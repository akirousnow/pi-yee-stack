/**
 * Yee Stack for DeepSeek Harness.
 *
 * One plugin, three features, one settings surface, and the Web panel that
 * shows them:
 *
 *   Wish    — /wish [light|standard|heavy] <wish>: one private completion turns
 *             a one-line wish into directional requirements, returned as the
 *             command's text. The panel's 特化 button does the same and writes
 *             the result into the composer.
 *   Ask     — /ask: read-only Q&A. The tool set is restricted, a guard denies
 *             everything else, and a prompt section explains the mode. The
 *             panel shows the mode and its tool policy, and toggles it.
 *   Browser — /browser and browser_*: a real Chrome through chrome-devtools-mcp,
 *             one tab at a time, with `$tN` references. The panel connects,
 *             lists tabs, and picks the current one.
 *   Panel   — one `main` entry (browser half, `./client`) plus the
 *             `yeeStackPanel` Remote namespace this file provides.
 *   /yee-config prints the resolved settings; the panel edits them live.
 *
 * Install it as a bundle (`dsh.bundle.patch` -> `cordis.patch.yml`) or load it
 * from a checkout with `dsh --patch`.
 */

import { createRequire } from "node:module";
import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import type { McpManagedServerView } from "@deepseek-ai/dsh-mcp-manager";
// Type-only: the Loader's event map (`loader/volatile-update`).
import type {} from "@deepseek-ai/cordis-plugin-loader";
import { registerAsk } from "./ask.ts";
import { registerBrowser } from "./browser.ts";
import { type Config as ConfigShape, describeConfig, type ResolvedConfig, resolvedConfig } from "./config.ts";
import type { PanelMcpServer } from "./client/state.ts";
import { panelEvents } from "./client/state.ts";
import { PanelService } from "./panel.ts";
import { runWish } from "./wish.ts";

export const name = "yee-stack";

/** `commands` and `llm` are optional (registered through `ctx.inject`). */
export const inject = ["tools", "systemPrompt", "sessionProjections"];

/** The MCP server name the browser feature contributes. */
export const MCP_SERVER_NAME = "chrome-devtools";

import { Config } from "./config.ts";
export { Config, ConfigSchema, resolveConfig, resolvedConfig } from "./config.ts";
export type { Config as YeeStackConfig, ResolvedConfig } from "./config.ts";
export { askProjectionDefinition, ASK_SECTION, NEVER_ALLOWED_TOOLS, READ_ONLY_TOOLS } from "./ask.ts";
export { BROWSER_SECTION } from "./browser.ts";
export { BROWSER_UPSTREAM_TOOLS, createBrowserTools } from "./tools.ts";
export { PanelService, projectPanel } from "./panel.ts";
export * from "./client/state.ts";

/**
 * The plugin body.
 *
 * Everything that changes at runtime — Ask mode, the browser connection, the
 * MCP server status, the config — is read through the live references or the
 * runtimes, so one panel write never costs a plugin reload.
 */
