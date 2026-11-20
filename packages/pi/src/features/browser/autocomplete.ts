/**
 * `$` completion in the Pi editor.
 *
 * Typing `$` after a boundary (start of line, whitespace, CJK punctuation)
 * lists the connected tabs and inserts `$t3 `. Anything else — `$HOME`,
 * `$5`, `$` with no browser — is left to Pi's own completion.
 */

import type { AutocompleteItem, AutocompleteProvider, AutocompleteSuggestions } from "@earendil-works/pi-tui";
import { fuzzyFilter } from "@earendil-works/pi-tui";
import { tabRef, type PageInfo } from "@yee-stack/browser";

export interface TabAutocompleteOptions {
	pages(): readonly PageInfo[];
	listening(): boolean;
}

/** `$` followed by a partial query at a token boundary. */
const TRIGGER = /(?:^|[\s([{<`"'，。：；！？（）【】「」])?\$([^\s$]*)$/u;

function triggerIndex(textBeforeCursor: string): { start: number; query: string } | undefined {
	const match = TRIGGER.exec(textBeforeCursor);
	if (!match) return undefined;
	const token = `$${match[1] ?? ""}`;
	return { start: textBeforeCursor.length - token.length, query: match[1] ?? "" };
}

function toItem(page: PageInfo): AutocompleteItem {
	const title = page.title.trim() || page.url.trim() || "(无标题)";
	const url = page.url.trim();
	return {
		// The value inserted into the editor stays $t3; the list shows the title.
		value: tabRef(page.id),
		label: title,
		description: `${tabRef(page.id)}${url && url !== title ? ` · ${url}` : ""}`,
	};
}

export function createTabAutocompleteProvider(
	current: AutocompleteProvider,
	options: TabAutocompleteOptions,
): AutocompleteProvider {
	return {
		triggerCharacters: ["$"],
		async getSuggestions(lines, cursorLine, cursorCol, request): Promise<AutocompleteSuggestions | null> {
			if (!options.listening()) return current.getSuggestions(lines, cursorLine, cursorCol, request);
			const line = lines[cursorLine] ?? "";
			const before = line.slice(0, cursorCol);
			const trigger = triggerIndex(before);
			if (!trigger) return current.getSuggestions(lines, cursorLine, cursorCol, request);
			// `$1`, `$5` and friends are shell/template syntax, not tab names.
			if (/^\d+$/.test(trigger.query)) return current.getSuggestions(lines, cursorLine, cursorCol, request);

			const pages = options.pages();
			if (pages.length === 0) return current.getSuggestions(lines, cursorLine, cursorCol, request);

			const items = (
				trigger.query
					? fuzzyFilter([...pages], trigger.query, (page) => `${tabRef(page.id)} ${page.title} ${page.url}`)
					: [...pages]
			).map(toItem);
			if (items.length === 0) return current.getSuggestions(lines, cursorLine, cursorCol, request);

			return { items, prefix: `$${trigger.query}` };
		},
		applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
			const line = lines[cursorLine] ?? "";
			const trigger = triggerIndex(line.slice(0, cursorCol));
			// Slash commands, files and everything else belong to the provider
			// we wrap. Only a $tN suggestion from our own getSuggestions is ours;
			// inserting it blindly would turn `/brow` into `/browbrowser`.
			if (!trigger || !prefix.startsWith("$") || !item.value.startsWith("$t")) {
				return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
			}
			const next = [...lines];
			next[cursorLine] = `${line.slice(0, trigger.start)}${item.value} ${line.slice(cursorCol)}`;
			return {
				lines: next,
				cursorLine,
				cursorCol: trigger.start + item.value.length + 1,
			};
		},
		shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
			return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
		},
	};
}
