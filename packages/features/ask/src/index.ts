/**
 * Ask mode, host-agnostic half.
 *
 * `policy` decides which tools may run while Ask mode is on; `prompt` is the
 * system-prompt section that tells the model what the mode means and the
 * reason handed back when a forbidden tool is called. The hosts own the
 * session state, the tool-set switching and the commands.
 */

export * from "./policy.ts";
export * from "./prompt.ts";
