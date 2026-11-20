/**
 * The panel's Host side: what the Web page reads and what it can do.
 *
 * The Web page cannot see a plugin's services directly, so everything the
 * panel shows travels over the Remote Gateway like any other Host fact:
 *
 *   snapshot   one Session's Ask mode and route, the browser connection, the
 *              live settings — the whole page state in one read;
 *   wish       one private specialization, returned as the prompt to draft;
 *   ask        flip Ask mode for one Session;
 *   browser    connect / launch / disconnect / pick a tab;
 *   restartMcp restart the chrome-devtools server.
 *
 * The service owns the projection of `{ config, runtime }` into
 * {@link PanelSnapshot}. This class is only ever constructed by the
 * `yee-stack` Host half; it is exported for tests.
 */

import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import type { AskRuntime } from "./ask.ts";
import type { BrowserRuntime } from "./browser.ts";
import { type Config, type ResolvedConfig, resolvedConfig } from "./config.ts";
import {
	type PanelActionResult,
	type PanelMcpServer,
	type PanelSnapshot,
	type PanelWishResult,
	PANEL_NAMESPACE,
	panelEvents,
} from "./client/state.ts";
import { routeOf, specializeWish } from "./wish.ts";

/** Everything the panel service reads, owned by the plugin body. */
export interface PanelDeps {
	/** The live plugin config. */
	readonly config: Config;
	/** The Ask runtime (mode per Session and the read-only policy). */
	readonly ask: AskRuntime;
	/** The browser runtime (connection, tabs, tools). */
	readonly browser: BrowserRuntime;
	/** The Session id the panel is showing, when the caller passed one. */
	readonly sessionId: string | null;
	/** Resolve one Session id to its agent, for the per-Session Ask mode and route. */
	readonly agentOf: (sessionId: string) => Agent | undefined;
	/** The MCP server the browser feature contributes, if the manager owns one. */
	readonly mcp: () => PanelMcpServer | null;
	/** Restart that MCP server. */
	readonly restartMcp: () => Promise<void>;
	/** Tell watchers the snapshot changed. */
	readonly changed: () => void;
}

/** The live halves, filled once the runtimes exist (they need this service's notifier). */
export interface PanelRuntime {
	ask: AskRuntime;
	browser: BrowserRuntime;
}

/** Build the snapshot one panel render reads. */
export function projectPanel(
	deps: PanelDeps,
	config: ResolvedConfig = resolvedConfig(deps.config),
	sessionId: string | null = deps.sessionId,
): PanelSnapshot {
	const agent = sessionId === null ? undefined : deps.agentOf(sessionId);
	const route = agent === undefined ? undefined : routeOf(agent);
	return {
		sessionId,
		dshVersion: process.env.DSH_VERSION ?? null,
		wish: {
			tier: config.wish.tier,
			maxTokens: config.wish.maxTokens,
			provider: route?.provider ?? null,
			model: route?.model ?? null,
		},
		ask: {
			active: agent === undefined ? false : deps.ask.isActive(agent.session),
			...deps.ask.policy(),
			section: config.ask.section,
		},
		browser: deps.browser.snapshot(),
		browserSettings: config.browser,
		mcp: deps.mcp(),
	};
}

declare module "@deepseek-ai/dsh-typert-protocol" {
	interface TypertRemoteNamespace$796565537461636b50616e656c {
		snapshot: (sessionId: string | null) => PanelSnapshot;
		wish: (sessionId: string, wish: string, tier: string | null) => Promise<PanelWishResult>;
		ask: (sessionId: string, active: boolean) => Promise<PanelActionResult>;
		browser: (sessionId: string | null, action: string, pageId: number | null) => Promise<PanelActionResult>;
		restartMcp: () => Promise<PanelActionResult>;
	}
	interface TypertRemoteMap {
		"yeeStackPanel/snapshot": (sessionId: string | null) => PanelSnapshot;
		"yeeStackPanel/wish": (sessionId: string, wish: string, tier: string | null) => Promise<PanelWishResult>;
		"yeeStackPanel/ask": (sessionId: string, active: boolean) => Promise<PanelActionResult>;
		"yeeStackPanel/browser": (sessionId: string | null, action: string, pageId: number | null) => Promise<PanelActionResult>;
		"yeeStackPanel/restartMcp": () => Promise<PanelActionResult>;
	}
	interface TypertRemoteNamespaceMap {
		[PANEL_NAMESPACE]: TypertRemoteNamespace$796565537461636b50616e656c;
	}
}

