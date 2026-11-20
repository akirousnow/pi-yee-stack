import assert from "node:assert/strict";
import {
	blockedTools,
	candidateExtraTools,
	computeAskTools,
	isToolAllowed,
	NEVER_ALLOWED_TOOLS,
	READ_ONLY_BUILTIN_TOOLS,
	toolsAfterAsk,
	type ToolLike,
} from "./policy.ts";

const tool = (name: string, extra: Partial<ToolLike> = {}): ToolLike => ({ name, exposure: "direct", ...extra });
const none: ReadonlySet<string> = new Set();

// The read-only set mirrors pi's createReadOnlyTools; the blocked set is every mutating built-in.
assert.deepEqual([...READ_ONLY_BUILTIN_TOOLS], ["read", "grep", "find", "ls"]);
assert.deepEqual([...NEVER_ALLOWED_TOOLS].sort(), ["bash", "edit", "powershell", "write"]);

// ── isToolAllowed ───────────────────────────────────────────────────────
for (const name of READ_ONLY_BUILTIN_TOOLS) assert.equal(isToolAllowed(tool(name), none), true, name);
for (const name of NEVER_ALLOWED_TOOLS) assert.equal(isToolAllowed(tool(name), none), false, name);
assert.equal(isToolAllowed(undefined, none), false, "unknown tools are blocked");
assert.equal(isToolAllowed(tool("web_search"), none), false, "unannotated tools are blocked by default");
assert.equal(isToolAllowed(tool("docs", { annotations: {} }), none), false);
assert.equal(isToolAllowed(tool("docs", { annotations: { readOnlyHint: false } }), none), false);
assert.equal(isToolAllowed(tool("docs", { annotations: { readOnlyHint: true } }), none), true, "readOnlyHint is honored");
assert.equal(isToolAllowed(tool("web_search"), new Set(["web_search"])), true, "ticked tools are allowed");

// A mutating built-in is never allowed — not by ticking it, not by claiming readOnlyHint.
for (const name of NEVER_ALLOWED_TOOLS) {
	assert.equal(isToolAllowed(tool(name), new Set([name])), false, `${name} ticked`);
	assert.equal(isToolAllowed(tool(name, { annotations: { readOnlyHint: true } }), none), false, `${name} annotated`);
}

// ── computeAskTools ─────────────────────────────────────────────────────
const registry = [
	tool("read"),
	tool("bash"),
	tool("edit"),
	tool("write"),
	tool("grep"),
	tool("find"),
	tool("ls"),
	tool("mcp__docs__search", { annotations: { readOnlyHint: true } }),
	tool("mcp__db__drop", { annotations: { destructiveHint: true } }),
	tool("web_search"),
	tool("todo"),
];

// Pi's default loadout → the read-only built-ins, in a stable order.
assert.deepEqual(computeAskTools(registry, ["read", "bash", "edit", "write"], none), ["read", "grep", "find", "ls"]);

// Active read-only extension tools stay; active unannotated/destructive ones go.
assert.deepEqual(
	computeAskTools(registry, ["read", "bash", "mcp__docs__search", "mcp__db__drop", "web_search"], none),
	["read", "grep", "find", "ls", "mcp__docs__search"],
);

// Inactive read-only tools are not switched on behind the user's back.
assert.deepEqual(computeAskTools(registry, ["read"], none), ["read", "grep", "find", "ls"]);

// Ticked tools are added even when they were not active.
assert.deepEqual(computeAskTools(registry, ["read"], new Set(["web_search", "todo"])), [
	"read",
	"grep",
	"find",
	"ls",
	"web_search",
	"todo",
]);

// Ticking a mutating built-in or an unregistered tool changes nothing.
assert.deepEqual(computeAskTools(registry, ["read"], new Set(["bash", "ghost"])), ["read", "grep", "find", "ls"]);

// Built-ins that do not exist (e.g. excluded with --exclude-tools) are skipped.
assert.deepEqual(computeAskTools([tool("read"), tool("bash")], ["read", "bash"], none), ["read"]);

// No duplicates.
assert.deepEqual(computeAskTools(registry, ["ls", "read", "ls", "grep"], none), ["read", "grep", "find", "ls"]);

// ── candidateExtraTools ─────────────────────────────────────────────────
const candidates = candidateExtraTools([
	...registry,
	tool("hidden_thing", { exposure: "hidden" }),
	tool("deferred_thing", { exposure: "deferred" }),
	tool("codemode_thing", { exposure: "codemode" }),
	tool("asker", { exposure: "model-only" }),
	{ name: "no_exposure_field" },
]).map((t) => t.name);
assert.deepEqual(candidates, ["asker", "mcp__db__drop", "no_exposure_field", "todo", "web_search"]);

// ── toolsAfterAsk ───────────────────────────────────────────────────────
assert.deepEqual(toolsAfterAsk(["read", "bash"], registry, ["read", "grep"]), ["read", "bash"], "the snapshot wins");
assert.deepEqual(
	toolsAfterAsk(undefined, registry, ["read", "grep", "find", "ls"]),
	["read", "bash", "edit", "write", "grep", "find", "ls"],
	"no snapshot: default coding tools plus whatever is active",
);
assert.deepEqual(toolsAfterAsk([], [tool("read")], ["read"]), ["read"], "an empty snapshot falls back too");

// ── blockedTools ────────────────────────────────────────────────────────
assert.deepEqual(blockedTools(registry, none), ["bash", "edit", "mcp__db__drop", "todo", "web_search", "write"]);
assert.deepEqual(blockedTools(registry, new Set(["todo"])), ["bash", "edit", "mcp__db__drop", "web_search", "write"]);

console.log("yee-stack ask policy tests passed");
