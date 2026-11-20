/**
 * Turning Yee Stack's browser settings into a chrome-devtools-mcp command.
 *
 * Three connection modes:
 *   auto   — attach to a Chrome that already allows remote debugging
 *            (`chrome://inspect/#remote-debugging`, Chrome 144+), else to a
 *            Chrome listening on 127.0.0.1:9222.
 *   url    — an explicit `http://host:port` (--browserUrl) or `ws://…`
 *            (--wsEndpoint), for remote machines and SSH tunnels.
 *   launch — let chrome-devtools-mcp start its own Chrome with a dedicated
 *            profile, headless when there is no display.
 *
 * The probe and the environment are injectable so the planning logic is
 * unit-tested without Chrome.
 */

import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join, win32 } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { BrowserChannel, BrowserConfig } from "../../config.ts";

export interface ConnectEnv {
	home: string;
	/** Pi's agent directory: the default Chrome profile lives below it. */
	agentDir: string;
	platform: NodeJS.Platform;
	isRoot: boolean;
	/** Set when a graphical session exists (X11 or Wayland). */
	display: string | undefined;
	localAppData: string | undefined;
	/** Node executable that runs the MCP server. */
	nodePath: string;
}

export type ConnectPlan =
	| { mode: "autoConnect"; channel: BrowserChannel }
	| { mode: "browserUrl"; url: string }
	| { mode: "wsEndpoint"; url: string }
	| { mode: "launch" }
	| { mode: "none"; reason: string };

export interface ConnectProbe {
	/** Whether Chrome wrote a DevToolsActivePort for this channel. */
	hasPortFile(channel: BrowserChannel): boolean;
	/** A debuggable Chrome on 127.0.0.1:9222, as a browser URL. */
	browserUrl(): Promise<string | undefined>;
}

export const AUTO_CONNECT_REASON =
	"没有找到可连接的 Chrome。打开 chrome://inspect/#remote-debugging 允许远程调试（Chrome 144+），" +
	"或运行 /browser launch 让 Yee Stack 启动一个 Chrome，或 /browser on http://127.0.0.1:9222 指定地址。";

/** Default Chrome user-data directory for a channel. */
export function chromeUserDataDir(channel: BrowserChannel, env: ConnectEnv): string {
	if (env.platform === "darwin") {
		const name =
			channel === "stable" ? "Chrome" : channel === "beta" ? "Chrome Beta" : channel === "dev" ? "Chrome Dev" : "Chrome Canary";
		return join(env.home, "Library", "Application Support", "Google", name);
	}
	if (env.platform === "win32") {
		const name =
			channel === "stable" ? "Chrome" : channel === "beta" ? "Chrome Beta" : channel === "dev" ? "Chrome Dev" : "Chrome SxS";
		const base = env.localAppData ?? win32.join(env.home, "AppData", "Local");
		return win32.join(base, "Google", name, "User Data");
	}
	const dir =
		channel === "stable"
			? "google-chrome"
			: channel === "beta"
				? "google-chrome-beta"
				: channel === "dev"
					? "google-chrome-unstable"
					: "google-chrome-canary";
	return join(env.home, ".config", dir);
}

/** The real probe: a DevToolsActivePort file, then a 9222 probe. */
export function defaultProbe(env: ConnectEnv): ConnectProbe {
	return {
		hasPortFile: (channel) => existsSync(join(chromeUserDataDir(channel, env), "DevToolsActivePort")),
		browserUrl: async () => {
			try {
				const response = await fetch("http://127.0.0.1:9222/json/version", { signal: AbortSignal.timeout(400) });
				if (!response.ok) return undefined;
				const payload = (await response.json()) as { webSocketDebuggerUrl?: string };
				return payload.webSocketDebuggerUrl ? "http://127.0.0.1:9222" : undefined;
			} catch {
				return undefined;
			}
		},
	};
}