export async function apply(ctx: Context, config: ConfigShape): Promise<void> {
	const readConfig = (): ResolvedConfig => resolvedConfig(config);
	const changed = panelEvents("panel");
	const notify = (): void => {
		changed.emit();
	};

	// The panel service exists before the runtimes so their callbacks can emit.
	const agents = new Map<string, Agent>();
	const mcpStatus = { current: null as McpManagedServerView["status"] | null };
	const service = new PanelService(ctx, {
		config,
		// Attached right after the runtimes exist (`service.attach`); the service
		// only reads them on a Remote call, which cannot happen before that.
		ask: undefined as never,
		browser: undefined as never,
		sessionId: null,
		agentOf: (sessionId) => agents.get(sessionId),
		mcp: () => mcpServerView(mcpStatus.current),
		restartMcp: async () => {
			const manager = ctx.get("mcpManager");
			if (manager === undefined) throw new Error("mcp-manager 未加载：无法重启 chrome-devtools");
			await manager.restart(MCP_SERVER_NAME);
		},
		changed: notify,
	});

	const ask = await registerAsk(ctx, readConfig);
	const browser = await registerBrowser(ctx, readConfig, notify);
	service.attach({ ask, browser });

	// Track live agents so the panel can read the Session's Ask mode and route.
	ctx.on("agent/created", ({ agent }) => {
		agents.set(agent.session.id, agent);
		ask.sync(agent);
	});
	ctx.on("agent/disposed", ({ agent }) => {
		agents.delete(agent.session.id);
	});

	// A config write commits live: re-resolve the extra-tool set and tell the panel.
	ctx.on("loader/volatile-update", () => {
		ask.refresh([...agents.values()]);
		notify();
	});

	// Follow the MCP server the browser feature speaks to, and contribute it
	// when the profile has not configured a server of that name itself: a
	// configured entry is the user's choice, and registering a duplicate throws.
	ctx.inject(["mcpManager"], (mcpCtx) => {
		const manager = mcpCtx.mcpManager;
		const configured = manager.list().find((entry) => entry.name === MCP_SERVER_NAME);
		mcpStatus.current = configured?.status ?? null;
		notify();
		const off = mcpCtx.on("mcp-manager/status", (serverName, status) => {
			if (serverName !== MCP_SERVER_NAME) return;
			mcpStatus.current = status;
			notify();
		});
		const dispose = configured?.configured === true
			? () => {}
			: manager.register(MCP_SERVER_NAME, {
				transport: "stdio",
				command: process.execPath,
				args: [chromeDevtoolsEntry()],
				env: {},
				cwd: process.cwd(),
				startupTimeoutMs: 60_000,
			});
		ctx.effect(() => () => {
			off();
			dispose();
		}, "yee-stack: chrome-devtools MCP server");
	});

	ctx.effect(() => () => {
		changed.dispose();
	}, "yee-stack: panel listeners");

	ctx.inject(["commands", "llm"], (commandCtx) => {
		commandCtx.commands.register({
			name: "wish",
			description: "许愿特化器：/wish [light|standard|heavy] <愿望>，补上工作模型需要的方向性要求",
			input: { hint: "[light|standard|heavy] <wish>" },
			handler: ({ agent, rawInput, signal }) => runWish(commandCtx, agent, rawInput, readConfig().wish, signal),
		});

		commandCtx.commands.register({
			name: "yee-config",
			description: "查看 Yee Stack 的当前设置（在 Web 的 Yee Stack 面板里改，即时生效）",
			handler: () => ({ kind: "success", text: describeConfig(config) }),
		});
	});
}

/** The MCP status, flattened into what the panel renders. */
function mcpServerView(status: McpManagedServerView["status"] | null): PanelMcpServer | null {
	if (status === null) return null;
	switch (status.state) {
		case "connected":
			return { name: MCP_SERVER_NAME, state: "connected", toolCount: status.toolCount, error: null };
		case "reconnecting":
		case "waiting-credentials":
			return { name: MCP_SERVER_NAME, state: status.state, toolCount: null, error: status.lastError };
		case "failed":
			return {
				name: MCP_SERVER_NAME,
				state: "failed",
				toolCount: null,
				error: status.reason === "cleanup"
					? status.result.cleanupError ?? "清理未确认"
					: status.lastError ?? status.reason,
			};
		case "closed":
			return {
				name: MCP_SERVER_NAME,
				state: "closed",
				toolCount: null,
				error: status.result.cleanupError ?? null,
			};
		default:
			return { name: MCP_SERVER_NAME, state: status.state, toolCount: null, error: null };
	}
}

/** The chrome-devtools-mcp entry point shipped as a dependency of this package. */
function chromeDevtoolsEntry(): string {
	const require = createRequire(import.meta.url);
	return require.resolve("chrome-devtools-mcp");
}

export default { name, inject, Config, apply };
