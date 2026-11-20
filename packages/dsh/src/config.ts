/**
 * Yee Stack plugin configuration for DeepSeek Harness.
 *
 * The loader validates a row's `config:` block against {@link Config} and
 * passes the resolved object to `apply(ctx, config)`. Defaults live here, so
 * an empty row means "everything on its default".
 *
 * Every field is `volatile()`. That is what lets the Web panel (and the
 * generated settings page) write one field without remounting the plugin:
 * the loader commits the new value into the live reference and emits
 * `loader/volatile-update`, and the Host half re-reads `config.*.get()`.
 * Ordinary fields would have meant a full plugin reload per edit, which drops
 * an open browser connection and every Session's Ask mode.
 *
 * `Config` itself stays the schemastery object the loader validates; the
 * `apply(ctx, config)` signature takes the *resolved* shape (plain values),
 * because that is what the loader hands a plugin function.
 */

import type { Volatile } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";
import type { BrowserChannel, BrowserConnect, BrowserHeadless, BrowserConfig, Tier } from "yee-stack-core";
import { ASK_SECTION_TEXT } from "yee-stack-ask";

export interface WishOptions {
	/** Default tier for `/wish`; `/wish light …` overrides it per call. */
	tier: Tier;
	/** Output budget for the one-shot completion. */
	maxTokens: number;
}

export interface AskOptions {
	/** Extra tool names allowed on top of the read-only set. */
	extraTools: string[];
	/** Guidance injected while Ask mode is on. */
	section: string;
}

export interface BrowserOptions {
	connect: BrowserConnect;
	channel: BrowserChannel;
	/** `http://host:port` or `ws://…` when `connect` is `"url"`. */
	endpoint: string;
	executable: string;
	headless: BrowserHeadless;
	profileDir: string;
	/** Allow page JavaScript evaluation in chrome-devtools-mcp. */
	allowEval: boolean;
	/** Allow `browser_upload` when connected to a remote Chrome. */
	allowRemoteUpload: boolean;
	/** Connect the browser when the plugin loads. */
	listenOnStartup: boolean;
}

/** Wish settings as the loader hands them to the plugin: live references. */
export interface WishConfigShape {
	tier: Volatile<Tier>;
	maxTokens: Volatile<number>;
}

/** Ask settings as the loader hands them to the plugin: live references. */
export interface AskConfigShape {
	extraTools: Volatile<string[]>;
	section: Volatile<string>;
}

/** Browser settings as the loader hands them to the plugin: live references. */
export interface BrowserConfigShape {
	connect: Volatile<BrowserConnect>;
	channel: Volatile<BrowserChannel>;
	endpoint: Volatile<string>;
	executable: Volatile<string>;
	headless: Volatile<BrowserHeadless>;
	profileDir: Volatile<string>;
	allowEval: Volatile<boolean>;
	allowRemoteUpload: Volatile<boolean>;
	listenOnStartup: Volatile<boolean>;
}

/** What `apply(ctx, config)` receives: every field is a live reference. */
export interface Config {
	wish: WishConfigShape;
	ask: AskConfigShape;
	browser: BrowserConfigShape;
}

/** The same settings as plain values, for one operation. */
export interface ResolvedConfig {
	wish: WishOptions;
	ask: AskOptions;
	browser: BrowserOptions;
}

const tierSchema = z
	.union([z.const("light"), z.const("standard"), z.const("heavy")])
	.description("默认档位：light 轻量 / standard 标准 / heavy 重度")
	.default("standard")
	.volatile();

