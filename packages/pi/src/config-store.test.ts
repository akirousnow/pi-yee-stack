import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_ASK_SHORTCUT, defaultConfig } from "yee-stack-core";
import { ConfigStore, type ConfigPaths, loadConfig } from "./config-store.ts";

const dir = mkdtempSync(join(tmpdir(), "yee-config-test-"));
let counter = 0;
function freshPaths(): ConfigPaths {
	const sub = join(dir, `case-${counter++}`);
	mkdirSync(sub, { recursive: true });
	return { config: join(sub, "yee-stack.json"), legacyWish: join(sub, "wish-specializer.json") };
}

try {
	assert.deepEqual(loadConfig(freshPaths()), defaultConfig());

	// ── shortcut collision: Wish wins ─────────────────────────────────────
	{
		const paths = freshPaths();
		writeFileSync(paths.config, JSON.stringify({ wish: { shortcut: "ctrl+alt+a" } }));
		const store = new ConfigStore(paths);
		assert.equal(store.get().wish.shortcut, "ctrl+alt+a");
		assert.equal(store.get().ask.shortcut, null, "Ask yields to Wish");
		assert.equal(store.hadShortcutCollision, true);

		const clean = new ConfigStore(freshPaths());
		assert.equal(clean.hadShortcutCollision, false);

		const optOut = freshPaths();
		writeFileSync(optOut.config, JSON.stringify({ wish: { shortcut: "ctrl+alt+a" }, ask: { shortcut: null } }));
		assert.equal(new ConfigStore(optOut).hadShortcutCollision, false, "an explicit opt-out is not a collision");
	}

	// ── legacy wish-specializer.json import ───────────────────────────────
	{
		const paths = freshPaths();
		writeFileSync(
			paths.legacyWish,
			JSON.stringify({ model: { provider: "magpie", id: "m1" }, tier: "light", shortcut: "ctrl+alt+j" }),
		);
		const store = new ConfigStore(paths);
		assert.deepEqual(store.get().wish, {
			model: { provider: "magpie", id: "m1" },
			tier: "light",
			shortcut: "ctrl+alt+j",
		});
		assert.equal(store.get().ask.shortcut, DEFAULT_ASK_SHORTCUT);

		// First save writes yee-stack.json and keeps the legacy file untouched.
		store.update((draft) => {
			draft.ask.extraTools = ["web_search"];
		});
		const written = JSON.parse(readFileSync(paths.config, "utf8"));
		assert.equal(written.version, 1);
		assert.equal(written.wish.tier, "light", "legacy values survive the first save");
		assert.deepEqual(written.ask.extraTools, ["web_search"]);
		assert.equal(JSON.parse(readFileSync(paths.legacyWish, "utf8")).tier, "light");

		// Once yee-stack.json exists the legacy file is ignored.
		writeFileSync(paths.legacyWish, JSON.stringify({ tier: "heavy" }));
		assert.equal(loadConfig(paths).wish.tier, "light");
	}

	// ── a corrupt yee-stack.json means defaults, not the legacy file ───────
	{
		const paths = freshPaths();
		writeFileSync(paths.config, "{ not json");
		writeFileSync(paths.legacyWish, JSON.stringify({ tier: "heavy" }));
		assert.deepEqual(loadConfig(paths), defaultConfig());
	}

	// ── update(): persists, re-reads disk, validates ──────────────────────
	{
		const paths = freshPaths();
		const a = new ConfigStore(paths);
		const b = new ConfigStore(paths); // a second Pi process

		a.update((d) => {
			d.wish.tier = "heavy";
		});
		// b still holds stale in-memory state, but its update starts from disk.
		assert.equal(b.get().wish.tier, "standard");
		b.update((d) => {
			d.ask.shortcut = "f8";
		});
		const onDisk = loadConfig(paths);
		assert.equal(onDisk.wish.tier, "heavy", "b did not clobber a's change");
		assert.equal(onDisk.ask.shortcut, "f8");
		assert.equal(b.get().wish.tier, "heavy");

		// invalid mutations are normalized away rather than persisted
		a.update((d) => {
			(d.wish as { tier: string }).tier = "bogus";
			d.ask.shortcut = "q";
		});
		assert.equal(loadConfig(paths).wish.tier, "standard");
		assert.equal(loadConfig(paths).ask.shortcut, DEFAULT_ASK_SHORTCUT);

		// no temp files are left behind
		const leftovers = readdirSync(join(paths.config, "..")).filter((name) => name.endsWith(".tmp"));
		assert.deepEqual(leftovers, []);

		// refresh() picks up outside edits
		writeFileSync(paths.config, JSON.stringify({ wish: { tier: "light" } }));
		assert.equal(a.refresh().wish.tier, "light");
	}

	// ── a failed write leaves the in-memory config unchanged ──────────────
	{
		const paths = freshPaths();
		// Make the config path a directory so renaming over it fails.
		mkdirSync(paths.config, { recursive: true });
		const store = new ConfigStore(paths);
		assert.throws(() =>
			store.update((d) => {
				d.wish.tier = "heavy";
			}),
		);
		assert.equal(store.get().wish.tier, "standard");
	}

	// ── browser shortcut collision: Wish, then Ask, keep theirs ────────────
	{
		const paths = freshPaths();
		writeFileSync(
			paths.config,
			JSON.stringify({
				wish: { shortcut: "ctrl+alt+w" },
				ask: { shortcut: "ctrl+alt+a" },
				browser: { shortcut: "ctrl+alt+a" },
			}),
		);
		const store = new ConfigStore(paths);
		assert.equal(store.get().browser.shortcut, null, "Browser yields to Ask");
		assert.equal(store.hadBrowserShortcutCollision, true);

		const toWish = freshPaths();
		writeFileSync(
			toWish.config,
			JSON.stringify({ wish: { shortcut: "ctrl+alt+k" }, ask: { shortcut: "f9" }, browser: { shortcut: "ctrl+alt+k" } }),
		);
		const wishStore = new ConfigStore(toWish);
		assert.equal(wishStore.get().browser.shortcut, null, "Browser yields to Wish");
		assert.equal(wishStore.hadBrowserShortcutCollision, true);

		const clean = freshPaths();
		writeFileSync(clean.config, JSON.stringify({ browser: { shortcut: "f10" } }));
		const cleanStore = new ConfigStore(clean);
		assert.equal(cleanStore.get().browser.shortcut, "f10");
		assert.equal(cleanStore.hadBrowserShortcutCollision, false);

		const optOut = freshPaths();
		writeFileSync(optOut.config, JSON.stringify({ wish: { shortcut: "f10" }, browser: { shortcut: null } }));
		assert.equal(new ConfigStore(optOut).hadBrowserShortcutCollision, false, "an explicit opt-out is not a collision");
	}

	console.log("yee-stack pi config-store tests passed");
} finally {
	rmSync(dir, { recursive: true, force: true });
}
