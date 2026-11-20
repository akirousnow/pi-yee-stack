/**
 * Wish Specializer for DeepSeek Harness.
 *
 *   /wish [light|standard|heavy] <wish>     the slash command
 *   runWish(...)                            the Web panel's "特化" button
 *
 * Runs one private completion with the Wish system prompt and returns the
 * original wish plus the generated directional requirements. Nothing is
 * rewritten in place: the user copies the result into the composer (or runs
 * `/wish send …` to submit it directly), and the panel fills the composer
 * with it through the conversation input face.
 *
 * The harness has no `llm.complete()`; the supported one-shot path is
 * `prepareCall` + `stream` + `BlockAssembler`.
 */

import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import { BlockAssembler, createUserMessage } from "@deepseek-ai/dsh-llm";
import { buildFinalPrompt, buildSystemPrompt, buildWishUserText, cleanSupplement, parseCommandArgs } from "yee-stack-wish";
import type { Tier } from "yee-stack-core";
import type { WishOptions } from "./config.ts";

/** The model route this session is using, or `undefined` when it has none yet. */
export function routeOf(agent: Agent): { provider: string; model: string } | undefined {
	const current = agent.model.current();
	if (current?.provider && current.model) return { provider: current.provider, model: current.model };
	const { provider, model } = agent.options;
	return provider && model ? { provider, model } : undefined;
}

/** One private completion: system prompt plus a single user turn. */
export async function complete(
	ctx: Context,
	route: { provider: string; model: string },
	options: { system: string; input: string; maxTokens: number; signal?: AbortSignal; sessionId?: string },
): Promise<string> {
	const call = await ctx.llm.prepareCall(
		{ provider: route.provider, model: route.model, maxTokens: options.maxTokens },
		options.signal,
	);
	const assembler = new BlockAssembler();
	const stream = call.stream({
		...call.config,
		system: options.system,
		messages: [createUserMessage({ content: [{ type: "text", text: options.input }], source: { kind: "user" } })],
		signal: options.signal,
		sessionId: options.sessionId as never,
	});
	for await (const chunk of stream) assembler.push(chunk);

	const finish = assembler.finish;
	if (finish.kind === "error" || finish.kind === "aborted") {
		throw new Error(finish.failure.message || "模型调用失败");
	}
	return assembler
		.blocks()
		.filter((block): block is Extract<ReturnType<BlockAssembler["blocks"]>[number], { type: "text" }> => block.type === "text")
		.map((block) => block.text)
		.join("");
}

/** What one specialization produced, before it becomes a command result or a panel draft. */
export type WishOutcome =
	| { ok: true; wish: string; supplement: string; prompt: string }
	| { ok: false; message: string };

/**
 * Specialize one wish with the Wish prompts.
 *
 * Shared by the `/wish` command (which returns `prompt` as its text) and the
 * Web panel (which writes `prompt` into the composer), so both produce the
 * exact same wording.
 *
 * @param tierOverride - the tier the panel picked; `undefined` uses the config default.
 */
export async function specializeWish(
	ctx: Context,
	agent: Agent,
	wish: string,
	options: WishOptions,
	tierOverride: WishOptions["tier"] | undefined,
	signal?: AbortSignal,
): Promise<WishOutcome> {
	const tier: Tier = tierOverride ?? options.tier;
	const raw = wish.trim();
	if (!raw) return { ok: false, message: "用法：/wish [light|standard|heavy] <愿望>" };

	const route = routeOf(agent);
	if (!route) return { ok: false, message: "当前会话没有可用的模型路由：先选一个模型再 /wish。" };

	let text: string;
	try {
		text = await complete(ctx, route, {
			system: buildSystemPrompt(tier),
			input: buildWishUserText(raw, tier),
			maxTokens: options.maxTokens,
			signal,
			sessionId: agent.session.id,
		});
	} catch (error) {
		return { ok: false, message: `特化失败：${error instanceof Error ? error.message : String(error)}` };
	}

	const supplement = cleanSupplement(text);
	if (!supplement) return { ok: true, wish: raw, supplement: "", prompt: raw };
	return { ok: true, wish: raw, supplement, prompt: buildFinalPrompt(raw, supplement) };
}

/** `/wish [tier] <wish>` for one agent. */
export async function runWish(
	ctx: Context,
	agent: Agent,
	rawInput: string,
	options: WishOptions,
	signal?: AbortSignal,
): Promise<{ kind: "success"; text: string } | { kind: "error"; text: string }> {
	const parsed = parseCommandArgs(rawInput, options.tier);
	if (!parsed.wish.trim()) {
		return { kind: "error", text: "用法：/wish [light|standard|heavy] <愿望>" };
	}

	const outcome = await specializeWish(ctx, agent, parsed.wish, options, parsed.tier, signal);
	if (!outcome.ok) return { kind: "error", text: outcome.message };
	if (!outcome.supplement) {
		return { kind: "success", text: "原愿望已经足够具体，没有需要补充的方向。" };
	}
	return { kind: "success", text: outcome.prompt };
}
