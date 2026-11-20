/**
 * Yee Stack's configuration file for the Pi extension.
 *
 *   ~/.pi/agent/yee-stack.json
 *
 * The schema, defaults and validation live in `@yee-stack/core`; this module
 * only owns the file: it reads defensively (missing, malformed and unknown
 * fields all fall back to defaults) and writes atomically. `update()` always
 * re-reads the file first, so two Pi processes that change different settings
 * do not clobber each other.
 *
 * Settings that used to live in `wish-specializer.json` are imported the first
 * time Yee Stack runs without a `yee-stack.json`; the legacy file is left alone.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import {
	hasBrowserShortcutCollision,
	hasShortcutCollision,
	isRecord,
	normalizeConfig,
	type YeeConfig,
} from "@yee-stack/core";

export interface ConfigPaths {
	config: string;
	legacyWish: string;
}

export function defaultConfigPaths(): ConfigPaths {
	const dir = getAgentDir();
	return {
		config: join(dir, "yee-stack.json"),
		legacyWish: join(dir, "wish-specializer.json"),
	};
}

type ReadResult = { kind: "missing" } | { kind: "invalid" } | { kind: "ok"; value: unknown };

function readJson(path: string): ReadResult {
	let text: string;
	try {
		text = readFileSync(path, "utf8");
	} catch {
		return { kind: "missing" };
	}
	try {
		return { kind: "ok", value: JSON.parse(text) as unknown };
	} catch {
		return { kind: "invalid" };
	}
}

/** The raw JSON that should be normalized for `paths`, applying the legacy import. */
function readRawConfig(paths: ConfigPaths): unknown {
	const current = readJson(paths.config);
	if (current.kind === "ok") return current.value;
	// A corrupt file means "defaults", not "resurrect the old Wish file".
	if (current.kind === "invalid") return {};

	const legacy = readJson(paths.legacyWish);
	if (legacy.kind === "ok" && isRecord(legacy.value)) return { wish: legacy.value };
	return {};
}

export function loadConfig(paths: ConfigPaths = defaultConfigPaths()): YeeConfig {
	return normalizeConfig(readRawConfig(paths));
}

function writeConfig(path: string, config: YeeConfig): void {
	mkdirSync(dirname(path), { recursive: true });
	const tmp = `${path}.${process.pid}.tmp`;
	writeFileSync(tmp, `${JSON.stringify({ version: 1, ...config }, null, 2)}\n`, "utf8");
	renameSync(tmp, path);
}

/** In-memory view of the config file with write-through updates. */
export class ConfigStore {
	private current: YeeConfig;
	private readonly startupCollision: boolean;
	private readonly startupBrowserCollision: boolean;

	constructor(private readonly paths: ConfigPaths = defaultConfigPaths()) {
		const raw = readRawConfig(paths);
		this.current = normalizeConfig(raw);
		this.startupCollision = hasShortcutCollision(raw, this.current);
		this.startupBrowserCollision = hasBrowserShortcutCollision(raw, this.current);
	}

	get(): Readonly<YeeConfig> {
		return this.current;
	}

	/** True when Ask's configured shortcut was dropped because Wish uses it. */
	get hadShortcutCollision(): boolean {
		return this.startupCollision;
	}

	/** True when Browser's configured shortcut was dropped because Wish or Ask uses it. */
	get hadBrowserShortcutCollision(): boolean {
		return this.startupBrowserCollision;
	}

	/**
	 * Apply `mutate` to the freshest on-disk config and persist the result.
	 * Throws if the file cannot be written; the in-memory config is then unchanged.
	 */
	update(mutate: (draft: YeeConfig) => void): Readonly<YeeConfig> {
		const draft = loadConfig(this.paths);
		mutate(draft);
		const next = normalizeConfig(draft);
		writeConfig(this.paths.config, next);
		this.current = next;
		return next;
	}

	/** Re-read the file (used when another process may have changed it). */
	refresh(): Readonly<YeeConfig> {
		this.current = loadConfig(this.paths);
		return this.current;
	}
}
