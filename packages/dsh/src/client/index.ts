/**
 * Yee Stack panel, browser half.
 *
 * One `main` entry in the frame: a Yee Stack page in the centre column, a
 * sidebar entry that selects it, and the copy the page renders. Everything the
 * page shows comes from the Host through `remote.yeeStackPanel.snapshot`; the
 * page never guesses a value it could read.
 *
 * Format: a hand-authored lazy factory registered through
 * `window.__ModuleLoader__.load`. No build step, no React copy of its own —
 * `react` and `react/jsx-runtime` are platform seed words of the Web shell,
 * and the DSH packages this file names in `dsh.client.external` are boot-graph
 * rows the page has already loaded. The Host half imports this file for its
 * types only (which is why every runtime import sits in `factory()`).
 */

import type { Context as ClientContext } from "@deepseek-ai/cordis";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
// Type-only: the SlotMap merges for the seats this file registers into.
import type {} from "@deepseek-ai/dsh-client-ui-layout/client";
import type {} from "@deepseek-ai/dsh-client-ui-sidebar/client";
import type {} from "@deepseek-ai/dsh-client-ui-conversation/client";
import type {} from "@deepseek-ai/dsh-client-ui-plugin-manager/client";
import type {} from "@deepseek-ai/dsh-client-ui-settings/client";
import type {} from "@deepseek-ai/dsh-api-remotes/client";
import type {
	PanelActionResult,
	PanelBrowser,
	PanelConfigField,
	PanelMcpServer,
	PanelSnapshot,
	PanelWishResult,
} from "./state.ts";

export {};

type ReactModule = {
	createElement: (type: unknown, props?: unknown, ...children: unknown[]) => unknown;
	useEffect: (effect: () => void | (() => void), deps?: readonly unknown[]) => void;
	useMemo: <T>(factory: () => T, deps: readonly unknown[]) => T;
	useRef: <T>(initial: T) => { current: T };
	useState: <S>(initial: S | (() => S)) => [S, (next: S | ((previous: S) => S)) => void];
};

interface RemoteResultLike<T> {
	ok: boolean;
	value?: T;
	error?: { code: string; message: string };
}

interface RemoteLike {
	yeeStackPanel: {
		snapshot(sessionId: string | null): Promise<RemoteResultLike<PanelSnapshot>>;
		wish(sessionId: string, wish: string, tier: string | null): Promise<RemoteResultLike<PanelWishResult>>;
		ask(sessionId: string, active: boolean): Promise<RemoteResultLike<PanelActionResult>>;
		browser(sessionId: string | null, action: string, pageId: number | null): Promise<RemoteResultLike<PanelActionResult>>;
		restartMcp(): Promise<RemoteResultLike<PanelActionResult>>;
	};
	settings: {
		mutate(
			ns: string,
			ops: readonly { op: "set"; path: string[]; value: unknown }[] | readonly { op: "unset"; path: string[] }[],
			expectedRevision: number | undefined,
		): Promise<RemoteResultLike<{ revision: number }>>;
		describe(): Promise<RemoteResultLike<{ writable: boolean; namespaces: Array<{ ns: string; revision: number; value: unknown }> }>>;
	};
}

interface SlotsLike {
	inject(key: string, callback: () => () => void): () => void;
	register(options: Record<string, unknown>, component: unknown): () => void;
}

interface InputFacadeLike {
	setDraft(text: string): void;
	submit(): void;
	notify(level: "info" | "error", text: string): void;
	focus(): void;
}

interface ClientCtxLike {
	readonly slots: SlotsLike;
	readonly remote: RemoteLike;
	readonly sessions: { scope(id: SessionId): { get(name: "conversation"): { input: { for(scope: unknown): InputFacadeLike } } | undefined } | undefined };
	readonly locale: {
		register(ns: string, dictionaries: Record<string, Record<string, string>>): () => void;
		bind(ns: string): (key: string, values?: Record<string, string | number>) => string;
	};
	effect(factory: () => (() => void) | void, label?: string): () => void;
	inject(deps: readonly string[], callback: (scope: ClientCtxLike) => void): () => void;
}

/**
 * The panel id: the `main` key and the sidebar entry id share it. Spelled
 * without the scope because a client bundle is not a package; the row that
 * mounts it is `yee-stack`.
 */
const PANEL_ID = "yee-stack";

/** The settings namespace the config writes address. */
const CONFIG_NS = "yee-stack";

/** Where the Host stores the panel's own copies. */
const NS = "yeeStack";

/** Everything the page's actions can do, handed to the component by `inject`. */
interface PanelFace {
	load(sessionId: string | null): Promise<PanelSnapshot>;
	restartMcp(): Promise<void>;
	write(field: PanelConfigField, value: string | number | boolean | string[] | null): Promise<void>;
	specialize(sessionId: SessionId | undefined, wish: string, tier: string): Promise<PanelWishResult>;
	setAsk(sessionId: SessionId | undefined, active: boolean): Promise<PanelActionResult>;
	browser(action: "connect" | "launch" | "disconnect"): Promise<PanelActionResult>;
	useTab(pageId: number): Promise<PanelActionResult>;
	useDraft(sessionId: SessionId | undefined, text: string): void;
}

