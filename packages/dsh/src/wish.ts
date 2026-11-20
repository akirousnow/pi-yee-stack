/**
 * Wish Specializer for DeepSeek Harness.
 *
 *   /wish [light|standard|heavy] <wish>
 *
 * Runs one private completion with the Wish system prompt and returns the
 * original wish plus the generated directional requirements as the command's
 * text. Nothing is rewritten in place: the user copies the result into the
 * composer (or runs `/wish send …` to submit it directly).
 *
 * The harness has no `llm.complete()`; the supported one-shot path is
 * `prepareCall` + `stream` + `BlockAssembler`.
 */

import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import { BlockAssembler, createUserMessage } from "@deepseek-ai/dsh-llm";
import { buildFinalPrompt, buildSystemPrompt, buildWishUserText, cleanSupplement, parseCommandArgs } from "yee-stack-wish";
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

	const route = routeOf(agent);
	if (!route) {
		return { kind: "error", text: "当前会话没有可用的模型路由：先选一个模型再 /wish。" };
	}

	let text: string;
	try {
		text = await complete(ctx, route, {
			system: buildSystemPrompt(parsed.tier),
			input: buildWishUserText(parsed.wish, parsed.tier),
			maxTokens: options.maxTokens,
			signal,
			sessionId: agent.session.id,
		});
	} catch (error) {
		return { kind: "error", text: `特化失败：${error instanceof Error ? error.message : String(error)}` };
	}

	const supplement = cleanSupplement(text);
	if (!supplement) {
		return { kind: "success", text: "原愿望已经足够具体，没有需要补充的方向。" };
	}
	return { kind: "success", text: buildFinalPrompt(parsed.wish, supplement) };
}
