/**
 * Ask mode for DeepSeek Harness: read-only Q&A.
 *
 * While Ask mode is on the agent only answers questions. It can still look
 * things up with read-only tools, but it cannot edit files or run commands.
 * Three layers keep that true, mirroring the Pi extension:
 *
 *   1. tool set  — the agent's own scope is restricted to the allowed tools;
 *   2. guard     — a monotonic `ctx.tools.guard` denies everything else, even
 *                  if a later plugin re-registers a tool;
 *   3. prompt    — a `yee:ask` system-prompt section explains the mode.
 *
 * The on/off state is a log-only session event folded by a projection, so it
 * survives resume and forking.
 */

import type { Context } from "@deepseek-ai/cordis";
import { brandString } from "@deepseek-ai/dsh-brand";
import type { Agent } from "@deepseek-ai/dsh-agent";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import type { CommandDefinitionId } from "@deepseek-ai/dsh-commands";
import type { ProjectionDefinition, ProjectionHandle } from "@deepseek-ai/dsh-session-projection";
import type { Session } from "@deepseek-ai/dsh-session";
import { askBlockedReason, createAskPolicy } from "yee-stack-ask";
import { z as zod } from "zod";
import type { AskOptions } from "./config.ts";

declare module "@deepseek-ai/dsh-session/types" {
	interface SessionEventMap {
		/** Whether Ask mode is in force from this point on: log-only, last one wins. */
		"yee/ask": { active: boolean };
	}
}

/** The system-prompt section name (becomes the `yee:ask` tag). */
export const ASK_SECTION = "yee:ask";

/** DSH built-ins that cannot change anything. */
export const READ_ONLY_TOOLS: readonly string[] = ["read", "read_image", "glob", "grep"];

/** DSH built-ins that can change the machine; never allowed, not even when ticked. */
export const NEVER_ALLOWED_TOOLS: readonly string[] = [
	"bash",
	"pwsh",
	"write",
	"edit",
	"apply_patch",
	"str_replace_editor",
	"run_code",
];

interface AskState {
	active: boolean;
}

const stateSchema = zod.object({ active: zod.boolean() }).strict();

/**
 * Projection folding `yee/ask` events into the current mode.
 *
 * Cast rather than structurally checked: the harness's projection types name
 * the zod copy that ships inside the dsh install, and a plugin resolves its own
 * `zod` peer. The schemas are duck-typed at runtime, so only the static
 * identity differs.
 */
export const askProjectionDefinition = {
	key: "yee-ask",
	stateVersion: 1,
	stateSchema,
	init: () => ({ active: false }),
	apply: (state: AskState, event: { type: string; data?: unknown }) =>
		event.type === "yee/ask" ? { active: (event.data as { active: boolean }).active } : state,
} as unknown as ProjectionDefinition<"yee-ask", AskState>;

export interface AskRuntime {
	/** Whether Ask mode is on for this session. */
	isActive(session: Session): boolean;
	/** Turn it on or off for one agent, logging the change and fixing the tool set. */
	set(agent: Agent, active: boolean): void;
	/** Re-apply the logged state to a freshly created agent. */
	sync(agent: Agent): void;
}

export async function registerAsk(ctx: Context, options: AskOptions): Promise<AskRuntime> {
	const policy = createAskPolicy({ readOnly: READ_ONLY_TOOLS, never: NEVER_ALLOWED_TOOLS });
	const extra = new Set(options.extraTools);
	const handle: ProjectionHandle<AskState> = await ctx.sessionProjections.register(askProjectionDefinition);

	const isActive = (session: Session): boolean => handle.stateOf(session).active;

	/** Per-agent restriction disposers, so leaving the mode restores the tool set. */
	const restrictions = new WeakMap<Agent, () => void>();

	function applyRestriction(agent: Agent): void {
		const dispose = restrictions.get(agent);
		if (dispose) {
			dispose();
			restrictions.delete(agent);
		}
		if (!isActive(agent.session)) return;

		const allow = policy.allowed(ctx.tools.definitions().map((definition) => definition.name), extra);
		if (allow.length === 0) return;
		try {
			// restrict() must run on the agent's own scope: a global call throws.
			restrictions.set(agent, agent.ctx.tools.restrict({ allow }));
		} catch (error) {
			ctx.logger?.warn("yee-stack: could not restrict the tool set: %o", error);
		}
	}

	ctx.systemPrompt.section({
		name: ASK_SECTION,
		order: ctx.systemPrompt.getSectionOrder("PLAN_POLICY") + 10,
		text: (context) => (context.agent !== undefined && isActive(context.agent.session) ? options.section : ""),
	});

	ctx.tools.guard((execution) => {
		const agent = execution.agent;
		if (agent === undefined || !isActive(agent.session)) return undefined;
		if (policy.isAllowed(execution.name, extra)) return undefined;
		return askBlockedReason(execution.name);
	});

	ctx.on("agent/created", ({ agent }) => {
		applyRestriction(agent);
	});

	ctx.on("agent/disposed", ({ agent }) => {
		restrictions.delete(agent);
	});

	const statusText = (agent: Agent): string => {
		const names = ctx.tools.definitions().map((definition) => definition.name);
		return [
			`Ask 模式：${isActive(agent.session) ? "开启" : "关闭"}`,
			`放行的只读工具：${policy.allowed(names, extra).join(", ") || "（无）"}`,
			`已屏蔽：${policy.blocked(names, extra).join(", ") || "（无）"}`,
			`配置里的额外放行：${options.extraTools.join(", ") || "（无）"}`,
		].join("\n");
	};

	const set = (agent: Agent, active: boolean): void => {
		if (isActive(agent.session) === active) return;
		agent.session.append("yee/ask", { active });
		applyRestriction(agent);
	};

	ctx.inject(["commands"], (commandCtx) => {
		commandCtx.commands.register({
			definitionId: brandString<CommandDefinitionId>("yee-stack-dsh"),
			name: "ask",
			description: "Ask 模式（只读问答）：/ask 切换 · /ask <问题> 进入并提问 · /ask on|off|status",
			input: { hint: "[on|off|status|<question>]" },
			handler: ({ agent, rawInput }) => {
				const text = rawInput.trim();
				if (!text) {
					const next = !isActive(agent.session);
					set(agent, next);
					return { kind: "success", text: next ? "Ask 模式已开启：只做问答。" : "Ask 模式已关闭：工具已恢复。" };
				}
				switch (text.toLowerCase()) {
					case "on":
						set(agent, true);
						return { kind: "success", text: "Ask 模式已开启：只做问答。" };
					case "off":
						set(agent, false);
						return { kind: "success", text: "Ask 模式已关闭：工具已恢复。" };
					case "status":
						return { kind: "success", text: statusText(agent) };
					default:
						set(agent, true);
						agent.followup(
							createUserMessage({
								content: [{ type: "text", text }],
								source: { kind: "user" },
							}),
						);
						return { kind: "success", text: "Ask 模式已开启，问题已提交。" };
				}
			},
		});
	});

	return {
		isActive,
		set,
		sync: (agent) => applyRestriction(agent),
	};
}
