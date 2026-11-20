/**
 * Browser control: chrome-devtools-mcp behind `$tN` tabs.
 *
 *   /browser            pick a tab (or connect when not connected)
 *   /browser on [url]   connect through auto-detect or an explicit endpoint
 *   /browser launch     start a dedicated Chrome
 *   /browser off        disconnect
 *   /browser status     connection, tabs and active tools
 *   /browser tabs       list tabs
 *   /browser use $t3    make a tab current without sending a message
 *
 * Typing `$` in the editor completes the connected tabs to `$t3 `. Sending
 * `$t3 …` makes that tab current for the run and the tools default to it.
 * The message itself is never rewritten.
 *
 * The MCP client lives in mcp.ts and is shared process-wide, so `/reload`,
 * `/new` and `/resume` keep the Chrome connection (and its permission prompt).
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { KeyId } from "@earendil-works/pi-tui";
import { fuzzyFilter } from "@earendil-works/pi-tui";
import type { BrowserConfig, ConfigStore } from "../../config.ts";
import { displayShortcut } from "../../shortcut.ts";
import type { ConfigTabFactory } from "../../ui/config-page.ts";
import { createTabAutocompleteProvider } from "./autocomplete.ts";
import { type BrowserEngineLike, getEngine } from "./mcp.ts";
import { BROWSER_SECTION_NAME, browserSectionText } from "./prompt.ts";
import { findTabRef, parseTabRef, tabRef } from "./refs.ts";
import { formatTabLine, formatTabList, type PageInfo } from "./tabs.ts";
import { createBrowserTab } from "./tab.ts";
import { createBrowserTools } from "./tools.ts";

const ENTRY_TYPE = "yee-browser";
const STATUS_KEY = "yee-browser";
const TRUNCATE_TITLE = 30;

interface TabEntryData {
	pageId: number;
	/** Engine epoch: page ids are only meaningful within one connection. */
	epoch: number;
	url: string;
	title: string;
}

export interface BrowserFeature {
	id: "browser";
	tab: ConfigTabFactory;
	/** Whether the browser connection is up (used by tests and /browser status). */
	isListening(): boolean;
}

export interface BrowserOptions {
	/** Ask mode is read-only; only expose the read-only browser tools while it is on. */
	askEnabled: () => boolean;
	/** Injection point for tests. */
	engine?: BrowserEngineLike;
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
	return a.length === b.length && a.every((name) => b.includes(name));
}

