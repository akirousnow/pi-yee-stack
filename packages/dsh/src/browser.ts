/**
 * Browser control for DeepSeek Harness.
 *
 *   /browser            list tabs (or connect when not connected)
 *   /browser on [url]   connect through auto-detect or an explicit endpoint
 *   /browser launch     start a dedicated Chrome
 *   /browser off        disconnect
 *   /browser status     connection, tabs and the current tab
 *   /browser tabs       list tabs
 *   /browser use $t3    make a tab current
 *
 * Sending a message that contains `$t3` makes that tab current for the run;
 * the message itself is never rewritten, and the `yee:browser` prompt section
 * explains what the reference means.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Context } from "@deepseek-ai/cordis";
import {
	browserSectionText,
	buildServerCommand,
	currentConnectEnv,
	type ConnectPlan,
	findTabRef,
	isRemoteConnectPlan,
	type PageInfo,
	pagesChanged,
	parsePages,
	parseStructuredPages,
	parseTabRef,
	planConnection,
	SnapshotCache,
	tabRef,
	formatTabList,
} from "yee-stack-browser";
import { type BrowserOptions, toBrowserConfig } from "./config.ts";
import { McpStdioClient, serverBin } from "./mcp.ts";
import { createBrowserTools, READ_ONLY_BROWSER_TOOLS } from "./tools.ts";

/** The system-prompt section name (becomes the `yee:browser` tag). */
export const BROWSER_SECTION = "yee:browser";

type State = "idle" | "connecting" | "connected" | "error";

export interface BrowserRuntime {
	connect(overrides?: Partial<BrowserOptions>): Promise<void>;
	disconnect(): Promise<void>;
	status(): string;
}

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** The harness home directory, where a launched Chrome's profile lives. */
function dshHome(): string {
	return process.env.DSH_HOME || join(homedir(), ".dsh");
}

