/**
 * The `browser_*` tools for DeepSeek Harness.
 *
 * They are a curated forwarding layer over chrome-devtools-mcp, the same 15
 * tools the Pi extension exposes: `page` is optional and defaults to the
 * current tab, snapshots come back as diffs after an action, and nothing here
 * can write files except the screenshot's own temp file.
 *
 * The tools register globally with a `when` condition, so they only exist
 * while the browser is connected.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { ContentBlock } from "@deepseek-ai/dsh-llm";
import { defineTool, type ToolDefinition, type ToolRunContext } from "@deepseek-ai/dsh-tools";
import {
	formatSnapshotDiff,
	formatTabList,
	type PageInfo,
	parsePages,
	parseTabRef,
	SnapshotCache,
	tabRef,
} from "@yee-stack/browser";
import type { McpToolResult } from "./mcp.ts";

/** One JSON-serializable content block; the canonical tool value. */
export interface RenderedBlock {
	type: "text";
	text: string;
}

/** The canonical value every browser tool returns. */
export interface BrowserToolValue {
	blocks: RenderedBlock[];
}

export interface BrowserToolDeps {
	/** Call one chrome-devtools-mcp tool. */
	call(name: string, args: Record<string, unknown>, options?: { signal?: AbortSignal }): Promise<McpToolResult>;
	/** Tabs as of the last `list_pages` response. */
	pages(): readonly PageInfo[];
	/** Replace the cached tab list. */
	setPages(pages: readonly PageInfo[]): void;
	/** The tab tools default to. */
	current(): number | undefined;
	/** Make a tab current (used by `browser_tabs`). */
	setCurrent(pageId: number | undefined): void;
	/** Per-page snapshot cache, for action diffs. */
	snapshots: SnapshotCache;
	/** Directory for screenshot files. */
	screenshotDir?: string;
}

/**
 * The author-facing parameter DSL, kept structural so the spec table stays
 * plain data instead of fifteen generic call sites.
 */
type ParameterLike = Record<string, any>;

interface ToolSpec {
	name: string;
	upstream: string;
	readOnly: boolean;
	description: string;
	parameters: ParameterLike;
	/** Build the upstream arguments; `pageId` is already resolved. */
	args(input: Record<string, unknown>, pageId: number | undefined): Record<string, unknown>;
	/** Ask chrome-devtools-mcp to include a snapshot with the result. */
	snapshot?: boolean;
}

const PAGE_PARAM: ParameterLike = {
	type: "string",
	description: '目标 tab，例如 "$t3"；省略时用当前 tab',
};

const UID_PARAM: ParameterLike = {
	type: "string",
	required: true,
	description: "元素的 uid，来自最近一次 browser_snapshot",
};

function textResult(text: string): BrowserToolValue {
	return { blocks: [{ type: "text", text }] };
}

function errorText(result: McpToolResult): string {
	const text = result.content
		.filter((block) => block.type === "text" && typeof block.text === "string")
		.map((block) => block.text)
		.join("\n")
		.trim();
	return text || "chrome-devtools-mcp 返回了错误";
}

/** The accessibility snapshot part of a tool result, if it has one. */
function splitSnapshot(text: string): { before: string; snapshot: string } | undefined {
	const lines = text.split("\n");
	const start = lines.findIndex((line) => /^\s*uid=\S+/.test(line));
	if (start < 0) return undefined;
	return {
		before: lines.slice(0, start).join("\n").trim(),
		snapshot: lines.slice(start).join("\n"),
	};
}

