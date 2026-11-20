/**
 * Yee Stack for Pi
 *
 * A small stack of extensions behind one install and one settings page:
 *
 *   Wish  — /wish and a shortcut: turn a one-line wish into directional
 *           requirements, edit them in a floating dialog, write them back.
 *   Ask   — /ask and a shortcut: read-only Q&A. The agent can read, grep, find
 *           and ls, but cannot edit files or run commands.
 *   Browser — /browser and `$tN` tabs: drive a real Chrome through
 *           chrome-devtools-mcp, one tab at a time.
 *
 *   /yee-config opens the tabbed settings page for all of them.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { ConfigStore } from "./config-store.ts";
import { registerAsk } from "./features/ask/index.ts";
import { registerBrowser } from "./features/browser/index.ts";
import { registerWish } from "./features/wish/index.ts";
import { findOtherWishExtensions } from "./legacy.ts";
import { openConfigPage } from "./ui/config-page.ts";

export default function yeeStack(pi: ExtensionAPI): void {
	// Read inside the factory (not at import time) so every reload sees the file as it is now.
	const store = new ConfigStore();

	const wish = registerWish(pi, store);
	const ask = registerAsk(pi, store);
	// Browser last: its before_agent_start runs after Ask's, so it can add the
	// read-only browser tools back while Ask mode keeps them cut down.
	const browser = registerBrowser(pi, store, { askEnabled: () => ask.isEnabled() });

	const features = [wish, ask, browser];
	const tabIds: string[] = features.map((feature) => feature.id);

	async function openConfig(ctx: ExtensionCommandContext, initialTab?: string): Promise<void> {
		const result = await openConfigPage(
			ctx,
			features.map((feature) => feature.tab),
			initialTab,
		);
		if (!result.reload) return;

		if (!ctx.isIdle()) {
			ctx.ui.notify("快捷键已保存；当前回合结束后执行 /reload 生效", "warning");
			return;
		}

		ctx.ui.notify("快捷键已保存，正在重载扩展…", "info");
		await ctx.reload();
	}

	pi.registerCommand("yee-config", {
		description: "打开 Yee Stack 配置页（多标签：Wish / Ask / Browser）；/yee-config ask 直接打开 Ask 标签",
		getArgumentCompletions: (prefix) => {
			const matches = tabIds.filter((id) => id.startsWith(prefix.trim().toLowerCase()));
			return matches.length > 0 ? matches.map((id) => ({ value: id, label: id })) : null;
		},
		handler: async (args, ctx) => {
			const requested = args.trim().toLowerCase();
			if (requested && !tabIds.includes(requested)) {
				ctx.ui.notify(`未知标签 "${requested}"，可用：${tabIds.join(", ")}`, "warning");
			}
			await openConfig(ctx, requested || undefined);
		},
	});

	// pi-wish-specializer's old entry point: same page, opened on the Wish tab.
	pi.registerCommand("wish-config", {
		description: "同 /yee-config，直接打开 Wish 标签",
		handler: async (_args, ctx) => {
			await openConfig(ctx, "wish");
		},
	});

	pi.on("session_start", (event, ctx) => {
		// Startup notices: once per Pi launch, not on every reload or new session.
		if (event.reason !== "startup" || !ctx.hasUI) return;

		if (store.hadShortcutCollision) {
			ctx.ui.notify(
				"Ask 的快捷键与 Wish 相同，已停用 Ask 快捷键；可在 /yee-config 的 Ask 标签里重新设置",
				"warning",
			);
		}

		if (store.hadBrowserShortcutCollision) {
			ctx.ui.notify(
				"Browser 的快捷键与 Wish 或 Ask 相同，已停用 Browser 快捷键；可在 /yee-config 的 Browser 标签里重新设置",
				"warning",
			);
		}

		const others = findOtherWishExtensions(pi.getCommands());
		if (others.length > 0) {
			ctx.ui.notify(
				`另一个扩展也注册了 /wish（${others.join("、")}），会和 Yee Stack 冲突。若它是旧的 pi-wish-specializer，请用 pi list 找到它并 pi remove，再 /reload`,
				"warning",
			);
		}
	});
}
