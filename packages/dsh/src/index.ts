/**
 * Yee Stack for DeepSeek Harness.
 *
 * One plugin, three features and one settings command:
 *
 *   Wish    — /wish [light|standard|heavy] <wish>: one private completion turns
 *             a one-line wish into directional requirements, returned as the
 *             command's text.
 *   Ask     — /ask: read-only Q&A. The tool set is restricted, a guard denies
 *             everything else, and a prompt section explains the mode.
 *   Browser — /browser and browser_*: a real Chrome through chrome-devtools-mcp,
 *             one tab at a time, with `$tN` references.
 *   /yee-config prints the resolved settings.
 *
 * Install it as a bundle (`dsh.bundle.patch` -> `cordis.patch.yml`) or load it
 * from a checkout with `dsh --patch`.
 */

import type { Context } from "@deepseek-ai/cordis";
import { registerAsk } from "./ask.ts";
import { registerBrowser } from "./browser.ts";
import { Config, describeConfig, type Config as ConfigShape } from "./config.ts";
import { runWish } from "./wish.ts";

export const name = "yee-stack";

export const inject = ["tools", "systemPrompt", "sessionProjections"];

export { Config };
export type { Config as YeeStackConfig } from "./config.ts";
export { askProjectionDefinition, ASK_SECTION, NEVER_ALLOWED_TOOLS, READ_ONLY_TOOLS } from "./ask.ts";
export { BROWSER_SECTION } from "./browser.ts";
export { BROWSER_UPSTREAM_TOOLS, createBrowserTools } from "./tools.ts";

export async function apply(ctx: Context, config: ConfigShape): Promise<void> {
	await registerAsk(ctx, config.ask);
	await registerBrowser(ctx, config.browser);

	ctx.inject(["commands", "llm"], (commandCtx) => {
		commandCtx.commands.register({
			name: "wish",
			description: "许愿特化器：/wish [light|standard|heavy] <愿望>，补上工作模型需要的方向性要求",
			input: { hint: "[light|standard|heavy] <wish>" },
			handler: ({ agent, rawInput, signal }) => runWish(commandCtx, agent, rawInput, config.wish, signal),
		});

		commandCtx.commands.register({
			name: "yee-config",
			description: "查看 Yee Stack 的当前设置（在 profile 的 cordis.patch.yml 里改）",
			handler: () => ({ kind: "success", text: describeConfig(config) }),
		});
	});
}

export default { name, inject, Config, apply };
