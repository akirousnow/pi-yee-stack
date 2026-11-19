/**
 * Wish Specializer
 *
 * Turn a one-line wish into directional requirements the working model can
 * follow. The original wish is preserved verbatim; only the missing half is
 * generated, shown in an editable floating dialog, and written back to the
 * input box on confirm.
 *
 * Trigger:
 *   - the configured shortcut (default Ctrl+Alt+W) while the editor holds the wish
 *   - /wish [light|standard|heavy] <wish>
 *
 * Behavior is unchanged from pi-wish-specializer; only its settings moved into
 * the "Wish" tab of /yee-config.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { KeyId } from "@earendil-works/pi-tui";
import type { ConfigStore, Tier } from "../../config.ts";
import { displayShortcut } from "../../shortcut.ts";
import type { ConfigTabFactory } from "../../ui/config-page.ts";
import { showGeneratingDialog, showResultDialog } from "./dialog.ts";
import { generateSupplement, resolveModel } from "./model.ts";
import { buildFinalPrompt, parseCommandArgs, TIER_LABEL } from "./prompt.ts";
import { createWishTab } from "./tab.ts";

export interface WishFeature {
	id: "wish";
	tab: ConfigTabFactory;
}

export function registerWish(pi: ExtensionAPI, store: ConfigStore): WishFeature {
	let activeRun = false;
	let warnedConfiguredModelUnavailable = false;

	const wish = () => store.get().wish;

	/** "按 Ctrl+Alt+W" when a shortcut is configured, otherwise nothing to mention. */
	const shortcutHint = (): string => {
		const key = wish().shortcut;
		return key ? `再按 ${displayShortcut(key)}` : "";
	};

	async function runWishSpecializer(ctx: ExtensionContext, rawWish: string, tier: Tier): Promise<void> {
		if (activeRun) {
			ctx.ui.notify("许愿特化器正在运行，请稍候", "info");
			return;
		}

		if (ctx.mode !== "tui") {
			ctx.ui.notify("许愿特化器需要 TUI 交互模式", "error");
			return;
		}

		const original = rawWish.replace(/\r\n/g, "\n").trim();
		if (!original) {
			const hint = shortcutHint();
			ctx.ui.notify(`输入框为空：先写下愿望${hint}，或使用 /wish <愿望>`, "warning");
			return;
		}

		const configuredModel = wish().model;
		const resolved = resolveModel(ctx, configuredModel);
		const model = resolved.model;
		if (!model) {
			ctx.ui.notify("没有可用模型，请先用 /model 选择一个模型", "error");
			return;
		}

		if (resolved.configuredUnavailable && !warnedConfiguredModelUnavailable) {
			warnedConfiguredModelUnavailable = true;
			ctx.ui.notify(
				`已保存的许愿模型 ${configuredModel?.provider}/${configuredModel?.id} 不可用，本次使用 ${model.provider}/${model.id}`,
				"warning",
			);
		}

		const modelLabel = `${model.name || model.id}${resolved.usingConfigured ? " · 固定" : ""}`;

		activeRun = true;
		try {
			const controller = new AbortController();
			let failure: string | undefined;

			const supplement = await showGeneratingDialog(
				ctx,
				modelLabel,
				tier,
				controller,
				() => generateSupplement(ctx.modelRegistry, model, original, tier, controller.signal),
				(message) => {
					failure = message;
				},
			);

			if (supplement === null) {
				if (failure) {
					ctx.ui.notify(`特化失败：${failure}`, "error");
				} else if (controller.signal.aborted) {
					ctx.ui.notify("已取消特化", "info");
				} else {
					ctx.ui.notify("没有生成补充内容", "warning");
				}
				return;
			}

			if (!supplement) {
				ctx.ui.notify("原愿望已经足够具体，没有需要补充的方向", "info");
				return;
			}

			const finalPrompt = buildFinalPrompt(original, supplement);
			const edited = await showResultDialog(ctx, finalPrompt, `${TIER_LABEL[tier]} · ${modelLabel}`);

			if (edited === null) {
				ctx.ui.notify("已取消，输入框保持不变", "info");
				return;
			}

			ctx.ui.setEditorText(edited);
			ctx.ui.notify("已写回输入框，按 Enter 发送", "info");
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (!/aborted/i.test(message)) {
				ctx.ui.notify(`特化失败：${message}`, "error");
			}
		} finally {
			activeRun = false;
		}
	}

	const shortcut = wish().shortcut;
	if (shortcut) {
		pi.registerShortcut(shortcut as KeyId, {
			description: `许愿特化器：优化输入框里的 prompt（${displayShortcut(shortcut)}）`,
			handler: async (ctx) => {
				await runWishSpecializer(ctx, ctx.ui.getEditorText(), wish().tier);
			},
		});
	}

	pi.registerCommand("wish", {
		description: "许愿特化器：/wish [light|standard|heavy] <愿望>；留空时使用输入框内容",
		handler: async (args, ctx) => {
			const parsed = parseCommandArgs(args, wish().tier);
			let text = parsed.wish;

			if (!text) {
				const editorText = ctx.ui.getEditorText().trim();
				if (editorText && !editorText.startsWith("/wish")) {
					text = editorText;
				}
			}

			// Extension commands normally leave their text in the editor. Clear it
			// before doing async work so a cancel does not leave "/wish ..." behind.
			if (ctx.mode === "tui") ctx.ui.setEditorText("");

			if (!text.trim()) {
				const key = wish().shortcut;
				ctx.ui.notify(
					`用法：/wish [light|standard|heavy] <愿望>${key ? `；或先在输入框写好愿望，再按 ${displayShortcut(key)}` : ""}`,
					"warning",
				);
				return;
			}

			await runWishSpecializer(ctx, text, parsed.tier);
		},
	});

	return {
		id: "wish",
		tab: (ctx) =>
			createWishTab({
				store,
				ctx,
				onModelChanged: () => {
					warnedConfiguredModelUnavailable = false;
				},
			}),
	};
}
