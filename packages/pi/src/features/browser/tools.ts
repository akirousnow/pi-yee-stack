/**
 * The `browser_*` tools: a small, rewritten subset of chrome-devtools-mcp's
 * 33 tools.
 *
 * Every tool defaults to the current tab (`$t3`) and accepts `page: "$t5"`.
 * File-writing parameters are dropped, snapshots after an action are turned
 * into a diff, and the read-only tools carry `readOnlyHint` so Ask mode can
 * look at pages without clicking anything.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { type CallToolResult, limitMcpContent, toLlmContent } from "@earendil-works/pi-mcp";
import { Type } from "typebox";
import { formatSnapshotDiff, formatTabList, type PageInfo, parsePages, parseTabRef, tabRef } from "@yee-stack/browser";
import type { BrowserEngineLike } from "./mcp.ts";

export interface BrowserToolDeps {
	engine(): BrowserEngineLike;
	/** The session's current tab. */
	currentPage(): number | undefined;
	/** URL/title of the current tab, for re-finding it after a reconnect. */
	currentMeta(): { url: string; title: string } | undefined;
	/** A new tab became the current one. */
	setCurrentPage(pageId: number): void;
	/** The current tab was closed. */
	clearCurrentPage(): void;
}

/** Upstream tools the feature forwards. Anything missing is skipped at runtime. */
export const BROWSER_UPSTREAM_TOOLS: readonly string[] = [
	"list_pages",
	"take_snapshot",
	"take_screenshot",
	"navigate_page",
	"new_page",
	"close_page",
	"click",
	"hover",
	"fill",
	"fill_form",
	"type_text",
	"press_key",
	"wait_for",
	"handle_dialog",
	"upload_file",
];

interface ToolSpec {
	name: string;
	upstream: string;
	label: string;
	description: string;
	snippet: string;
	readOnly: boolean;
	needsPage: boolean;
	parameters: ReturnType<typeof Type.Object>;
	/** Build the upstream arguments. `pageId` is resolved unless `needsPage` is false. */
	build(params: Record<string, unknown>, pageId: number | undefined): Record<string, unknown>;
	/** Replace the tool's text output. */
	format?(result: CallToolResult, deps: BrowserToolDeps): string | undefined;
	/** React to a successful call (new/closed tab). */
	after?(result: CallToolResult, deps: BrowserToolDeps): void;
}

const pageParameter = Type.Optional(
	Type.Union([Type.String(), Type.Number()], {
		description: 'Tab to use: "$t3", "t3" or 3. Defaults to the current tab.',
	}),
);

const snapshotParameter = Type.Optional(
	Type.Boolean({ description: "Return the changed elements after the action. Defaults to true." }),
);

function textOf(result: CallToolResult): string {
	return result.content
		.filter((block) => block.type === "text")
		.map((block) => block.text)
		.join("\n")
		.trim();
}

function errorOf(result: CallToolResult): string {
	const text = textOf(result);
	return text || "chrome-devtools-mcp 返回了错误";
}

function requireString(params: Record<string, unknown>, key: string, allowEmpty = false): string {
	const value = params[key];
	if (typeof value !== "string" || (!allowEmpty && !value)) throw new Error(`缺少参数 ${key}`);
	return value;
}

function optionalString(params: Record<string, unknown>, key: string): string | undefined {
	const value = params[key];
	return typeof value === "string" && value ? value : undefined;
}

