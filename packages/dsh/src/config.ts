/**
 * Yee Stack plugin configuration for DeepSeek Harness.
 *
 * The loader validates a row's `config:` block against {@link Config} and
 * passes the resolved object to `apply(ctx, config)`. Defaults live here, so
 * an empty row means "everything on its default".
 *
 * Fields are plain (not `volatile()`) on purpose: changing them means
 * reloading the plugin, and a browser connection or an active Ask mode should
 * not silently change under a running session.
 */

import z from "@deepseek-ai/schemastery";
import type { BrowserChannel, BrowserConnect, BrowserHeadless, BrowserConfig, Tier } from "@yee-stack/core";
import { ASK_SECTION_TEXT } from "@yee-stack/ask";

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

export interface Config {
	wish: WishOptions;
	ask: AskOptions;
	browser: BrowserOptions;
}

const tierSchema = z
	.union([z.const("light"), z.const("standard"), z.const("heavy")])
	.description("默认档位：light 轻量 / standard 标准 / heavy 重度")
	.default("standard");

export const Config: z<Config> = z.object({
	wish: z
		.object({
			tier: tierSchema,
			maxTokens: z.number().step(1).min(1).max(8192).default(900),
		})
		.description("Wish Specializer（/wish）"),
	ask: z
		.object({
			extraTools: z.array(z.string()).default([]).description("Ask 模式额外放行的工具名"),
			section: z.string().default(ASK_SECTION_TEXT).description("Ask 模式注入的系统提示词"),
		})
		.description("Ask 只读问答（/ask）"),
	browser: z
		.object({
			connect: z
				.union([z.const("auto"), z.const("url"), z.const("launch")])
				.default("auto")
				.description("auto 自动连接 / url 指定地址 / launch 自己启动 Chrome"),
			channel: z
				.union([z.const("stable"), z.const("beta"), z.const("dev"), z.const("canary")])
				.default("stable"),
			endpoint: z.string().default("").description("connect=url 时的 http:// 或 ws:// 地址"),
			executable: z.string().default("").description("connect=launch 时的 Chrome 可执行文件"),
			headless: z.union([z.const("auto"), z.const("on"), z.const("off")]).default("auto"),
			profileDir: z.string().default("").description("connect=launch 时的用户数据目录"),
			allowEval: z.boolean().default(false).description("允许在页面里执行 JavaScript"),
			allowRemoteUpload: z.boolean().default(false).description("允许向远程 Chrome 上传文件（绕过本机项目目录校验）"),
			listenOnStartup: z.boolean().default(false).description("插件加载时自动连接浏览器"),
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
export function describeConfig(config: Config): string {
	const { wish, ask, browser } = config;
	return [
		"Yee Stack 设置",
		`  Wish  档位 ${wish.tier} · 输出上限 ${wish.maxTokens} tokens`,
		`  Ask   额外放行 ${ask.extraTools.length > 0 ? ask.extraTools.join(", ") : "（无）"}`,
		`  Browser  ${browser.connect}${browser.connect === "url" && browser.endpoint ? ` → ${browser.endpoint}` : ""}` +
			` · ${browser.channel} · 无头 ${browser.headless} · JS ${browser.allowEval ? "允许" : "禁止"}` +
			` · 远程上传 ${browser.allowRemoteUpload ? "允许" : "禁止"}` +
			` · 启动时连接 ${browser.listenOnStartup ? "开启" : "关闭"}`,
		"修改：在 profile 的 cordis.patch.yml 里覆盖 yee-stack 行的 config，然后 /reload 或重启 dsh。",
	].join("\n");
}