const TOOLS: ToolSpec[] = [
	{
		name: "browser_tabs",
		upstream: "list_pages",
		readOnly: true,
		description: "列出浏览器里的 tab。tab 名就是 $tN，其它 browser_* 工具的 page 参数用它。",
		parameters: {},
		args: () => ({}),
	},
	{
		name: "browser_snapshot",
		upstream: "take_snapshot",
		readOnly: true,
		description: "取当前页面的无障碍快照。元素带 uid，点击、填表都用这个 uid；导航或 DOM 变化后 uid 会失效。",
		parameters: { page: PAGE_PARAM },
		args: (_input, pageId) => (pageId === undefined ? {} : { pageId }),
	},
	{
		name: "browser_screenshot",
		upstream: "take_screenshot",
		readOnly: true,
		description: "截图（JPEG）。图片会写到临时文件，结果里给出路径，用 read_image 查看。",
		parameters: {
			page: PAGE_PARAM,
			fullPage: { type: "boolean", description: "整页截图（默认只截视口）" },
			uid: { type: "string", description: "只截这个 uid 对应的元素" },
		},
		args: (input, pageId) => ({
			...(pageId === undefined ? {} : { pageId }),
			...(input.fullPage === true ? { fullPage: true } : {}),
			...(typeof input.uid === "string" ? { uid: input.uid } : {}),
		}),
	},
	{
		name: "browser_navigate",
		upstream: "navigate_page",
		readOnly: false,
		description: '打开 URL，或在当前 tab 后退 / 前进 / 刷新。默认 type="url"。',
		parameters: {
			url: { type: "string", description: '要打开的地址；type="url" 时必填' },
			type: {
				type: "string",
				enum: ["url", "back", "forward", "reload"],
				description: "导航方式，省略时按 url 处理",
			},
			page: PAGE_PARAM,
		},
		args: (input, pageId) => {
			const url = typeof input.url === "string" ? input.url : undefined;
			const type = typeof input.type === "string" ? input.type : url ? "url" : undefined;
			if (type === "url" && !url) throw new Error('type="url" 需要 url 参数');
			return {
				type,
				url,
				...(pageId === undefined ? {} : { pageId }),
			};
		},
		snapshot: true,
	},
	{
		name: "browser_new_tab",
		upstream: "new_page",
		readOnly: false,
		description: "新建一个 tab（后台打开），返回新 tab 的名字。",
		parameters: {
			url: { type: "string", description: "新 tab 打开的地址" },
			background: { type: "boolean", description: "后台打开（默认 true）" },
		},
		args: (input) => ({
			...(typeof input.url === "string" ? { url: input.url } : {}),
			// chrome-devtools-mcp focuses a new page unless told otherwise; pi defaults to background.
			background: input.background !== false,
		}),
	},
	{
		name: "browser_close_tab",
		upstream: "close_page",
		readOnly: false,
		description: "关闭一个 tab。",
		parameters: { page: PAGE_PARAM },
		args: (_input, pageId) => (pageId === undefined ? {} : { pageId }),
	},
	{
		name: "browser_click",
		upstream: "click",
		readOnly: false,
		description: "按 uid 点击元素。点击前先 browser_snapshot。",
		parameters: { uid: UID_PARAM, page: PAGE_PARAM },
		args: (input, pageId) => ({ uid: input.uid, ...(pageId === undefined ? {} : { pageId }) }),
		snapshot: true,
	},
	{
		name: "browser_hover",
		upstream: "hover",
		readOnly: false,
		description: "按 uid 悬停元素。",
		parameters: { uid: UID_PARAM, page: PAGE_PARAM },
		args: (input, pageId) => ({ uid: input.uid, ...(pageId === undefined ? {} : { pageId }) }),
		snapshot: true,
	},
	{
		name: "browser_fill",
		upstream: "fill",
		readOnly: false,
		description: "给一个输入框填值（替换原内容）。",
		parameters: {
			uid: UID_PARAM,
			value: { type: "string", required: true, description: "要填入的值" },
			page: PAGE_PARAM,
		},
		args: (input, pageId) => ({ uid: input.uid, value: input.value, ...(pageId === undefined ? {} : { pageId }) }),
		snapshot: true,
	},
	{
		name: "browser_fill_form",
		upstream: "fill_form",
		readOnly: false,
		description: "批量填表：一次传入多个 {uid, value}，比多次 browser_fill 快。",
		parameters: {
			fields: {
				type: "array",
				required: true,
				description: '要填的字段，例如 [{"uid":"1_2","value":"张三"}]',
				items: {
					type: "object",
					additionalProperties: false,
					properties: {
						uid: { type: "string", required: true, description: "元素 uid" },
						value: { type: "string", required: true, description: "填入的值" },
					},
				},
			},
			page: PAGE_PARAM,
		},
		args: (input, pageId) => ({ elements: input.fields, ...(pageId === undefined ? {} : { pageId }) }),
		snapshot: true,
	},
	{
		name: "browser_type",
		upstream: "type_text",
		readOnly: false,
		description: "往当前焦点输入文字（不会先清空）。",
		parameters: {
			text: { type: "string", required: true, description: "要输入的文字" },
			page: PAGE_PARAM,
		},
		args: (input, pageId) => ({ text: input.text, ...(pageId === undefined ? {} : { pageId }) }),
		snapshot: true,
	},
	{
		name: "browser_press",
		upstream: "press_key",
		readOnly: false,
		description: '按键，例如 "Enter"、"Control+A"。',
		parameters: {
			key: { type: "string", required: true, description: "键名" },
			page: PAGE_PARAM,
		},
		args: (input, pageId) => ({ key: input.key, ...(pageId === undefined ? {} : { pageId }) }),
		snapshot: true,
	},
	{
		name: "browser_wait",
		upstream: "wait_for",
		readOnly: true,
		description: "等某段文字出现在页面上。",
		parameters: {
			text: { type: "string", required: true, description: "要等待的文字" },
			timeoutMs: { type: "number", description: "超时毫秒数" },
			page: PAGE_PARAM,
		},
		args: (input, pageId) => ({
			// wait_for takes a list of texts; one match is enough.
			text: [input.text],
			...(typeof input.timeoutMs === "number" ? { timeout: input.timeoutMs } : {}),
			...(pageId === undefined ? {} : { pageId }),
		}),
	},
	{
		name: "browser_dialog",
		upstream: "handle_dialog",
		readOnly: false,
		description: "处理 alert / confirm / prompt。",
		parameters: {
			action: {
				type: "string",
				required: true,
				enum: ["accept", "dismiss"],
				description: "确认还是取消",
			},
			promptText: { type: "string", description: "prompt 要输入的文本" },
			page: PAGE_PARAM,
		},
		args: (input, pageId) => ({
			action: input.action,
			...(typeof input.promptText === "string" ? { promptText: input.promptText } : {}),
			...(pageId === undefined ? {} : { pageId }),
		}),
	},
	{
		name: "browser_upload",
		upstream: "upload_file",
		readOnly: false,
		description: "给 file input 设置文件（路径需在项目目录内）。",
		parameters: {
			uid: UID_PARAM,
			paths: {
				type: "array",
				required: true,
				items: { type: "string" },
				description: "要上传的文件路径",
			},
			page: PAGE_PARAM,
		},
		args: (input, pageId) => ({
			uid: input.uid,
			filePaths: input.paths,
			...(pageId === undefined ? {} : { pageId }),
		}),
	},
];

