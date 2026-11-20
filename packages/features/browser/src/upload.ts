/**
 * Workspace-scoped authorization for `browser_upload`.
 *
 * chrome-devtools-mcp validates local `upload_file` paths against the union of
 * all MCP roots ever registered on the shared server plus `os.tmpdir()`, and
 * skips path validation entirely when Chrome is treated as remote. Enforcing
 * per-workspace containment and explicit remote opt-in here keeps the tool's
 * stated boundary ("inside the current project") true in every host.
 */

import { realpath, stat } from "node:fs/promises";
import { resolve, sep } from "node:path";
import type { ConnectPlan } from "./args.ts";

const ALLOWED_PROTOCOLS = new Set(["http:", "https:", "ws:", "wss:"]);
const IPV4_LOOPBACK = /^127(?:\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)){3}$/;
const IPV4_MAPPED_LOOPBACK = /^\[::ffff:7f[0-9a-f]{2}:[0-9a-f]{1,4}\]$/;
const UNSPECIFIED_HOSTS = new Set(["0.0.0.0", "[::]", "[::ffff:0:0]"]);
/** Matches URL schemes (2+ chars before `:`) without tripping Windows drive letters (`C:\...`). */
const URL_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]+:/;

export interface UploadAuthOptions {
	filePaths: readonly string[];
	/** Calling session's workspace directory. Required for local Chrome connections. */
	workspaceDir: string | undefined;
	/** Whether the active Chrome connection targets a remote (non-local) endpoint. */
	remote: boolean;
	/** Explicit opt-in required before forwarding uploads to a remote Chrome. */
	allowRemoteUpload: boolean;
}

/** True when an HTTP/WebSocket browser endpoint points to the local machine. */
export function isLocalBrowserUrl(url: string): boolean {
	if (!url || !url.trim()) return false;
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return false;
	}
	if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) return false;
	const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
	if (hostname === "localhost" || hostname.endsWith(".localhost")) return true;
	if (hostname === "[::1]" || hostname === "::1") return true;
	if (IPV4_LOOPBACK.test(hostname)) return true;
	if (IPV4_MAPPED_LOOPBACK.test(hostname)) return true;
	return UNSPECIFIED_HOSTS.has(hostname);
}

/** True when a connection plan targets a remote browser endpoint. */
export function isRemoteConnectPlan(plan: ConnectPlan): boolean {
	if (plan.mode === "browserUrl" || plan.mode === "wsEndpoint") {
		return !isLocalBrowserUrl(plan.url);
	}
	return false;
}

function normalizeForComparison(filePath: string): string {
	return process.platform === "win32" ? filePath.toLowerCase() : filePath;
}

function isInsideRoot(canonicalFile: string, canonicalRoot: string): boolean {
	const file = normalizeForComparison(canonicalFile);
	const root = normalizeForComparison(canonicalRoot);
	const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
	return file.startsWith(prefix);
}

function validateRawFilePath(rawPath: string): string {
	const trimmed = rawPath.trim();
	if (!trimmed) throw new Error("filePaths 包含空路径");
	if (trimmed.includes("\0")) throw new Error(`非法文件路径：${rawPath}`);
	if (URL_SCHEME.test(trimmed)) {
		throw new Error(`上传路径必须是文件路径，不能是 URL：${rawPath}`);
	}
	return trimmed;
}

/**
 * Authorize upload paths before calling upstream `upload_file`.
 *
 * - Remote Chrome: denied unless `allowRemoteUpload` is explicitly enabled.
 * - Local Chrome: every path must resolve (after symlink resolution) to an
 *   existing regular file strictly inside `workspaceDir`. Returns the canonical
 *   paths so upstream cannot reinterpret relative segments or symlinks.
 */
export async function authorizeUploadPaths(options: UploadAuthOptions): Promise<string[]> {
	if (options.filePaths.length === 0) throw new Error("filePaths 不能为空");

	const validated = options.filePaths.map(validateRawFilePath);

	if (options.remote) {
		if (!options.allowRemoteUpload) {
			throw new Error(
				"当前连接的是远程 Chrome，默认禁止 browser_upload（上游会跳过工作区路径校验）；如确认允许上传远程主机上的文件，请在配置中开启 browser.allowRemoteUpload",
			);
		}
		return validated;
	}

	const workspaceDir = options.workspaceDir?.trim();
	if (!workspaceDir) {
		throw new Error("无法确定当前工作区目录，已拒绝 browser_upload");
	}

	let canonicalRoot: string;
	try {
		canonicalRoot = await realpath(resolve(workspaceDir));
	} catch {
		throw new Error(`无法解析当前工作区目录：${workspaceDir}`);
	}

	const authorized: string[] = [];
	for (const rawPath of validated) {
		const candidate = resolve(canonicalRoot, rawPath);
		let canonicalFile: string;
		try {
			canonicalFile = await realpath(candidate);
		} catch {
			throw new Error(`无法访问要上传的文件：${rawPath}`);
		}
		if (!isInsideRoot(canonicalFile, canonicalRoot)) {
			throw new Error(`拒绝上传当前项目目录之外的文件：${rawPath}（仅允许当前工作区 ${canonicalRoot} 内的文件）`);
		}
		const info = await stat(canonicalFile);
		if (!info.isFile()) {
			throw new Error(`只能上传普通文件：${rawPath}`);
		}
		authorized.push(canonicalFile);
	}
	return authorized;
}
