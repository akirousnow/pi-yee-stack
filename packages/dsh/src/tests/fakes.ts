/**
 * Minimal fakes for the harness services the plugin touches.
 *
 * They implement exactly the surface the plugin calls, so the tests exercise
 * the real registration and handler code without booting a harness.
 */

import type { Agent } from "@deepseek-ai/dsh-agent";
import type { Context } from "@deepseek-ai/cordis";
import type { Session } from "@deepseek-ai/dsh-session";

export interface FakeSession {
	readonly id: string;
	readonly events: Array<{ type: string; data: unknown }>;
	append(type: string, data: unknown): void;
}

export interface FakeAgent {
	readonly session: FakeSession;
	readonly options: { provider?: string; model?: string };
	readonly model: { current(): { provider: string; model: string } | undefined };
	readonly followups: Array<{ content: Array<{ type: string; text?: string }> }>;
	followup(message: { content: Array<{ type: string; text?: string }> }): void;
	readonly ctx: { tools: { restrict(filter: { allow?: readonly string[] }): () => void } };
	restriction?: { allow?: readonly string[] };
}

interface ProjectionLike {
	init(...args: unknown[]): unknown;
	apply(state: unknown, event: { type: string; data?: unknown }): unknown;
}

export interface FakeCtx {
	tools: {
		definitions(): Array<{ name: string }>;
		guard(guard: (execution: { name: string; agent?: FakeAgent }) => string | undefined): () => void;
	};
	systemPrompt: {
		section(section: { name: string; order: number; text: (context: { agent?: FakeAgent }) => string }): () => void;
		getSectionOrder(name: string): number;
	};
	sessionProjections: {
		register(definition: ProjectionLike): Promise<{ stateOf(session: FakeSession): unknown; dispose(): Promise<void> }>;
	};
	on(name: string, listener: (...args: any[]) => unknown): () => void;
	inject(deps: string[], callback: (ctx: FakeCtx) => void): void;
	effect(factory: () => () => void): () => void;
	logger: { warn(...args: unknown[]): void };
	commands: {
		register(definition: { name: string; handler: (invocation: any) => unknown }): () => void;
		get(name: string): { name: string; handler: (invocation: any) => unknown } | undefined;
	};
	llm: {
		prepareCall(
			config: { provider: string; model: string; maxTokens?: number },
			signal?: AbortSignal,
		): Promise<{ config: { provider: string; model: string }; stream(options: unknown): AsyncIterable<unknown> }>;
	};
	readonly sections: Array<{ name: string; order: number; text: (context: { agent?: FakeAgent }) => string }>;
	readonly guards: Array<(execution: { name: string; agent?: FakeAgent }) => string | undefined>;
	readonly listeners: Map<string, Array<(...args: any[]) => unknown>>;
	setLlmChunks(chunks: unknown[]): void;
	createSession(id?: string): FakeSession;
	createAgent(overrides?: { provider?: string; model?: string }): FakeAgent;
	emit(name: string, ...args: unknown[]): Promise<void>;
}

export function createFakeCtx(options: { tools?: readonly string[] } = {}): FakeCtx {
	const sections: FakeCtx["sections"] = [];
	const guards: FakeCtx["guards"] = [];
	const listeners = new Map<string, Array<(...args: any[]) => unknown>>();
	const state = new WeakMap<object, unknown>();
	const names =
		options.tools ?? ["read", "read_image", "glob", "grep", "bash", "write", "edit", "browser_click", "browser_snapshot"];
	const registry = new Map<string, { name: string; handler: (invocation: any) => unknown }>();
	let projection: ProjectionLike | undefined;
	/** Chunks the fake LLM streams back; tests set them before calling /wish. */
	const llmChunks: unknown[] = [];

	const ctx: FakeCtx = {
		tools: {
			definitions: () => names.map((name) => ({ name })),
			guard: (guard) => {
				guards.push(guard);
				return () => {};
			},
		},
		systemPrompt: {
			section: (section) => {
				sections.push(section);
				return () => {};
			},
			getSectionOrder: () => 500,
		},
		sessionProjections: {
			register: async (definition) => {
				projection = definition;
				return {
					stateOf: (session) => state.get(session) ?? definition.init({}, 0),
					dispose: async () => {},
				};
			},
		},
		on: (name, listener) => {
			const list = listeners.get(name) ?? [];
			list.push(listener);
			listeners.set(name, list);
			return () => {};
		},
		inject: (_deps, callback) => callback(ctx),
		effect: () => () => {},
		logger: { warn: () => {} },
		commands: {
			register: (definition) => {
				registry.set(definition.name, definition);
				return () => registry.delete(definition.name);
			},
			get: (name) => registry.get(name),
		},
		llm: {
			prepareCall: async (config) => ({
				config: { provider: config.provider, model: config.model },
				stream: async function* () {
					for (const chunk of llmChunks) yield chunk;
				},
			}),
		},
		setLlmChunks: (chunks) => {
			llmChunks.length = 0;
			llmChunks.push(...chunks);
		},
		sections,
		guards,
		listeners,
		createSession: (id = "session-1") => {
			const session: FakeSession = {
				id,
				events: [],
				append(type, data) {
					session.events.push({ type, data });
					if (!projection) return;
					const previous = state.get(session) ?? projection.init({}, 0);
					state.set(session, projection.apply(previous, { type, data }));
				},
			};
			return session;
		},
		createAgent: (overrides = {}) => {
			const session = ctx.createSession();
			const agent: FakeAgent = {
				session,
				options: { provider: overrides.provider, model: overrides.model },
				model: {
					current: () =>
						overrides.provider && overrides.model
							? { provider: overrides.provider, model: overrides.model }
							: undefined,
				},
				followups: [],
				followup: (message) => {
					agent.followups.push(message);
				},
				ctx: {
					tools: {
						restrict: (filter) => {
							agent.restriction = filter;
							return () => {
								agent.restriction = undefined;
							};
						},
					},
				},
			};
			return agent;
		},
		emit: async (name, ...args) => {
			for (const listener of listeners.get(name) ?? []) await listener(...args);
		},
	};

	return ctx;
}

/** The plugin talks to a real Context; tests hand it the fake. */
export function asContext(ctx: FakeCtx): Context {
	return ctx as unknown as Context;
}
export function asAgent(agent: FakeAgent): Agent {
	return agent as unknown as Agent;
}
export function asSession(session: FakeSession): Session {
	return session as unknown as Session;
}
