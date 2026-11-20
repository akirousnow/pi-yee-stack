/**
 * Which tools Ask mode allows.
 *
 * Ask mode is read-only Q&A, so only tools that cannot change anything are
 * available:
 *
 *  - Pi's read-only built-ins: `read`, `grep`, `find`, `ls`.
 *  - Tools that declare `annotations.readOnlyHint` (MCP servers do), when they
 *    are active.
 *  - Tools the user explicitly ticked in /yee-config → Ask.
 *
 * Pi's mutating built-ins (`bash`, `powershell`, `edit`, `write`) are never
 * allowed, not even when ticked: a shell cannot be proven read-only.
 *
 * Pure functions: the rules are unit-tested without a Pi runtime.
 */

/** The slice of a tool annotation record the policy reads (MCP servers send these). */
export interface ToolAnnotations {
	readOnlyHint?: boolean;
	destructiveHint?: boolean;
	idempotentHint?: boolean;
	openWorldHint?: boolean;
	title?: string;
}

/** Pi's read-only built-in tools (the same set as pi's `createReadOnlyTools`). */
export const READ_ONLY_BUILTIN_TOOLS: readonly string[] = ["read", "grep", "find", "ls"];

/** Built-in tools that can modify files or run arbitrary commands. */
export const NEVER_ALLOWED_TOOLS: ReadonlySet<string> = new Set(["bash", "powershell", "edit", "write"]);

/** The slice of Pi's `ToolInfo` the policy looks at. */
export interface ToolLike {
	name: string;
	exposure?: string;
	annotations?: ToolAnnotations;
}

const READ_ONLY_BUILTIN_SET: ReadonlySet<string> = new Set(READ_ONLY_BUILTIN_TOOLS);

/** Whether the tool declares itself read-only. Unverified, like MCP hints. */
export function declaresReadOnly(tool: ToolLike): boolean {
	return tool.annotations?.readOnlyHint === true;
}

/** Whether `tool` may run in Ask mode. Unknown tools are never allowed. */
export function isToolAllowed(tool: ToolLike | undefined, extra: ReadonlySet<string>): boolean {
	if (!tool) return false;
	if (NEVER_ALLOWED_TOOLS.has(tool.name)) return false;
	if (READ_ONLY_BUILTIN_SET.has(tool.name)) return true;
	if (extra.has(tool.name)) return true;
	return declaresReadOnly(tool);
}

/**
 * The active tool set for Ask mode: the read-only built-ins that exist, then
 * every other active tool the policy allows, then the user's extra tools.
 */
export function computeAskTools(
	all: readonly ToolLike[],
	active: readonly string[],
	extra: ReadonlySet<string>,
): string[] {
	const byName = new Map(all.map((tool) => [tool.name, tool] as const));
	const out: string[] = [];
	const add = (name: string) => {
		if (!out.includes(name) && isToolAllowed(byName.get(name), extra)) out.push(name);
	};

	for (const name of READ_ONLY_BUILTIN_TOOLS) add(name);
	for (const name of active) add(name);
	for (const name of extra) add(name);
	return out;
}

/** Tools the user may tick in /yee-config: everything not already decided. */
export function candidateExtraTools<T extends ToolLike>(all: readonly T[]): T[] {
	return all
		.filter((tool) => {
			if (NEVER_ALLOWED_TOOLS.has(tool.name) || READ_ONLY_BUILTIN_SET.has(tool.name)) return false;
			if (declaresReadOnly(tool)) return false;
			// codemode / deferred / hidden tools are reached through other tools, not declared directly.
			return tool.exposure === undefined || tool.exposure === "direct" || tool.exposure === "model-only";
		})
		.sort((a, b) => a.name.localeCompare(b.name));
}

/** The tools to restore when leaving Ask mode. */
export function toolsAfterAsk(
	before: readonly string[] | undefined,
	all: readonly ToolLike[],
	currentlyActive: readonly string[],
): string[] {
	if (before && before.length > 0) return [...before];
	// No snapshot (an entry written by hand?): current tools plus Pi's default coding tools.
	const registered = new Set(all.map((tool) => tool.name));
	const defaults = ["read", "bash", "edit", "write"].filter((name) => registered.has(name));
	return [...new Set([...defaults, ...currentlyActive])];
}

/** The tool vocabulary one host brings to the policy. */
export interface AskPolicySpec {
	/** Tools that are read-only by construction (the host's built-ins). */
	readOnly: readonly string[];
	/** Tools that can change the machine; never allowed, not even when ticked. */
	never: readonly string[];
}

/** A policy bound to one host's tool vocabulary. */
export interface AskPolicy {
	/** Whether `name` may run in Ask mode. Unknown tools are never allowed. */
	isAllowed(name: string, extra?: ReadonlySet<string>): boolean;
	/** The names from `all` that stay available. */
	allowed(all: readonly string[], extra?: ReadonlySet<string>): string[];
	/** The names from `all` that Ask mode blocks. */
	blocked(all: readonly string[], extra?: ReadonlySet<string>): string[];
}

/**
 * Bind the policy to a host's tool names.
 *
 * Pi's own set lives in {@link READ_ONLY_BUILTIN_TOOLS} / {@link NEVER_ALLOWED_TOOLS};
 * DeepSeek Harness names its built-ins differently, so it builds its own policy
 * from the same rules.
 */
export function createAskPolicy(spec: AskPolicySpec): AskPolicy {
	const readOnly = new Set(spec.readOnly);
	const never = new Set(spec.never);
	const isAllowed = (name: string, extra?: ReadonlySet<string>): boolean => {
		if (never.has(name)) return false;
		if (readOnly.has(name)) return true;
		return extra?.has(name) === true;
	};
	return {
		isAllowed,
		allowed: (all, extra) => all.filter((name) => isAllowed(name, extra)),
		blocked: (all, extra) => all.filter((name) => !isAllowed(name, extra)),
	};
}

/** Tools in `all` that Ask mode blocks, for status output. */
export function blockedTools(all: readonly ToolLike[], extra: ReadonlySet<string>): string[] {
	return all
		.filter((tool) => !isToolAllowed(tool, extra))
		.map((tool) => tool.name)
		.sort();
}
