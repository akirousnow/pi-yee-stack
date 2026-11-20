/**
 * Yee Stack configuration: one JSON file for every feature.
 *
 *   ~/.pi/agent/yee-stack.json
 *
 * The file is read defensively (missing, malformed and unknown fields all fall
 * back to defaults) and written atomically. `update()` always re-reads the file
 * first, so two Pi processes that change different settings do not clobber
 * each other.
 *
 * Settings that used to live in `wish-specializer.json` are imported the first
 * time Yee Stack runs without a `yee-stack.json`; the legacy file is left alone.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { normalizeShortcut } from "./shortcut.ts";

export type Tier = "light" | "standard" | "heavy";

export interface ModelRef {
	provider: string;
	id: string;
}

export interface WishConfig {
	/** Pinned model, or `null` to follow the current Pi model. */
	model: ModelRef | null;
	/** Default style for `/wish` and the shortcut. */
	tier: Tier;
	/** Shortcut key id, or `null` for none. */
	shortcut: string | null;
}

export interface AskConfig {
	/** Shortcut key id, or `null` for none. */
	shortcut: string | null;
	/** Extra tool names allowed in Ask mode on top of the read-only ones. */
	extraTools: string[];
}

export type BrowserConnect = "auto" | "url" | "launch";
export type BrowserChannel = "stable" | "beta" | "dev" | "canary";
export type BrowserHeadless = "auto" | "on" | "off";

export interface BrowserConfig {
	/** How to reach Chrome: auto-detect, an explicit endpoint, or launch one. */
	connect: BrowserConnect;
	/** Chrome channel used by auto-connect and launch. */
	channel: BrowserChannel;
	/** `http://host:port` or `ws://…` when `connect` is `"url"`. */
	endpoint: string | null;
	/** Chrome executable for `connect: "launch"`; `null` auto-detects. */
	executable: string | null;
	/** Headless mode for `connect: "launch"`; `auto` means headless without a display. */
	headless: BrowserHeadless;
	/** Chrome user-data directory for `connect: "launch"`; `null` uses the agent dir. */
	profileDir: string | null;
	/** Start listening when Pi starts. */
	listenOnStartup: boolean;
	/** Bring the selected tab to the front in Chrome. */
	focusTab: boolean;
	/** Allow the browser_eval tool (chrome-devtools-mcp --javascript-evaluation). */
	allowEval: boolean;
	/** Shortcut key id, or `null` for none. */
	shortcut: string | null;
}

export interface YeeConfig {
	wish: WishConfig;
	ask: AskConfig;
	browser: BrowserConfig;
}

export const DEFAULT_WISH_SHORTCUT = "ctrl+alt+w";
export const DEFAULT_ASK_SHORTCUT = "ctrl+alt+a";
export const DEFAULT_BROWSER_SHORTCUT: string | null = null;
export const DEFAULT_TIER: Tier = "standard";

const MAX_EXTRA_TOOLS = 64;
const BROWSER_CONNECTS: readonly BrowserConnect[] = ["auto", "url", "launch"];
const BROWSER_CHANNELS: readonly BrowserChannel[] = ["stable", "beta", "dev", "canary"];
const BROWSER_HEADLESS: readonly BrowserHeadless[] = ["auto", "on", "off"];

export function isTier(value: unknown): value is Tier {
	return value === "light" || value === "standard" || value === "heavy";
}

