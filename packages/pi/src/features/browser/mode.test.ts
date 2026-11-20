import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigStore, type ConfigPaths } from "../../config-store.ts";
import { FakeBrowserEngine } from "../../test-support/fake-browser-engine.ts";
import { createFakeCtx, createFakePi } from "../../test-support/fakes.ts";
import { registerBrowser } from "./index.ts";
import type { PageInfo } from "@yee-stack/browser";

const dir = mkdtempSync(join(tmpdir(), "yee-browser-test-"));
let counter = 0;

function freshStore(config?: unknown): ConfigStore {
	const sub = join(dir, `case-${counter++}`);
	mkdirSync(sub, { recursive: true });
	const paths: ConfigPaths = { config: join(sub, "yee-stack.json"), legacyWish: join(sub, "wish-specializer.json") };
	if (config !== undefined) writeFileSync(paths.config, JSON.stringify(config));
	return new ConfigStore(paths);
}

const PAGES: PageInfo[] = [
	{ id: 3, title: "抖音创作者中心", url: "https://creator.douyin.com/", selected: true },
	{ id: 5, title: "文档", url: "https://example.com/docs", selected: false },
];

const READ_ONLY_BROWSER_TOOLS = ["browser_tabs", "browser_snapshot", "browser_screenshot", "browser_wait"];

async function flush(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 0));
}

async function emit(fake: ReturnType<typeof createFakePi>, event: string, payload: Record<string, unknown>, ctx: unknown) {
	return Promise.all(fake.emit(event, payload, ctx) as Promise<unknown>[]);
}

function setup(options: { config?: unknown; ask?: boolean; active?: string[]; mode?: string; engine?: FakeBrowserEngine } = {}) {
	const fake = createFakePi({ active: options.active });
	const store = freshStore(options.config);
	const engine = options.engine ?? new FakeBrowserEngine();
	const c = createFakeCtx({ mode: options.mode });
	const ask = { enabled: options.ask === true };
	const feature = registerBrowser(fake.pi, store, { engine, askEnabled: () => ask.enabled });
	return { fake, store, engine, c, feature, ask };
}

