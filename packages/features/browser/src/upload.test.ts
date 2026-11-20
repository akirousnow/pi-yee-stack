import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { authorizeUploadPaths, isLocalBrowserUrl, isRemoteConnectPlan } from "./upload.ts";

// ── local vs remote endpoint classification ──────────────────────────────
assert.equal(isLocalBrowserUrl("http://127.0.0.1:9222"), true);
assert.equal(isLocalBrowserUrl("http://localhost:9222"), true);
assert.equal(isLocalBrowserUrl("ws://sub.localhost:9222/devtools/browser/1"), true);
assert.equal(isLocalBrowserUrl("ws://[::1]:9222/devtools/browser/1"), true);
assert.equal(isLocalBrowserUrl("http://0.0.0.0:9222"), true);
assert.equal(isLocalBrowserUrl("http://192.168.1.20:9222"), false);
assert.equal(isLocalBrowserUrl("wss://chrome.example.com/devtools/browser/1"), false);
assert.equal(isLocalBrowserUrl("ftp://127.0.0.1:9222"), false);
assert.equal(isLocalBrowserUrl("not-a-url"), false);

assert.equal(isRemoteConnectPlan({ mode: "launch" }), false);
assert.equal(isRemoteConnectPlan({ mode: "autoConnect", channel: "stable" }), false);
assert.equal(isRemoteConnectPlan({ mode: "browserUrl", url: "http://127.0.0.1:9222" }), false);
assert.equal(isRemoteConnectPlan({ mode: "browserUrl", url: "http://10.0.0.5:9222" }), true);
assert.equal(isRemoteConnectPlan({ mode: "wsEndpoint", url: "ws://10.0.0.5:9222/devtools/browser/1" }), true);
assert.equal(isRemoteConnectPlan({ mode: "none", reason: "none" }), false);

// ── local workspace authorization ────────────────────────────────────────
const base = mkdtempSync(join(tmpdir(), "yee-upload-auth-"));
const workspaceA = join(base, "proj");
const workspaceSibling = join(base, "proj-secret");
const tempOutside = join(base, "outside-tmp");
mkdirSync(join(workspaceA, "nested"), { recursive: true });
mkdirSync(workspaceSibling, { recursive: true });
mkdirSync(tempOutside, { recursive: true });

const insideFile = join(workspaceA, "nested", "avatar.png");
const siblingFile = join(workspaceSibling, "token.txt");
const outsideFile = join(tempOutside, "leak.txt");
writeFileSync(insideFile, "png");
writeFileSync(siblingFile, "secret");
writeFileSync(outsideFile, "tmp");

const insideLink = join(workspaceA, "ok-link.png");
const escapeLink = join(workspaceA, "escape-link.txt");
symlinkSync(insideFile, insideLink);
symlinkSync(outsideFile, escapeLink);

try {
	const canonicalInside = realpathSync(insideFile);

	// Absolute and relative paths inside the workspace are allowed and canonicalized.
	assert.deepEqual(
		await authorizeUploadPaths({
			filePaths: [insideFile, "nested/avatar.png", insideLink],
			workspaceDir: workspaceA,
			remote: false,
			allowRemoteUpload: false,
		}),
		[canonicalInside, canonicalInside, canonicalInside],
	);

	// Sibling prefix directory (/proj-secret vs /proj) must be denied.
	await assert.rejects(
		() =>
			authorizeUploadPaths({
				filePaths: [siblingFile],
				workspaceDir: workspaceA,
				remote: false,
				allowRemoteUpload: false,
			}),
		/当前项目目录之外/,
	);

	// Files in os.tmpdir() outside the calling workspace must be denied.
	await assert.rejects(
		() =>
			authorizeUploadPaths({
				filePaths: [outsideFile],
				workspaceDir: workspaceA,
				remote: false,
				allowRemoteUpload: false,
			}),
		/当前项目目录之外/,
	);

	// Path traversal out of workspace must be denied.
	await assert.rejects(
		() =>
			authorizeUploadPaths({
				filePaths: [join(workspaceA, "..", "outside-tmp", "leak.txt")],
				workspaceDir: workspaceA,
				remote: false,
				allowRemoteUpload: false,
			}),
		/当前项目目录之外/,
	);

	// Symlink inside workspace pointing outside must be denied.
	await assert.rejects(
		() =>
			authorizeUploadPaths({
				filePaths: [escapeLink],
				workspaceDir: workspaceA,
				remote: false,
				allowRemoteUpload: false,
			}),
		/当前项目目录之外/,
	);

	// Directories and URLs are rejected.
	await assert.rejects(
		() =>
			authorizeUploadPaths({
				filePaths: [join(workspaceA, "nested")],
				workspaceDir: workspaceA,
				remote: false,
				allowRemoteUpload: false,
			}),
		/普通文件/,
	);
	await assert.rejects(
		() =>
			authorizeUploadPaths({
				filePaths: ["file:///etc/passwd"],
				workspaceDir: workspaceA,
				remote: false,
				allowRemoteUpload: false,
			}),
		/不能是 URL/,
	);
	await assert.rejects(
		() =>
			authorizeUploadPaths({
				filePaths: ["http://x/../../etc/passwd"],
				workspaceDir: workspaceA,
				remote: false,
				allowRemoteUpload: false,
			}),
		/不能是 URL/,
	);

	// Missing workspaceDir fails closed for local connections.
	await assert.rejects(
		() =>
			authorizeUploadPaths({
				filePaths: [insideFile],
				workspaceDir: undefined,
				remote: false,
				allowRemoteUpload: false,
			}),
		/无法确定当前工作区目录/,
	);

	// ── remote Chrome requires explicit opt-in ───────────────────────────
	await assert.rejects(
		() =>
			authorizeUploadPaths({
				filePaths: ["/remote/host/file.pdf"],
				workspaceDir: workspaceA,
				remote: true,
				allowRemoteUpload: false,
			}),
		/allowRemoteUpload/,
	);

	assert.deepEqual(
		await authorizeUploadPaths({
			filePaths: ["/remote/host/file.pdf", "C:\\Users\\alice\\doc.pdf"],
			workspaceDir: undefined,
			remote: true,
			allowRemoteUpload: true,
		}),
		["/remote/host/file.pdf", "C:\\Users\\alice\\doc.pdf"],
	);

	console.log("yee-stack browser upload auth tests passed");
} finally {
	rmSync(base, { recursive: true, force: true });
}
