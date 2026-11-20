/**
 * The chrome-devtools-mcp process, shared by every Pi session in this process.
 *
 * Yee Stack is the MCP client itself (McpClient + StdioTransport) instead of
 * registering the server with `pi.registerMcpServer`: commands, `$`
 * completion and input hooks cannot call Pi tools, but they need the page
 * list and the page ids the server hands out. Owning the client gives them
 * that, and keeps one Chrome connection (and one permission prompt) for
 * `/reload`, `/new` and every pi-web session.
 *
 * Lifecycle: runtimes retain/release the engine. Releasing the last runtime
 * schedules a close after a grace period, so a reload or a session switch
 * does not tear down Chrome; quitting Pi kills the child right away.
 */

import { pathToFileURL } from "node:url";
import { McpClient, type CallToolResult, StdioTransport, type Tool } from "@earendil-works/pi-mcp";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { BrowserConfig } from "@yee-stack/core";
import {
	buildServerCommand,
	type ConnectPlan,
	currentConnectEnv,
	isRemoteConnectPlan,
	planConnection,
	pagesChanged,
	type PageInfo,
	parsePages,
	parseStructuredPages,
	SnapshotCache,
} from "@yee-stack/browser";

export type EngineState = "idle" | "starting" | "connected" | "error";

/** What the feature and the tools need; a fake implements it in tests. */
export interface BrowserEngineLike {
	readonly state: EngineState;
	readonly epoch: number;
	readonly error: string | undefined;
	readonly mode: string | undefined;
	readonly remote: boolean;
	readonly pid: number | undefined;
	readonly serverVersion: string | undefined;
	readonly snapshots: SnapshotCache;
	available(): ReadonlySet<string>;
	pages(): readonly PageInfo[];
	setPages(pages: readonly PageInfo[]): void;
	refreshPages(options?: { maxAgeMs?: number; force?: boolean; timeoutMs?: number }): Promise<readonly PageInfo[]>;
	call(
		name: string,
		args?: Record<string, unknown>,
		options?: { signal?: AbortSignal; timeoutMs?: number },
	): Promise<CallToolResult>;
	start(config: BrowserConfig, roots?: readonly string[], options?: { restart?: boolean }): Promise<void>;
	stop(): Promise<void>;
	retain(owner: object, root?: string): void;
	release(owner: object): void;
	addRoots(paths: readonly string[]): void;
	subscribe(listener: () => void): () => void;
}

const CLIENT_NAME = "pi-yee-stack";
const CLIENT_VERSION = "0.4.3";
// A new package version gets a new engine, so a reload after an upgrade does
// not keep running the old MCP client code.
const ENGINE_KEY = Symbol.for(`pi-yee-stack/browser-engine@${CLIENT_VERSION}`);
const CLOSE_GRACE_MS = 60_000;
const REFRESH_INTERVAL_MS = 15_000;
const START_TIMEOUT_MS = 120_000;
const CALL_TIMEOUT_MS = 120_000;