function truncate(text: string, max: number): string {
	return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function readEntry(data: unknown): TabEntryData | undefined {
	if (typeof data !== "object" || data === null) return undefined;
	const record = data as Record<string, unknown>;
	if (typeof record.pageId !== "number" || !Number.isInteger(record.pageId) || record.pageId <= 0) return undefined;
	return {
		pageId: record.pageId,
		epoch: typeof record.epoch === "number" ? record.epoch : 0,
		url: typeof record.url === "string" ? record.url : "",
		title: typeof record.title === "string" ? record.title : "",
	};
}

export function registerBrowser(pi: ExtensionAPI, store: ConfigStore, options: BrowserOptions): BrowserFeature {
	const engine = options.engine ?? getEngine();
	let current: TabEntryData | undefined;
	let lastCtx: ExtensionContext | undefined;
	let unsubscribe: (() => void) | undefined;
	let retained = false;
	const owner = {};

	const browser = () => store.get().browser;

	// ── tools ─────────────────────────────────────────────────────────────

	const tools = createBrowserTools({
		engine: () => engine,
		currentPage: () => current?.pageId,
		currentMeta: () => (current ? { url: current.url, title: current.title } : undefined),
		setCurrentPage: (pageId) => {
			const page = engine.pages().find((candidate) => candidate.id === pageId);
			if (page) applyCurrent(page, false, true);
		},
		clearCurrentPage: () => {
			current = undefined;
			pi.appendEntry(ENTRY_TYPE, { pageId: null });
			updateStatus();
		},
	});
	const toolNames = new Set(tools.map((tool) => tool.name));
	for (const tool of tools) pi.registerTool(tool);

	function desiredTools(): string[] {
		if (engine.state !== "connected") return [];
		const available = engine.available();
		const readOnlyOnly = options.askEnabled();
		return tools
			.filter((tool) => available.has(tool.upstream) && (!readOnlyOnly || tool.readOnly))
			.map((tool) => tool.name);
	}

	/** Add the browser tools that apply, remove the rest. Idempotent. */
	function ensureTools(): void {
		const active = pi.getActiveTools();
		const next = [...active.filter((name) => !toolNames.has(name)), ...desiredTools()];
		if (!sameSet(active, next)) pi.setActiveTools(next);
	}

	// ── status ────────────────────────────────────────────────────────────

	function updateStatus(): void {
		const ctx = lastCtx;
		if (!ctx) return;
		if (engine.state === "connected") {
			const pages = engine.pages();
			const page = current ? pages.find((candidate) => candidate.id === current!.pageId) : undefined;
			const label = page ? ` · ${tabRef(page.id)} ${truncate(page.title || page.url, TRUNCATE_TITLE)}` : "";
			ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("accent", `🌐 ${pages.length} tabs${label}`));
			return;
		}
		if (engine.state === "starting") {
			ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("dim", "🌐 连接中…"));
			return;
		}
		if (engine.state === "error") {
			ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("warning", "🌐 未连接"));
			return;
		}
		ctx.ui.setStatus(STATUS_KEY, undefined);
	}

	function statusText(): string {
		const pages = engine.pages();
		const state =
			engine.state === "connected"
				? "已连接"
				: engine.state === "starting"
					? "连接中"
					: engine.state === "error"
						? "连接失败"
						: "未连接";
		const lines = [`浏览器：${state}`];
		if (engine.state === "connected") {
			lines.push(`连接方式：${engine.mode ?? "?"}`);
			lines.push(`chrome-devtools-mcp：${engine.serverVersion ?? "?"}${engine.pid ? ` · pid ${engine.pid}` : ""}`);
			lines.push(`tab：${pages.length} 个`);
			if (current) {
				const page = pages.find((candidate) => candidate.id === current!.pageId);
				lines.push(`当前 tab：${tabRef(current.pageId)} ${page?.title || current.title || current.url}`);
			} else {
				lines.push("当前 tab：未选择");
			}
			const active = pi.getActiveTools().filter((name) => toolNames.has(name));
			lines.push(`工具：${active.join(", ") || "（未激活）"}`);
		} else if (engine.error) {
			lines.push(`原因：${engine.error}`);
		}
		lines.push(`快捷键：${browser().shortcut ? displayShortcut(browser().shortcut!) : "未设置"}`);
		return lines.join("\n");
	}

	// ── current tab ───────────────────────────────────────────────────────

	function applyCurrent(page: PageInfo, focus: boolean, record: boolean): void {
		const next: TabEntryData = {
			pageId: page.id,
			epoch: engine.epoch,
			url: page.url,
			title: page.title,
		};
		const changed = current?.pageId !== next.pageId || current?.epoch !== next.epoch;
		current = next;
		if (record && changed) pi.appendEntry(ENTRY_TYPE, next);
		if (focus && browser().focusTab && engine.state === "connected") {
			void engine.call("select_page", { pageId: page.id, bringToFront: true }).catch(() => {});
		}
		updateStatus();
	}

	/** Rebuild the current tab from the branch (reload, resume, /tree). */
	function restore(ctx: ExtensionContext): void {
		let last: unknown;
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type === "custom" && entry.customType === ENTRY_TYPE) last = entry.data;
		}
		current = readEntry(last);
	}

	/** Page ids are per connection: re-find the tab by URL, then title, after a reconnect. */
	async function reconcile(ctx: ExtensionContext): Promise<void> {
		const target = current;
		if (!target || engine.state !== "connected") return;
		if (target.epoch === engine.epoch && engine.pages().some((page) => page.id === target.pageId)) return;

		if (engine.pages().length === 0) {
			await engine.refreshPages({ force: true, timeoutMs: 8_000 }).catch(() => {});
		}
		const pages = engine.pages();
		const found =
			(target.url ? pages.find((page) => page.url === target.url) : undefined) ??
			(target.title ? pages.find((page) => page.title === target.title) : undefined) ??
			(target.epoch === engine.epoch ? pages.find((page) => page.id === target.pageId) : undefined);
		if (!found) return;

		current = { pageId: found.id, epoch: engine.epoch, url: found.url, title: found.title };
		pi.appendEntry(ENTRY_TYPE, current);
		updateStatus();
		if (found.id !== target.pageId) ctx.ui.notify(`当前 tab 已恢复为 ${tabRef(found.id)}`, "info");
	}

	async function findPage(id: number): Promise<PageInfo | undefined> {
		let page = engine.pages().find((candidate) => candidate.id === id);
		if (!page) {
			await engine.refreshPages({ force: true, timeoutMs: 8_000 }).catch(() => {});
			page = engine.pages().find((candidate) => candidate.id === id);
		}
		return page;
	}

	// ── actions ───────────────────────────────────────────────────────────

	async function startBrowser(
		ctx: ExtensionContext,
		overrides: Partial<BrowserConfig> = {},
		startOptions: { restart?: boolean; quiet?: boolean } = {},
	): Promise<boolean> {
		const config: BrowserConfig = { ...browser(), ...overrides };
		try {
			if (engine.state === "idle" || engine.state === "error") {
				ctx.ui.notify("正在连接浏览器…", "info");
			}
			await engine.start(config, [ctx.cwd], { restart: startOptions.restart });
			ensureTools();
			updateStatus();
			await reconcile(ctx);
			if (!startOptions.quiet) {
				const pages = engine.pages();
				const hint = pages.length > 0 ? `；输入 $ 选择 tab（${tabRef(pages[0]!.id)}…）` : "";
				ctx.ui.notify(`浏览器已连接（${engine.mode ?? "?"}）：${pages.length} 个 tab${hint}`, "info");
			}
			return true;
		} catch (error) {
			ctx.ui.notify(`浏览器连接失败：${error instanceof Error ? error.message : String(error)}`, "error");
			return false;
		}
	}

	async function stopBrowser(ctx: ExtensionContext): Promise<void> {
		if (engine.state === "idle") {
			ctx.ui.notify("浏览器本来就没有连接", "info");
			return;
		}
		await engine.stop();
		ensureTools();
		updateStatus();
		ctx.ui.notify("浏览器已断开（/browser on 重新连接）", "info");
	}

	async function pickTab(ctx: ExtensionContext, query: string): Promise<boolean> {
		if (engine.state !== "connected") {
			ctx.ui.notify("浏览器未连接：先 /browser on", "warning");
			return true;
		}
		if (engine.pages().length === 0) {
			await engine.refreshPages({ force: true, timeoutMs: 8_000 }).catch(() => {});
		}
		let pages = [...engine.pages()];
		if (query) {
			pages = fuzzyFilter(pages, query, (page) => `${tabRef(page.id)} ${page.title} ${page.url}`);
			if (pages.length === 0) {
				ctx.ui.notify(`没有匹配「${query}」的 tab`, "warning");
				return true;
			}
		}
		if (pages.length === 0) {
			ctx.ui.notify("没有打开的 tab；用 /browser launch 或 browser_new_tab 打开一个", "warning");
			return true;
		}

		const labels = pages.map((page) => formatTabLine(page, current?.pageId));
		const disconnect = "✕ 断开浏览器连接";
		const choice = await ctx.ui.select("选择浏览器 tab", [...labels, disconnect]);
		if (!choice) return true;
		if (choice === disconnect) {
			await stopBrowser(ctx);
			return true;
		}
		const page = pages[labels.indexOf(choice)];
		if (!page) return true;
		applyCurrent(page, true, true);
		ctx.ui.notify(`已选择 ${tabRef(page.id)} ${page.title || page.url}`, "info");
		return true;
	}

	async function useTab(ctx: ExtensionContext, raw: string): Promise<void> {
		const id = parseTabRef(raw);
		if (id === undefined) {
			ctx.ui.notify("用法：/browser use $t3（也可以 t3 或 3）", "warning");
			return;
		}
		if (engine.state !== "connected") {
			ctx.ui.notify("浏览器未连接：先 /browser on", "warning");
			return;
		}
		const page = await findPage(id);
		if (!page) {
			ctx.ui.notify(`没有找到 ${tabRef(id)}；用 /browser tabs 查看可用的 tab`, "warning");
			return;
		}
		applyCurrent(page, true, true);
		ctx.ui.notify(`已选择 ${tabRef(page.id)} ${page.title || page.url}`, "info");
	}

	// ── entry points ──────────────────────────────────────────────────────

	pi.registerFlag("browser", {
		description: "启动时连接浏览器（等同 /browser on）",
		type: "boolean",
		default: false,
	});

	const shortcut = browser().shortcut;
	if (shortcut) {
		pi.registerShortcut(shortcut as KeyId, {
			description: `浏览器：选择 tab（${displayShortcut(shortcut)}）`,
			handler: async (ctx) => {
				lastCtx = ctx;
				if (engine.state === "connected") await pickTab(ctx, "");
				else await startBrowser(ctx);
			},
		});
	}

	const SUBCOMMANDS = ["on", "launch", "off", "status", "tabs", "use"];

	pi.registerCommand("browser", {
		description: "浏览器：/browser 选择 tab · on [地址] · launch · off · status · tabs · use $t3",
		getArgumentCompletions: (prefix) => {
			const text = prefix.trim().toLowerCase();
			if (text.startsWith("use ")) {
				const query = text.slice(4);
				return engine
					.pages()
					.filter((page) => !query || `${tabRef(page.id)} ${page.title} ${page.url}`.toLowerCase().includes(query))
					.map((page) => ({ value: tabRef(page.id), label: `${tabRef(page.id)} ${page.title || page.url}` }));
			}
			const matches = SUBCOMMANDS.filter((command) => command.startsWith(text));
			return matches.length > 0 ? matches.map((command) => ({ value: command, label: command })) : null;
		},
		handler: async (args, ctx) => {
			lastCtx = ctx;
			if (ctx.mode === "tui") ctx.ui.setEditorText("");

			const text = args.trim();
			const [word, ...rest] = text.split(/\s+/);
			const tail = rest.join(" ").trim();

			switch ((word ?? "").toLowerCase()) {
				case "":
					if (engine.state === "connected") await pickTab(ctx, "");
					else await startBrowser(ctx);
					return;
				case "on":
					await startBrowser(ctx, tail ? { connect: "url", endpoint: tail } : {}, { restart: true });
					return;
				case "launch":
					await startBrowser(ctx, { connect: "launch" }, { restart: true });
					return;
				case "off":
					await stopBrowser(ctx);
					return;
				case "status":
					ctx.ui.notify(statusText(), "info");
					return;
				case "tabs":
					ctx.ui.notify(
						engine.state === "connected"
							? formatTabList(engine.pages(), current?.pageId)
							: "浏览器未连接：先 /browser on",
						"info",
					);
					return;
				case "use":
					await useTab(ctx, tail);
					return;
				default:
					if (parseTabRef(text) !== undefined) {
						await useTab(ctx, text);
						return;
					}
					ctx.ui.notify("用法：/browser [on [地址] | launch | off | status | tabs | use $t3]", "warning");
			}
		},
	});

	// ── hooks ─────────────────────────────────────────────────────────────

	pi.on("session_start", (event, ctx) => {
		lastCtx = ctx;
		if (!retained) {
			retained = true;
			engine.retain(owner);
		}
		engine.addRoots([ctx.cwd]);
		restore(ctx);
		unsubscribe ??= engine.subscribe(() => {
			updateStatus();
			ensureTools();
		});
		updateStatus();
		ensureTools();

		if (ctx.mode === "tui") {
			ctx.ui.addAutocompleteProvider((base) =>
				createTabAutocompleteProvider(base, {
					pages: () => engine.pages(),
					listening: () => engine.state === "connected",
				}),
			);
		}

		const autoStart = event.reason === "startup" && (pi.getFlag("browser") === true || browser().listenOnStartup);
		if (autoStart) void startBrowser(ctx);
		else void reconcile(ctx);
	});

	pi.on("session_tree", (_event, ctx) => {
		lastCtx = ctx;
		restore(ctx);
		updateStatus();
		void reconcile(ctx);
	});

	pi.on("session_shutdown", () => {
		unsubscribe?.();
		unsubscribe = undefined;
		lastCtx = undefined;
		if (retained) {
			retained = false;
			engine.release(owner);
		}
	});

	pi.on("before_agent_start", (event) => {
		ensureTools();
		if (engine.state !== "connected") return;
		event.systemPromptOptions.sections[BROWSER_SECTION_NAME] = browserSectionText(engine.pages(), current?.pageId);
	});

	pi.on("input", async (event, ctx) => {
		lastCtx = ctx;
		if (engine.state !== "connected") return;
		const ref = findTabRef(event.text);
		if (ref === undefined) return;

		const page = await findPage(ref);
		if (!page) {
			ctx.ui.notify(`没有找到 ${tabRef(ref)}；用 /browser tabs 查看可用的 tab`, "warning");
			return { action: "continue" as const };
		}
		if (current?.pageId !== page.id || current?.epoch !== engine.epoch) {
			applyCurrent(page, true, true);
			ctx.ui.notify(`当前 tab：${tabRef(page.id)} ${page.title || page.url}`, "info");
		} else if (browser().focusTab) {
			void engine.call("select_page", { pageId: page.id, bringToFront: true }).catch(() => {});
		}
		return { action: "continue" as const };
	});

	pi.on("agent_settled", () => {
		if (engine.state === "connected") void engine.refreshPages({ maxAgeMs: 5_000 });
	});

	return {
		id: "browser",
		isListening: () => engine.state === "connected" || engine.state === "starting",
		tab: () => createBrowserTab({ store }),
	};
}
