import assert from "node:assert/strict";
import { routeOf, runWish } from "../wish.ts";
import { asAgent, asContext, createFakeCtx } from "./fakes.ts";

const ctx = createFakeCtx();
const agent = ctx.createAgent({ provider: "deepseek", model: "deepseek-chat" });

assert.deepEqual(routeOf(asAgent(agent)), { provider: "deepseek", model: "deepseek-chat" });

// ── usage errors ─────────────────────────────────────────────────────────
const empty = await runWish(asContext(ctx), asAgent(agent), "", { tier: "standard", maxTokens: 100 });
assert.equal(empty.kind, "error");
assert.match(empty.text, /用法：\/wish/);

const noRoute = ctx.createAgent();
const missing = await runWish(asContext(ctx), asAgent(noRoute), "画一只猫", { tier: "standard", maxTokens: 100 });
assert.equal(missing.kind, "error");
assert.match(missing.text, /没有可用的模型路由/);

// ── a successful specialization ──────────────────────────────────────────
ctx.setLlmChunks([
	{ type: "block-start", index: 0, blockType: "text" },
	{ type: "text-delta", index: 0, text: "- 冷色霓虹光\n- 主体占画面 1/3" },
	{ type: "block-end", index: 0, block: { type: "text", text: "- 冷色霓虹光\n- 主体占画面 1/3" } },
	{ type: "finish", reason: { kind: "stop" } },
]);

const result = await runWish(asContext(ctx), asAgent(agent), "heavy 画一只赛博朋克猫", { tier: "standard", maxTokens: 100 });
assert.equal(result.kind, "success");
assert.equal(result.text, "画一只赛博朋克猫\n\n---\n\n- 冷色霓虹光\n- 主体占画面 1/3");

// ── an empty supplement is reported, not written back ────────────────────
ctx.setLlmChunks([
	{ type: "block-start", index: 0, blockType: "text" },
	{ type: "text-delta", index: 0, text: "   " },
	{ type: "block-end", index: 0, block: { type: "text", text: "   " } },
	{ type: "finish", reason: { kind: "stop" } },
]);
const nothing = await runWish(asContext(ctx), asAgent(agent), "把首页改成深色", { tier: "light", maxTokens: 100 });
assert.equal(nothing.kind, "success");
assert.match(nothing.text, /已经足够具体/);

// ── a failed call is an error result, not a crash ────────────────────────
ctx.setLlmChunks([{ type: "finish", reason: { kind: "error", failure: { message: "boom" } } }]);
const failed = await runWish(asContext(ctx), asAgent(agent), "画一只猫", { tier: "standard", maxTokens: 100 });
assert.equal(failed.kind, "error");
assert.match(failed.text, /特化失败：boom/);

console.log("yee-stack dsh wish tests passed");