export async function registerBrowser(ctx: Context, options: BrowserOptions): Promise<BrowserRuntime> {
	let state: State = "idle";
	let error: string | undefined;
	let client: McpStdioClient | undefined;
	let remote = false;
	let pages: PageInfo[] = [];
	let current: number | undefined;
	const roots = new Set<string>();
	const snapshots = new SnapshotCache();

	const ensureRoot = async (dir: string): Promise<void> => {
		if (!dir || roots.has(dir)) return;
		roots.add(dir);
		if (state === "connected" && client) await client.syncRoots();
	};

	const setPages = (next: readonly PageInfo[]): void => {
		if (!pagesChanged(pages, next)) return;
		pages = [...next];
	};

	async function refresh(): Promise<void> {
		if (state !== "connected" || !client) return;
		try {
			const result = await client.callTool("list_pages", {}, { timeoutMs: 15_000 });
			const parsed = parsePages(result);
			if (parsed) setPages(parsed);
		} catch {
			// Keep the last known list; the section and the tools still work.
		}
	}

	async function connect(overrides: Partial<BrowserOptions> = {}): Promise<void> {
		const settings = { ...options, ...overrides };
		await disconnect();
		state = "connecting";
		error = undefined;
		try {
			const env = currentConnectEnv(dshHome());
			const plan: ConnectPlan = await planConnection(toBrowserConfig(settings), env);
			if (plan.mode === "none") throw new Error(plan.reason);
			const command = buildServerCommand(toBrowserConfig(settings), plan, env, serverBin());
			client = await McpStdioClient.connect(command, {
				timeoutMs: 120_000,
				roots: () =>
					[...roots].map((path) => ({
						uri: pathToFileURL(path).href,
						name: path,
					})),
			});
			remote = isRemoteConnectPlan(plan);
			state = "connected";
			const result = await client.callTool("list_pages", {}, { timeoutMs: 60_000 });
			const parsed = parsePages(result);
			if (!parsed) throw new Error("无法解析 list_pages 的结果");
			pages = parsed;
			current = parsed.find((page) => page.selected)?.id ?? parsed[0]?.id;
		} catch (cause) {
			state = "error";
			error = message(cause);
			await client?.close().catch(() => {});
			client = undefined;
			remote = false;
			throw new Error(error);
		}
	}

	async function disconnect(): Promise<void> {
		await client?.close().catch(() => {});
		client = undefined;
		remote = false;
		state = "idle";
		error = undefined;
		pages = [];
		current = undefined;
		roots.clear();
		snapshots.clear();
	}

	const tools = createBrowserTools({
		call: async (name, args, callOptions) => {
			if (!client || state !== "connected") throw new Error("浏览器未连接：先执行 /browser on");
			const result = await client.callTool(name, args, { signal: callOptions?.signal });
			const parsed = parseStructuredPages(result);
			if (parsed && parsed.length > 0) setPages(parsed);
			return result;
		},
		pages: () => pages,
		setPages,
		current: () => current,
		setCurrent: (pageId) => {
			current = pageId;
		},
		remote: () => remote,
		allowRemoteUpload: () => options.allowRemoteUpload,
		ensureRoot,
		snapshots,
	});
	for (const tool of tools) {
		ctx.tools.register(tool, { when: () => state === "connected" });
	}

	ctx.systemPrompt.section({
		name: BROWSER_SECTION,
		order: ctx.systemPrompt.getSectionOrder("MCP_SERVERS") - 10,
		text: () => (state === "connected" ? browserSectionText(pages, current) : ""),
	});

	// `$t3 …` in a user message selects that tab for the run.
	ctx.on("agent/pre-step", async ({ messages }, next) => {
		if (state !== "connected") return next();
		for (const userMessage of messages) {
			for (const block of userMessage.content) {
				if (block.type !== "text") continue;
				const id = findTabRef(block.text);
				if (id !== undefined && pages.some((page) => page.id === id)) current = id;
			}
		}
		return next();
	});

	const status = (): string => {
		const label =
			state === "connected" ? "已连接" : state === "connecting" ? "连接中" : state === "error" ? "连接失败" : "未连接";
		const lines = [`浏览器：${label}`];
		if (state === "connected") {
			lines.push(`tab：${pages.length} 个`);
			const page = current === undefined ? undefined : pages.find((candidate) => candidate.id === current);
			lines.push(`当前 tab：${page ? `${tabRef(page.id)} ${page.title || page.url}` : "未选择"}`);
			lines.push(`工具：${tools.length} 个（只读 ${READ_ONLY_BROWSER_TOOLS.size} 个）`);
		} else if (error) {
			lines.push(`原因：${error}`);
		}
		return lines.join("\n");
	};

	ctx.inject(["commands"], (commandCtx) => {
		commandCtx.commands.register({
			name: "browser",
			description: "浏览器：/browser 列出 tab · on [地址] · launch · off · status · tabs · use $t3",
			input: { hint: "[on [url]|launch|off|status|tabs|use $t3]" },
			handler: async ({ rawInput }) => {
				const text = rawInput.trim();
				const [word, ...rest] = text.split(/\s+/);
				const tail = rest.join(" ").trim();
				try {
					switch ((word ?? "").toLowerCase()) {
						case "":
							if (state === "connected") return { kind: "success", text: formatTabList(pages, current) };
							await connect();
							return { kind: "success", text: `浏览器已连接：${pages.length} 个 tab` };
						case "on":
							await connect(tail ? { connect: "url", endpoint: tail } : {});
							return { kind: "success", text: `浏览器已连接：${pages.length} 个 tab` };
						case "launch":
							await connect({ connect: "launch" });
							return { kind: "success", text: `已启动并连接 Chrome：${pages.length} 个 tab` };
						case "off":
							await disconnect();
							return { kind: "success", text: "浏览器已断开。" };
						case "status":
							return { kind: "success", text: status() };
						case "tabs":
							return {
								kind: "success",
								text: state === "connected" ? formatTabList(pages, current) : "浏览器未连接：先 /browser on",
							};
						case "use": {
							const id = parseTabRef(tail);
							if (id === undefined) return { kind: "error", text: "用法：/browser use $t3" };
							await refresh();
							const page = pages.find((candidate) => candidate.id === id);
							if (!page) return { kind: "error", text: `没有找到 ${tabRef(id)}；用 /browser tabs 查看` };
							current = page.id;
							return { kind: "success", text: `当前 tab：${tabRef(page.id)} ${page.title || page.url}` };
						}
						default: {
							const id = parseTabRef(text);
							if (id === undefined) return { kind: "error", text: "用法：/browser [on [地址] | launch | off | status | tabs | use $t3]" };
							current = id;
							return { kind: "success", text: `当前 tab：${tabRef(id)}` };
						}
					}
				} catch (cause) {
					return { kind: "error", text: `浏览器操作失败：${message(cause)}` };
				}
			},
		});
	});

	if (options.listenOnStartup) {
		void connect().catch((cause) => ctx.logger?.warn("yee-stack: 浏览器启动连接失败: %o", cause));
	}

	ctx.effect(() => () => {
		void disconnect();
	});

	return { connect, disconnect, status };
}
