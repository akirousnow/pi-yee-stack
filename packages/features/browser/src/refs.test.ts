import assert from "node:assert/strict";
import { findTabRef, parseTabRef, tabRef } from "./refs.ts";

// ── tabRef ───────────────────────────────────────────────────────────────
assert.equal(tabRef(3), "$t3");
assert.equal(tabRef(12), "$t12");

// ── parseTabRef: tool arguments and /browser use ─────────────────────────
assert.equal(parseTabRef("$t3"), 3);
assert.equal(parseTabRef("t3"), 3);
assert.equal(parseTabRef("3"), 3);
assert.equal(parseTabRef("  $T12  "), 12);
assert.equal(parseTabRef(7), 7);

for (const bad of ["", "t", "$", "$t", "$t0", "0", "-1", "3.5", 0, -2, 3.5, null, undefined, {}, ["3"]]) {
	assert.equal(parseTabRef(bad), undefined, `rejects ${JSON.stringify(bad)}`);
}

// ── findTabRef: the tab named by a user message ──────────────────────────
assert.equal(findTabRef("$t3 把数据整理成表格"), 3);
assert.equal(findTabRef("用 $t12 看一下"), 12);
assert.equal(findTabRef("先看（$t4）再改"), 4);
assert.equal(findTabRef("`$t5`"), 5);

assert.equal(findTabRef("$t3 和 $t5"), 3, "the first reference wins");
assert.equal(findTabRef("$HOME 是什么"), undefined);
assert.equal(findTabRef("$3 是 shell 参数"), undefined);
assert.equal(findTabRef("t3 没有美元符号"), undefined);
assert.equal(findTabRef("$t3x"), undefined);
assert.equal(findTabRef("价格 $t0"), undefined);
assert.equal(findTabRef(""), undefined);

console.log("yee-stack browser refs tests passed");