export const Config = z.object({
	wish: z
		.object({
			tier: tierSchema,
			maxTokens: z.number().step(1).min(1).max(8192).default(900).volatile(),
		})
		.description("Wish Specializer（/wish）"),
	ask: z
		.object({
			extraTools: z.array(z.string()).default([]).description("Ask 模式额外放行的工具名").volatile(),
			section: z.string().default(ASK_SECTION_TEXT).description("Ask 模式注入的系统提示词").volatile(),
		})
		.description("Ask 只读问答（/ask）"),
	browser: z
		.object({
			connect: z
				.union([z.const("auto"), z.const("url"), z.const("launch")])
				.default("auto")
				.description("auto 自动连接 / url 指定地址 / launch 自己启动 Chrome")
				.volatile(),
			channel: z
				.union([z.const("stable"), z.const("beta"), z.const("dev"), z.const("canary")])
				.default("stable")
				.volatile(),
			endpoint: z.string().default("").description("connect=url 时的 http:// 或 ws:// 地址").volatile(),
			executable: z.string().default("").description("connect=launch 时的 Chrome 可执行文件").volatile(),
			headless: z.union([z.const("auto"), z.const("on"), z.const("off")]).default("auto").volatile(),
			profileDir: z.string().default("").description("connect=launch 时的用户数据目录").volatile(),
			allowEval: z.boolean().default(false).description("允许在页面里执行 JavaScript").volatile(),
			allowRemoteUpload: z.boolean().default(false).description("允许向远程 Chrome 上传文件（绕过本机项目目录校验）").volatile(),
			listenOnStartup: z.boolean().default(false).description("插件加载时自动连接浏览器").volatile(),
		})
		.description("浏览器控制（/browser）"),
});

/**
 * Resolve a possibly-partial config the way the loader does.
 *
 * The schema's static input type mirrors the resolved shape, while the loader
 * accepts any JSON a row carries; this keeps tests and overlays honest.
 */
export function resolveConfig(input: unknown): Config {
	return (Config as unknown as (value: unknown) => Config)(input);
}

/** The same schema as the loader's static Config: the resolved plain shape. */
export const ConfigSchema = Config as unknown as z<ResolvedConfig>;

/** Read every live reference into plain values for one operation. */
export function resolvedConfig(config: Config): ResolvedConfig {
	return {
		wish: { tier: config.wish.tier.get(), maxTokens: config.wish.maxTokens.get() },
		ask: { extraTools: [...config.ask.extraTools.get()], section: config.ask.section.get() },
		browser: {
			connect: config.browser.connect.get(),
			channel: config.browser.channel.get(),
			endpoint: config.browser.endpoint.get(),
			executable: config.browser.executable.get(),
			headless: config.browser.headless.get(),
			profileDir: config.browser.profileDir.get(),
			allowEval: config.browser.allowEval.get(),
			allowRemoteUpload: config.browser.allowRemoteUpload.get(),
			listenOnStartup: config.browser.listenOnStartup.get(),
		},
	};
}

/** The browser settings in the shape the shared connection planner expects. */
export function toBrowserConfig(options: BrowserOptions): BrowserConfig {
	return {
		connect: options.connect,
		channel: options.channel,
		endpoint: options.endpoint.trim() || null,
		executable: options.executable.trim() || null,
		headless: options.headless,
		profileDir: options.profileDir.trim() || null,
		listenOnStartup: options.listenOnStartup,
		focusTab: false,
		allowEval: options.allowEval,
		allowRemoteUpload: options.allowRemoteUpload,
		shortcut: null,
	};
}

/** Human-readable settings, for `/yee-config`. */
export function describeConfig(config: Config | ResolvedConfig): string {
	const { wish, ask, browser } = "tier" in config.wish && typeof config.wish.tier === "string"
		? (config as ResolvedConfig)
		: resolvedConfig(config as Config);
	return [
		"Yee Stack 设置",
		`  Wish  档位 ${wish.tier} · 输出上限 ${wish.maxTokens} tokens`,
		`  Ask   额外放行 ${ask.extraTools.length > 0 ? ask.extraTools.join(", ") : "（无）"}`,
		`  Browser  ${browser.connect}${browser.connect === "url" && browser.endpoint ? ` → ${browser.endpoint}` : ""}` +
			` · ${browser.channel} · 无头 ${browser.headless} · JS ${browser.allowEval ? "允许" : "禁止"}` +
			` · 远程上传 ${browser.allowRemoteUpload ? "允许" : "禁止"}` +
			` · 启动时连接 ${browser.listenOnStartup ? "开启" : "关闭"}`,
		"修改：在 Web 的「Yee Stack」面板里改（或 profile 的 cordis.patch.yml 覆盖 yee-stack 行的 config）；面板的改动即时生效。",
	].join("\n");
}