try {
	// ── registration ──────────────────────────────────────────────────────
	{
		const { fake } = setup();
		assert.ok(fake.commands.has("browser"));
		assert.equal(fake.flags.get("browser")?.type, "boolean");
		assert.equal(fake.flags.get("browser")?.default, false);
		assert.equal(fake.toolDefs.size, 15, "all browser tools are registered");
		assert.equal(fake.shortcuts.size, 0, "no shortcut by default");
		for (const name of fake.toolDefs.keys()) {
			assert.ok(name.startsWith("browser_"));
		}
	}
	{
		const { fake } = setup({ config: { browser: { shortcut: "f9" } } });
		assert.deepEqual([...fake.shortcuts.keys()], ["f9"]);
		assert.match(fake.shortcuts.get("f9")!.description ?? "", /浏览器/);
	}
	{
		const { fake } = setup({ config: { browser: { shortcut: null } } });
		assert.equal(fake.shortcuts.size, 0);
	}

	// ── session start does not connect unless asked ───────────────────────
	{
		const { fake, engine, c, feature } = setup();
		await emit(fake, "session_start", { reason: "startup" }, c.ctx);
		assert.equal(engine.startCalls.length, 0);
		assert.equal(feature.isListening(), false);
		assert.equal(c.autocompleteFactories.length, 1, "TUI registers $ completion");
		assert.equal(c.status.get("yee-browser"), undefined);
		assert.equal(engine.retainCount, 1);
	}
	{
		// --browser starts the connection.
		const { fake, engine, c } = setup();
		fake.flagValues.browser = true;
		await emit(fake, "session_start", { reason: "startup" }, c.ctx);
		await flush();
		assert.equal(engine.startCalls.length, 1);
		assert.equal(engine.state, "connected");
	}
	{
		// listenOnStartup does the same without the flag.
		const { fake, engine, c } = setup({ config: { browser: { listenOnStartup: true } } });
		await emit(fake, "session_start", { reason: "startup" }, c.ctx);
		await flush();
		assert.equal(engine.startCalls.length, 1);
	}
	{
		// A reload does not reconnect on its own.
		const { fake, engine, c } = setup({ config: { browser: { listenOnStartup: true } } });
		await emit(fake, "session_start", { reason: "reload" }, c.ctx);
		await flush();
		assert.equal(engine.startCalls.length, 0);
	}

	// ── a one-shot connection is remembered ───────────────────────────────
	{
		const { fake, store, engine, c } = setup();
		await fake.commands.get("browser")!.handler("on http://127.0.0.1:9222", c.ctx);
		assert.equal(store.get().browser.connect, "url");
		assert.equal(store.get().browser.endpoint, "http://127.0.0.1:9222");
		assert.match(c.notifications.at(-1)!.message, /连接设置已保存/);

		// The next /browser on without an argument reuses the saved endpoint.
		await fake.commands.get("browser")!.handler("on", c.ctx);
		assert.equal(engine.startCalls.at(-1)?.connect, "url");
		assert.equal(engine.startCalls.at(-1)?.endpoint, "http://127.0.0.1:9222");
	}
	{
		const { fake, store, c } = setup();
		await fake.commands.get("browser")!.handler("launch", c.ctx);
		assert.equal(store.get().browser.connect, "launch");
	}
	{
		// A failed connection does not overwrite the saved settings.
		const { fake, store, engine, c } = setup();
		engine.startError = new Error("boom");
		await fake.commands.get("browser")!.handler("on http://bad:9222", c.ctx);
		assert.equal(store.get().browser.connect, "auto");
		assert.equal(store.get().browser.endpoint, null);
		assert.match(c.notifications.at(-1)!.message, /连接失败/);
	}

	// ── /browser on ───────────────────────────────────────────────────────
	{
		const { fake, engine, c, feature } = setup();
		await emit(fake, "session_start", { reason: "startup" }, c.ctx);
		await fake.commands.get("browser")!.handler("on", c.ctx);
		engine.setPages([...PAGES]);
		assert.equal(engine.startCalls.length, 1);
		assert.equal(feature.isListening(), true);
		assert.match(c.notifications.at(-1)!.message, /浏览器已连接/);
		assert.equal(c.editorText.value, "", "the /browser text is cleared");

		const active = fake.active();
		for (const name of fake.toolDefs.keys()) assert.ok(active.includes(name), `${name} is active`);
		assert.ok(active.includes("read"), "other tools stay active");
		assert.match(c.status.get("yee-browser") ?? "", /🌐 2 tabs/);
	}

	// ── Ask mode keeps only the read-only browser tools ───────────────────
	{
		const { fake, engine, c, ask } = setup();
		engine.connect([...PAGES]);
		await emit(fake, "session_start", { reason: "reload" }, c.ctx);
		await emit(fake, "before_agent_start", { systemPromptOptions: { sections: {} } }, c.ctx);

		ask.enabled = true;
		const sections: Record<string, string> = {};
		await emit(fake, "before_agent_start", { systemPromptOptions: { sections } }, c.ctx);
		const browserTools = fake.active().filter((name) => name.startsWith("browser_"));
		assert.deepEqual(browserTools.sort(), [...READ_ONLY_BROWSER_TOOLS].sort());
		assert.match(sections["yee-browser"] ?? "", /Browser control is ON/);
		assert.match(sections["yee-browser"] ?? "", /\$t3/);

		ask.enabled = false;
		await emit(fake, "before_agent_start", { systemPromptOptions: { sections: {} } }, c.ctx);
		assert.equal(fake.active().filter((name) => name.startsWith("browser_")).length, 15);
	}

	// ── $t5 selects the tab for the run ───────────────────────────────────
	{
		const { fake, engine, c } = setup({ config: { browser: { focusTab: true } } });
		engine.connect([...PAGES]);
		await emit(fake, "session_start", { reason: "reload" }, c.ctx);
		engine.calls.length = 0;

		const results = await emit(fake, "input", { text: "$t5 把近 7 天数据整理成表格", source: "interactive" }, c.ctx);
		assert.deepEqual(results, [{ action: "continue" }]);
		assert.deepEqual(engine.calls.at(-1), { name: "select_page", args: { pageId: 5, bringToFront: true } });
		assert.deepEqual(fake.entries.at(-1), {
			type: "custom",
			customType: "yee-browser",
			data: { pageId: 5, epoch: engine.epoch, url: "https://example.com/docs", title: "文档" },
		});
		assert.match(c.notifications.at(-1)!.message, /当前 tab：\$t5 文档/);
		assert.match(c.status.get("yee-browser") ?? "", /\$t5 文档/);
	}

	{
		// focusTab defaults to false: the tab is selected in Pi only.
		const { fake, engine, c } = setup();
		engine.connect([...PAGES]);
		await emit(fake, "session_start", { reason: "reload" }, c.ctx);
		engine.calls.length = 0;
		await emit(fake, "input", { text: "$t5 看一下", source: "interactive" }, c.ctx);
		assert.equal(engine.calls.length, 0);
		assert.equal((fake.entries.at(-1)?.data as { pageId: number }).pageId, 5);
	}

	{
		// An unknown $tN warns and the message still goes through.
		const { fake, engine, c } = setup();
		engine.connect([...PAGES]);
		await emit(fake, "session_start", { reason: "reload" }, c.ctx);
		const entries = fake.entries.length;
		const results = await emit(fake, "input", { text: "$t9 看一下", source: "interactive" }, c.ctx);
		assert.deepEqual(results, [{ action: "continue" }]);
		assert.equal(fake.entries.length, entries, "nothing recorded");
		assert.match(c.notifications.at(-1)!.message, /没有找到 \$t9/);
	}

	{
		// $HOME is not a tab reference.
		const { fake, engine, c } = setup();
		engine.connect([...PAGES]);
		await emit(fake, "session_start", { reason: "reload" }, c.ctx);
		const results = await emit(fake, "input", { text: "echo $HOME", source: "interactive" }, c.ctx);
		assert.deepEqual(results, [undefined]);
	}

	// ── /browser use and tabs ─────────────────────────────────────────────
	{
		const { fake, engine, c } = setup();
		engine.connect([...PAGES]);
		await emit(fake, "session_start", { reason: "reload" }, c.ctx);

		await fake.commands.get("browser")!.handler("use t5", c.ctx);
		assert.equal((fake.entries.at(-1)?.data as { pageId: number }).pageId, 5);
		assert.match(c.notifications.at(-1)!.message, /已选择 \$t5/);

		await fake.commands.get("browser")!.handler("tabs", c.ctx);
		const tabs = c.notifications.at(-1)!.message;
		assert.match(tabs, /\$t3\s+抖音创作者中心/);
		assert.match(tabs, /← 当前/);

		await fake.commands.get("browser")!.handler("use", c.ctx);
		assert.match(c.notifications.at(-1)!.message, /用法：\/browser use/);
	}

	// ── /browser status and off ───────────────────────────────────────────
	{
		const { fake, engine, c, feature } = setup();
		await emit(fake, "session_start", { reason: "startup" }, c.ctx);
		await fake.commands.get("browser")!.handler("on", c.ctx);
		engine.setPages([...PAGES]);
		await fake.commands.get("browser")!.handler("status", c.ctx);
		const status = c.notifications.at(-1)!.message;
		assert.match(status, /浏览器：已连接/);
		assert.match(status, /连接方式：launch/);
		assert.match(status, /chrome-devtools-mcp：1\.13\.0 · pid 4242/);
		assert.match(status, /tab：2 个/);
		assert.match(status, /工具：browser_tabs/);

		await fake.commands.get("browser")!.handler("off", c.ctx);
		assert.equal(engine.stopCalls, 1);
		assert.equal(feature.isListening(), false);
		assert.equal(fake.active().filter((name) => name.startsWith("browser_")).length, 0);
		assert.equal(c.status.get("yee-browser"), undefined);
	}

	// ── /browser picker ───────────────────────────────────────────────────
	{
		const { fake, engine, c } = setup();
		engine.connect([...PAGES]);
		await emit(fake, "session_start", { reason: "reload" }, c.ctx);
		c.selectAnswers.push("$t5  文档 — https://example.com/docs");
		await fake.commands.get("browser")!.handler("", c.ctx);
		assert.equal(c.selectCalls.length, 1);
		assert.match(c.selectCalls[0]!.title, /选择浏览器 tab/);
		assert.equal((fake.entries.at(-1)?.data as { pageId: number }).pageId, 5);

		c.selectAnswers.push("✕ 断开浏览器连接");
		await fake.commands.get("browser")!.handler("", c.ctx);
		assert.equal(engine.stopCalls, 1);
	}

	// ── restoring the current tab ─────────────────────────────────────────
	{
		const { fake, engine, c } = setup();
		engine.connect([...PAGES]);
		engine.epoch = 4;
		c.setBranch([
			{ type: "message" },
			{ type: "custom", customType: "yee-browser", data: { pageId: 5, epoch: 4, url: PAGES[1]!.url, title: PAGES[1]!.title } },
		]);
		await emit(fake, "session_start", { reason: "resume" }, c.ctx);
		assert.match(c.status.get("yee-browser") ?? "", /\$t5 文档/);
	}
	{
		// After a reconnect the page id changed: find the tab by URL.
		const { fake, engine, c } = setup();
		engine.connect([...PAGES]);
		engine.epoch = 8;
		c.setBranch([
			{
				type: "custom",
				customType: "yee-browser",
				data: { pageId: 99, epoch: 3, url: PAGES[1]!.url, title: PAGES[1]!.title },
			},
		]);
		await emit(fake, "session_start", { reason: "reload" }, c.ctx);
		await flush();
		assert.equal((fake.entries.at(-1)?.data as { pageId: number }).pageId, 5);
		assert.match(c.status.get("yee-browser") ?? "", /\$t5 文档/);
	}
	{
		// A malformed entry is ignored.
		const { fake, engine, c } = setup();
		engine.connect([...PAGES]);
		c.setBranch([{ type: "custom", customType: "yee-browser", data: { pageId: "nope" } }]);
		await emit(fake, "session_start", { reason: "reload" }, c.ctx);
		assert.match(c.status.get("yee-browser") ?? "", /🌐 2 tabs/);
	}

	// ── /tree navigation restores the branch's tab ────────────────────────
	{
		const { fake, engine, c } = setup();
		engine.connect([...PAGES]);
		await emit(fake, "session_start", { reason: "reload" }, c.ctx);
		c.setBranch([
			{ type: "custom", customType: "yee-browser", data: { pageId: 5, epoch: engine.epoch, url: PAGES[1]!.url, title: PAGES[1]!.title } },
		]);
		await emit(fake, "session_tree", {}, c.ctx);
		assert.match(c.status.get("yee-browser") ?? "", /\$t5 文档/);
	}

	// ── session shutdown releases the engine ──────────────────────────────
	{
		const { fake, engine, c } = setup();
		await emit(fake, "session_start", { reason: "startup" }, c.ctx);
		assert.equal(engine.retainCount, 1);
		await emit(fake, "session_shutdown", { reason: "quit" }, c.ctx);
		assert.equal(engine.retainCount, 0);
	}

	// ── $ completion ──────────────────────────────────────────────────────
	{
		const { fake, engine, c } = setup();
		engine.connect([...PAGES]);
		await emit(fake, "session_start", { reason: "reload" }, c.ctx);

		const provider = c.autocompleteProvider;
		assert.deepEqual(provider.triggerCharacters, ["$"]);
		const all = await provider.getSuggestions(["$"], 0, 1, { signal: new AbortController().signal });
		assert.deepEqual(all.items.map((item: { value: string }) => item.value), ["$t3", "$t5"]);
		assert.equal(all.prefix, "$");

		const filtered = await provider.getSuggestions(["$文"], 0, 2, { signal: new AbortController().signal });
		assert.deepEqual(filtered.items.map((item: { value: string }) => item.value), ["$t5"]);

		const applied = provider.applyCompletion(["看看 $文 的页面"], 0, 5, { value: "$t5", label: "$t5" }, "$文");
		assert.deepEqual(applied.lines, ["看看 $t5  的页面"]);
		assert.equal(applied.cursorCol, 7);

		const fallback = await provider.getSuggestions(["echo $HOME"], 0, 10, { signal: new AbortController().signal });
		assert.equal(fallback, null, "not a tab query: the base provider answers");
	}
	{
		// Not connected: $ stays with the base provider.
		const { fake, c } = setup();
		await emit(fake, "session_start", { reason: "reload" }, c.ctx);
		const provider = c.autocompleteProvider;
		assert.equal(await provider.getSuggestions(["$"], 0, 1, { signal: new AbortController().signal }), null);
	}

	console.log("yee-stack browser mode tests passed");
} finally {
	rmSync(dir, { recursive: true, force: true });
}