function errorText(result: CallToolResult): string {
	const text = result.content
		.filter((block) => block.type === "text")
		.map((block) => block.text)
		.join("\n")
		.trim();
	return text || "chrome-devtools-mcp 返回了错误";
}

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export class BrowserEngine implements BrowserEngineLike {
	readonly snapshots = new SnapshotCache();

	private client: McpClient | undefined;
	private transport: StdioTransport | undefined;
	private starting: Promise<void> | undefined;
	private stopping = false;
	private refreshing: Promise<readonly PageInfo[]> | undefined;
	private closeTimer: NodeJS.Timeout | undefined;
	private refreshTimer: NodeJS.Timeout | undefined;

	private toolList = new Map<string, Tool>();
	private pageList: PageInfo[] = [];
	private pagesAt = 0;
	private activeCalls = 0;
	private startToken = 0;

	private owners = new Set<object>();
	private ownerRoots = new Map<object, string>();
	private listeners = new Set<() => void>();
	private roots = new Set<string>();

	private _state: EngineState = "idle";
	private _error: string | undefined;
	private _epoch = 0;
	private _mode: string | undefined;
	private _remote = false;
	private _pid: number | undefined;
	private _serverVersion: string | undefined;

	constructor() {
		process.once("exit", () => this.killNow());
	}

	get state(): EngineState {
		return this._state;
	}

	get epoch(): number {
		return this._epoch;
	}

	get error(): string | undefined {
		return this._error;
	}

	get mode(): string | undefined {
		return this._mode;
	}

	get remote(): boolean {
		return this._remote;
	}

	get pid(): number | undefined {
		return this._pid;
	}

	get serverVersion(): string | undefined {
		return this._serverVersion;
	}

	available(): ReadonlySet<string> {
		return new Set(this.toolList.keys());
	}

	pages(): readonly PageInfo[] {
		return this.pageList;
	}

	setPages(pages: readonly PageInfo[]): void {
		this.pagesAt = Date.now();
		if (!pagesChanged(this.pageList, pages)) return;
		this.pageList = [...pages];
		this.emit();
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	// ── reference counting ────────────────────────────────────────────────

	private effectiveRoots(): string[] {
		const merged = new Set<string>(this.roots);
		for (const path of this.ownerRoots.values()) merged.add(path);
		return [...merged];
	}

	private notifyRootsChanged(): void {
		if (this._state === "connected" && this.client) {
			void this.client.notify("notifications/roots/list_changed").catch(() => {});
		}
	}

	retain(owner: object, root?: string): void {
		const alreadyRetained = this.owners.has(owner);
		this.owners.add(owner);
		if (root) {
			const previous = this.ownerRoots.get(owner);
			if (previous !== root) {
				this.ownerRoots.set(owner, root);
				this.notifyRootsChanged();
			}
		}
		if (alreadyRetained) return;
		if (this.closeTimer) {
			clearTimeout(this.closeTimer);
			this.closeTimer = undefined;
		}
	}

	release(owner: object): void {
		const removedRoot = this.ownerRoots.delete(owner);
		if (removedRoot) this.notifyRootsChanged();
		if (!this.owners.delete(owner)) return;
		if (this.owners.size > 0) return;
		if (this.closeTimer) return;
		this.closeTimer = setTimeout(() => {
			this.closeTimer = undefined;
			if (this.owners.size === 0) void this.stop();
		}, CLOSE_GRACE_MS);
		this.closeTimer.unref?.();
	}

	addRoots(paths: readonly string[]): void {
		const existing = new Set(this.effectiveRoots());
		let changed = false;
		for (const path of paths) {
			if (!path || existing.has(path)) continue;
			this.roots.add(path);
			existing.add(path);
			changed = true;
		}
		if (changed) this.notifyRootsChanged();
	}

	// ── connection ────────────────────────────────────────────────────────

	async start(config: BrowserConfig, roots: readonly string[] = [], options: { restart?: boolean } = {}): Promise<void> {
		this.addRoots(roots);
		if (options.restart) {
			if (this.starting) await this.starting.catch(() => {});
			if (this._state !== "idle") await this.stop();
		}
		if (this._state === "connected") return;
		if (this.starting) return this.starting;

		this.starting = this.doStart(config).finally(() => {
			this.starting = undefined;
		});
		return this.starting;
	}

	private async doStart(config: BrowserConfig): Promise<void> {
		const token = ++this.startToken;
		this.setState("starting");
		this._error = undefined;

		const env = currentConnectEnv(getAgentDir());
		let plan: ConnectPlan;
		try {
			plan = await planConnection(config, env);
			if (plan.mode === "none") throw new Error(plan.reason);
		} catch (error) {
			this.fail(message(error));
			throw error;
		}

		const server = buildServerCommand(config, plan, env);
		const client = new McpClient({
			name: CLIENT_NAME,
			version: CLIENT_VERSION,
			requestTimeoutMs: 60_000,
			roots: () =>
				this.effectiveRoots().map((path) => ({
					uri: pathToFileURL(path).href,
					name: path,
				})),
		});
		const transport = new StdioTransport({
			command: server.command,
			args: server.args,
			env: server.env,
			stderr: "pipe",
			closeTimeoutMs: 2_000,
		});

		this.client = client;
		this.transport = transport;
		client.onClose(() => {
			if (this.client === client) this.handleClosed("chrome-devtools-mcp 已断开");
		});

		try {
			await client.connect(transport);
			if (token !== this.startToken) throw new Error("连接已取消");
			const tools = await client.listTools();
			this.toolList = new Map(tools.map((tool) => [tool.name, tool]));
			this._serverVersion = client.serverInfo?.version;
			this._pid = transport.pid;
			this._mode = plan.mode;
			this._remote = isRemoteConnectPlan(plan);

			const result = await client.callTool("list_pages", {}, { timeoutMs: START_TIMEOUT_MS });
			if (result.isError) throw new Error(errorText(result));
			const pages = parsePages(result);
			if (!pages) throw new Error("无法解析 list_pages 的结果");

			this._epoch += 1;
			this.snapshots.clear();
			this.pageList = pages;
			this.pagesAt = Date.now();
			this.setState("connected");
			this.startRefreshTimer();
		} catch (error) {
			const details = transport.stderr.trim().split("\n").slice(-3).join("\n");
			await client.close().catch(() => {});
			if (this.client === client) this.client = undefined;
			if (this.transport === transport) this.transport = undefined;
			this._pid = undefined;
			this._remote = false;
			if (token === this.startToken) {
				this.fail(details && !message(error).includes(details) ? `${message(error)}\n${details}` : message(error));
			}
			throw error;
		}
	}

	private fail(text: string): void {
		this._error = text;
		this.setState("error");
	}

	private handleClosed(text: string): void {
		if (this.stopping) return;
		this.client = undefined;
		this.transport = undefined;
		this._pid = undefined;
		this._mode = undefined;
		this._remote = false;
		this.toolList = new Map();
		this.pageList = [];
		this.pagesAt = 0;
		this.snapshots.clear();
		this._epoch += 1;
		this.stopRefreshTimer();
		this.fail(text);
	}

	private setState(state: EngineState): void {
		this._state = state;
		this.emit();
	}

	private emit(): void {
		for (const listener of [...this.listeners]) {
			try {
				listener();
			} catch {
				// A broken listener must not break the engine.
			}
		}
	}

	async stop(): Promise<void> {
		this.startToken += 1;
		this.stopRefreshTimer();
		if (this.closeTimer) {
			clearTimeout(this.closeTimer);
			this.closeTimer = undefined;
		}
		const client = this.client;
		this.client = undefined;
		this.transport = undefined;
		this.stopping = true;
		try {
			await client?.close().catch(() => {});
		} finally {
			this.stopping = false;
			this.toolList = new Map();
			this.pageList = [];
			this.pagesAt = 0;
			this.snapshots.clear();
			this._pid = undefined;
			this._mode = undefined;
			this._remote = false;
			this._error = undefined;
			this._epoch += 1;
			this.setState("idle");
		}
	}

	/** Synchronous last resort for process exit. */
	private killNow(): void {
		const pid = this.transport?.pid;
		if (!pid) return;
		try {
			process.kill(pid, "SIGKILL");
		} catch {
			// already gone
		}
	}

	private startRefreshTimer(): void {
		this.stopRefreshTimer();
		this.refreshTimer = setInterval(() => {
			if (this._state === "connected" && this.owners.size > 0 && this.activeCalls === 0) {
				void this.refreshPages({ maxAgeMs: REFRESH_INTERVAL_MS / 2 });
			}
		}, REFRESH_INTERVAL_MS);
		this.refreshTimer.unref?.();
	}

	private stopRefreshTimer(): void {
		if (this.refreshTimer) {
			clearInterval(this.refreshTimer);
			this.refreshTimer = undefined;
		}
	}

	// ── calls ─────────────────────────────────────────────────────────────

	async refreshPages(
		options: { maxAgeMs?: number; force?: boolean; timeoutMs?: number } = {},
	): Promise<readonly PageInfo[]> {
		if (this._state !== "connected" || !this.client) return this.pages();
		const maxAge = options.maxAgeMs ?? 5_000;
		if (!options.force && Date.now() - this.pagesAt < maxAge) return this.pages();
		if (this.refreshing) return this.refreshing;

		this.refreshing = (async () => {
			try {
				const result = await this.client!.callTool("list_pages", {}, { timeoutMs: options.timeoutMs ?? 15_000 });
				if (result.isError) return this.pages();
				const pages = parsePages(result);
				if (pages) this.setPages(pages);
			} catch {
				// Keep the last known list; the footer and $ completion still work.
			}
			return this.pages();
		})().finally(() => {
			this.refreshing = undefined;
		});
		return this.refreshing;
	}

	async call(
		name: string,
		args: Record<string, unknown> = {},
		options: { signal?: AbortSignal; timeoutMs?: number } = {},
	): Promise<CallToolResult> {
		const client = this.client;
		if (!client || this._state !== "connected") {
			throw new Error("浏览器未连接：先执行 /browser on");
		}
		let result: CallToolResult;
		this.activeCalls += 1;
		try {
			result = await client.callTool(name, args, {
				signal: options.signal,
				timeoutMs: options.timeoutMs ?? CALL_TIMEOUT_MS,
			});
		} catch (error) {
			throw new Error(`浏览器调用失败（${name}）：${message(error)}`);
		} finally {
			this.activeCalls -= 1;
		}
		const pages = parseStructuredPages(result);
		if (pages && pages.length > 0) this.setPages(pages);
		return result;
	}
}

/** The process-wide engine. Survives `/reload` and is shared by pi-web sessions. */
export function getEngine(): BrowserEngine {
	const holder = globalThis as unknown as Record<symbol, BrowserEngine | undefined>;
	let engine = holder[ENGINE_KEY];
	if (!engine) {
		engine = new BrowserEngine();
		holder[ENGINE_KEY] = engine;
	}
	return engine;
}
