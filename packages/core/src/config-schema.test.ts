import assert from "node:assert/strict";
import {
	DEFAULT_ASK_SHORTCUT,
	DEFAULT_WISH_SHORTCUT,
	defaultConfig,
	normalizeConfig,
} from "./config-schema.ts";

// ── defaults ─────────────────────────────────────────────────────────────
assert.deepEqual(normalizeConfig(undefined), defaultConfig());
assert.deepEqual(normalizeConfig("nope"), defaultConfig());
assert.deepEqual(normalizeConfig([]), defaultConfig());
assert.equal(defaultConfig().wish.shortcut, "ctrl+alt+w");
assert.equal(defaultConfig().ask.shortcut, "ctrl+alt+a");

// ── field validation ─────────────────────────────────────────────────────
const odd = normalizeConfig({
	wish: {
		model: { provider: "magpie", id: "auto/x" },
		tier: "heavy",
		shortcut: "  CTRL+ALT+K ",
	},
	ask: { shortcut: "f9", extraTools: [" web_search ", "web_search", 7, "", "fetch"] },
});
assert.deepEqual(odd.wish.model, { provider: "magpie", id: "auto/x" });
assert.equal(odd.wish.tier, "heavy");
assert.equal(odd.wish.shortcut, "ctrl+alt+k");
assert.equal(odd.ask.shortcut, "f9");
assert.deepEqual(odd.ask.extraTools, ["web_search", "fetch"]);

const junk = normalizeConfig({
	wish: { model: { provider: "x" }, tier: "extreme", shortcut: "w" },
	ask: { shortcut: 42, extraTools: "bash" },
});
assert.equal(junk.wish.model, null, "model without id is dropped");
assert.equal(junk.wish.tier, "standard");
assert.equal(junk.wish.shortcut, DEFAULT_WISH_SHORTCUT, "bare letter is not a valid shortcut");
assert.equal(junk.ask.shortcut, DEFAULT_ASK_SHORTCUT);
assert.deepEqual(junk.ask.extraTools, []);

// explicit null disables a shortcut; absence means "use the default"
const disabled = normalizeConfig({ wish: { shortcut: null }, ask: { shortcut: null } });
assert.equal(disabled.wish.shortcut, null);
assert.equal(disabled.ask.shortcut, null);
assert.equal(normalizeConfig({ wish: {}, ask: {} }).ask.shortcut, DEFAULT_ASK_SHORTCUT);

// extraTools is capped
const many = normalizeConfig({ ask: { extraTools: Array.from({ length: 200 }, (_, i) => `t${i}`) } });
assert.equal(many.ask.extraTools.length, 64);

// ── browser config ───────────────────────────────────────────────────────
assert.equal(defaultConfig().browser.connect, "auto");
assert.equal(defaultConfig().browser.channel, "stable");
assert.equal(defaultConfig().browser.headless, "auto");
assert.equal(defaultConfig().browser.focusTab, false);
assert.equal(defaultConfig().browser.listenOnStartup, false);
assert.equal(defaultConfig().browser.allowEval, false);
assert.equal(defaultConfig().browser.shortcut, null);

const browser = normalizeConfig({
	browser: {
		connect: "launch",
		channel: "beta",
		endpoint: "https://remote:9222",
		executable: "  /opt/chrome  ",
		headless: "on",
		profileDir: "/tmp/profile",
		listenOnStartup: true,
		focusTab: false,
		allowEval: true,
		shortcut: " F7 ",
	},
});
assert.deepEqual(browser.browser, {
	connect: "launch",
	channel: "beta",
	endpoint: "https://remote:9222",
	executable: "/opt/chrome",
	headless: "on",
	profileDir: "/tmp/profile",
	listenOnStartup: true,
	focusTab: false,
	allowEval: true,
	shortcut: "f7",
});

const junkBrowser = normalizeConfig({
	browser: {
		connect: "nope",
		channel: "nope",
		endpoint: "ftp://x",
		executable: 42,
		headless: "nope",
		profileDir: "   ",
		listenOnStartup: "yes",
		focusTab: "no",
		allowEval: 1,
		shortcut: "z",
	},
});
assert.deepEqual(junkBrowser.browser, defaultConfig().browser);

assert.equal(normalizeConfig({ browser: { focusTab: true } }).browser.focusTab, true);

console.log("yee-stack core config-schema tests passed");