function optionalNumber(params: Record<string, unknown>, key: string): number | undefined {
	const value = params[key];
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function optionalBoolean(params: Record<string, unknown>, key: string): boolean | undefined {
	const value = params[key];
	return typeof value === "boolean" ? value : undefined;
}

/** Only keep defined values: chrome-devtools-mcp validates against its own schema. */
function compact(args: Record<string, unknown>): Record<string, unknown> {
	return Object.fromEntries(Object.entries(args).filter(([, value]) => value !== undefined));
}

function firstActionLine(text: string): string {
	const lines = text.split(/\r?\n/);
	const cut = lines.findIndex((line) => /^##\s*Latest page snapshot/i.test(line) || /uid=/.test(line));
	const head = (cut === -1 ? lines : lines.slice(0, cut))
		.map((line) => line.trim())
		.filter(Boolean)
		.join(" ");
	return head || "Done";
}

/** Drop chrome-devtools-mcp's `## Pages` block from a tool result. */
function stripPageList(text: string): string {
	const lines = text.split(/\r?\n/);
	const index = lines.findIndex((line) => /^##\s*Pages\s*$/i.test(line.trim()));
	return (index === -1 ? text : lines.slice(0, index).join("\n")).trim();
}

function imageExtension(mimeType: string): string {
	if (/png/i.test(mimeType)) return ".png";
	if (/webp/i.test(mimeType)) return ".webp";
	return ".jpg";
}

async function saveOutput(data: string | Uint8Array, extension: string): Promise<string> {
	const dir = join(tmpdir(), "yee-browser");
	await mkdir(dir, { recursive: true });
	const file = join(dir, `${Date.now()}-${randomUUID()}${extension}`);
	await writeFile(file, data);
	return file;
}

/** Resolve the page a call should use. */
async function resolvePageId(
	engine: BrowserEngineLike,
	deps: BrowserToolDeps,
	raw: unknown,
): Promise<number | undefined> {
	if (raw !== undefined && raw !== null) {
		const explicit = parseTabRef(raw);
		if (explicit === undefined) throw new Error(`无法识别的 tab：${String(raw)}（用 $t3、t3 或 3）`);
		let page = engine.pages().find((candidate) => candidate.id === explicit);
		if (!page) {
			await engine.refreshPages({ force: true, timeoutMs: 8_000 });
			page = engine.pages().find((candidate) => candidate.id === explicit);
		}
		if (!page) throw new Error(`没有 ${tabRef(explicit)}；用 browser_tabs 查看可用的 tab`);
		return page.id;
	}

	let pages = engine.pages();
	if (pages.length === 0) pages = await engine.refreshPages({ force: true, timeoutMs: 8_000 });

	const current = deps.currentPage();
	if (current !== undefined) {
		const page = pages.find((candidate) => candidate.id === current);
		if (page) return page.id;
		// The server may have restarted and renumbered pages: try URL, then title.
		const meta = deps.currentMeta();
		const recovered =
			(meta?.url ? pages.find((candidate) => candidate.url === meta.url) : undefined) ??
			(meta?.title ? pages.find((candidate) => candidate.title === meta.title) : undefined);
		if (recovered) {
			deps.setCurrentPage(recovered.id);
			return recovered.id;
		}
	}

	if (pages.length === 1) return pages[0]!.id;
	if (pages.length === 0) throw new Error("没有打开的 tab；用 browser_new_tab 打开一个");
	throw new Error(`有多个 tab，请用 page="$tN" 指定；当前 tab：${formatTabList(pages).split("\n").slice(0, 12).join(" / ")}`);
}

function newPages(before: ReadonlySet<number>, pages: readonly PageInfo[] | undefined): PageInfo[] {
	if (!pages) return [];
	return pages.filter((page) => !before.has(page.id));
}

const specs: ToolSpec[] = [
	{
		name: "browser_tabs",
		upstream: "list_pages",
		label: "Browser Tabs",
		description: "List the open browser tabs. Each tab is named $t<id>; pass page=\"$t3\" to other tools.",
		snippet: "List browser tabs and their $tN names",
		readOnly: true,
		needsPage: false,
		parameters: Type.Object({}),
		build: () => ({}),
		format: (result, deps) => {
			const pages = parsePages(result) ?? [...deps.engine().pages()];
			return formatTabList(pages, deps.currentPage());
		},
	},
	{
		name: "browser_snapshot",
		upstream: "take_snapshot",
		label: "Browser Snapshot",
		description:
			"Accessibility snapshot of the page. Every interactive element gets a uid used by click/fill/hover. Always take a fresh snapshot after a navigation.",
		snippet: "Snapshot a browser tab (uids for click/fill)",
		readOnly: true,
		needsPage: true,
		parameters: Type.Object({ page: pageParameter }),
		build: (_params, pageId) => ({ pageId }),
	},
	{
		name: "browser_screenshot",
		upstream: "take_screenshot",
		label: "Browser Screenshot",
		description:
			"Screenshot of the viewport, or of one element when uid is given. JPEG, at most 1280px wide. The result also reports the image's temp file path.",
		snippet: "Screenshot a browser tab",
		readOnly: true,
		needsPage: true,
		parameters: Type.Object({
			page: pageParameter,
			fullPage: Type.Optional(Type.Boolean({ description: "Capture the whole page instead of the viewport." })),
			uid: Type.Optional(Type.String({ description: "Snapshot uid of a single element." })),
		}),
		build: (params, pageId) =>
			compact({ pageId, fullPage: optionalBoolean(params, "fullPage"), uid: optionalString(params, "uid") }),
	},
	{
		name: "browser_navigate",
		upstream: "navigate_page",
		label: "Browser Navigate",
		description: 'Open a URL, or go back/forward/reload in the current tab. Example: type="url", url="https://example.com".',
		snippet: "Navigate, go back/forward or reload a tab",
		readOnly: false,
		needsPage: true,
		parameters: Type.Object({
			page: pageParameter,
			type: Type.Optional(StringEnum(["url", "back", "forward", "reload"] as const)),
			url: Type.Optional(Type.String({ description: "Required when type is url." })),
			ignoreCache: Type.Optional(Type.Boolean()),
			timeout: Type.Optional(Type.Integer({ minimum: 1, maximum: 300_000, description: "Navigation timeout in ms." })),
		}),
		build: (params, pageId) => {
			const url = optionalString(params, "url");
			const type = optionalString(params, "type") ?? (url ? "url" : undefined);
			if (type === "url" && !url) throw new Error('type="url" 需要 url 参数');
			return compact({
				pageId,
				type,
				url,
				ignoreCache: optionalBoolean(params, "ignoreCache"),
				timeout: optionalNumber(params, "timeout"),
			});
		},
	},
	{
		name: "browser_new_tab",
		upstream: "new_page",
		label: "Browser New Tab",
		description: "Open a URL in a new tab. The new tab becomes the current tab and gets a new $tN name.",
		snippet: "Open a URL in a new browser tab",
		readOnly: false,
		needsPage: false,
		parameters: Type.Object({
			url: Type.String({ description: "URL to open." }),
			background: Type.Optional(
				Type.Boolean({ description: "Open without focusing the tab. Defaults to true." }),
			),
			timeout: Type.Optional(Type.Integer({ minimum: 1, maximum: 300_000 })),
		}),
		build: (params) =>
			compact({
				url: requireString(params, "url"),
				background: optionalBoolean(params, "background") ?? true,
				timeout: optionalNumber(params, "timeout"),
			}),
		after: (result, deps) => {
			const pages = parsePages(result) ?? deps.engine().pages();
			const selected = pages.find((page) => page.selected) ?? pages[pages.length - 1];
			if (selected) deps.setCurrentPage(selected.id);
		},
	},
	{
		name: "browser_close_tab",
		upstream: "close_page",
		label: "Browser Close Tab",
		description: "Close a tab. The last remaining tab cannot be closed.",
		snippet: "Close a browser tab",
		readOnly: false,
		needsPage: true,
		parameters: Type.Object({ page: pageParameter }),
		build: (_params, pageId) => ({ pageId }),
		after: (result, deps) => {
			const pages = parsePages(result) ?? deps.engine().pages();
			const current = deps.currentPage();
			if (current !== undefined && !pages.some((page) => page.id === current)) deps.clearCurrentPage();
		},
	},
	{
		name: "browser_click",
		upstream: "click",
		label: "Browser Click",
		description: "Click an element by its snapshot uid. Returns the elements that appeared or changed.",
		snippet: "Click an element in a browser tab",
		readOnly: false,
		needsPage: true,
		parameters: Type.Object({
			page: pageParameter,
			uid: Type.String({ description: "uid from browser_snapshot." }),
			dblClick: Type.Optional(Type.Boolean()),
			includeSnapshot: snapshotParameter,
		}),
		build: (params, pageId) =>
			compact({
				pageId,
				uid: requireString(params, "uid"),
				dblClick: optionalBoolean(params, "dblClick"),
				includeSnapshot: optionalBoolean(params, "includeSnapshot") ?? true,
			}),
	},
	{
		name: "browser_hover",
		upstream: "hover",
		label: "Browser Hover",
		description: "Hover an element by its snapshot uid.",
		snippet: "Hover an element in a browser tab",
		readOnly: false,
		needsPage: true,
		parameters: Type.Object({
			page: pageParameter,
			uid: Type.String({ description: "uid from browser_snapshot." }),
			includeSnapshot: snapshotParameter,
		}),
		build: (params, pageId) =>
			compact({
				pageId,
				uid: requireString(params, "uid"),
				includeSnapshot: optionalBoolean(params, "includeSnapshot") ?? true,
			}),
	},
	{
		name: "browser_fill",
		upstream: "fill",
		label: "Browser Fill",
		description: "Set an input, textarea or select by snapshot uid. Prefer browser_fill_form for several fields.",
		snippet: "Fill one form field in a browser tab",
		readOnly: false,
		needsPage: true,
		parameters: Type.Object({
			page: pageParameter,
			uid: Type.String({ description: "uid from browser_snapshot." }),
			value: Type.String({ description: "Text to set, or an option label/value for a select." }),
			includeSnapshot: snapshotParameter,
		}),
		build: (params, pageId) =>
			compact({
				pageId,
				uid: requireString(params, "uid"),
				value: requireString(params, "value", true),
				includeSnapshot: optionalBoolean(params, "includeSnapshot") ?? true,
			}),
	},
	{
		name: "browser_fill_form",
		upstream: "fill_form",
		label: "Browser Fill Form",
		description: "Fill several inputs, selects, checkboxes or radios at once. Much faster than repeated browser_fill calls.",
		snippet: "Fill several form fields at once",
		readOnly: false,
		needsPage: true,
		parameters: Type.Object({
			page: pageParameter,
			elements: Type.Array(
				Type.Object({
					uid: Type.String({ description: "uid from browser_snapshot." }),
					value: Type.String({ description: "Value to set." }),
				}),
				{ description: "Fields to fill." },
			),
			includeSnapshot: snapshotParameter,
		}),
		build: (params, pageId) => {
			const elements = params.elements;
			if (!Array.isArray(elements) || elements.length === 0) throw new Error("elements 不能为空");
			return compact({
				pageId,
				elements: elements.map((element) => {
					const record = element as Record<string, unknown>;
					return { uid: requireString(record, "uid"), value: requireString(record, "value", true) };
				}),
				includeSnapshot: optionalBoolean(params, "includeSnapshot") ?? true,
			});
		},
	},
	{
		name: "browser_type",
		upstream: "type_text",
		label: "Browser Type",
		description: "Type text into the focused element, as real keystrokes. Use browser_fill when the element has a uid.",
		snippet: "Type into the focused browser element",
		readOnly: false,
		needsPage: true,
		parameters: Type.Object({
			page: pageParameter,
			text: Type.String({ description: "Text to type." }),
			submitKey: Type.Optional(Type.String({ description: 'Key pressed after typing, for example "Enter".' })),
		}),
		build: (params, pageId) =>
			compact({ pageId, text: requireString(params, "text"), submitKey: optionalString(params, "submitKey") }),
	},
	{
		name: "browser_press",
		upstream: "press_key",
		label: "Browser Press Key",
		description: 'Press a key or combination, for example "Enter", "Tab" or "Control+A".',
		snippet: "Press a key in a browser tab",
		readOnly: false,
		needsPage: true,
		parameters: Type.Object({
			page: pageParameter,
			key: Type.String({ description: "Key name." }),
			includeSnapshot: snapshotParameter,
		}),
		build: (params, pageId) =>
			compact({
				pageId,
				key: requireString(params, "key"),
				includeSnapshot: optionalBoolean(params, "includeSnapshot") ?? true,
			}),
	},
	{
		name: "browser_wait",
		upstream: "wait_for",
		label: "Browser Wait",
		description: "Wait until one of the given texts appears on the page.",
		snippet: "Wait for text to appear on a page",
		readOnly: true,
		needsPage: true,
		parameters: Type.Object({
			page: pageParameter,
			text: Type.Array(Type.String(), { description: "Texts to wait for; one match is enough." }),
			timeout: Type.Optional(Type.Integer({ minimum: 1, maximum: 300_000, description: "Timeout in ms." })),
			visible: Type.Optional(Type.Boolean({ description: "Require the text to be visible." })),
		}),
		build: (params, pageId) => {
			const text = params.text;
			if (!Array.isArray(text)) throw new Error("text 不能为空");
			const wanted = text.filter((item): item is string => typeof item === "string" && item.length > 0);
			if (wanted.length === 0) throw new Error("text 不能为空");
			return compact({
				pageId,
				text: wanted,
				timeout: optionalNumber(params, "timeout"),
				visible: optionalBoolean(params, "visible"),
			});
		},
	},
	{
		name: "browser_dialog",
		upstream: "handle_dialog",
		label: "Browser Dialog",
		description: "Accept or dismiss the browser dialog (alert/confirm/prompt) that is currently open.",
		snippet: "Handle an open browser dialog",
		readOnly: false,
		needsPage: true,
		parameters: Type.Object({
			page: pageParameter,
			action: StringEnum(["accept", "dismiss"] as const),
			promptText: Type.Optional(Type.String({ description: "Text for a prompt dialog." })),
		}),
		build: (params, pageId) =>
			compact({ pageId, action: requireString(params, "action"), promptText: optionalString(params, "promptText") }),
	},
	{
		name: "browser_upload",
		upstream: "upload_file",
		label: "Browser Upload",
		description: "Set files on a file input, by snapshot uid. Paths must be inside the current project.",
		snippet: "Upload files through a file input",
		readOnly: false,
		needsPage: true,
		parameters: Type.Object({
			page: pageParameter,
			uid: Type.String({ description: "uid of the file input." }),
			filePaths: Type.Array(Type.String(), { description: "Absolute paths." }),
			includeSnapshot: snapshotParameter,
		}),
		build: (params, pageId) => {
			const filePaths = params.filePaths;
			if (!Array.isArray(filePaths)) throw new Error("filePaths 不能为空");
			const paths = filePaths.filter((item): item is string => typeof item === "string" && item.length > 0);
			if (paths.length === 0) throw new Error("filePaths 不能为空");
			return compact({
				pageId,
				uid: requireString(params, "uid"),
				filePaths: paths,
				includeSnapshot: optionalBoolean(params, "includeSnapshot") ?? true,
			});
		},
	},
];

/** Per-tool model guidance, included while the tool is active. */
function guidelinesFor(name: string): string[] | undefined {
	if (name === "browser_snapshot") {
		return [
			"Use browser_snapshot before browser_click, browser_fill or browser_press; uids come from the latest snapshot and expire after the page changes.",
			"Use browser_tabs when the user mentions a tab that is not the current one.",
		];
	}
	if (name === "browser_screenshot") {
		return [
			"browser_screenshot returns an image block in a normal tool call. In codemode mode only the text survives, so use the temp file path it reports with read and image() to view the screenshot.",
		];
	}
	return undefined;
}

export interface BrowserToolDefinition extends ToolDefinition {
	/** The chrome-devtools-mcp tool this one forwards. */
	upstream: string;
	readOnly: boolean;
}

export function createBrowserTools(deps: BrowserToolDeps): BrowserToolDefinition[] {
	return specs.map((spec) => {
		const definition: BrowserToolDefinition = {
			name: spec.name,
			label: spec.label,
			description: spec.description,
			upstream: spec.upstream,
			readOnly: spec.readOnly,
			promptSnippet: spec.snippet,
			promptGuidelines: guidelinesFor(spec.name),
			parameters: spec.parameters,
			defaultActive: false,
			executionMode: "sequential",
			annotations: spec.readOnly ? { readOnlyHint: true } : undefined,
			async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
				const engine = deps.engine();
				if (engine.state !== "connected") {
					return {
						content: [{ type: "text", text: "浏览器未连接：先执行 /browser on" }],
						details: { error: true },
						isError: true,
					};
				}

				const input = (params ?? {}) as Record<string, unknown>;
				const before = new Set(engine.pages().map((page) => page.id));
				const pageId = spec.needsPage ? await resolvePageId(engine, deps, input.page) : undefined;
				const args = spec.build(input, pageId);
				const result = await engine.call(spec.upstream, args, { signal, timeoutMs: 120_000 });

				if (!result.isError) spec.after?.(result, deps);

				const pages = parsePages(result);
				if (pages) engine.setPages(pages);
				const addedTabs = newPages(before, pages);

				const limited = await limitMcpContent(toLlmContent(result), saveOutput);
				const rawText = textOf(result);
				let text = limited.content
					.filter((block) => block.type === "text")
					.map((block) => block.text)
					.join("\n")
					.trim();
				const images = limited.content.filter((block) => block.type === "image");

				const formatted = spec.format?.(result, deps);
				if (formatted !== undefined) {
					text = formatted;
				} else if (!result.isError && pageId !== undefined && /uid=/.test(rawText)) {
					if (spec.name === "browser_snapshot") {
						engine.snapshots.update(pageId, rawText, { forceFull: true });
					} else {
						const diff = engine.snapshots.update(pageId, rawText);
						if (!diff.full) text = `${firstActionLine(rawText)}\n${formatSnapshotDiff(diff, pageId)}`;
					}
				}

				if (addedTabs.length > 0) {
					if (spec.name === "browser_new_tab" && addedTabs.length === 1) {
						const opened = addedTabs[0]!;
						text = `已打开 ${tabRef(opened.id)} ${opened.title || opened.url}`;
					} else {
						text += `\n新 tab：${addedTabs.map((page) => `${tabRef(page.id)} ${page.title || page.url}`).join("；")}`;
					}
				} else if (spec.name === "browser_close_tab" && pageId !== undefined && !result.isError) {
					text = `已关闭 ${tabRef(pageId)}`;
				} else if (pages && spec.name !== "browser_tabs" && !result.isError) {
					text = stripPageList(text);
				}
				if (limited.fullOutputPath) text += `\n[完整输出：${limited.fullOutputPath}]`;
				if (!result.isError && spec.name === "browser_screenshot" && images.length > 0) {
					const paths = await Promise.all(
						images.map((image) => saveOutput(Buffer.from(image.data, "base64"), imageExtension(image.mimeType))),
					);
					text += `\n[截图文件：${paths.join("，")}]`;
				}
				if (result.isError) text = `错误：${errorOf(result)}`;

				return {
					content: [
						{ type: "text" as const, text: text || "Done" },
						...images.map((image) => ({ type: "image" as const, data: image.data, mimeType: image.mimeType })),
					],
					details: { pageId, epoch: engine.epoch, upstream: spec.upstream, error: result.isError === true },
					isError: result.isError === true,
				};
			},
		};
		return definition;
	});
}
