import assert from "node:assert/strict";
import {
	AUTO_CONNECT_REASON,
	buildServerCommand,
	chromeUserDataDir,
	type ConnectEnv,
	type ConnectProbe,
	commonServerFlags,
	defaultProfileDir,
	planConnection,
	resolveHeadless,
} from "./args.ts";
import { defaultConfig } from "yee-stack-core";

const env: ConnectEnv = {
	home: "/home/u",
	agentDir: "/home/u/.pi/agent",
	platform: "linux",
	isRoot: false,
	display: ":0",
	localAppData: undefined,
	nodePath: "/usr/bin/node",
};

const BIN = "/pkg/node_modules/chrome-devtools-mcp/bin.js";

function probe(options: { portFile?: boolean; url?: string } = {}): ConnectProbe {
	return {
		hasPortFile: () => options.portFile === true,
		browserUrl: async () => options.url,
	};
}

const config = (patch: Partial<ReturnType<typeof defaultConfig>["browser"]> = {}) => ({
	...defaultConfig().browser,
	...patch,
});

// ── channel directories ──────────────────────────────────────────────────
assert.equal(chromeUserDataDir("stable", env), "/home/u/.config/google-chrome");
assert.equal(chromeUserDataDir("beta", env), "/home/u/.config/google-chrome-beta");
assert.equal(chromeUserDataDir("dev", env), "/home/u/.config/google-chrome-unstable");
assert.equal(chromeUserDataDir("canary", env), "/home/u/.config/google-chrome-canary");
assert.equal(
	chromeUserDataDir("stable", { ...env, platform: "darwin", home: "/Users/u" }),
	"/Users/u/Library/Application Support/Google/Chrome",
);
assert.equal(
	chromeUserDataDir("canary", { ...env, platform: "darwin", home: "/Users/u" }),
	"/Users/u/Library/Application Support/Google/Chrome Canary",
);
assert.equal(
	chromeUserDataDir("stable", { ...env, platform: "win32", home: "C:\\Users\\u", localAppData: "C:\\Users\\u\\AppData\\Local" }),
	"C:\\Users\\u\\AppData\\Local\\Google\\Chrome\\User Data",
);

// ── planConnection ───────────────────────────────────────────────────────
{
	assert.deepEqual(await planConnection(config({ connect: "launch" }), env, probe()), { mode: "launch" });

	assert.deepEqual(await planConnection(config(), env, probe({ portFile: true })), {
		mode: "autoConnect",
		channel: "stable",
	});
	assert.deepEqual(await planConnection(config({ channel: "beta" }), env, probe({ portFile: true })), {
		mode: "autoConnect",
		channel: "beta",
	});

	assert.deepEqual(await planConnection(config(), env, probe({ url: "http://127.0.0.1:9222" })), {
		mode: "browserUrl",
		url: "http://127.0.0.1:9222",
	});

	const none = await planConnection(config(), env, probe());
	assert.equal(none.mode, "none");
	assert.equal(none.mode === "none" ? none.reason : "", AUTO_CONNECT_REASON);

	assert.deepEqual(
		await planConnection(config({ connect: "url", endpoint: "http://10.0.0.5:9222" }), env, probe()),
		{ mode: "browserUrl", url: "http://10.0.0.5:9222" },
	);
	assert.deepEqual(
		await planConnection(config({ connect: "url", endpoint: "wss://remote/devtools/browser/x" }), env, probe()),
		{ mode: "wsEndpoint", url: "wss://remote/devtools/browser/x" },
	);
	assert.equal((await planConnection(config({ connect: "url", endpoint: "nope" }), env, probe())).mode, "none");
	assert.equal((await planConnection(config({ connect: "url", endpoint: null }), env, probe())).mode, "none");
}

// ── headless and profile defaults ────────────────────────────────────────
assert.equal(resolveHeadless(config(), env), false, "a display means a visible Chrome");
assert.equal(resolveHeadless(config(), { ...env, display: undefined }), true);
assert.equal(resolveHeadless(config({ headless: "on" }), env), true);
assert.equal(resolveHeadless(config({ headless: "off" }), { ...env, display: undefined }), false);
assert.equal(resolveHeadless(config(), { ...env, platform: "darwin", display: undefined }), false, "macOS has a GUI");
assert.equal(resolveHeadless(config(), { ...env, platform: "win32", display: undefined }), false, "Windows has a GUI");
assert.equal(defaultProfileDir("/home/u/.pi/agent"), "/home/u/.pi/agent/yee-browser/profile");

// ── common flags ─────────────────────────────────────────────────────────
{
	const flags = commonServerFlags(config());
	assert.ok(flags.includes("--experimentalStructuredContent"));
	assert.ok(flags.includes("--usageStatistics=false"));
	assert.ok(flags.includes("--performanceCrux=false"));
	assert.ok(flags.includes("--redactNetworkHeaders"));
	assert.ok(flags.includes("--screenshotFormat=jpeg"));
	assert.ok(flags.includes("--no-javascript-evaluation"));
	assert.ok(!commonServerFlags(config({ allowEval: true })).includes("--no-javascript-evaluation"));
}

// ── launch command ───────────────────────────────────────────────────────
{
	const command = buildServerCommand(config({ connect: "launch" }), { mode: "launch" }, { ...env, isRoot: true }, BIN);
	assert.equal(command.command, "/usr/bin/node");
	assert.equal(command.args[0], BIN);
	assert.ok(command.args.includes("--userDataDir=/home/u/.pi/agent/yee-browser/profile"));
	assert.ok(command.args.includes("--channel=stable"));
	assert.ok(!command.args.includes("--headless"), "a display is present");
	assert.ok(command.args.includes("--chromeArg=--no-sandbox"), "root needs --no-sandbox");
	assert.equal(command.env.CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS, "1");
	assert.equal(command.env.CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS, "1");

	const headless = buildServerCommand(
		config({ connect: "launch", headless: "on", executable: "/opt/chrome", profileDir: "/tmp/profile" }),
		{ mode: "launch" },
		env,
		BIN,
	);
	assert.ok(headless.args.includes("--headless"));
	assert.ok(headless.args.includes("--executablePath=/opt/chrome"));
	assert.ok(!headless.args.some((arg) => arg.startsWith("--channel=")), "--executablePath cannot be combined with --channel");
	assert.ok(headless.args.includes("--userDataDir=/tmp/profile"));
	assert.ok(!headless.args.includes("--chromeArg=--no-sandbox"));
}

// ── autoConnect / browserUrl commands ────────────────────────────────────
{
	const auto = buildServerCommand(config(), { mode: "autoConnect", channel: "beta" }, env, BIN);
	assert.ok(auto.args.includes("--autoConnect"));
	assert.ok(auto.args.includes("--channel=beta"));
	assert.ok(!auto.args.some((arg) => arg.startsWith("--userDataDir")));

	const url = buildServerCommand(config(), { mode: "browserUrl", url: "http://127.0.0.1:9222" }, env, BIN);
	assert.ok(url.args.includes("--browserUrl=http://127.0.0.1:9222"));
	assert.ok(!url.args.includes("--autoConnect"));

	const ws = buildServerCommand(config(), { mode: "wsEndpoint", url: "ws://h/devtools/browser/x" }, env, BIN);
	assert.ok(ws.args.includes("--wsEndpoint=ws://h/devtools/browser/x"));
}

console.log("yee-stack browser args tests passed");
