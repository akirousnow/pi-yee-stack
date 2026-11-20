/**
 * Snapshot diffs.
 *
 * chrome-devtools-mcp's accessibility snapshot gives every element a stable
 * `uid` (for example `uid=1_2 textbox "用户名"`). uids survive clicks and
 * fills, and elements that appear later get a new generation prefix. So after
 * an action that returns `includeSnapshot`, only the new or changed lines are
 * worth sending to the model; sending the whole page again burns context.
 *
 * Pure data handling, unit-tested without a browser.
 */

export interface SnapshotElement {
	role: string;
	name: string;
	line: string;
}

export interface SnapshotDiff {
	/** The caller should use the full snapshot instead of the diff. */
	full: boolean;
	/** New elements, as their original snapshot lines. */
	added: string[];
	/** Elements whose role, name or state attributes changed. */
	changed: string[];
	/** Elements that disappeared. */
	removed: number;
	/** Elements in the latest snapshot. */
	total: number;
	/** The page URL when the snapshot is the root accessibility node. */
	url?: string;
	/** The URL changed since the previous snapshot of this page. */
	urlChanged: boolean;
}

interface PageSnapshot {
	url?: string;
	elements: Map<string, SnapshotElement>;
}

const MAX_DIFF_LINES = 40;
const MAX_CHANGED_LINES = 20;

/** Parse the text snapshot into elements keyed by uid. */
export function parseSnapshotText(text: string): { elements: Map<string, SnapshotElement>; url?: string } {
	const elements = new Map<string, SnapshotElement>();
	let url: string | undefined;

	for (const rawLine of text.split(/\r?\n/)) {
		const line = rawLine.trim();
		const match = /uid=(\S+)(?:\s+([A-Za-z][\w-]*))?(?:\s+"((?:[^"\\]|\\.)*)")?/.exec(line);
		if (!match) continue;
		const uid = match[1]!;
		const role = match[2] ?? "";
		const name = (match[3] ?? "").replace(/\\(.)/g, "$1");
		elements.set(uid, { role, name, line });
		if (url === undefined && role === "RootWebArea") {
			const urlMatch = /url="((?:[^"\\]|\\.)*)"/.exec(line);
			if (urlMatch) url = urlMatch[1]!.replace(/\\(.)/g, "$1");
		}
	}
	return { elements, url };
}

/** Per-page snapshot cache used to turn full snapshots into diffs. */
export class SnapshotCache {
	private readonly pages = new Map<number, PageSnapshot>();

	/**
	 * Remember a snapshot and describe what changed since the previous one.
	 * `forceFull` is for `browser_snapshot`, whose full text the model asked for.
	 */
	update(pageId: number, text: string, options: { forceFull?: boolean } = {}): SnapshotDiff {
		const parsed = parseSnapshotText(text);
		const previous = this.pages.get(pageId);
		const previousUrl = previous?.url;

		const added: string[] = [];
		const changed: string[] = [];
		let removed = 0;

		for (const [uid, element] of parsed.elements) {
			const before = previous?.elements.get(uid);
			if (!before) {
				added.push(element.line);
				continue;
			}
			if (before.line !== element.line) changed.push(element.line);
		}
		if (previous) {
			for (const uid of previous.elements.keys()) {
				if (!parsed.elements.has(uid)) removed++;
			}
		}

		const total = parsed.elements.size;
		const urlChanged = previousUrl !== undefined && parsed.url !== undefined && previousUrl !== parsed.url;
		const firstSnapshot = previous === undefined;
		// After a navigation almost everything is new; a diff would be noise.
		const mostlyNew = total > 0 && added.length / total > 0.5;

		this.pages.set(pageId, { url: parsed.url, elements: parsed.elements });

		return {
			full: options.forceFull === true || firstSnapshot || mostlyNew || urlChanged,
			added: added.slice(0, MAX_DIFF_LINES),
			changed: changed.slice(0, MAX_CHANGED_LINES),
			removed,
			total,
			url: parsed.url,
			urlChanged,
		};
	}

	/** The element behind a uid, for labels in tool output. */
	element(pageId: number, uid: string): SnapshotElement | undefined {
		return this.pages.get(pageId)?.elements.get(uid);
	}

	clear(pageId?: number): void {
		if (pageId === undefined) this.pages.clear();
		else this.pages.delete(pageId);
	}
}

/** Human-readable diff for a tool result. Empty when nothing changed. */
export function formatSnapshotDiff(diff: SnapshotDiff, pageId: number): string {
	const lines: string[] = [];
	if (diff.urlChanged && diff.url) lines.push(`URL → ${diff.url}`);
	for (const line of diff.added) lines.push(`+ ${line}`);
	for (const line of diff.changed) lines.push(`~ ${line}`);
	if (diff.removed > 0) lines.push(`- ${diff.removed} 个元素消失`);
	if (lines.length === 0) return "（页面没有可见变化）";
	const summary = `$t${pageId} · ${diff.total} 个元素`;
	return `${summary}\n${lines.join("\n")}`;
}
