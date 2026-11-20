import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { getKeybindings } from "@earendil-works/pi-tui";
import { ConfigStore, type ConfigPaths } from "../../config-store.ts";
import type { ConfigHost, ConfigView } from "../../ui/config-page.ts";
import { TextInputView } from "../../ui/text-input.ts";
import { createBrowserTab } from "./tab.ts";

const theme = {
	fg: (_color: string, text: string) => text,
	bg: (_color: string, text: string) => text,
	bold: (text: string) => text,
} as unknown as Theme;

const dir = mkdtempSync(join(tmpdir(), "yee-browser-tab-test-"));
let counter = 0;

function freshStore(): ConfigStore {
	const sub = join(dir, `case-${counter++}`);
	mkdirSync(sub, { recursive: true });
	const paths: ConfigPaths = { config: join(sub, "yee-stack.json"), legacyWish: join(sub, "wish-specializer.json") };
	return new ConfigStore(paths);
}

function setup() {
	const store = freshStore();
	const tab = createBrowserTab({ store });
	const views: ConfigView[] = [];
	const notifications: Array<{ text: string; kind?: string }> = [];
	let renders = 0;
	let reloads = 0;
	const host: ConfigHost = {
		ctx: {} as ExtensionContext,
		theme,
		keybindings: getKeybindings(),
		listRows: 10,
		openView: (view) => void views.push(view),
		closeView: () => {},
		notify: (text, kind) => void notifications.push({ text, kind }),
		requestReload: () => void reloads++,
		requestRender: () => void renders++,
	};
	const ids = () => tab.rows().map((row) => row.id);
	return { store, tab, host, views, notifications, ids, renders: () => renders, reloads: () => reloads };
}

try {
	// ── rows follow the connection mode ──────────────────────────────────
	{
		const { tab, host, ids } = setup();
		assert.deepEqual(ids(), [
			"browser.connect",
			"browser.channel",
			"browser.listenOnStartup",
			"browser.focusTab",
			"browser.allowEval",
			"browser.shortcut",
		]);
		assert.equal(tab.rows().find((row) => row.id === "browser.connect")?.value(), "自动连接");

		// auto → url
		tab.rows().find((row) => row.id === "browser.connect")!.activate(host);
		assert.deepEqual(ids(), [
			"browser.connect",
			"browser.endpoint",
			"browser.allowRemoteUpload",
			"browser.listenOnStartup",
			"browser.focusTab",
			"browser.allowEval",
			"browser.shortcut",
		]);

		// url → launch
		tab.rows().find((row) => row.id === "browser.connect")!.activate(host);
		assert.deepEqual(ids(), [
			"browser.connect",
			"browser.channel",
			"browser.executable",
			"browser.headless",
			"browser.profileDir",
			"browser.listenOnStartup",
			"browser.focusTab",
			"browser.allowEval",
			"browser.shortcut",
		]);
		assert.equal(tab.rows().find((row) => row.id === "browser.headless")?.value(), "自动（没有显示器时无头）");

		// launch → auto
		tab.rows().find((row) => row.id === "browser.connect")!.activate(host);
		assert.equal(tab.rows().find((row) => row.id === "browser.connect")?.value(), "自动连接");
	}

	// ── toggles save immediately ─────────────────────────────────────────
	{
		const { tab, host, store, notifications } = setup();
		const row = (id: string) => tab.rows().find((candidate) => candidate.id === id)!;

		row("browser.listenOnStartup").activate(host);
		assert.equal(store.get().browser.listenOnStartup, true);
		assert.match(notifications.at(-1)!.text, /自动连接浏览器/);

		assert.equal(store.get().browser.focusTab, false, "foreground switching is off by default");
		row("browser.focusTab").activate(host);
		assert.equal(store.get().browser.focusTab, true);

		row("browser.allowEval").activate(host);
		assert.equal(store.get().browser.allowEval, true);
		assert.match(notifications.at(-1)!.text, /重新连接后生效/);

		row("browser.channel").activate(host);
		assert.equal(store.get().browser.channel, "beta");

		row("browser.connect").activate(host); // auto → url
		assert.equal(store.get().browser.allowRemoteUpload, false, "remote upload is off by default");
		row("browser.allowRemoteUpload").activate(host);
		assert.equal(store.get().browser.allowRemoteUpload, true);
		assert.match(notifications.at(-1)!.text, /允许向远程 Chrome 上传/);
	}

	// ── endpoint and executable text inputs ──────────────────────────────
	{
		const { tab, host, store, views } = setup();
		tab.rows().find((row) => row.id === "browser.connect")!.activate(host); // → url
		tab.rows().find((row) => row.id === "browser.endpoint")!.activate(host);
		assert.equal(views.length, 1);
		const endpoint = views[0] as TextInputView;

		endpoint.handleInput("http://127.0.0.1:9222");
		endpoint.handleInput("\r");
		assert.equal(store.get().browser.endpoint, "http://127.0.0.1:9222");

		tab.rows().find((row) => row.id === "browser.connect")!.activate(host); // → launch
		tab.rows().find((row) => row.id === "browser.executable")!.activate(host);
		const executable = views.at(-1) as TextInputView;
		executable.handleInput("/opt/chrome");
		executable.handleInput("\r");
		assert.equal(store.get().browser.executable, "/opt/chrome");
	}

	// ── text input validation, cancel, and clearing ──────────────────────
	{
		const store = freshStore();
		const done: Array<string | null> = [];
		let cancelled = 0;
		const view = new TextInputView({
			theme,
			keybindings: getKeybindings(),
			title: "地址",
			current: null,
			placeholder: "http://…",
			validate: (value) => (!value || value.startsWith("http") ? undefined : "需要 http://"),
			onDone: (value) => void done.push(value),
			onCancel: () => void cancelled++,
			requestRender: () => {},
		});
		view.focused = true;
		view.handleInput("ftp://x");
		view.handleInput("\r");
		assert.deepEqual(done, [], "invalid input keeps the view open");
		assert.match(view.render(60).join("\n"), /需要 http:\/\//);

		view.handleInput("\x1b");
		assert.equal(cancelled, 1);

		// An empty field means "unset".
		const emptyDone: Array<string | null> = [];
		const empty = new TextInputView({
			theme,
			keybindings: getKeybindings(),
			title: "地址",
			current: null,
			placeholder: "http://…",
			onDone: (value) => void emptyDone.push(value),
			onCancel: () => {},
			requestRender: () => {},
		});
		empty.handleInput("\r");
		assert.deepEqual(emptyDone, [null]);
		void store;
	}

	console.log("yee-stack browser tab tests passed");
} finally {
	rmSync(dir, { recursive: true, force: true });
}
