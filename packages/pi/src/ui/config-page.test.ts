import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { getKeybindings, stripTerminalSequences, type TUI, visibleWidth } from "@earendil-works/pi-tui";
import { ConfigStore, type ConfigPaths } from "../config-store.ts";
import { createAskTab } from "../features/ask/tab.ts";
import { createWishTab } from "../features/wish/tab.ts";
import { ConfigPage, type ConfigPageResult } from "./config-page.ts";

// ── test doubles ────────────────────────────────────────────────────────

/** A theme that emits real SGR sequences, so width math is exercised for real. */
const theme = {
	fg: (color: string, text: string) => `\x1b[38;5;${color.length + 30}m${text}\x1b[39m`,
	bg: (color: string, text: string) => `\x1b[48;5;${color.length + 30}m${text}\x1b[49m`,
	bold: (text: string) => `\x1b[1m${text}\x1b[22m`,
} as unknown as Theme;

const KEYS = {
	up: "\x1b[A",
	down: "\x1b[B",
	right: "\x1b[C",
	left: "\x1b[D",
	tab: "\t",
	shiftTab: "\x1b[Z",
	enter: "\r",
	escape: "\x1b",
	space: " ",
	backspace: "\x7f",
	ctrlAltK: "\x1b\x0b",
	ctrlAltA: "\x1b\x01",
	ctrlA: "\x01",
	plainK: "k",
};

const dir = mkdtempSync(join(tmpdir(), "yee-page-test-"));
let counter = 0;

function freshStore(): { store: ConfigStore; paths: ConfigPaths } {
	const sub = join(dir, `case-${counter++}`);
	mkdirSync(sub, { recursive: true });
	const paths = { config: join(sub, "yee-stack.json"), legacyWish: join(sub, "wish-specializer.json") };
	return { store: new ConfigStore(paths), paths };
}

const MODELS = [
	{ provider: "magpie", id: "auto/deepseek-v4.1-flash", name: "DeepSeek-V4.1-Flash · routing group" },
	{ provider: "magpie", id: "codex/gpt-6", name: "GPT-6" },
	{ provider: "anthropic", id: "claude-sonnet", name: "claude-sonnet" },
];

const TOOLS = [
	{ name: "read", exposure: "direct", description: "Read files" },
	{ name: "bash", exposure: "direct", description: "Run shell commands" },
	{ name: "web_search", exposure: "direct", description: "Search the web\nsecond line" },
	{ name: "todo", exposure: "direct", description: "Track todos" },
	{ name: "docs", exposure: "direct", annotations: { readOnlyHint: true }, description: "Docs lookup" },
	{ name: "hidden", exposure: "hidden", description: "never shown" },
];

function setup(options: { models?: typeof MODELS; pinned?: boolean } = {}) {
	const { store, paths } = freshStore();
	const ctx = {
		mode: "tui",
		model: { provider: "magpie", id: "codex/gpt-6" },
		modelRegistry: { getAvailable: () => options.models ?? MODELS },
	} as unknown as ExtensionContext;

	let renders = 0;
	let modelChanged = 0;
	const tui = { requestRender: () => void renders++, terminal: { rows: 40, columns: 100 } } as unknown as TUI;
	const results: ConfigPageResult[] = [];

	const tabs = [
		createWishTab({ store, ctx, onModelChanged: () => void modelChanged++ }),
		createAskTab({ store, ctx, listTools: () => TOOLS }),
	];
	const page = new ConfigPage({
		tui,
		theme,
		keybindings: getKeybindings(),
		ctx,
		tabs,
		done: (result) => void results.push(result),
	});
	page.focused = true;

	const press = (...keys: string[]) => keys.forEach((key) => page.handleInput(key));
	const text = (width = 80) => page.render(width).map(stripTerminalSequences);
	const screen = (width = 80) => text(width).join("\n");
	return { page, store, paths, press, text, screen, results, renders: () => renders, modelChanged: () => modelChanged };
}