/** Decide how to reach Chrome. */
export async function planConnection(
	config: BrowserConfig,
	env: ConnectEnv,
	probe: ConnectProbe = defaultProbe(env),
): Promise<ConnectPlan> {
	if (config.connect === "launch") return { mode: "launch" };

	if (config.connect === "url") {
		const endpoint = config.endpoint?.trim();
		if (!endpoint) return { mode: "none", reason: "浏览器连接方式是「指定地址」，但没有填写地址（/yee-config → Browser）。" };
		if (/^wss?:\/\//i.test(endpoint)) return { mode: "wsEndpoint", url: endpoint };
		if (/^https?:\/\//i.test(endpoint)) return { mode: "browserUrl", url: endpoint };
		return { mode: "none", reason: `无法识别的地址：${endpoint}（需要 http:// 或 ws://）` };
	}

	if (probe.hasPortFile(config.channel)) return { mode: "autoConnect", channel: config.channel };
	const url = await probe.browserUrl();
	if (url) return { mode: "browserUrl", url };
	return { mode: "none", reason: AUTO_CONNECT_REASON };
}

/** The default profile for launched browsers. */
export function defaultProfileDir(agentDir: string): string {
	return join(agentDir, "yee-browser", "profile");
}

/** Whether a launched Chrome should be headless. */
export function resolveHeadless(config: BrowserConfig, env: ConnectEnv): boolean {
	if (config.headless === "on") return true;
	if (config.headless === "off") return false;
	// macOS and Windows always have a GUI; only a Linux session can lack a display.
	return env.platform === "linux" ? env.display === undefined : false;
}

/** Locate chrome-devtools-mcp's entry script inside node_modules. */
export function resolveServerBin(requireFn: NodeJS.Require = createRequire(import.meta.url)): string {
	let packageJsonPath: string;
	try {
		packageJsonPath = requireFn.resolve("chrome-devtools-mcp/package.json");
	} catch {
		const main = requireFn.resolve("chrome-devtools-mcp");
		return join(dirname(main), "bin", "chrome-devtools-mcp.js");
	}
	const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
		bin?: string | Record<string, string>;
	};
	const bin = typeof packageJson.bin === "string" ? packageJson.bin : packageJson.bin?.["chrome-devtools-mcp"];
	return bin ? join(dirname(packageJsonPath), bin) : join(dirname(packageJsonPath), "out/Default/gen/src/bin/chrome-devtools-mcp.js");
}

export interface ServerCommand {
	command: string;
	args: string[];
	env: Record<string, string>;
}

/** Flags that apply to every connection mode. */
export function commonServerFlags(config: BrowserConfig): string[] {
	const flags = [
		"--usageStatistics=false",
		"--performanceCrux=false",
		"--experimentalStructuredContent",
		"--screenshotFormat=jpeg",
		"--screenshotQuality=70",
		"--screenshotMaxWidth=1280",
		"--redactNetworkHeaders",
	];
	if (!config.allowEval) flags.push("--no-javascript-evaluation");
	return flags;
}

/** The full command that runs chrome-devtools-mcp over stdio. */
export function buildServerCommand(
	config: BrowserConfig,
	plan: ConnectPlan,
	env: ConnectEnv,
	binPath: string = resolveServerBin(),
): ServerCommand {
	const args = [binPath, ...commonServerFlags(config)];

	if (plan.mode === "autoConnect") {
		args.push("--autoConnect", `--channel=${plan.channel}`);
	} else if (plan.mode === "browserUrl") {
		args.push(`--browserUrl=${plan.url}`);
	} else if (plan.mode === "wsEndpoint") {
		args.push(`--wsEndpoint=${plan.url}`);
	} else if (plan.mode === "launch") {
		args.push(`--userDataDir=${config.profileDir ?? defaultProfileDir(env.agentDir)}`);
		// --executablePath cannot be combined with --channel.
		if (!config.executable) args.push(`--channel=${config.channel}`);
		if (resolveHeadless(config, env)) args.push("--headless");
		if (config.executable) args.push(`--executablePath=${config.executable}`);
		if (env.isRoot) args.push("--chromeArg=--no-sandbox");
	}

	return {
		command: env.nodePath,
		args,
		env: {
			CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS: "1",
			CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS: "1",
		},
	};
}

/** The process environment as the browser feature sees it. */
export function currentConnectEnv(): ConnectEnv {
	return {
		home: homedir(),
		agentDir: getAgentDir(),
		platform: process.platform,
		isRoot: typeof process.getuid === "function" && process.getuid() === 0,
		display: process.env.DISPLAY || process.env.WAYLAND_DISPLAY || undefined,
		localAppData: process.env.LOCALAPPDATA,
		nodePath: process.versions.bun ? "node" : process.execPath,
	};
}
