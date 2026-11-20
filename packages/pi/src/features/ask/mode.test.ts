import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigStore, type ConfigPaths } from "../../config-store.ts";
import { createFakeCtx, createFakePi, defaultTools, type FakeTool } from "../../test-support/fakes.ts";
import { registerAsk } from "./index.ts";
import { ASK_SECTION_NAME, ASK_SECTION_TEXT } from "yee-stack-ask";

const dir = mkdtempSync(join(tmpdir(), "yee-ask-test-"));
let counter = 0;

function freshStore(config?: unknown): ConfigStore {
	const sub = join(dir, `case-${counter++}`);
	mkdirSync(sub, { recursive: true });
	const paths: ConfigPaths = { config: join(sub, "yee-stack.json"), legacyWish: join(sub, "wish-specializer.json") };
	if (config !== undefined) writeFileSync(paths.config, JSON.stringify(config));
	return new ConfigStore(paths);
}

const READ_ONLY_ACTIVE = ["read", "grep", "find", "ls"];

function setup(options: { config?: unknown; tools?: FakeTool[]; active?: string[]; ctx?: { mode?: string } } = {}) {
	const fake = createFakePi({ tools: options.tools, active: options.active });
	const store = freshStore(options.config);
	const feature = registerAsk(fake.pi, store);
	const c = createFakeCtx(options.ctx);
	const runAsk = (args = "") => fake.commands.get("ask")!.handler(args, c.ctx);
	return { fake, store, feature, c, runAsk };
}

/** Fire before_agent_start and return the sections the handler left behind. */
function sectionsAfterStart(fake: ReturnType<typeof createFakePi>, c: ReturnType<typeof createFakeCtx>) {
	const event = { systemPromptOptions: { sections: {} as Record<string, string>, selectedTools: [] as string[] } };
	fake.emit("before_agent_start", event, c.ctx);
	return event.systemPromptOptions.sections;
}

function callTool(fake: ReturnType<typeof createFakePi>, c: ReturnType<typeof createFakeCtx>, toolName: string) {
	const results = fake.emit("tool_call", { toolName, toolCallId: "t1", input: {} }, c.ctx);
	return results.find((r) => r !== undefined) as { block?: boolean; reason?: string } | undefined;
}

