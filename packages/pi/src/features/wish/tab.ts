/**
 * The "Wish" tab of /yee-config: model, default style, shortcut.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { shortcutLabel, type ModelRef, type Tier } from "@yee-stack/core";
import { TIER_LABEL } from "@yee-stack/wish";
import type { ConfigStore } from "../../config-store.ts";
import type { ConfigHost, ConfigRow, ConfigTab } from "../../ui/config-page.ts";
import { type ModelChoice, ModelPickerView, sameModel } from "../../ui/model-picker.ts";
import { ShortcutCaptureView } from "../../ui/shortcut-capture.ts";


const TIERS: Tier[] = ["light", "standard", "heavy"];

export interface WishTabOptions {
	store: ConfigStore;
	ctx: ExtensionContext;
	/** The pinned model changed: forget that the old pin was reported unavailable. */
	onModelChanged: () => void;
}

function describeModel(ref: ModelRef | null): string {
	return ref ? `${ref.provider}/${ref.id}` : "跟随当前 Pi 模型";
}

function buildModelChoices(ctx: ExtensionContext, pinned: ModelRef | null): ModelChoice[] {
	const sorted = [...ctx.modelRegistry.getAvailable()].sort((a, b) =>
		`${a.provider}/${a.id}`.localeCompare(`${b.provider}/${b.id}`),
	);

	const choices: ModelChoice[] = [{ ref: null, label: "↺ 跟随当前 Pi 模型（默认）" }];
	for (const model of sorted) {
		const ref = { provider: model.provider, id: model.id };
		const name = model.name && model.name !== model.id ? model.name : "";
		const marks: string[] = [];
		if (sameModel(pinned, ref)) marks.push("✓ 固定");
		if (ctx.model?.provider === model.provider && ctx.model.id === model.id) marks.push("当前");
		const suffix = marks.length > 0 ? `[${marks.join(" · ")}]` : "";
		choices.push({
			ref,
			label: `${model.provider}/${model.id}`,
			name: name || undefined,
			description: [name, suffix].filter(Boolean).join("  "),
		});
	}
	return choices;
}

export function createWishTab({ store, ctx, onModelChanged }: WishTabOptions): ConfigTab {
	const wish = () => store.get().wish;

	/** Persist a change; report a failure in the page footer instead of throwing. */
	const save = (host: ConfigHost, mutate: Parameters<ConfigStore["update"]>[0]): boolean => {
		try {
			store.update(mutate);
			return true;
		} catch (error) {
			host.notify(`保存设置失败：${error instanceof Error ? error.message : String(error)}`, "error");
			return false;
		}
	};

	const modelRow: ConfigRow = {
		id: "wish.model",
		label: "模型",
		value: () => describeModel(wish().model),
		description:
			"许愿特化器用哪个模型补全方向。固定后不会修改 Pi 当前模型；固定的模型不可用时，本次临时退回当前 Pi 模型。",
		activate: (host) => {
			if (ctx.modelRegistry.getAvailable().length === 0) {
				host.notify("没有可用模型，请先用 /login 或 /model 配置模型", "error");
				return;
			}

			host.openView(
				new ModelPickerView({
					theme: host.theme,
					keybindings: host.keybindings,
					title: "选择许愿特化器使用的模型",
					subtitle: `当前：${describeModel(wish().model)}`,
					choices: buildModelChoices(ctx, wish().model),
					selected: wish().model,
					listRows: host.listRows,
					onCancel: () => host.closeView(),
					onSelect: (choice) => {
						host.closeView();
						if (sameModel(choice.ref, wish().model)) return;
						if (!save(host, (draft) => void (draft.wish.model = choice.ref))) return;

						onModelChanged();
						host.notify(
							choice.ref === null
								? "许愿模型：跟随当前 Pi 模型"
								: `许愿模型已固定：${choice.name ?? choice.ref.id} (${choice.ref.provider}/${choice.ref.id})`,
							"success",
						);
					},
				}),
			);
		},
	};

	const tierRow: ConfigRow = {
		id: "wish.tier",
		label: "默认风格",
		value: () => `${TIER_LABEL[wish().tier]} (${wish().tier})`,
		description:
			"light 轻量：2–3 条方向（约 700 字）· standard 标准：4–6 条方向 + 验收（约 1200 字）· heavy 重度：少数方向写透（约 2000 字）。/wish light|standard|heavy 可单次覆盖。",
		activate: (host) => {
			const next = TIERS[(TIERS.indexOf(wish().tier) + 1) % TIERS.length]!;
			if (!save(host, (draft) => void (draft.wish.tier = next))) return;
			host.notify(`默认 wish 风格：${TIER_LABEL[next]} (${next})`, "success");
		},
	};

	const shortcutRow: ConfigRow = {
		id: "wish.shortcut",
		label: "快捷键",
		value: () => shortcutLabel(wish().shortcut),
		description: "在输入框写好愿望后按此键触发。修改后需要重载扩展才会生效，关闭此页时会自动重载。",
		activate: (host) => {
			host.openView(
				new ShortcutCaptureView({
					theme: host.theme,
					keybindings: host.keybindings,
					title: "Wish 快捷键",
					current: wish().shortcut,
					reserved: [{ key: store.get().ask.shortcut, owner: "Ask" }],
					requestRender: () => host.requestRender(),
					onCancel: () => host.closeView(),
					onDone: (key) => {
						host.closeView();
						if (key === wish().shortcut) return;
						if (!save(host, (draft) => void (draft.wish.shortcut = key))) return;

						host.requestReload();
						host.notify(
							key === null
								? "Wish 快捷键已清除（关闭此页后重载生效）"
								: `Wish 快捷键已设为 ${shortcutLabel(key)}（关闭此页后重载生效）`,
							"success",
						);
					},
				}),
			);
		},
	};

	return {
		id: "wish",
		title: "许愿 Wish",
		rows: () => [modelRow, tierRow, shortcutRow],
	};
}
