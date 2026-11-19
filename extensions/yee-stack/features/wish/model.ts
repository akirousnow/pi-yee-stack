/**
 * Which model the Wish Specializer calls, and the call itself.
 *
 * Behavior is unchanged from pi-wish-specializer; the pinned model is now a
 * parameter instead of module state.
 */

import type { Api, Model } from "@earendil-works/pi-ai";
import type { ExtensionContext, ModelRegistry } from "@earendil-works/pi-coding-agent";
import type { ModelRef, Tier } from "../../config.ts";
import { assistantText, buildSystemPrompt, buildUserMessage, cleanSupplement } from "./prompt.ts";

export interface ResolvedWishModel {
	model: Model<Api> | undefined;
	usingConfigured: boolean;
	configuredUnavailable: boolean;
}

export function resolveModel(ctx: ExtensionContext, configuredWishModel: ModelRef | null): ResolvedWishModel {
	const available = ctx.modelRegistry.getAvailable();
	const fallback = () =>
		ctx.model ??
		available.find((model) => ctx.modelRegistry.hasConfiguredAuth(model)) ??
		available[0];

	if (configuredWishModel) {
		const ref = configuredWishModel;
		const configured =
			ctx.modelRegistry.find(ref.provider, ref.id) ??
			available.find((model) => model.provider === ref.provider && model.id === ref.id);

		if (configured && ctx.modelRegistry.hasConfiguredAuth(configured)) {
			return { model: configured, usingConfigured: true, configuredUnavailable: false };
		}

		return { model: fallback(), usingConfigured: false, configuredUnavailable: true };
	}

	return { model: fallback(), usingConfigured: false, configuredUnavailable: false };
}

export async function generateSupplement(
	registry: ModelRegistry,
	model: Model<Api>,
	wish: string,
	tier: Tier,
	signal: AbortSignal,
): Promise<string> {
	const response = await registry.complete(
		model,
		{
			systemPrompt: buildSystemPrompt(tier),
			messages: [buildUserMessage(wish, tier)],
		},
		{
			signal,
			cacheRetention: "none",
		},
	);

	if (signal.aborted) {
		throw new Error("aborted");
	}

	const text = cleanSupplement(assistantText(response));
	if (!text && response.stopReason === "length") {
		throw new Error("模型输出被截断，请重试或降低档位");
	}
	return text;
}
