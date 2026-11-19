/**
 * Ask mode: read-only Q&A.
 *
 * While Ask mode is on the agent only answers questions. It can still look
 * things up with read-only tool calls (read / grep / find / ls and any tool
 * that is read-only by declaration or by the user's choice), but it cannot
 * edit files or run commands.
 *
 * Three layers keep that true:
 *   1. the active tool set is cut down to the allowed tools (and re-asserted
 *      before every run, in case something re-enabled a tool);
 *   2. a `tool_call` guard blocks any call to a tool the policy forbids;
 *   3. a `<yee-ask>` system-prompt section tells the model what the mode is.
 *
 * Entry points: /ask, the configured shortcut (default Ctrl+Alt+A), and the
 * `--ask` flag. The on/off state is stored in the session, so it survives
 * /reload, resume and /tree navigation.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { KeyId } from "@earendil-works/pi-tui";
import type { ConfigStore } from "../../config.ts";
import { displayShortcut } from "../../shortcut.ts";
import type { ConfigTabFactory } from "../../ui/config-page.ts";
import { blockedTools, computeAskTools, isToolAllowed, toolsAfterAsk } from "./policy.ts";
import { ASK_SECTION_NAME, ASK_SECTION_TEXT, askBlockedReason } from "./prompt.ts";
import { createAskTab } from "./tab.ts";

const ENTRY_TYPE = "yee-ask";
const STATUS_KEY = "yee-ask";

/** What each session entry records. */
interface AskEntryData {
	enabled: boolean;
	/** Active tools to restore when leaving Ask mode. */
	toolsBefore?: string[];
}

export interface AskFeature {
	id: "ask";
	tab: ConfigTabFactory;
	/** Whether Ask mode is currently on (used by tests and status output). */
	isEnabled(): boolean;
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
	return a.length === b.length && a.every((name) => b.includes(name));
}

function readToolsBefore(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const names = value.filter((item): item is string => typeof item === "string");
	return names.length > 0 ? names : undefined;
}

