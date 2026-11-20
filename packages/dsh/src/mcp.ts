/**
 * A small MCP client over stdio.
 *
 * The harness ships `@deepseek-ai/dsh-mcp-client`, but that layer registers
 * every server tool straight into `ctx.tools` and hands back no call handle —
 * while `/browser`, the tab list and the prompt section all need to call
 * `list_pages` outside a model step. So Yee Stack owns a tiny client for the
 * one server it cares about, exactly like the Pi extension does.
 *
 * Wire format: newline-delimited JSON-RPC 2.0 over the child's stdin/stdout,
 * which is what the MCP stdio transport specifies.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { resolveServerBin } from "@yee-stack/browser";

export interface McpContentBlock {
	type: string;
	text?: string;
	data?: string;
	mimeType?: string;
}

export interface McpToolResult {
	content: McpContentBlock[];
	structuredContent?: unknown;
	isError?: boolean;
}

export interface McpToolInfo {
	name: string;
	description?: string;
	inputSchema?: unknown;
	annotations?: { readOnlyHint?: boolean; [key: string]: unknown };
}

export interface McpServerCommand {
	command: string;
	args: string[];
	env: Record<string, string>;
}

export interface McpRoot {
	uri: string;
	name?: string;
}

const CLIENT_NAME = "yee-stack-dsh";
const CLIENT_VERSION = "0.5.0";
const PROTOCOL_VERSION = "2025-06-18";
const DEFAULT_TIMEOUT_MS = 60_000;

interface Pending {
	resolve(value: unknown): void;
	reject(error: Error): void;
	timer: NodeJS.Timeout;
}

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export class McpStdioClient {
	private readonly child: ChildProcess;
	private readonly pending = new Map<number, Pending>();
	private readonly rootsProvider?: () => McpRoot[];
	private rootSyncWaiters: Array<() => void> = [];
	private nextId = 1;
	private buffer = "";
	private closed = false;
	private stderrText = "";

	readonly tools: McpToolInfo[] = [];
	serverVersion: string | undefined;
	pid: number | undefined;

	private constructor(child: ChildProcess, rootsProvider?: () => McpRoot[]) {
		this.child = child;
		this.rootsProvider = rootsProvider;
		this.pid = child.pid;
		child.stdout?.setEncoding("utf8");
		child.stdout?.on("data", (chunk: string) => this.onData(chunk));
		child.stderr?.setEncoding("utf8");
		child.stderr?.on("data", (chunk: string) => {
			this.stderrText = (this.stderrText + chunk).slice(-8_000);
		});
		child.on("exit", () => this.onExit());
		child.on("error", (error) => this.failAll(new Error(`chrome-devtools-mcp 启动失败：${message(error)}`)));
	}

	/** Spawn the server and complete the MCP handshake. */
	static async connect(
		command: McpServerCommand,
		options: { timeoutMs?: number; roots?: () => McpRoot[] } = {},
	): Promise<McpStdioClient> {
		const child = spawn(command.command, command.args, {
			env: { ...process.env, ...command.env },
			stdio: ["pipe", "pipe", "pipe"],
		});
		const client = new McpStdioClient(child, options.roots);
		try {
			await client.request(
				"initialize",
				{
					protocolVersion: PROTOCOL_VERSION,
					capabilities: options.roots ? { roots: { listChanged: true } } : {},
					clientInfo: { name: CLIENT_NAME, version: CLIENT_VERSION },
				},
				{ timeoutMs: options.timeoutMs ?? 30_000 },
			);
			client.notify("notifications/initialized", {});
			await client.refreshTools();
			return client;
		} catch (error) {
			await client.close().catch(() => {});
			const tail = client.stderrTail();
			throw new Error(tail && !message(error).includes(tail) ? `${message(error)}\n${tail}` : message(error));
		}
	}

	/** The last few stderr lines, for a failed connection. */
	stderrTail(): string {
		return this.stderrText.trim().split("\n").slice(-3).join("\n");
	}

	async refreshTools(): Promise<McpToolInfo[]> {
		const result = (await this.request("tools/list", {})) as { tools?: McpToolInfo[] };
		this.tools.length = 0;
		for (const tool of result.tools ?? []) {
			if (typeof tool?.name === "string") this.tools.push(tool);
		}
		return this.tools;
	}

	async callTool(name: string, args: Record<string, unknown> = {}, options: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<McpToolResult> {
		const result = (await this.request("tools/call", { name, arguments: args }, options)) as McpToolResult;
		return {
			content: Array.isArray(result?.content) ? result.content : [],
			structuredContent: result?.structuredContent,
			isError: result?.isError === true,
		};
	}

	/** Tell the server that workspace roots changed and wait briefly for its `roots/list` refresh. */
	async syncRoots(timeoutMs = 1_500): Promise<void> {
		if (!this.rootsProvider || this.closed) return;
		await new Promise<void>((resolve) => {
			let settled = false;
			const finish = () => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				resolve();
			};
			const timer = setTimeout(finish, timeoutMs);
			timer.unref?.();
			this.rootSyncWaiters.push(finish);
			this.notify("notifications/roots/list_changed", {});
		});
	}

	async close(): Promise<void> {
		if (this.closed) return;
		this.closed = true;
		this.flushRootSyncWaiters();
		this.failAll(new Error("MCP 连接已关闭"));
		try {
			this.child.stdin?.end();
		} catch {
			// already closed
		}
		const pid = this.child.pid;
		await new Promise<void>((resolve) => {
			const timer = setTimeout(() => {
				if (pid) {
					try {
						process.kill(pid, "SIGKILL");
					} catch {
						// already gone
					}
				}
				resolve();
			}, 2_000);
			timer.unref?.();
			this.child.once("exit", () => {
				clearTimeout(timer);
				resolve();
			});
		});
	}

	// ── JSON-RPC ─────────────────────────────────────────────────────────

	private request(method: string, params: unknown, options: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<unknown> {
		if (this.closed) return Promise.reject(new Error("MCP 连接已关闭"));
		const id = this.nextId++;
		const payload = `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`;
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`MCP 请求超时（${method}）`));
			}, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
			timer.unref?.();
			this.pending.set(id, { resolve, reject, timer });

			if (options.signal) {
				const abort = () => {
					const entry = this.pending.get(id);
					if (!entry) return;
					this.pending.delete(id);
					clearTimeout(entry.timer);
					reject(new Error("aborted"));
				};
				if (options.signal.aborted) {
					abort();
					return;
				}
				options.signal.addEventListener("abort", abort, { once: true });
			}

			try {
				this.child.stdin?.write(payload);
			} catch (error) {
				const entry = this.pending.get(id);
				this.pending.delete(id);
				if (entry) clearTimeout(entry.timer);
				reject(new Error(`MCP 写入失败：${message(error)}`));
			}
		});
	}

	private notify(method: string, params: unknown): void {
		if (this.closed) return;
		try {
			this.child.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
		} catch {
			// A dead child fails the next request anyway.
		}
	}

	private onData(chunk: string): void {
		this.buffer += chunk;
		let index = this.buffer.indexOf("\n");
		while (index >= 0) {
			const line = this.buffer.slice(0, index).trim();
			this.buffer = this.buffer.slice(index + 1);
			if (line) this.onMessage(line);
			index = this.buffer.indexOf("\n");
		}
	}

	private onMessage(line: string): void {
		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch {
			return; // Not a JSON-RPC frame; ignore.
		}
		if (typeof parsed !== "object" || parsed === null) return;
		const record = parsed as Record<string, unknown>;

		// Server-initiated request or notification: handle before response lookup,
		// because server requests also carry numeric JSON-RPC ids.
		if (typeof record.method === "string") {
			if (record.id !== undefined) {
				const result = record.method === "roots/list" ? { roots: this.rootsProvider?.() ?? [] } : {};
				const reply = { jsonrpc: "2.0", id: record.id, result };
				try {
					this.child.stdin?.write(`${JSON.stringify(reply)}\n`);
				} catch {
					// ignore
				}
				if (record.method === "roots/list") this.flushRootSyncWaiters();
			}
			return;
		}

		if (typeof record.id === "number") {
			const entry = this.pending.get(record.id);
			if (!entry) return;
			this.pending.delete(record.id);
			clearTimeout(entry.timer);
			if (record.error !== undefined) {
				const error = record.error as { message?: string; code?: number };
				entry.reject(new Error(error?.message || `MCP 错误 ${error?.code ?? ""}`.trim()));
			} else {
				entry.resolve(record.result);
			}
		}
	}

	private flushRootSyncWaiters(): void {
		const waiters = this.rootSyncWaiters;
		this.rootSyncWaiters = [];
		for (const finish of waiters) finish();
	}

	private onExit(): void {
		if (this.closed) return;
		this.closed = true;
		this.flushRootSyncWaiters();
		this.failAll(new Error("chrome-devtools-mcp 已退出"));
	}

	private failAll(error: Error): void {
		for (const [id, entry] of this.pending) {
			this.pending.delete(id);
			clearTimeout(entry.timer);
			entry.reject(error);
		}
	}
}

/** chrome-devtools-mcp's entry script, resolved from this package. */
export function serverBin(): string {
	return resolveServerBin(createRequire(import.meta.url));
}
