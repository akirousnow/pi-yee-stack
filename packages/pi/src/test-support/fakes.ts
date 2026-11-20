/**
 * Minimal stand-ins for Pi's ExtensionAPI / ExtensionContext, enough to drive
 * the features' handlers in unit tests. Only the surface the features use.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ToolLike } from "yee-stack-ask";

export interface FakeTool extends ToolLike {
	description?: string;
}

export function defaultTools(): FakeTool[] {
	return ["read", "bash", "edit", "write", "grep", "find", "ls"].map((name) => ({
		name,
		exposure: "direct",
		description: `${name} tool`,
	}));
}

type Handler = (event: any, ctx: any) => unknown;

export interface FakePi {
	pi: ExtensionAPI;
	commands: Map<string, { description?: string; handler: (args: string, ctx: any) => Promise<void> }>;
	shortcuts: Map<string, { description?: string; handler: (ctx: any) => unknown }>;
	flags: Map<string, { type: string; default?: unknown }>;
	/** Tools registered by extensions, by name. */
	toolDefs: Map<string, any>;
	/** Message renderers registered by extensions, by custom type. */
	messageRenderers: Map<string, any>;
	/** Custom entries written with pi.appendEntry (session-entry shaped). */
	entries: Array<{ type: "custom"; customType: string; data: unknown }>;
	sentMessages: Array<{ text: string; options: unknown }>;
	/** Every pi.setActiveTools() call, in order. */
	setActiveCalls: string[][];
	flagValues: Record<string, unknown>;
	tools: FakeTool[];
	active(): string[];
	setActive(names: string[]): void;
	/** Fire an event; returns the results of every handler. */
	emit(event: string, payload: Record<string, unknown>, ctx: unknown): unknown[];
}

export function createFakePi(options: { tools?: FakeTool[]; active?: string[] } = {}): FakePi {
	const handlers = new Map<string, Handler[]>();
	let active = options.active ?? ["read", "bash", "edit", "write"];

	const fake: FakePi = {
		pi: undefined as unknown as ExtensionAPI,
		commands: new Map(),
		shortcuts: new Map(),
		flags: new Map(),
		toolDefs: new Map(),
		messageRenderers: new Map(),
		entries: [],
		sentMessages: [],
		setActiveCalls: [],
		flagValues: {},
		tools: options.tools ?? defaultTools(),
		active: () => [...active],
		setActive: (names) => {
			active = [...names];
		},
		emit(event, payload, ctx) {
			return (handlers.get(event) ?? []).map((handler) => handler({ type: event, ...payload }, ctx));
		},
	};

	const api = {
		on(event: string, handler: Handler) {
			handlers.set(event, [...(handlers.get(event) ?? []), handler]);
			return () => {};
		},
		registerCommand(name: string, opts: { description?: string; handler: (args: string, ctx: any) => Promise<void> }) {
			fake.commands.set(name, opts);
		},
		registerShortcut(key: string, opts: { description?: string; handler: (ctx: any) => unknown }) {
			fake.shortcuts.set(key, opts);
		},
		registerFlag(name: string, opts: { type: string; default?: unknown }) {
			fake.flags.set(name, opts);
		},
		registerTool(def: any) {
			fake.toolDefs.set(def.name, def);
			const exposure = def.exposure ?? "direct";
			fake.tools.push({ name: def.name, description: def.description, exposure, annotations: def.annotations });
			if (def.defaultActive !== false && (exposure === "direct" || exposure === "model-only")) active.push(def.name);
		},
		registerMessageRenderer(customType: string, renderer: any) {
			fake.messageRenderers.set(customType, renderer);
		},
		getFlag(name: string) {
			return name in fake.flagValues ? fake.flagValues[name] : fake.flags.get(name)?.default;
		},
		appendEntry(customType: string, data?: unknown) {
			fake.entries.push({ type: "custom", customType, data });
		},
		getActiveTools: () => [...active],
		getAllTools: () => fake.tools,
		setActiveTools(names: string[]) {
			fake.setActiveCalls.push([...names]);
			// Like Pi: unknown tool names are ignored.
			active = names.filter((name) => fake.tools.some((tool) => tool.name === name));
		},
		sendUserMessage(text: string, opts?: unknown) {
			fake.sentMessages.push({ text, options: opts });
		},
	};
	fake.pi = api as unknown as ExtensionAPI;
	return fake;
}

export interface FakeCtx {
	ctx: ExtensionContext;
	notifications: Array<{ message: string; type?: string }>;
	status: Map<string, string | undefined>;
	editorText: { value: string };
	/** ui.addAutocompleteProvider factories, in order. */
	autocompleteFactories: Array<(current: any) => any>;
	/** The provider built from the last registered factory. */
	autocompleteProvider: any;
	selectCalls: Array<{ title: string; options: string[] }>;
	selectAnswers: string[];
	widgets: Map<string, unknown>;
	setBranch(entries: unknown[]): void;
	setIdle(idle: boolean): void;
}

/** A theme whose `fg` wraps text in readable markers: `fg("warning","x")` → `<warning>x</warning>`. */
export const markerTheme = {
	fg: (color: string, text: string) => `<${color}>${text}</${color}>`,
	bg: (_color: string, text: string) => text,
	bold: (text: string) => text,
};

export function createFakeCtx(options: { mode?: string; hasUI?: boolean } = {}): FakeCtx {
	let branch: unknown[] = [];
	let idle = true;
	const notifications: FakeCtx["notifications"] = [];
	const status = new Map<string, string | undefined>();
	const editorText = { value: "" };
	const autocompleteFactories: FakeCtx["autocompleteFactories"] = [];
	const selectCalls: FakeCtx["selectCalls"] = [];
	const selectAnswers: string[] = [];
	const widgets = new Map<string, unknown>();
	const baseProvider = {
		getSuggestions: async () => null,
		applyCompletion: (lines: string[], cursorLine: number, cursorCol: number) => ({ lines, cursorLine, cursorCol }),
		shouldTriggerFileCompletion: () => true,
	};
	const fakeCtx: FakeCtx = {
		ctx: undefined as unknown as ExtensionContext,
		notifications,
		status,
		editorText,
		autocompleteFactories,
		autocompleteProvider: undefined,
		selectCalls,
		selectAnswers,
		widgets,
		setBranch: (entries) => {
			branch = entries;
		},
		setIdle: (value) => {
			idle = value;
		},
	};

	const ctx = {
		mode: options.mode ?? "tui",
		hasUI: options.hasUI ?? true,
		isIdle: () => idle,
		ui: {
			theme: markerTheme,
			notify: (message: string, type?: string) => void notifications.push({ message, type }),
			setStatus: (key: string, text: string | undefined) => void status.set(key, text),
			setEditorText: (text: string) => void (editorText.value = text),
			getEditorText: () => editorText.value,
			select: async (title: string, options: string[]) => {
				selectCalls.push({ title, options });
				return selectAnswers.shift();
			},
			confirm: async () => true,
			setWidget: (key: string, content: unknown) => {
				if (content === undefined) widgets.delete(key);
				else widgets.set(key, content);
			},
			addAutocompleteProvider: (factory: (current: any) => any) => {
				autocompleteFactories.push(factory);
				fakeCtx.autocompleteProvider = factory(baseProvider);
			},
		},
		sessionManager: { getBranch: () => branch },
	};

	fakeCtx.ctx = ctx as unknown as ExtensionContext;
	return fakeCtx;
}