export function registerAsk(pi: ExtensionAPI, store: ConfigStore): AskFeature {
	let enabled = false;
	let toolsBefore: string[] | undefined;

	const ask = () => store.get().ask;
	const extraTools = () => new Set(ask().extraTools);

	pi.registerFlag("ask", {
		description: "以只读问答（Ask）模式启动：只放行 read / grep / find / ls 等只读工具",
		type: "boolean",
		default: false,
	});

	// ── tool set ───────────────────────────────────────────────────────────

	/** Cut the active tools down to what the policy allows. Idempotent. */
	function enforceTools(): void {
		const active = pi.getActiveTools();
		const allowed = computeAskTools(pi.getAllTools(), active, extraTools());
		if (!sameSet(active, allowed)) pi.setActiveTools(allowed);
	}

	function restoreTools(snapshot: string[] | undefined): void {
		pi.setActiveTools(toolsAfterAsk(snapshot, pi.getAllTools(), pi.getActiveTools()));
	}

	// ── state transitions ──────────────────────────────────────────────────

	function updateStatus(ctx: ExtensionContext): void {
		ctx.ui.setStatus(STATUS_KEY, enabled ? ctx.ui.theme.fg("warning", "❓ ask") : undefined);
	}

	function shortcutHint(): string {
		const key = ask().shortcut;
		return key ? `（${displayShortcut(key)}）` : "";
	}

	function enable(ctx: ExtensionContext): void {
		if (!enabled) {
			enabled = true;
			toolsBefore = pi.getActiveTools();
		}
		enforceTools();
		pi.appendEntry<AskEntryData>(ENTRY_TYPE, { enabled: true, toolsBefore });
		updateStatus(ctx);
	}

	function disable(ctx: ExtensionContext): void {
		const snapshot = toolsBefore;
		enabled = false;
		toolsBefore = undefined;
		restoreTools(snapshot);
		pi.appendEntry<AskEntryData>(ENTRY_TYPE, { enabled: false });
		updateStatus(ctx);
	}

	function toggle(ctx: ExtensionContext): void {
		if (enabled) {
			disable(ctx);
			ctx.ui.notify("已退出 Ask 模式，工具已恢复", "info");
		} else {
			enable(ctx);
			ctx.ui.notify(
				`Ask 模式已开启：只做问答，可用只读工具 ${pi.getActiveTools().join(", ")}。再次 /ask${shortcutHint()} 退出`,
				"info",
			);
		}
	}

	/** Re-derive the mode from the current branch's last Ask entry. */
	function syncFromBranch(ctx: ExtensionContext): void {
		let last: Partial<AskEntryData> | undefined;
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type === "custom" && entry.customType === ENTRY_TYPE) {
				last = entry.data as Partial<AskEntryData> | undefined;
			}
		}

		const wasEnabled = enabled;
		const previousSnapshot = toolsBefore;
		enabled = last?.enabled === true;
		toolsBefore = enabled ? readToolsBefore(last?.toolsBefore) : undefined;

		if (enabled) {
			toolsBefore ??= pi.getActiveTools();
			enforceTools();
		} else if (wasEnabled) {
			// The branch we landed on is not in Ask mode; do not leave its tools cut down.
			restoreTools(previousSnapshot);
		}
		updateStatus(ctx);
	}

	function statusText(): string {
		const all = pi.getAllTools();
		const extra = extraTools();
		const allowed = all.filter((tool) => isToolAllowed(tool, extra)).map((tool) => tool.name);
		const key = ask().shortcut;
		return [
			`Ask 模式：${enabled ? "开启" : "关闭"}`,
			`放行的只读工具：${allowed.join(", ") || "（无）"}`,
			`已屏蔽：${blockedTools(all, extra).join(", ") || "（无）"}`,
			`快捷键：${key ? displayShortcut(key) : "未设置"}`,
		].join("\n");
	}

	// ── entry points ───────────────────────────────────────────────────────

	const shortcut = ask().shortcut;
	if (shortcut) {
		pi.registerShortcut(shortcut as KeyId, {
			description: `Ask 模式：切换只读问答（${displayShortcut(shortcut)}）`,
			handler: (ctx) => toggle(ctx),
		});
	}

	pi.registerCommand("ask", {
		description: "Ask 模式（只读问答）：/ask 切换 · /ask <问题> 进入并提问 · /ask on|off|status",
		handler: async (args, ctx) => {
			const text = args.trim();

			// Extension commands normally leave their text in the editor.
			if (ctx.mode === "tui") ctx.ui.setEditorText("");

			if (!text) {
				toggle(ctx);
				return;
			}

			switch (text.toLowerCase()) {
				case "on":
					if (enabled) ctx.ui.notify("Ask 模式已经开启", "info");
					else toggle(ctx);
					return;
				case "off":
					if (!enabled) ctx.ui.notify("Ask 模式本来就是关闭的", "info");
					else toggle(ctx);
					return;
				case "status":
					ctx.ui.notify(statusText(), "info");
					return;
			}

			// Anything else is a question: make sure Ask mode is on, then ask it.
			if (!enabled) toggle(ctx);
			pi.sendUserMessage(text, ctx.isIdle() ? undefined : { deliverAs: "followUp" });
		},
	});

	// ── hooks ──────────────────────────────────────────────────────────────

	pi.on("session_start", (event, ctx) => {
		syncFromBranch(ctx);
		// `--ask` applies when Pi starts, not on every reload or session switch.
		if (event.reason === "startup" && pi.getFlag("ask") === true && !enabled) {
			enable(ctx);
		}
	});

	pi.on("session_tree", (_event, ctx) => {
		syncFromBranch(ctx);
	});

	pi.on("before_agent_start", (event) => {
		if (!enabled) return;
		// Something may have re-enabled a tool since the mode was switched on.
		enforceTools();
		event.systemPromptOptions.sections[ASK_SECTION_NAME] = ASK_SECTION_TEXT;
	});

	pi.on("tool_call", (event) => {
		if (!enabled) return;
		const tool = pi.getAllTools().find((candidate) => candidate.name === event.toolName);
		if (isToolAllowed(tool, extraTools())) return;
		return { block: true, reason: askBlockedReason(event.toolName) };
	});

	return {
		id: "ask",
		isEnabled: () => enabled,
		tab: (ctx) =>
			createAskTab({
				store,
				ctx,
				listTools: () => pi.getAllTools(),
			}),
	};
}
