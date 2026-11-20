import assert from "node:assert/strict";
import { ASK_SECTION, READ_ONLY_TOOLS, registerAsk } from "../ask.ts";
import { asAgent, asContext, createFakeCtx } from "./fakes.ts";

const ctx = createFakeCtx();
const ask = await registerAsk(asContext(ctx), { extraTools: ["browser_snapshot"], section: "ASK TEXT" });
const agent = ctx.createAgent();

// ── prompt section ───────────────────────────────────────────────────────
const section = ctx.sections.find((candidate) => candidate.name === ASK_SECTION);
assert.ok(section, "the yee:ask section is registered");
assert.equal(section.text({ agent }), "", "nothing is injected while the mode is off");

// ── guard ────────────────────────────────────────────────────────────────
const guard = ctx.guards[0];
assert.ok(guard, "a tool guard is registered");
assert.equal(guard({ name: "bash", agent }), undefined, "no opinion while the mode is off");

ask.set(asAgent(agent), true);
assert.deepEqual(agent.session.events.at(-1), { type: "yee/ask", data: { active: true } });
assert.equal(section.text({ agent }), "ASK TEXT");
assert.ok(guard({ name: "bash", agent }), "bash is denied");
assert.ok(guard({ name: "write", agent }), "write is denied");
assert.equal(guard({ name: "read", agent }), undefined, "read is allowed");
assert.equal(guard({ name: "browser_snapshot", agent }), undefined, "configured extra tools are allowed");
assert.equal(guard({ name: "browser_click", agent }), "Ask mode is on: \"browser_click\" is not a read-only tool, so it is unavailable. Answer from what you can read, or tell the user to leave ask mode with /ask if the task needs it.");

// ── tool set ─────────────────────────────────────────────────────────────
assert.deepEqual(agent.restriction?.allow, [...READ_ONLY_TOOLS, "browser_snapshot"]);

// ── command ──────────────────────────────────────────────────────────────
const command = ctx.commands.get("ask");
assert.ok(command, "/ask is registered");

const status = (await command.handler({ agent: asAgent(agent), rawInput: "status" })) as { kind: string; text: string };
assert.equal(status.kind, "success");
assert.match(status.text, /Ask 模式：开启/);
assert.match(status.text, /放行的只读工具：read, read_image, glob, grep, browser_snapshot/);
assert.match(status.text, /已屏蔽：bash/);

const toggled = (await command.handler({ agent: asAgent(agent), rawInput: "" })) as { kind: string; text: string };
assert.equal(toggled.kind, "success");
assert.equal(agent.restriction, undefined, "leaving the mode restores the tool set");
assert.equal(section.text({ agent }), "");
assert.deepEqual(agent.session.events.at(-1), { type: "yee/ask", data: { active: false } });

const question = (await command.handler({ agent: asAgent(agent), rawInput: "这个项目的入口在哪？" })) as {
	kind: string;
};
assert.equal(question.kind, "success");
assert.equal(agent.followups.length, 1, "the question is submitted as a follow-up");
assert.equal(agent.followups[0]?.content[0]?.text, "这个项目的入口在哪？");
assert.equal(ask.isActive(asAgent(agent).session), true, "asking turns the mode on");

// ── a fresh agent picks up the logged state ──────────────────────────────
const resumed = ctx.createAgent();
const events = resumed.session.events;
events.push({ type: "yee/ask", data: { active: true } });
assert.equal(ask.isActive(asAgent(resumed).session), false, "the fake log is per session");

console.log("yee-stack dsh ask tests passed");