/**
 * The two dependency surfaces the factory needs. Declared here so the Host
 * half's type check sees the same shape the page is written against.
 */
type FactoryRequire = (specifier: string) => any;

declare global {
	interface Window {
		__ModuleLoader__: { load(registration: { id: string; factory(require: FactoryRequire): unknown }): void };
	}
}

const en: Record<string, string> = {
	panel: "Yee Stack",
	panelHint: "Wish · Ask · Browser",
	title: "Yee Stack",
	intro: "Three small tools for one session: a wish specializer, a read-only Ask mode, and Chrome control.",
	loading: "Reading the Host…",
	unbound: "Open a Session to see its Ask mode and the wish route. Settings and the browser connection show regardless.",
	refresh: "Refresh",
	wish: "Wish",
	wishIntro: "One line in, the directional requirements a working model needs out. The result lands in the composer, not in your session.",
	tier: "Tier",
	tierLight: "Light",
	tierStandard: "Standard",
	tierHeavy: "Heavy",
	maxTokens: "Output budget",
	route: "Route",
	noRoute: "no model selected yet",
	wishPlaceholder: "A one-line wish, e.g. a dark landing page for a pour-over coffee shop",
	specialize: "Specialize",
	specializing: "Specializing…",
	wishDone: "Written into the composer — review it, then send.",
	wishEmpty: "Type a wish first.",
	ask: "Ask",
	askIntro: "Read-only Q&A: the agent can read, search and list, and nothing else. Toggle it per Session; it survives resume and fork.",
	askOn: "Ask mode is on",
	askOff: "Ask mode is off",
	askToggleOn: "Turn on",
	askToggleOff: "Turn off",
	allowed: "Allowed",
	blocked: "Blocked",
	extraTools: "Extra tools from the config",
	extraToolsPlaceholder: "web_search, web_fetch",
	saveExtraTools: "Save",
	section: "Injected guidance",
	browser: "Browser",
	browserIntro: "A real Chrome through chrome-devtools-mcp. One tab is current; `$t3` in a message picks that tab for the run.",
	connect: "Connect",
	launch: "Launch Chrome",
	disconnect: "Disconnect",
	tabs: "Tabs",
	noTabs: "No tabs yet.",
	currentTab: "current",
	useTab: "Use",
	tools: "Tools",
	remote: "remote Chrome",
	connectMode: "Mode",
	channel: "Channel",
	headless: "Headless",
	endpoint: "Endpoint",
	executable: "Chrome path",
	allowEval: "Allow page JavaScript",
	allowRemoteUpload: "Allow remote upload",
	listenOnStartup: "Connect on startup",
	mcp: "MCP server",
	restartMcp: "Restart",
	save: "Save",
	saving: "Saving…",
	saved: "Saved.",
	saveFailed: "The Host refused that value.",
	advanced: "Advanced",
	askTip: "Send the question from the composer; Ask mode answers with the read-only tools only.",
};

const zh: Record<string, string> = {
	panel: "Yee Stack",
	panelHint: "许愿 · 只读问答 · 浏览器",
	title: "Yee Stack",
	intro: "一个会话里的三件小工具：许愿特化器、只读 Ask 模式、Chrome 控制。",
	loading: "正在读取 Host…",
	unbound: "打开一个会话才能看到它的 Ask 状态和许愿路由；设置和浏览器连接不受影响。",
	refresh: "刷新",
	wish: "许愿",
	wishIntro: "输入一句话，补上工作模型真正需要的方向性要求。结果写进输入框，不会直接进会话。",
	tier: "档位",
	tierLight: "轻量",
	tierStandard: "标准",
	tierHeavy: "重度",
	maxTokens: "输出上限",
	route: "路由",
	noRoute: "还没有选模型",
	wishPlaceholder: "一句话愿望，例如：做一个卖手冲咖啡的深色主页",
	specialize: "特化",
	specializing: "特化中…",
	wishDone: "已写进输入框：看一眼再发送。",
	wishEmpty: "先写一个愿望。",
	ask: "只读问答",
	askIntro: "只做问答：agent 只能读、搜、列文件，别的都不行。按会话开关，resume / fork 后仍然有效。",
	askOn: "Ask 模式已开启",
	askOff: "Ask 模式已关闭",
	askToggleOn: "开启",
	askToggleOff: "关闭",
	allowed: "放行",
	blocked: "屏蔽",
	extraTools: "配置里额外放行的工具",
	extraToolsPlaceholder: "web_search, web_fetch",
	saveExtraTools: "保存",
	section: "注入的提示词",
	browser: "浏览器",
	browserIntro: "通过 chrome-devtools-mcp 连真实 Chrome。同一时间只有一个当前 tab；消息里写 `$t3` 就用那个 tab 跑这一轮。",
	connect: "连接",
	launch: "启动 Chrome",
	disconnect: "断开",
	tabs: "标签页",
	noTabs: "还没有标签页。",
	currentTab: "当前",
	useTab: "设为当前",
	tools: "工具",
	remote: "远程 Chrome",
	connectMode: "方式",
	channel: "通道",
	headless: "无头",
	endpoint: "地址",
	executable: "Chrome 路径",
	allowEval: "允许页面里执行 JS",
	allowRemoteUpload: "允许远程上传文件",
	listenOnStartup: "启动时自动连接",
	mcp: "MCP 服务",
	restartMcp: "重启",
	save: "保存",
	saving: "保存中…",
	saved: "已保存。",
	saveFailed: "Host 没接受这个值。",
	advanced: "高级",
	askTip: "问题从输入框发；Ask 模式只会用只读工具回答。",
};

