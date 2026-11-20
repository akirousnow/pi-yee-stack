/**
 * A BrowserEngineLike that records calls instead of spawning Chrome.
 */

import type { CallToolResult } from "@earendil-works/pi-mcp";
import type { BrowserConfig } from "yee-stack-core";
import { type PageInfo, SnapshotCache } from "yee-stack-browser";
import type { BrowserEngineLike, EngineState } from "../features/browser/mcp.ts";
import { BROWSER_UPSTREAM_TOOLS } from "../features/browser/tools.ts";

export class FakeBrowserEngine implements BrowserEngineLike {
	state: EngineState = "idle";
	epoch = 1;
	error: string | undefined;
	mode: string | undefined = "launch";
	remote = false;
	pid: number | undefined = 4242;
	serverVersion: string | undefined = "1.13.0";
	readonly snapshots = new SnapshotCache();

	pageList: PageInfo[] = [];
	calls: Array<{ name: string; args: Record<string, unknown> }> = [];
	startCalls: BrowserConfig[] = [];
	startOptions: Array<{ restart?: boolean }> = [];
	stopCalls = 0;
	result: CallToolResult = { content: [{ type: "text", text: "ok" }] };
	/** When set, start() throws instead of connecting. */
	startError: Error | undefined;

	readonly roots: string[] = [];
	retainCount = 0;
	private readonly owners = new Set<object>();
	private readonly listeners = new Set<() => void>();

	available(): ReadonlySet<string> {
		return new Set(BROWSER_UPSTREAM_TOOLS);
	}

	pages(): readonly PageInfo[] {
		return this.pageList;
	}

	setPages(pages: readonly PageInfo[]): void {
		this.pageList = [...pages];
		this.emit();
	}

	async refreshPages(): Promise<readonly PageInfo[]> {
		return this.pageList;
	}

	async call(
		name: string,
		args: Record<string, unknown> = {},
		_options?: { signal?: AbortSignal; timeoutMs?: number },
	): Promise<CallToolResult> {
		this.calls.push({ name, args });
		return this.result;
	}

	async start(config: BrowserConfig, roots: readonly string[] = [], options: { restart?: boolean } = {}): Promise<void> {
		this.startCalls.push(config);
		this.startOptions.push(options);
		this.roots.push(...roots);
		if (this.startError) {
			this.state = "error";
			this.emit();
			throw this.startError;
		}
		this.state = "connected";
		this.epoch += 1;
		this.emit();
	}

	async stop(): Promise<void> {
		this.stopCalls++;
		this.state = "idle";
		this.pageList = [];
		this.emit();
	}

	retain(owner: object, root?: string): void {
		if (root && !this.roots.includes(root)) this.roots.push(root);
		if (this.owners.has(owner)) return;
		this.owners.add(owner);
		this.retainCount++;
	}

	release(owner: object): void {
		if (this.owners.delete(owner)) this.retainCount--;
	}

	addRoots(paths: readonly string[]): void {
		this.roots.push(...paths);
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	/** Simulate an established connection. */
	connect(pages: PageInfo[] = []): void {
		this.state = "connected";
		this.pageList = [...pages];
		this.emit();
	}

	emit(): void {
		for (const listener of [...this.listeners]) listener();
	}
}
