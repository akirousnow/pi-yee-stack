import assert from "node:assert/strict";
import { describeConfig, resolveConfig, resolvedConfig, toBrowserConfig } from "../config.ts";

const resolved = resolvedConfig(resolveConfig({}));
assert.equal(resolved.wish.tier, "standard");
assert.equal(resolved.wish.maxTokens, 900);
assert.deepEqual(resolved.ask.extraTools, []);
assert.ok(resolved.ask.section.includes("Ask mode is ON"));
assert.equal(resolved.browser.connect, "auto");
assert.equal(resolved.browser.channel, "stable");
assert.equal(resolved.browser.allowEval, false);
assert.equal(resolved.browser.allowRemoteUpload, false);
assert.equal(resolved.browser.listenOnStartup, false);

const custom = resolvedConfig(resolveConfig({ wish: { tier: "heavy" }, ask: { extraTools: ["web_search"] }, browser: { connect: "url", endpoint: " http://127.0.0.1:9222 " } }));
assert.equal(custom.wish.tier, "heavy");
assert.deepEqual(custom.ask.extraTools, ["web_search"]);

// Empty strings become null so the shared planner sees "unset".
const browser = toBrowserConfig(custom.browser);
assert.equal(browser.endpoint, "http://127.0.0.1:9222");
assert.equal(browser.executable, null);
assert.equal(browser.profileDir, null);
assert.equal(browser.focusTab, false);
assert.equal(browser.allowRemoteUpload, false);
assert.equal(browser.shortcut, null);

const text = describeConfig(resolved);
assert.match(text, /Yee Stack 设置/);
assert.match(text, /Wish  档位 standard/);
assert.match(text, /Browser  auto/);

assert.throws(() => resolveConfig({ wish: { tier: "extreme" } }), /expected "light" \| "standard" \| "heavy"/);

console.log("yee-stack dsh config tests passed");