/** chrome-devtools-mcp tool names these wrappers need. */
export const BROWSER_UPSTREAM_TOOLS: readonly string[] = TOOLS.map((spec) => spec.upstream);

/** Resolve the tab a call should use, defaulting to the current one. */
export function resolvePageId(
	deps: Pick<BrowserToolDeps, "pages" | "current">,
	raw: unknown,
): number | undefined {
	const explicit = parseTabRef(raw);
	if (explicit !== undefined) return explicit;
	const current = deps.current();
	if (current !== undefined) return current;
	const pages = deps.pages();
	return pages.length === 1 ? pages[0]?.id : undefined;
}

function requirePageId(deps: BrowserToolDeps, raw: unknown): number {
	const pageId = resolvePageId(deps, raw);
	if (pageId !== undefined) return pageId;
	const pages = deps.pages();
	if (pages.length === 0) throw new Error("没有打开的 tab：先用 /browser launch 或 browser_new_tab");
	throw new Error(`有多个 tab，请用 page 参数指定：\n${formatTabList(pages)}`);
}

/** Render one MCP result into text blocks, turning action snapshots into diffs. */
function renderResult(
	deps: BrowserToolDeps,
	spec: ToolSpec,
	pageId: number | undefined,
	result: McpToolResult,
): BrowserToolValue {
	const text = result.content
		.filter((block) => block.type === "text" && typeof block.text === "string")
		.map((block) => block.text as string)
		.join("\n")
		.trim();
	if (result.isError) throw new Error(text || `${spec.upstream} 失败`);

	const parts: string[] = [];
	if (spec.upstream === "take_snapshot") {
		if (pageId !== undefined) deps.snapshots.update(pageId, text, { forceFull: true });
		return textResult(text);
	}

	if (spec.snapshot && pageId !== undefined) {
		const split = splitSnapshot(text);
		if (split) {
			const diff = deps.snapshots.update(pageId, split.snapshot);
			if (split.before) parts.push(split.before);
			parts.push(diff.full ? split.snapshot : formatSnapshotDiff(diff, pageId));
		} else if (text) {
			parts.push(text);
		}
	} else if (text) {
		parts.push(text);
	}

	const images = result.content.filter((block) => block.type === "image" && typeof block.data === "string");
	for (const image of images) {
		parts.push(`[截图：${image.mimeType ?? "image/jpeg"}，${image.data?.length ?? 0} base64 字节]`);
	}
	return textResult(parts.join("\n\n"));
}