export function defaultConfig(): YeeConfig {
	return {
		wish: { model: null, tier: DEFAULT_TIER, shortcut: DEFAULT_WISH_SHORTCUT },
		ask: { shortcut: DEFAULT_ASK_SHORTCUT, extraTools: [] },
		browser: {
			connect: "auto",
			channel: "stable",
			endpoint: null,
			executable: null,
			headless: "auto",
			profileDir: null,
			listenOnStartup: false,
			focusTab: true,
			allowEval: false,
			shortcut: DEFAULT_BROWSER_SHORTCUT,
		},
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readModelRef(value: unknown): ModelRef | null {
	if (!isRecord(value)) return null;
	const { provider, id } = value;
	if (typeof provider !== "string" || typeof id !== "string") return null;
	if (!provider || !id) return null;
	return { provider, id };
}

/**
 * A shortcut field: missing or invalid → the default, explicit `null` → none.
 * Keeping "unset" and "disabled" apart lets the user turn a shortcut off.
 */
function readShortcut(record: Record<string, unknown>, fallback: string | null): string | null {
	if (!("shortcut" in record)) return fallback;
	if (record.shortcut === null) return null;
	return normalizeShortcut(record.shortcut) ?? fallback;
}

function readEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
	return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function readPath(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const path = value.trim();
	return path ? path : null;
}

function readEndpoint(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const endpoint = value.trim();
	return /^(?:https?|wss?):\/\//i.test(endpoint) ? endpoint : null;
}

function readToolNames(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	const out: string[] = [];
	for (const item of value) {
		if (typeof item !== "string") continue;
		const name = item.trim();
		if (name && !out.includes(name)) out.push(name);
		if (out.length >= MAX_EXTRA_TOOLS) break;
	}
	return out;
}

/**
 * Turn arbitrary parsed JSON into a valid config.
 *
 * If both features end up on the same shortcut, Wish keeps it and Ask loses
 * it: Wish shipped first, and `registerShortcut` would otherwise let the later
 * registration silently steal the key.
 */
export function normalizeConfig(raw: unknown): YeeConfig {
	const root = isRecord(raw) ? raw : {};
	const wish = isRecord(root.wish) ? root.wish : {};
	const ask = isRecord(root.ask) ? root.ask : {};
	const browser = isRecord(root.browser) ? root.browser : {};

	const config: YeeConfig = {
		wish: {
			model: readModelRef(wish.model),
			tier: isTier(wish.tier) ? wish.tier : DEFAULT_TIER,
			shortcut: readShortcut(wish, DEFAULT_WISH_SHORTCUT),
		},
		ask: {
			shortcut: readShortcut(ask, DEFAULT_ASK_SHORTCUT),
			extraTools: readToolNames(ask.extraTools),
		},
		browser: {
			connect: readEnum(browser.connect, BROWSER_CONNECTS, "auto"),
			channel: readEnum(browser.channel, BROWSER_CHANNELS, "stable"),
			endpoint: readEndpoint(browser.endpoint),
			executable: readPath(browser.executable),
			headless: readEnum(browser.headless, BROWSER_HEADLESS, "auto"),
			profileDir: readPath(browser.profileDir),
			listenOnStartup: browser.listenOnStartup === true,
			focusTab: browser.focusTab !== false,
			allowEval: browser.allowEval === true,
			shortcut: readShortcut(browser, DEFAULT_BROWSER_SHORTCUT),
		},
	};

	// Wish shipped first and keeps its key; Ask is next, Browser last.
	if (config.ask.shortcut !== null && config.ask.shortcut === config.wish.shortcut) {
		config.ask.shortcut = null;
	}
	if (
		config.browser.shortcut !== null &&
		(config.browser.shortcut === config.wish.shortcut || config.browser.shortcut === config.ask.shortcut)
	) {
		config.browser.shortcut = null;
	}
	return config;
}

/** Whether Ask lost its shortcut to Wish during normalization. */
export function hasShortcutCollision(raw: unknown, normalized: YeeConfig): boolean {
	const root = isRecord(raw) ? raw : {};
	const ask = isRecord(root.ask) ? root.ask : {};
	const wish = isRecord(root.wish) ? root.wish : {};
	const wanted = readShortcut(ask, DEFAULT_ASK_SHORTCUT);
	return wanted !== null && normalized.ask.shortcut === null && wanted === readShortcut(wish, DEFAULT_WISH_SHORTCUT);
}

/** Whether Browser lost its shortcut to Wish or Ask during normalization. */
export function hasBrowserShortcutCollision(raw: unknown, normalized: YeeConfig): boolean {
	const root = isRecord(raw) ? raw : {};
	const browser = isRecord(root.browser) ? root.browser : {};
	const wanted = readShortcut(browser, DEFAULT_BROWSER_SHORTCUT);
	if (wanted === null || normalized.browser.shortcut !== null) return false;
	return wanted === normalized.wish.shortcut || wanted === normalized.ask.shortcut;
}

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