window.__ModuleLoader__.load({
	id: "yee-stack-dsh",
	factory(require: FactoryRequire) {
		const React = require("react") as ReactModule;
		const h = React.createElement;

		/* ---------------------------------------------------------------- */
		/* Styles                                                            */
		/* ---------------------------------------------------------------- */

		const css = `
.yeeRoot{--yee-card:var(--dsw-alias-card-fill);--yee-line:var(--dsw-alias-border-l1);--yee-line-strong:var(--dsw-alias-border-l3);
  box-sizing:border-box;height:100%;overflow:auto;padding:28px 32px 56px;color:var(--dsw-alias-label-primary);font:inherit}
.yeeWrap{max-width:920px;margin:0 auto;display:flex;flex-direction:column;gap:18px}
.yeeHead{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}
.yeeTitle{margin:0;font-size:20px;font-weight:600;line-height:28px}
.yeeIntro{margin:6px 0 0;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}
.yeeNotice{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);border:.5px solid var(--yee-line);
  border-radius:var(--dsw-radius-sm);padding:8px 10px;background:var(--dsw-alias-card-tile-fill)}
.yeeCard{box-sizing:border-box;border:.5px solid var(--yee-line);border-radius:var(--dsw-radius-lg);background:var(--yee-card);
  padding:16px 18px;display:flex;flex-direction:column;gap:12px;min-width:0}
.yeeCardHead{display:flex;align-items:center;justify-content:space-between;gap:12px;min-width:0}
.yeeCardTitle{display:flex;align-items:center;gap:8px;font-size:14px;font-weight:600;line-height:22px;min-width:0}
.yeeCardHint{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.yeeRow{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.yeeGrow{flex:1;min-width:0}
.yeeLabel{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);display:block;margin-bottom:4px}
.yeeInput,.yeeSelect,.yeeTextarea{box-sizing:border-box;width:100%;font:inherit;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary);
  background:var(--dsw-alias-input-fill,var(--dsw-alias-card-tile-fill));border:.5px solid var(--yee-line-strong);
  border-radius:var(--dsw-radius-sm);padding:6px 8px;min-width:0}
.yeeTextarea{resize:vertical;min-height:84px;font-family:inherit}
.yeeInput:focus-visible,.yeeSelect:focus-visible,.yeeTextarea:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.yeeButton{box-sizing:border-box;display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 10px;font:inherit;font-size:12px;line-height:18px;
  color:var(--dsw-alias-label-primary);background:var(--dsw-alias-button-floating-fill);border:.5px solid var(--yee-line-strong);
  border-radius:var(--dsw-radius-sm);cursor:pointer;white-space:nowrap}
.yeeButton:hover:not(:disabled){background:var(--dsw-alias-card-fill-hover)}
.yeeButton:disabled{opacity:.5;cursor:default}
.yeeButton.primary{background:var(--dsw-alias-state-business-primary);border-color:transparent;color:var(--dsw-alias-label-on-business,#fff)}
.yeeButton.primary:hover:not(:disabled){filter:brightness(1.06)}
.yeeButton:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
.yeePill{display:inline-flex;align-items:center;gap:6px;height:22px;padding:0 8px;border-radius:999px;font-size:11px;line-height:16px;
  background:var(--dsw-alias-card-tile-fill);border:.5px solid var(--yee-line);color:var(--dsw-alias-label-secondary)}
.yeePill.on{background:var(--dsw-alias-state-business-tertiary);color:var(--dsw-alias-state-business-primary);border-color:transparent}
.yeePill.warn{background:var(--dsw-alias-state-warning-tertiary,var(--dsw-alias-card-tile-fill));color:var(--dsw-alias-state-warning-primary,var(--dsw-alias-label-primary))}
.yeeDot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-label-tertiary);flex:none}
.yeeDot.on{background:var(--dsw-alias-state-business-primary)}
.yeeDot.warn{background:var(--dsw-alias-state-warning-primary,var(--dsw-alias-label-secondary))}
.yeeTags{display:flex;flex-wrap:wrap;gap:4px}
.yeeTag{font-size:11px;line-height:16px;padding:1px 6px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-card-tile-fill);
  border:.5px solid var(--yee-line);color:var(--dsw-alias-label-secondary);font-family:var(--dsw-font-mono,ui-monospace,monospace)}
.yeeTag.blocked{color:var(--dsw-alias-label-tertiary);text-decoration:line-through}
.yeeTabs{display:flex;flex-direction:column;gap:6px}
.yeeTabRow{display:flex;align-items:center;gap:10px;padding:6px 8px;border-radius:var(--dsw-radius-sm);border:.5px solid transparent;min-width:0}
.yeeTabRow.current{border-color:var(--yee-line-strong);background:var(--dsw-alias-card-tile-fill)}
.yeeTabId{font-family:var(--dsw-font-mono,ui-monospace,monospace);font-size:11px;color:var(--dsw-alias-label-tertiary);flex:none}
.yeeTabTitle{font-size:13px;line-height:20px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.yeeTabUrl{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.yeeGrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px}
.yeeCheck{display:flex;align-items:center;gap:8px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.yeeDetails{border-top:.5px solid var(--yee-line);padding-top:10px}
.yeeDetails>summary{cursor:pointer;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);list-style:none}
.yeeDetails>summary::-webkit-details-marker{display:none}
.yeeDetails[open]>summary{margin-bottom:10px}
.yeeStatus{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.yeeStatus.error{color:var(--dsw-alias-state-error-primary,var(--dsw-alias-label-primary))}
.yeeError{font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary,var(--dsw-alias-label-primary))}
`;

		/* ---------------------------------------------------------------- */
		/* Small pieces                                                      */
		/* ---------------------------------------------------------------- */

		function text(value: unknown): string {
			return typeof value === "string" ? value : "";
		}

		function Tag({ label, blocked }: { label: string; blocked?: boolean }) {
			return h("span", { className: blocked ? "yeeTag blocked" : "yeeTag" }, label);
		}

		function Pill({ tone, children }: { tone?: "on" | "warn"; children?: unknown }) {
			return h("span", { className: tone ? `yeePill ${tone}` : "yeePill" }, children);
		}

		function Dot({ tone }: { tone?: "on" | "warn" }) {
			return h("span", { className: tone ? `yeeDot ${tone}` : "yeeDot", "aria-hidden": "true" });
		}

		function Field({ label, children }: { label: string; children?: unknown }) {
			return h("div", null, h("span", { className: "yeeLabel" }, label), children);
		}

		/* ---------------------------------------------------------------- */
		/* The page                                                          */
		/* ---------------------------------------------------------------- */

		function Panel(props: PanelFace & { sessionId?: SessionId; t: (key: string) => string }) {
			const t: (key: string) => string = props.t;
			const face: PanelFace = props;
			const sessionId = props.sessionId as SessionId | undefined;

			const [snapshot, setSnapshot] = React.useState<PanelSnapshot | null>(null);
			const [loadError, setLoadError] = React.useState<string | null>(null);
			const [busy, setBusy] = React.useState<string | null>(null);
			const [status, setStatus] = React.useState<{ level: "info" | "error"; text: string } | null>(null);
			const [wish, setWish] = React.useState<string>("");
			const [tier, setTier] = React.useState<string>("");
			const [extraTools, setExtraTools] = React.useState<string>("");

			const alive = React.useRef(true);
			React.useEffect(() => {
				alive.current = true;
				return () => {
					alive.current = false;
				};
			}, []);

			const load = React.useMemo(
				() => () => {
					face.load(sessionId ?? null).then(
						(next) => {
							if (!alive.current) return;
							setSnapshot(next);
							setLoadError(null);
							setTier((current) => current || next.wish.tier);
							setExtraTools(next.ask.extraTools.join(", "));
						},
						(error: unknown) => {
							if (!alive.current) return;
							setLoadError(error instanceof Error ? error.message : String(error));
						},
					);
				},
				[sessionId, face],
			);

			React.useEffect(() => {
				load();
			}, [load]);

			const run = (name: string, action: () => Promise<void>): void => {
				setBusy(name);
				setStatus(null);
				action().then(
					() => {
						if (alive.current) setBusy(null);
					},
					(error: unknown) => {
						if (!alive.current) return;
						setBusy(null);
						setStatus({ level: "error", text: error instanceof Error ? error.message : String(error) });
					},
				);
			};

			if (snapshot === null) {
				return h(
					"div",
					{ className: "yeeRoot" },
					h(
						"div",
						{ className: "yeeWrap" },
						h("div", { className: "yeeStatus" }, loadError ?? t("loading")),
					),
				);
			}

			const browser: PanelBrowser = snapshot.browser;
			const mcp: PanelMcpServer | null = snapshot.mcp;

			/* ── Wish ─────────────────────────────────────────────────── */

			const specialize = (): void => {
				if (!wish.trim()) {
					setStatus({ level: "error", text: t("wishEmpty") });
					return;
				}
				run("wish", async () => {
					const result = await face.specialize(sessionId, wish, tier as "light" | "standard" | "heavy");
					face.useDraft(sessionId, result.prompt);
					setStatus({ level: "info", text: t("wishDone") });
				});
			};

			/* ── Ask ──────────────────────────────────────────────────── */

			const toggleAsk = (): void => {
				run("ask", async () => {
					await face.setAsk(sessionId, !snapshot.ask.active);
					load();
				});
			};

			const saveExtraTools = (): void => {
				const names = extraTools
					.split(/[,\s]+/u)
					.map((name) => name.trim())
					.filter((name) => name.length > 0);
				run("extraTools", async () => {
					await face.write("ask.extraTools", names);
					setStatus({ level: "info", text: t("saved") });
					load();
				});
			};

			/* ── Browser ──────────────────────────────────────────────── */

			const browserAction = (name: string, action: () => Promise<PanelActionResult>): void => {
				run(name, async () => {
					const result = await action();
					if (!result.ok) throw new Error(result.message ?? name);
					load();
				});
			};

			const browserTone = browser.state === "connected" ? "on" : browser.state === "error" ? "warn" : undefined;

			/* ── Settings ─────────────────────────────────────────────── */

			const save = (field: PanelConfigField, value: string | number | boolean | string[]): void => {
				run(`save:${field}`, async () => {
					await face.write(field, value);
					setStatus({ level: "info", text: t("saved") });
					load();
				});
			};

			const currentTab = browser.tabs.find((tab) => tab.id === browser.current) ?? null;

			return h(
				"div",
				{ className: "yeeRoot" },
				h(
					"div",
					{ className: "yeeWrap" },
					/* header */
					h(
						"div",
						{ className: "yeeHead" },
						h(
							"div",
							null,
							h("h1", { className: "yeeTitle" }, t("title")),
							h("p", { className: "yeeIntro" }, t("intro")),
						),
						h(
							"button",
							{ type: "button", className: "yeeButton", onClick: load, disabled: busy !== null },
							t("refresh"),
						),
					),
					status === null
						? null
						: h("div", { className: status.level === "error" ? "yeeError" : "yeeStatus" }, status.text),
					sessionId === undefined ? h("div", { className: "yeeNotice" }, t("unbound")) : null,

					/* Wish */
					h(
						"section",
						{ className: "yeeCard", "aria-labelledby": "yee-wish-title" },
						h(
							"div",
							{ className: "yeeCardHead" },
							h("div", { className: "yeeCardTitle", id: "yee-wish-title" }, t("wish")),
							h(
								"div",
								{ className: "yeeRow" },
								h(Pill, null, `${t("route")}: ${snapshot.wish.provider ?? t("noRoute")}${snapshot.wish.model ? ` · ${snapshot.wish.model}` : ""}`),
							),
						),
						h("p", { className: "yeeCardHint" }, t("wishIntro")),
						h(
							"textarea",
							{
								className: "yeeTextarea",
								placeholder: t("wishPlaceholder"),
								value: wish,
								onChange: (event: any) => {
									setWish(event.target.value);
								},
							},
						),
						h(
							"div",
							{ className: "yeeRow" },
							h(
								"div",
								null,
								h("span", { className: "yeeLabel" }, t("tier")),
								h(
									"select",
									{
										className: "yeeSelect",
										value: tier || snapshot.wish.tier,
										onChange: (event: any) => {
											setTier(event.target.value);
										},
									},
									h("option", { value: "light" }, t("tierLight")),
									h("option", { value: "standard" }, t("tierStandard")),
									h("option", { value: "heavy" }, t("tierHeavy")),
								),
							),
							h("div", { className: "yeeGrow" }),
							h(
								"button",
								{
									type: "button",
									className: "yeeButton primary",
									onClick: specialize,
									disabled: busy !== null || sessionId === undefined,
								},
								busy === "wish" ? t("specializing") : t("specialize"),
							),
						),
					),

					/* Ask */
					h(
						"section",
						{ className: "yeeCard", "aria-labelledby": "yee-ask-title" },
						h(
							"div",
							{ className: "yeeCardHead" },
							h("div", { className: "yeeCardTitle", id: "yee-ask-title" }, t("ask")),
							h(
								"div",
								{ className: "yeeRow" },
								h(Pill, { tone: snapshot.ask.active ? "on" : undefined }, snapshot.ask.active ? t("askOn") : t("askOff")),
								h(
									"button",
									{
										type: "button",
										className: snapshot.ask.active ? "yeeButton" : "yeeButton primary",
										onClick: toggleAsk,
										disabled: busy !== null || sessionId === undefined,
									},
									snapshot.ask.active ? t("askToggleOff") : t("askToggleOn"),
								),
							),
						),
						h("p", { className: "yeeCardHint" }, t("askIntro")),
						h(
							"div",
							{ className: "yeeGrid" },
							h(
								"div",
								null,
								h("span", { className: "yeeLabel" }, t("allowed")),
								h("div", { className: "yeeTags" }, snapshot.ask.allowed.map((name) => h(Tag, { key: name, label: name }))),
							),
							h(
								"div",
								null,
								h("span", { className: "yeeLabel" }, t("blocked")),
								h(
									"div",
									{ className: "yeeTags" },
									snapshot.ask.blocked.map((name) => h(Tag, { key: name, label: name, blocked: true })),
								),
							),
						),
						h(
							"div",
							{ className: "yeeRow" },
							h(
								"div",
								{ className: "yeeGrow" },
								h("span", { className: "yeeLabel" }, t("extraTools")),
								h("input", {
									className: "yeeInput",
									value: extraTools,
									placeholder: t("extraToolsPlaceholder"),
									onChange: (event: any) => {
										setExtraTools(event.target.value);
									},
								}),
							),
							h(
								"button",
								{
									type: "button",
									className: "yeeButton",
									onClick: saveExtraTools,
									disabled: busy !== null,
								},
								t("saveExtraTools"),
							),
						),
						h(
							"details",
							{ className: "yeeDetails" },
							h("summary", null, t("section")),
							h("pre", { className: "yeeStatus", style: { whiteSpace: "pre-wrap", margin: 0 } }, snapshot.ask.section),
						),
					),

					/* Browser */
					h(
						"section",
						{ className: "yeeCard", "aria-labelledby": "yee-browser-title" },
						h(
							"div",
							{ className: "yeeCardHead" },
							h(
								"div",
								{ className: "yeeCardTitle", id: "yee-browser-title" },
								h(Dot, { tone: browserTone }),
								t("browser"),
							),
							h(
								"div",
								{ className: "yeeRow" },
								h(Pill, { tone: browserTone }, browser.state),
								browser.remote ? h(Pill, null, t("remote")) : null,
								browser.state === "connected"
									? h(Pill, null, `${t("tools")}: ${browser.toolCount}`)
									: null,
							),
						),
						h("p", { className: "yeeCardHint" }, t("browserIntro")),
						browser.error ? h("div", { className: "yeeError" }, browser.error) : null,
						h(
							"div",
							{ className: "yeeRow" },
							h(
								"button",
								{
									type: "button",
									className: "yeeButton",
									disabled: busy !== null || browser.state === "connecting",
									onClick: () => {
										browserAction("connect", () => face.browser("connect"));
									},
								},
								t("connect"),
							),
							h(
								"button",
								{
									type: "button",
									className: "yeeButton",
									disabled: busy !== null || browser.state === "connecting",
									onClick: () => {
										browserAction("launch", () => face.browser("launch"));
									},
								},
								t("launch"),
							),
							h(
								"button",
								{
									type: "button",
									className: "yeeButton",
									disabled: busy !== null || browser.state !== "connected",
									onClick: () => {
										browserAction("disconnect", () => face.browser("disconnect"));
									},
								},
								t("disconnect"),
							),
						),
						h(
							"div",
							null,
							h(
								"span",
								{ className: "yeeLabel" },
								`${t("tabs")}${currentTab ? ` · ${t("currentTab")}: $t${currentTab.id}` : ""}`,
							),
							browser.tabs.length === 0
								? h("div", { className: "yeeStatus" }, t("noTabs"))
								: h(
										"div",
										{ className: "yeeTabs" },
										browser.tabs.map((tab) =>
											h(
												"div",
												{ key: tab.id, className: tab.id === browser.current ? "yeeTabRow current" : "yeeTabRow" },
												h("span", { className: "yeeTabId" }, `$t${tab.id}`),
												h(
													"div",
													{ className: "yeeGrow" },
													h("div", { className: "yeeTabTitle" }, tab.title || tab.url),
													h("div", { className: "yeeTabUrl" }, tab.url),
												),
												tab.id === browser.current
													? h(Pill, { tone: "on" }, t("currentTab"))
													: h(
															"button",
															{
																type: "button",
																className: "yeeButton",
																disabled: busy !== null,
																onClick: () => {
																	browserAction(`use:${tab.id}`, () => face.useTab(tab.id));
																},
															},
															t("useTab"),
														),
											),
										),
									),
						),
						mcp
							? h(
									"div",
									{ className: "yeeRow" },
									h(Dot, { tone: mcp.state === "connected" ? "on" : mcp.state === "failed" ? "warn" : undefined }),
									h("span", { className: "yeeStatus" }, `${t("mcp")}: ${mcp.name} · ${mcp.state}${mcp.toolCount === null ? "" : ` · ${mcp.toolCount}`}`),
									mcp.error ? h("span", { className: "yeeError" }, mcp.error) : null,
									h("div", { className: "yeeGrow" }),
									h(
										"button",
										{
											type: "button",
											className: "yeeButton",
											disabled: busy !== null,
											onClick: () => {
												run("mcp", async () => {
													await face.restartMcp();
													load();
												});
											},
										},
										t("restartMcp"),
									),
								)
							: null,
					),

					/* Settings */
					h(
						"section",
						{ className: "yeeCard", "aria-labelledby": "yee-config-title" },
						h("div", { className: "yeeCardHead" }, h("div", { className: "yeeCardTitle", id: "yee-config-title" }, t("advanced"))),
						h(
							"div",
							{ className: "yeeGrid" },
							h(
								Field,
								{ label: `${t("tier")}` },
								h(
									"select",
									{
										className: "yeeSelect",
										value: snapshot.wish.tier,
										onChange: (event: any) => {
											save("wish.tier", event.target.value);
										},
									},
									h("option", { value: "light" }, t("tierLight")),
									h("option", { value: "standard" }, t("tierStandard")),
									h("option", { value: "heavy" }, t("tierHeavy")),
								),
							),
							h(
								Field,
								{ label: t("maxTokens") },
								h("input", {
									className: "yeeInput",
									type: "number",
									min: 1,
									max: 8192,
									defaultValue: String(snapshot.wish.maxTokens),
									onBlur: (event: any) => {
										const next = Number(event.target.value);
										if (Number.isInteger(next) && next > 0 && next !== snapshot.wish.maxTokens) save("wish.maxTokens", next);
									},
								}),
							),
							h(
								Field,
								{ label: t("connectMode") },
								h(
									"select",
									{
										className: "yeeSelect",
										value: snapshot.browserSettings.connect,
										onChange: (event: any) => {
											save("browser.connect", event.target.value);
										},
									},
									h("option", { value: "auto" }, "auto"),
									h("option", { value: "url" }, "url"),
									h("option", { value: "launch" }, "launch"),
								),
							),
							h(
								Field,
								{ label: t("channel") },
								h(
									"select",
									{
										className: "yeeSelect",
										value: snapshot.browserSettings.channel,
										onChange: (event: any) => {
											save("browser.channel", event.target.value);
										},
									},
									h("option", { value: "stable" }, "stable"),
									h("option", { value: "beta" }, "beta"),
									h("option", { value: "dev" }, "dev"),
									h("option", { value: "canary" }, "canary"),
								),
							),
							h(
								Field,
								{ label: t("headless") },
								h(
									"select",
									{
										className: "yeeSelect",
										value: snapshot.browserSettings.headless,
										onChange: (event: any) => {
											save("browser.headless", event.target.value);
										},
									},
									h("option", { value: "auto" }, "auto"),
									h("option", { value: "on" }, "on"),
									h("option", { value: "off" }, "off"),
								),
							),
							h(
								Field,
								{ label: t("endpoint") },
								h("input", {
									className: "yeeInput",
									defaultValue: snapshot.browserSettings.endpoint,
									onBlur: (event: any) => {
										if (event.target.value !== snapshot.browserSettings.endpoint) save("browser.endpoint", event.target.value);
									},
								}),
							),
							h(
								Field,
								{ label: t("executable") },
								h("input", {
									className: "yeeInput",
									defaultValue: snapshot.browserSettings.executable,
									onBlur: (event: any) => {
										if (event.target.value !== snapshot.browserSettings.executable) save("browser.executable", event.target.value);
									},
								}),
							),
						),
						h(
							"div",
							{ className: "yeeRow" },
							h(
								"label",
								{ className: "yeeCheck" },
								h("input", {
									type: "checkbox",
									checked: snapshot.browserSettings.allowEval,
									onChange: (event: any) => {
										save("browser.allowEval", event.target.checked);
									},
								}),
								t("allowEval"),
							),
							h(
								"label",
								{ className: "yeeCheck" },
								h("input", {
									type: "checkbox",
									checked: snapshot.browserSettings.allowRemoteUpload,
									onChange: (event: any) => {
										save("browser.allowRemoteUpload", event.target.checked);
									},
								}),
								t("allowRemoteUpload"),
							),
							h(
								"label",
								{ className: "yeeCheck" },
								h("input", {
									type: "checkbox",
									checked: snapshot.browserSettings.listenOnStartup,
									onChange: (event: any) => {
										save("browser.listenOnStartup", event.target.checked);
									},
								}),
								t("listenOnStartup"),
							),
						),
					),
				),
			);
		}

		/** Sidebar entry: the glyph the sidebar renders for the panel. */
		function PanelIcon(props: { size: number }) {
			const size = props.size || 16;
			return h(
				"svg",
				{
					viewBox: "0 0 16 16",
					width: size,
					height: size,
					"aria-hidden": "true",
					style: { display: "block" },
				},
				h("path", {
					d: "M8 1.5 2.5 4.6v6.8L8 14.5l5.5-3.1V4.6L8 1.5Zm0 1.7 4 2.3v.6L8 8.4 4 6.1v-.6l4-2.3Zm-4 4.4 3.2 1.8v3.3L4 10.9V7.6Zm4.8 5.1V9.4L12 7.6v3.3l-3.2 1.8Z",
					fill: "currentColor",
				}),
			);
		}

		const plugin = {
			inject: ["slots", "locale", "remote", "remote.yeeStackPanel", "remote.settings", "sessions"],
			apply(ctx: ClientCtxLike) {
				ctx.effect(() => ctx.locale.register(NS, { zh, en }), "yee-stack: panel dictionaries");
				const t = ctx.locale.bind(NS);

				const style = document.createElement("style");
				style.setAttribute("data-plugin", "yee-stack-dsh");
				style.textContent = css;
				ctx.effect(() => {
					document.head.append(style);
					return () => {
						style.remove();
					};
				}, "yee-stack: panel styles");

				const fail = (what: string, result: RemoteResultLike<unknown>): never => {
					throw new Error(`${what}: ${result.error?.code ?? "unknown"} ${result.error?.message ?? ""}`.trim());
				};

				/** Unwrap one Remote answer, throwing the Host's reason when it refused. */
				const unwrap = <T>(what: string, result: RemoteResultLike<T>): T => {
					if (!result.ok) fail(what, result);
					return result.value as T;
				};

				/** Turn a panel action's answer into its snapshot, or throw its message. */
				const acted = async (what: string, call: Promise<RemoteResultLike<PanelActionResult>>): Promise<PanelActionResult> => {
					const result = unwrap(what, await call);
					if (!result.ok) throw new Error(result.message ?? what);
					return result;
				};

				const inputOf = (sessionId: SessionId | undefined): InputFacadeLike | null => {
					if (sessionId === undefined) return null;
					const scope = ctx.sessions.scope(sessionId);
					const conversation = scope?.get("conversation");
					return conversation === undefined ? null : conversation.input.for(scope);
				};

				const face: PanelFace = {
					async load(sessionId) {
						return unwrap("snapshot", await ctx.remote.yeeStackPanel.snapshot(sessionId));
					},
					async restartMcp() {
						await acted("restartMcp", ctx.remote.yeeStackPanel.restartMcp());
					},
					async specialize(sessionId, wish, tier) {
						if (sessionId === undefined) throw new Error("composer: no Session");
						return unwrap("wish", await ctx.remote.yeeStackPanel.wish(sessionId, wish, tier));
					},
					async setAsk(sessionId, active) {
						if (sessionId === undefined) throw new Error("ask: no Session");
						return acted("ask", ctx.remote.yeeStackPanel.ask(sessionId, active));
					},
					async browser(action) {
						return acted(`browser:${action}`, ctx.remote.yeeStackPanel.browser(null, action, null));
					},
					async useTab(pageId) {
						return acted(`browser:use:${pageId}`, ctx.remote.yeeStackPanel.browser(null, "use", pageId));
					},
					async write(field, value) {
						const described = await ctx.remote.settings.describe();
						const describeValue = described.value;
						if (!described.ok || describeValue === undefined) fail("settings.describe", described);
						const namespaces = (describeValue as { namespaces: Array<{ ns: string; revision: number }> }).namespaces;
						const section = namespaces.find((entry) => entry.ns === CONFIG_NS);
						if (section === undefined) throw new Error(`settings: no "${CONFIG_NS}" section`);
						const ops = value === null
							? [{ op: "unset" as const, path: field.split(".") }]
							: [{ op: "set" as const, path: field.split("."), value }];
						const written = await ctx.remote.settings.mutate(CONFIG_NS, ops, section.revision);
						if (!written.ok) fail(`settings.mutate(${field})`, written);
					},
					useDraft(sessionId, value) {
						const input = inputOf(sessionId);
						if (input === null) throw new Error("composer: no Session input");
						input.setDraft(value);
						input.focus();
					},

				};

				// The page is a `main` entry: the sidebar entry selects it.
				ctx.effect(() => ctx.slots.inject("main", () => ctx.slots.register({
					name: "main",
					key: PANEL_ID,
					locale: NS,
					inject: (sessionId: SessionId | undefined) => ({ ...face, sessionId }),
				}, Panel)), "yee-stack: main panel");

				ctx.effect(() => ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({
					name: "sidebar.panellist",
					id: PANEL_ID,
					order: 20,
					label: () => t("panel"),
					locale: NS,
				}, PanelIcon)), "yee-stack: sidebar entry");
			},
		};

		// The module value IS the factory's return: the harness materializes the
		// factory's result as this package's exports.
		return plugin;
	},
});