/** Screenshots land in a temp file so `read_image` can open them. */
async function writeScreenshot(deps: BrowserToolDeps, data: string, mimeType: string | undefined): Promise<string> {
	const dir = deps.screenshotDir ?? join(tmpdir(), "yee-stack-browser");
	await mkdir(dir, { recursive: true });
	const extension = mimeType === "image/png" ? "png" : "jpg";
	const path = join(dir, `${Date.now()}-${randomUUID().slice(0, 8)}.${extension}`);
	await writeFile(path, Buffer.from(data, "base64"));
	return path;
}

/** Build one registry-ready tool from a spec. */
function buildTool(deps: BrowserToolDeps, spec: ToolSpec): ToolDefinition {
	const options = {
		name: spec.name,
		description: spec.description,
		parameters: spec.parameters,
		output: {
			schema: { type: "json" },
			render: (_args: unknown, value: unknown) => (value as BrowserToolValue).blocks as ContentBlock[],
		},
		execute: async (args: unknown, exec: ToolRunContext) => {
			const input = args as Record<string, unknown>;
			const pageId = spec.upstream === "list_pages" || spec.upstream === "new_page" ? undefined : requirePageId(deps, input.page);
			const upstreamArgs = spec.args(input, pageId);
			// Actions ask for a snapshot so the caller sees what changed; the renderer
			// turns it into a diff.
			if (spec.snapshot && upstreamArgs.includeSnapshot === undefined) upstreamArgs.includeSnapshot = true;
			const result = await deps.call(spec.upstream, upstreamArgs, { signal: exec.signal });

			const pages = parsePages(result);
			if (pages) deps.setPages(pages);

			if (spec.upstream === "list_pages") {
				return textResult(formatTabList(deps.pages(), deps.current()));
			}
			if (spec.upstream === "close_page" && !result.isError) {
				const current = deps.current();
				if (current !== undefined && !deps.pages().some((page) => page.id === current)) deps.setCurrent(undefined);
			}
			if (spec.upstream === "new_page" && !result.isError) {
				const created = parsePages(result);
				const page = created?.find((candidate) => candidate.selected) ?? created?.[0];
				if (page) deps.setCurrent(page.id);
				return textResult(`已新建 ${page ? tabRef(page.id) : "tab"}${page ? ` — ${page.title || page.url}` : ""}`);
			}

			const rendered = renderResult(deps, spec, pageId, result);
			const images = result.content.filter((block) => block.type === "image" && typeof block.data === "string");
			if (images.length > 0) {
				const paths: string[] = [];
				for (const image of images) paths.push(await writeScreenshot(deps, image.data as string, image.mimeType));
				rendered.blocks.push({ type: "text", text: `[截图文件：${paths.join(", ")}]` });
			}
			return rendered;
		},
	};
	// The spec table is data, so defineTool's generic inference is bypassed here;
	// it still compiles and validates the schema when the tool is registered.
	return (defineTool as unknown as (spec: unknown) => ToolDefinition)(options);
}

/** Every browser tool, bound to one engine. */
export function createBrowserTools(deps: BrowserToolDeps): ToolDefinition[] {
	return TOOLS.map((spec) => buildTool(deps, spec));
}

/** Tools that are read-only, for Ask-mode filtering. */
export const READ_ONLY_BROWSER_TOOLS: ReadonlySet<string> = new Set(
	TOOLS.filter((spec) => spec.readOnly).map((spec) => spec.name),
);
