/**
 * Text Ask mode adds to the model's context.
 *
 * The instructions go into a dedicated system-prompt section. Pi diffs
 * sections between runs and patches only what changed, so switching the mode
 * costs one small system message instead of a rebuilt prompt, and leaving the
 * mode removes the section again.
 */

/** Section name (becomes the `<yee-ask>` tag). Must match /^[a-z][a-z0-9_-]*$/. */
export const ASK_SECTION_NAME = "yee-ask";

export const ASK_SECTION_TEXT = `Ask mode is ON. The user wants answers, not changes. This overrides any general instruction above to implement, edit or run things.
- Answer the question directly and accurately, and lead with the answer.
- Use the read-only tools you were given (reading, searching and listing files, plus any other read-only tool) to look things up. Check the code instead of guessing, and name the files and lines you relied on.
- You cannot modify files, run shell commands, or change anything on the user's machine in this mode, and you must never claim that you did. If the question implies a change, describe what you would change and why (showing code in your reply is fine), then tell the user they can leave ask mode with /ask to have it applied.
- If you cannot find the answer, say so plainly instead of inventing one.
- Reply in the user's language.`;

/** Reason returned to the model when it calls a tool Ask mode does not allow. */
export function askBlockedReason(toolName: string): string {
	return `Ask mode is on: "${toolName}" is not a read-only tool, so it is unavailable. Answer from what you can read, or tell the user to leave ask mode with /ask if the task needs it.`;
}
