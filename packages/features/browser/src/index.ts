/**
 * Browser control, host-agnostic half.
 *
 *  - `refs`     — `$t3` tab references
 *  - `tabs`     — `list_pages` parsing (structured and text) and tab formatting
 *  - `snapshot` — turning full accessibility snapshots into per-page diffs
 *  - `args`     — turning browser settings into a chrome-devtools-mcp command
 *
 * The MCP client, the tools and the commands belong to the hosts.
 */

export * from "./refs.ts";
export * from "./prompt.ts";
export * from "./tabs.ts";
export * from "./snapshot.ts";
export * from "./args.ts";
export * from "./upload.ts";