/** The Host service behind `ctx.remote.yeeStackPanel`. */
export class PanelService extends TypertRemoteService {
	private readonly deps: PanelDeps;
	private readonly events = panelEvents("panel");

	constructor(ctx: Context, deps: PanelDeps) {
		super(ctx, PANEL_NAMESPACE, { namespace: PANEL_NAMESPACE });
		this.deps = deps;
	}

	/** Attach the runtimes that need this service's notifier at construction. */
	attach(runtime: PanelRuntime): void {
		(this.deps as { ask: AskRuntime; browser: BrowserRuntime }).ask = runtime.ask;
		(this.deps as { ask: AskRuntime; browser: BrowserRuntime }).browser = runtime.browser;
	}

	/**
	 * Read the snapshot for one Session (or none).
	 * @param sessionId - the Session the panel is showing; `null` for the config-only view.
	 */
	@Remote
	snapshot(sessionId: string | null): PanelSnapshot {
		return projectPanel(this.deps, resolvedConfig(this.deps.config), sessionId);
	}

	/**
	 * Specialize one wish. The panel writes the answer into the composer.
	 * @param sessionId - the Session whose model route does the work.
	 * @param wish - the raw wish, verbatim.
	 * @param tier - the tier the panel picked, or `null` for the configured default.
	 */
	@Remote
	async wish(sessionId: string, wish: string, tier: string | null): Promise<PanelWishResult> {
		const agent = this.deps.agentOf(sessionId);
		if (agent === undefined) throw new Error(`没有找到会话 ${sessionId} 的 agent`);
		const options = resolvedConfig(this.deps.config).wish;
		const outcome = await specializeWish(
			this.ctx,
			agent,
			wish,
			options,
			tier === "light" || tier === "standard" || tier === "heavy" ? tier : undefined,
		);
		if (!outcome.ok) throw new Error(outcome.message);
		this.events.emit();
		return { prompt: outcome.prompt, supplement: outcome.supplement };
	}

	/**
	 * Turn Ask mode on or off for one Session.
	 * @param sessionId - the Session to change.
	 * @param active - the requested mode.
	 */
	@Remote
	async ask(sessionId: string, active: boolean): Promise<PanelActionResult> {
		const agent = this.deps.agentOf(sessionId);
		if (agent === undefined) return { ok: false, message: `没有找到会话 ${sessionId} 的 agent` };
		this.deps.ask.set(agent, active);
		this.events.emit();
		return { ok: true, snapshot: this.snapshot(sessionId) };
	}

	/**
	 * Drive the browser connection.
	 * @param sessionId - the Session the panel is showing (for the answer).
	 * @param action - `connect`, `launch`, `disconnect`, or `use`.
	 * @param pageId - the tab `use` selects.
	 */
	@Remote
	async browser(sessionId: string | null, action: string, pageId: number | null): Promise<PanelActionResult> {
		try {
			switch (action) {
				case "connect":
					await this.deps.browser.connect();
					break;
				case "launch":
					await this.deps.browser.connect({ connect: "launch" });
					break;
				case "disconnect":
					await this.deps.browser.disconnect();
					break;
				case "use": {
					if (pageId === null) return { ok: false, message: "没有指定 tab" };
					await this.deps.browser.use(pageId);
					break;
				}
				default:
					return { ok: false, message: `未知操作：${action}` };
			}
		} catch (error) {
			return { ok: false, message: error instanceof Error ? error.message : String(error) };
		}
		this.events.emit();
		return { ok: true, snapshot: this.snapshot(sessionId) };
	}

	/** Restart the MCP server the browser feature contributed. */
	@Remote
	async restartMcp(): Promise<PanelActionResult> {
		try {
			await this.deps.restartMcp();
		} catch (error) {
			return { ok: false, message: error instanceof Error ? error.message : String(error) };
		}
		this.events.emit();
		return { ok: true, snapshot: this.snapshot(this.deps.sessionId) };
	}
}

export { PanelService as default };