try {
	// ── layout ────────────────────────────────────────────────────────────
	{
		const t = setup();
		const out = t.screen();
		assert.match(out, /Yee Stack 设置/);
		assert.match(out, /\[ 许愿 Wish \]/, "active tab is bracketed");
		assert.match(out, /提问 Ask/);
		assert.match(out, /→ 模型\s+跟随当前 Pi 模型/);
		assert.match(out, /默认风格\s+标准 \(standard\)/);
		assert.match(out, /快捷键\s+Ctrl\+Alt\+W/);
		assert.match(out, /固定后不会修改 Pi 当前模型/, "description of the selected row");
		assert.match(out, /←\/→ 切换标签/);

		// Every line fills the panel exactly, at every width, including CJK and tiny terminals.
		for (const width of [20, 24, 36, 40, 60, 80, 110]) {
			for (const line of t.page.render(width)) {
				assert.equal(visibleWidth(line), width, `width ${width}: ${JSON.stringify(stripTerminalSequences(line))}`);
			}
		}
	}

	// ── tabs and row navigation ───────────────────────────────────────────
	{
		const t = setup();
		t.press(KEYS.tab);
		assert.match(t.screen(), /\[ 提问 Ask \]/);
		assert.match(t.screen(), /→ 快捷键\s+Ctrl\+Alt\+A/);
		assert.match(t.screen(), /额外放行的工具\s+无/);
		t.press(KEYS.tab);
		assert.match(t.screen(), /\[ 许愿 Wish \]/, "tabs wrap");
		t.press(KEYS.shiftTab);
		assert.match(t.screen(), /\[ 提问 Ask \]/, "shift+tab goes back (wrapping)");
		t.press(KEYS.left);
		assert.match(t.screen(), /\[ 许愿 Wish \]/);
		t.press(KEYS.right);
		assert.match(t.screen(), /\[ 提问 Ask \]/);

		// Each tab remembers its own cursor.
		t.press(KEYS.down);
		assert.match(t.screen(), /→ 额外放行的工具/);
		t.press(KEYS.left);
		assert.match(t.screen(), /→ 模型/, "the Wish tab cursor was untouched");
		t.press(KEYS.right);
		assert.match(t.screen(), /→ 额外放行的工具/, "…and Ask kept its own");

		// up/down wrap around
		t.press(KEYS.down);
		assert.match(t.screen(), /→ 快捷键/);
		t.press(KEYS.up);
		assert.match(t.screen(), /→ 额外放行的工具/);
	}

	// ── closing ───────────────────────────────────────────────────────────
	{
		const t = setup();
		t.press(KEYS.escape);
		assert.deepEqual(t.results, [{ reload: false }]);
		t.press(KEYS.escape);
		assert.equal(t.results.length, 1, "done fires once");
	}

	// ── Wish: default style cycles and persists ───────────────────────────
	{
		const t = setup();
		t.press(KEYS.down, KEYS.enter); // 默认风格 is the second row
		assert.equal(t.store.get().wish.tier, "heavy");
		assert.match(t.screen(), /默认风格\s+重度 \(heavy\)/);
		assert.match(t.screen(), /默认 wish 风格：重度 \(heavy\)/, "footer notice");
		t.press(KEYS.space);
		assert.equal(t.store.get().wish.tier, "light", "space also activates; heavy wraps to light");
		t.press(KEYS.enter);
		assert.equal(t.store.get().wish.tier, "standard");
		assert.deepEqual(t.results, [], "changing a value does not close the page");
	}

	// ── Wish: shortcut capture ────────────────────────────────────────────
	{
		const t = setup();
		t.press(KEYS.down, KEYS.down, KEYS.enter);
		assert.match(t.screen(), /设置 Wish 快捷键/);
		assert.match(t.screen(), /当前：Ctrl\+Alt\+W/);
		assert.match(t.screen(), /按下新的快捷键 · Backspace 清除 · Esc 取消/, "view hint replaces the page hint");

		t.press(KEYS.plainK);
		assert.match(t.screen(), /需要 Ctrl\/Alt\/Super\+字母\/数字/, "a bare letter is refused");
		t.press(KEYS.ctrlA);
		assert.match(t.screen(), /与 Pi 内置快捷键冲突/, "built-in conflict is refused");
		t.press(KEYS.ctrlAltA);
		assert.match(t.screen(), /已被 Ask 使用/, "Ask's shortcut is reserved");
		assert.equal(t.store.get().wish.shortcut, "ctrl+alt+w", "nothing saved yet");

		t.press(KEYS.ctrlAltK);
		assert.equal(t.store.get().wish.shortcut, "ctrl+alt+k");
		assert.match(t.screen(), /快捷键\s+Ctrl\+Alt\+K/, "back on the rows, new value shown");
		assert.match(t.screen(), /Wish 快捷键已设为 Ctrl\+Alt\+K（关闭此页后重载生效）/);

		t.press(KEYS.escape);
		assert.deepEqual(t.results, [{ reload: true }], "closing reports that a reload is needed");
	}
	{
		// Esc inside the view only closes the view; the same key afterwards closes the page.
		const t = setup();
		t.press(KEYS.down, KEYS.down, KEYS.enter, KEYS.escape);
		assert.match(t.screen(), /→ 快捷键/);
		assert.equal(t.results.length, 0);
		assert.equal(t.store.get().wish.shortcut, "ctrl+alt+w");
		t.press(KEYS.escape);
		assert.deepEqual(t.results, [{ reload: false }], "no change, no reload");
	}
	{
		// Backspace clears the shortcut; the default for the other feature stays put.
		const t = setup();
		t.press(KEYS.down, KEYS.down, KEYS.enter, KEYS.backspace);
		assert.equal(t.store.get().wish.shortcut, null);
		assert.match(t.screen(), /快捷键\s+未设置/);
		assert.match(t.screen(), /Wish 快捷键已清除/);
		t.press(KEYS.escape);
		assert.deepEqual(t.results, [{ reload: true }]);

		// Re-capturing the cleared shortcut works, and Ask may now claim ctrl+alt+w.
		const u = setup();
		u.press(KEYS.right, KEYS.enter, "\x1b\x17"); // Ask → shortcut → ctrl+alt+w
		assert.match(u.screen(), /已被 Wish 使用/);
	}
	{
		// Re-pressing the current shortcut is a no-op, not a reload.
		const t = setup();
		t.press(KEYS.down, KEYS.down, KEYS.enter, "\x1b\x17");
		assert.equal(t.store.get().wish.shortcut, "ctrl+alt+w");
		t.press(KEYS.escape);
		assert.deepEqual(t.results, [{ reload: false }]);
	}

	// ── Wish: model picker ────────────────────────────────────────────────
	{
		const t = setup();
		t.press(KEYS.enter);
		let out = t.screen(100);
		assert.match(out, /选择许愿特化器使用的模型/);
		assert.match(out, /当前：跟随当前 Pi 模型/);
		assert.match(out, /搜索/);
		assert.match(out, /→ ↺ 跟随当前 Pi 模型（默认）/, "preselects the current choice");
		assert.match(out, /anthropic\/claude-sonnet/);
		assert.match(out, /magpie\/codex\/gpt-6\s+GPT-6\s+\[当前\]/, "marks the current Pi model");

		// Fuzzy filter; the "follow" choice is not offered while searching.
		for (const ch of "deepseek") t.press(ch);
		out = t.screen(100);
		assert.match(out, /→ magpie\/auto\/deepseek-v4\.1-flash/);
		assert.doesNotMatch(out, /gpt-6/);
		assert.doesNotMatch(out, /跟随当前 Pi 模型（默认）/);

		t.press(KEYS.enter);
		assert.deepEqual(t.store.get().wish.model, { provider: "magpie", id: "auto/deepseek-v4.1-flash" });
		assert.equal(t.modelChanged(), 1);
		assert.match(t.screen(100), /模型\s+magpie\/auto\/deepseek-v4\.1-flash/);
		assert.match(
			t.screen(100),
			/许愿模型已固定：DeepSeek-V4\.1-Flash · routing group \(magpie\/auto\/deepseek-v4\.1-flash\)/,
			"the notice shows the model's name when it differs from its id (as in 0.2.0)",
		);

		// Reopen: the pinned model is preselected and marked; choosing "follow" unpins.
		t.press(KEYS.enter);
		out = t.screen(100);
		assert.match(out, /→ magpie\/auto\/deepseek-v4\.1-flash\s+DeepSeek-V4\.1-Flash · routing group\s+\[✓ 固定\]/);
		t.press(KEYS.escape);
		assert.deepEqual(t.results, [], "Esc closed the picker, not the page");
		assert.match(t.screen(100), /→ 模型\s+magpie\/auto\/deepseek-v4\.1-flash/, "back on the rows, pin unchanged");
	}
	{
		const t = setup();
		t.press(KEYS.enter);
		for (const ch of "zzzz") t.press(ch);
		assert.match(t.screen(100), /没有匹配的模型/);
		t.press(KEYS.enter); // nothing selectable: stays in the picker
		assert.match(t.screen(100), /没有匹配的模型/);
		t.press(KEYS.escape);
		assert.match(t.screen(100), /→ 模型/);
		assert.equal(t.store.get().wish.model, null);
	}
	{
		// Choosing the same model again saves nothing and does not reset the warning.
		const t = setup();
		t.press(KEYS.enter, KEYS.enter); // "follow" is preselected; pick it
		assert.equal(t.modelChanged(), 0);
		assert.equal(t.store.get().wish.model, null);

		// Pin, then choose "follow" again.
		t.press(KEYS.enter, KEYS.down, KEYS.enter);
		assert.ok(t.store.get().wish.model);
		t.press(KEYS.enter, KEYS.up, KEYS.enter);
		assert.match(t.screen(), /许愿模型：跟随当前 Pi 模型/);
		assert.equal(t.store.get().wish.model, null);
		assert.equal(t.modelChanged(), 2);
	}
	{
		// With no available models the picker does not open.
		const t = setup({ models: [] });
		t.press(KEYS.enter);
		assert.match(t.screen(), /没有可用模型，请先用 \/login 或 \/model 配置模型/);
		assert.match(t.screen(), /→ 模型/);
	}

	// ── Ask: shortcut and extra tools ─────────────────────────────────────
	{
		const t = setup();
		t.press(KEYS.right, KEYS.enter, KEYS.ctrlAltK);
		assert.equal(t.store.get().ask.shortcut, "ctrl+alt+k");
		assert.match(t.screen(), /Ask 快捷键已设为 Ctrl\+Alt\+K/);
		t.press(KEYS.escape);
		assert.deepEqual(t.results, [{ reload: true }]);
	}
	{
		const t = setup();
		t.press(KEYS.right, KEYS.down, KEYS.enter);
		let out = t.screen(100);
		assert.match(out, /额外放行的工具/);
		assert.match(out, /read \/ grep \/ find \/ ls 与声明为只读的工具自动放行/);
		assert.match(out, /→ \[ \] todo\s+Track todos/);
		assert.match(out, /\[ \] web_search\s+Search the web/, "only the first description line");
		const itemRows = out.split("\n").filter((line) => /\[( |x)\]/.test(line));
		assert.equal(itemRows.length, 2, "decided/never-allowed/hidden tools are not offered");

		t.press(KEYS.space);
		assert.deepEqual(t.store.get().ask.extraTools, ["todo"]);
		assert.match(t.screen(100), /\[x\] todo/);
		assert.match(t.screen(100), /Ask 模式将放行 todo/);
		t.press(KEYS.down, KEYS.enter);
		assert.deepEqual([...t.store.get().ask.extraTools].sort(), ["todo", "web_search"]);
		t.press(KEYS.up, KEYS.space);
		assert.deepEqual(t.store.get().ask.extraTools, ["web_search"], "untick removes it");
		assert.match(t.screen(100), /已取消放行 todo/);

		t.press(KEYS.escape);
		assert.match(t.screen(100), /额外放行的工具\s+1 个：web_search/);
		assert.deepEqual(t.results, []);
		t.press(KEYS.escape);
		assert.deepEqual(t.results, [{ reload: false }], "tool choices never need a reload");
	}
	{
		// Stale entries from an uninstalled tool stay visible so they can be unticked.
		const t = setup();
		t.store.update((d) => {
			d.ask.extraTools = ["gone_tool"];
		});
		t.press(KEYS.right, KEYS.down, KEYS.enter);
		const out = t.screen(100);
		assert.match(out, /\[x\] gone_tool\s+（当前未注册）/);
		// registered tools come first, stale entries last: [todo, web_search, gone_tool]
		t.press(KEYS.down, KEYS.down, KEYS.space);
		assert.deepEqual(t.store.get().ask.extraTools, []);
	}

	// ── save failures are reported, not thrown ────────────────────────────
	{
		const t = setup();
		// Turn the config path into a directory so every write fails.
		rmSync(t.paths.config, { force: true });
		mkdirSync(t.paths.config, { recursive: true });

		t.press(KEYS.down, KEYS.enter);
		assert.match(t.screen(), /保存设置失败：/);
		assert.equal(t.store.get().wish.tier, "standard", "the in-memory config did not change");

		t.press(KEYS.right, KEYS.down, KEYS.enter, KEYS.space);
		assert.match(t.screen(100), /保存设置失败：/);
		assert.match(t.screen(100), /\[ \] todo/, "the checkbox is reverted");
		assert.deepEqual(t.store.get().ask.extraTools, []);
	}

	// ── an unexpected throw in a row does not take the page down ──────────
	{
		const { store } = freshStore();
		const ctx = { mode: "tui" } as unknown as ExtensionContext;
		const tui = { requestRender() {}, terminal: { rows: 30, columns: 80 } } as unknown as TUI;
		const page = new ConfigPage({
			tui,
			theme,
			keybindings: getKeybindings(),
			ctx,
			done: () => {},
			tabs: [
				{
					id: "boom",
					title: "Boom",
					rows: () => [
						{
							id: "b",
							label: "Explode",
							value: () => "x",
							activate: () => {
								throw new Error("kaboom");
							},
						},
					],
				},
			],
		});
		void store;
		page.handleInput("\r");
		assert.match(page.render(80).map(stripTerminalSequences).join("\n"), /操作失败：kaboom/);
	}

	// ── initial tab ───────────────────────────────────────────────────────
	{
		const { store } = freshStore();
		const ctx = { mode: "tui", modelRegistry: { getAvailable: () => [] } } as unknown as ExtensionContext;
		const tui = { requestRender() {}, terminal: { rows: 30, columns: 80 } } as unknown as TUI;
		const make = (initialTab?: string) =>
			new ConfigPage({
				tui,
				theme,
				keybindings: getKeybindings(),
				ctx,
				initialTab,
				done: () => {},
				tabs: [
					createWishTab({ store, ctx, onModelChanged() {} }),
					createAskTab({ store, ctx, listTools: () => [] }),
				],
			});
		const first = (page: ConfigPage) => page.render(80).map(stripTerminalSequences).join("\n");
		assert.match(first(make("ask")), /\[ 提问 Ask \]/);
		assert.match(first(make("wish")), /\[ 许愿 Wish \]/);
		assert.match(first(make("nope")), /\[ 许愿 Wish \]/, "an unknown tab falls back to the first");
		assert.match(first(make()), /\[ 许愿 Wish \]/);
	}

	console.log("yee-stack config page tests passed");
} finally {
	rmSync(dir, { recursive: true, force: true });
}
