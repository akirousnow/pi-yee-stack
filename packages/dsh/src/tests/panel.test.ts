/**
 * Panel snapshot tests: the projection the Web page renders.
 *
 * No cordis, no remote: `projectPanel` is a pure function over the runtime
 * faces the plugin already owns, so the tests hand it plain fakes.
 */

import assert from "node:assert/strict";
import type { Agent } from "@deepseek-ai/dsh-agent";
import type { AskRuntime } from "../ask.ts";
import type { BrowserRuntime } from "../browser.ts";
import type { PanelBrowser } from "../client/state.ts";
import { configPath, panelEvents, watchPanel } from "../client/state.ts";
import { resolveConfig } from "../config.ts";
import { projectPanel } from "../panel.ts";

const BROWSER: PanelBrowser = {
	state: "connected",
	error: null,
	tabs: [
		{ id: 1, title: "登录页", url: "https://example.com/login" },
		{ id: 3, title: "文档", url: "https://example.com/docs" },
	],
	current: 3,
	remote: false,
	toolCount: 15,
};

function fakeAsk(active: boolean): AskRuntime {
	return {
		isActive: () => active,
		set: () => {},
		sync: () => {},
		policy: () => ({ allowed: ["read", "grep"], blocked: ["bash"], extraTools: ["web_search"] }),
		section: () => "ASK",
		refresh: () => {},
	};
}

function fakeBrowser(snapshot: PanelBrowser = BROWSER): BrowserRuntime {
	return {
		connect: async () => {},
		disconnect: async () => {},
		status: () => "",
		snapshot: () => snapshot,
		use: async () => {},
		toolNames: () => ["browser_tabs"],
		notify: () => {},
	};
}

const config = resolveConfig({ wish: { tier: "heavy", maxTokens: 1200 }, ask: { extraTools: ["web_search"], section: "ASK" } });
const agent = {
	session: { id: "session-9" },
	options: { provider: "deepseek", model: "deepseek-chat" },
	model: { current: () => ({ provider: "deepseek", model: "deepseek-chat" }) },
} as unknown as Agent;

// ── a bound Session: the route and the Ask mode come from its agent ──────
const bound = projectPanel({
	config,
	ask: fakeAsk(true),
	browser: fakeBrowser(),
	sessionId: "session-9",
	agentOf: (id) => (id === "session-9" ? agent : undefined),
	mcp: () => ({ name: "chrome-devtools", state: "connected", toolCount: 26, error: null }),
	restartMcp: async () => {},
	changed: () => {},
});
assert.equal(bound.sessionId, "session-9");
assert.deepEqual(bound.wish, { tier: "heavy", maxTokens: 1200, provider: "deepseek", model: "deepseek-chat" });
assert.equal(bound.ask.active, true);
assert.deepEqual(bound.ask.allowed, ["read", "grep"]);
assert.deepEqual(bound.ask.blocked, ["bash"]);
assert.equal(bound.ask.section, "ASK");
assert.equal(bound.browser.tabs.length, 2);
assert.equal(bound.browser.current, 3);
assert.deepEqual(bound.mcp, { name: "chrome-devtools", state: "connected", toolCount: 26, error: null });

// ── no Session: no route, Ask reads off, the browser facts still stand ───
const unbound = projectPanel({
	config,
	ask: fakeAsk(true),
	browser: fakeBrowser({ ...BROWSER, state: "error", error: "连不上", tabs: [], current: null }),
	sessionId: null,
	agentOf: () => undefined,
	mcp: () => null,
	restartMcp: async () => {},
	changed: () => {},
});
assert.equal(unbound.wish.provider, null);
assert.equal(unbound.wish.model, null);
assert.equal(unbound.ask.active, false);
assert.equal(unbound.browser.state, "error");
assert.equal(unbound.browser.error, "连不上");
assert.equal(unbound.mcp, null);
// The browser settings travel with the snapshot so the advanced form shows stored values.
assert.equal(unbound.browserSettings.connect, "auto");
assert.equal(unbound.browserSettings.channel, "stable");

// ── config paths address the settings document ───────────────────────────
assert.deepEqual(configPath("wish.tier"), ["wish", "tier"]);
assert.deepEqual(configPath("browser.allowRemoteUpload"), ["browser", "allowRemoteUpload"]);

// ── listeners: push reaches watchers, disposal drops them ────────────────
let hits = 0;
const off = watchPanel("test-owner")(() => {
	hits += 1;
});
const events = panelEvents("test-owner");
events.emit();
assert.equal(hits, 1);
off();
events.emit();
assert.equal(hits, 1);
const off2 = watchPanel("test-owner")(() => {
	hits += 10;
});
events.dispose();
events.emit();
assert.equal(hits, 1);
off2();

console.log("yee-stack dsh panel tests passed");