try {
	// ── registration ──────────────────────────────────────────────────────
	{
		const { fake } = setup();
		assert.ok(fake.commands.has("ask"));
		assert.deepEqual([...fake.shortcuts.keys()], ["ctrl+alt+a"], "default shortcut");
		assert.match(fake.shortcuts.get("ctrl+alt+a")!.description ?? "", /Ctrl\+Alt\+A/);
		assert.equal(fake.flags.get("ask")?.type, "boolean");
		assert.equal(fake.flags.get("ask")?.default, false);
	}
	{
		const { fake } = setup({ config: { ask: { shortcut: "f9" } } });
		assert.deepEqual([...fake.shortcuts.keys()], ["f9"], "configured shortcut");
	}
	{
		const { fake } = setup({ config: { ask: { shortcut: null } } });
		assert.equal(fake.shortcuts.size, 0, "no shortcut when disabled");
	}

	// ── toggle on: tools, entry, status ───────────────────────────────────
	{
		const { fake, feature, c, runAsk } = setup();
		await runAsk();
		assert.equal(feature.isEnabled(), true);
		assert.deepEqual(fake.active(), READ_ONLY_ACTIVE, "only read-only tools remain active");
		assert.deepEqual(fake.entries, [
			{ type: "custom", customType: "yee-ask", data: { enabled: true, toolsBefore: ["read", "bash", "edit", "write"] } },
		]);
		assert.equal(c.status.get("yee-ask"), "<warning>❓ ask</warning>");
		assert.match(c.notifications.at(-1)!.message, /Ask 模式已开启/);
		assert.match(c.notifications.at(-1)!.message, /read, grep, find, ls/);
		assert.match(c.notifications.at(-1)!.message, /Ctrl\+Alt\+A/);
		assert.equal(c.editorText.value, "", "the /ask text is cleared from the editor");

		// ── prompt section only while the mode is on ─────────────────────
		const sections = sectionsAfterStart(fake, c);
		assert.equal(sections[ASK_SECTION_NAME], ASK_SECTION_TEXT);
		assert.match(ASK_SECTION_NAME, /^[a-z][a-z0-9_-]*$/, "valid Pi section name");

		// ── tool_call guard ──────────────────────────────────────────────
		for (const name of ["bash", "edit", "write", "powershell", "web_search"]) {
			const verdict = callTool(fake, c, name);
			assert.equal(verdict?.block, true, `${name} is blocked`);
			assert.match(verdict?.reason ?? "", new RegExp(`"${name}"`));
			assert.match(verdict?.reason ?? "", /\/ask/);
		}
		for (const name of READ_ONLY_ACTIVE) assert.equal(callTool(fake, c, name), undefined, `${name} is allowed`);

		// ── toggle off: everything comes back ────────────────────────────
		await runAsk();
		assert.equal(feature.isEnabled(), false);
		assert.deepEqual(fake.active(), ["read", "bash", "edit", "write"], "snapshot restored");
		assert.deepEqual(fake.entries.at(-1), { type: "custom", customType: "yee-ask", data: { enabled: false } });
		assert.equal(c.status.get("yee-ask"), undefined);
		assert.match(c.notifications.at(-1)!.message, /已退出 Ask 模式/);
		assert.deepEqual(sectionsAfterStart(fake, c), {}, "no section when off");
		assert.equal(callTool(fake, c, "bash"), undefined, "the guard is off");
	}

	// ── shortcut toggles the mode ─────────────────────────────────────────
	{
		const { fake, feature, c } = setup();
		const press = () => fake.shortcuts.get("ctrl+alt+a")!.handler(c.ctx);
		await press();
		assert.equal(feature.isEnabled(), true);
		assert.deepEqual(fake.active(), READ_ONLY_ACTIVE);
		await press();
		assert.equal(feature.isEnabled(), false);
		assert.deepEqual(fake.active(), ["read", "bash", "edit", "write"]);
	}

	// ── before_agent_start re-asserts the tool set ────────────────────────
	{
		const { fake, c, runAsk } = setup();
		await runAsk();
		fake.setActive([...fake.active(), "bash", "write"]); // something re-enabled them
		sectionsAfterStart(fake, c);
		assert.deepEqual(fake.active(), READ_ONLY_ACTIVE);
	}

	// ── enforcement is idempotent: no redundant setActiveTools calls ──────
	{
		const { fake, c, runAsk } = setup();
		await runAsk();
		const calls = fake.setActiveCalls.length;
		sectionsAfterStart(fake, c);
		sectionsAfterStart(fake, c);
		assert.equal(fake.setActiveCalls.length, calls, "already-correct tool set is left alone");
	}

	// ── /ask <question> ───────────────────────────────────────────────────
	{
		const { fake, feature, c, runAsk } = setup();
		await runAsk("  why does X fail?  ");
		assert.equal(feature.isEnabled(), true, "a question switches the mode on");
		assert.deepEqual(fake.sentMessages, [{ text: "why does X fail?", options: undefined }]);

		// Already on: asking does not toggle it off.
		await runAsk("and Y?");
		assert.equal(feature.isEnabled(), true);
		assert.deepEqual(fake.sentMessages.at(-1), { text: "and Y?", options: undefined });
		assert.equal(fake.entries.filter((e) => (e.data as { enabled: boolean }).enabled).length, 1, "one 'on' entry only");

		// Busy agent: the question is queued as a follow-up.
		c.setIdle(false);
		await runAsk("one more");
		assert.deepEqual(fake.sentMessages.at(-1), { text: "one more", options: { deliverAs: "followUp" } });
	}

	// ── /ask on|off|status ────────────────────────────────────────────────
	{
		const { fake, feature, c, runAsk } = setup();
		await runAsk("off");
		assert.equal(feature.isEnabled(), false);
		assert.match(c.notifications.at(-1)!.message, /本来就是关闭/);
		assert.equal(fake.entries.length, 0);

		await runAsk("ON");
		assert.equal(feature.isEnabled(), true);
		await runAsk("on");
		assert.match(c.notifications.at(-1)!.message, /已经开启/);
		assert.equal(fake.entries.length, 1, "no duplicate entry");

		await runAsk("status");
		const status = c.notifications.at(-1)!.message;
		assert.match(status, /Ask 模式：开启/);
		assert.match(status, /放行的只读工具：read, grep, find, ls/);
		assert.match(status, /已屏蔽：.*bash/);
		assert.match(status, /快捷键：Ctrl\+Alt\+A/);
		assert.equal(fake.sentMessages.length, 0, "on/off/status are not questions");

		await runAsk("Off");
		assert.equal(feature.isEnabled(), false);
		assert.equal(fake.sentMessages.length, 0);
	}

	// ── non-TUI modes do not touch the editor ─────────────────────────────
	{
		const { c, runAsk } = setup({ ctx: { mode: "rpc" } });
		c.editorText.value = "draft";
		await runAsk();
		assert.equal(c.editorText.value, "draft");
	}

	// ── extension tools: readOnlyHint, user-ticked, destructive ───────────
	{
		const tools: FakeTool[] = [
			...defaultTools(),
			{ name: "docs", exposure: "direct", annotations: { readOnlyHint: true } },
			{ name: "dropper", exposure: "direct", annotations: { destructiveHint: true } },
			{ name: "web_search", exposure: "direct" },
		];
		const { fake, c, runAsk } = setup({
			tools,
			active: ["read", "bash", "edit", "write", "docs", "dropper", "web_search"],
			config: { ask: { extraTools: ["web_search", "bash"] } },
		});
		await runAsk();
		assert.deepEqual(fake.active(), ["read", "grep", "find", "ls", "docs", "web_search"]);
		assert.equal(callTool(fake, c, "docs"), undefined);
		assert.equal(callTool(fake, c, "web_search"), undefined, "ticked");
		assert.equal(callTool(fake, c, "dropper")?.block, true);
		assert.equal(callTool(fake, c, "bash")?.block, true, "bash cannot be ticked in");

		await runAsk();
		assert.deepEqual(fake.active(), ["read", "bash", "edit", "write", "docs", "dropper", "web_search"]);
	}

	// ── session restore ───────────────────────────────────────────────────
	{
		// reload / resume inside an Ask-mode session
		const { fake, feature, c } = setup();
		c.setBranch([
			{ type: "message" },
			{ type: "custom", customType: "other", data: { enabled: false } },
			{ type: "custom", customType: "yee-ask", data: { enabled: true, toolsBefore: ["read", "bash"] } },
		]);
		fake.emit("session_start", { reason: "resume" }, c.ctx);
		assert.equal(feature.isEnabled(), true);
		assert.deepEqual(fake.active(), READ_ONLY_ACTIVE);
		assert.equal(c.status.get("yee-ask"), "<warning>❓ ask</warning>");

		// leaving the mode restores the snapshot that was saved in the session
		await fake.commands.get("ask")!.handler("", c.ctx);
		assert.deepEqual(fake.active(), ["read", "bash"]);
	}
	{
		// the last entry wins
		const { fake, feature, c } = setup({ active: READ_ONLY_ACTIVE });
		c.setBranch([
			{ type: "custom", customType: "yee-ask", data: { enabled: true, toolsBefore: ["read", "bash"] } },
			{ type: "custom", customType: "yee-ask", data: { enabled: false } },
		]);
		fake.emit("session_start", { reason: "resume" }, c.ctx);
		assert.equal(feature.isEnabled(), false);
		assert.equal(c.status.get("yee-ask"), undefined);
	}
	{
		// a fresh session starts with the mode off and touches nothing
		const { fake, feature, c } = setup();
		fake.emit("session_start", { reason: "new" }, c.ctx);
		assert.equal(feature.isEnabled(), false);
		assert.equal(fake.setActiveCalls.length, 0);
		assert.deepEqual(fake.active(), ["read", "bash", "edit", "write"]);
	}
	{
		// a malformed entry is tolerated
		const { fake, feature, c } = setup();
		c.setBranch([{ type: "custom", customType: "yee-ask", data: { enabled: true, toolsBefore: "nope" } }]);
		fake.emit("session_start", { reason: "reload" }, c.ctx);
		assert.equal(feature.isEnabled(), true);
		assert.deepEqual(fake.active(), READ_ONLY_ACTIVE);
		await fake.commands.get("ask")!.handler("", c.ctx);
		assert.equal(feature.isEnabled(), false);
		assert.ok(fake.active().includes("bash"), "falls back to the default coding tools");
	}

	// ── /tree navigation ──────────────────────────────────────────────────
	{
		// Ask mode on → navigate to a branch where it is off: tools are put back.
		const { fake, feature, c, runAsk } = setup();
		await runAsk();
		assert.deepEqual(fake.active(), READ_ONLY_ACTIVE);
		c.setBranch([]);
		fake.emit("session_tree", {}, c.ctx);
		assert.equal(feature.isEnabled(), false);
		assert.deepEqual(fake.active(), ["read", "bash", "edit", "write"]);
		assert.equal(c.status.get("yee-ask"), undefined);

		// …and onto a branch where it is on.
		c.setBranch([{ type: "custom", customType: "yee-ask", data: { enabled: true, toolsBefore: ["read", "bash", "edit", "write"] } }]);
		fake.emit("session_tree", {}, c.ctx);
		assert.equal(feature.isEnabled(), true);
		assert.deepEqual(fake.active(), READ_ONLY_ACTIVE);
	}

	// ── --ask flag ────────────────────────────────────────────────────────
	{
		const { fake, feature, c } = setup();
		fake.flagValues.ask = true;
		fake.emit("session_start", { reason: "startup" }, c.ctx);
		assert.equal(feature.isEnabled(), true, "--ask starts in Ask mode");
		assert.deepEqual(fake.active(), READ_ONLY_ACTIVE);
		assert.equal(fake.entries.length, 1, "and records it in the session");
	}
	{
		// --ask only applies at startup: a reload after the user left Ask mode keeps it off.
		const { fake, feature, c } = setup();
		fake.flagValues.ask = true;
		fake.emit("session_start", { reason: "reload" }, c.ctx);
		assert.equal(feature.isEnabled(), false);
		fake.emit("session_start", { reason: "new" }, c.ctx);
		assert.equal(feature.isEnabled(), false);
	}
	{
		// --ask on a session that is already in Ask mode does not stack entries.
		const { fake, feature, c } = setup();
		fake.flagValues.ask = true;
		c.setBranch([{ type: "custom", customType: "yee-ask", data: { enabled: true, toolsBefore: ["read", "bash"] } }]);
		fake.emit("session_start", { reason: "startup" }, c.ctx);
		assert.equal(feature.isEnabled(), true);
		assert.equal(fake.entries.length, 0);
	}

	console.log("yee-stack ask mode tests passed");
} finally {
	rmSync(dir, { recursive: true, force: true });
}
