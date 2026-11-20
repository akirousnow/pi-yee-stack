# dsh plugin API digest (verified against the installed tree)

Third-party bundle scope: (a) slash command running a one-shot completion, (b) per-session
read-only mode (tool restriction + guard + prompt section + durable state), (c) MCP client for
chrome-devtools-mcp, (d) config schema + settings hooks.

**Citations.** Paths are relative to the dsh package root
/root/.nvm/versions/node/v24.22.3/lib/node_modules/@deepseek-ai/dsh/; package sources are
abbreviated, so dsh-tools/src/index.ts means
node_modules/@deepseek-ai/dsh-tools/src/index.ts. Installed version 0.2.2-rc.5
(dsh-base/package.json). UNVERIFIED marks anything no shipped .d.ts / src/*.ts confirms here.

## 1. Plugin shape, bundle patch, inject, Service

**Module forms** (docs/user/develop/basic/index.md; docs/cordis-api/registry.md:62-100):
function (shown), object export default {name, inject, apply}, or class extending Service.
Plugin.Base fields (registry.md:72-83): name?, Config? (Standard-Schema validator), inject?,
provide?, intercept?.

    import type { Context } from '@deepseek-ai/cordis'
    export const name = 'my-plugin'            // diagnostic name only
    export const inject = ['tools', 'llm']     // required services; the plugin waits for them
    export function apply(ctx: Context, config: Config) { /* registrations */ }

**ctx.inject(deps, cb)** (docs/cordis-api/registry.md:8-33):

    inject(deps: Inject, callback: Plugin.Function<void>): Fiber & PromiseLike<Fiber>

Shorthand for ctx.plugin({inject, apply}); the callback is unloaded and re-run whenever a
required service changes. This is how an optional capability (commands, userQuestions,
mcpManager) is mounted without becoming a hard dependency - dsh-agent/src/index.ts:261,
dsh-plan-mode/src/index.ts:232.

**Service + static inject + [Service.init]**. Service.init is the symbol key of an instance
method run after construction (docs/cordis-api/service.md:27-36); it runs after the
constructor, before dependents activate, and may be async or a generator of disposers
(precedents: dsh-agent/src/index.ts:291-293; generator form at dsh-mcp-manager/src/index.ts:231).

    export class ReadOnlyMode extends Service {
      static inject = ['tools', 'systemPrompt', 'sessionProjections', 'agents']
      static Config = z.object({ /* schemastery; validated by the loader */ })
      constructor(ctx: Context, config: Config) { super(ctx, 'readOnlyMode'); /* sync only */ }
      protected async [Service.init](): Promise<void> { /* awaits registrations */ }
    }
    export default ReadOnlyMode

**Bundle manifest** (docs/user/develop/basic/publish.md:36-66). patch also accepts an ordered
list, applied as one layer with each file's relative plugin paths resolving beside that file;
without dsh.bundle the package installs as a plain dependency and activates no layer. Declare
dsh packages shared with the host under both peer- and devDependencies (publish.md:105).

    { "name": "dsh-hello-plugin", "type": "module", "main": "index.js",
      "files": ["index.js", "cordis.patch.yml"],
      "engines": { "dsh": ">=0.2.0 <0.3.0" },
      "dsh": { "bundle": { "patch": "./cordis.patch.yml" } } }

**Row shape** (real file: dsh-base/cordis.patch.yml:19-56; rules publish.md:56-62,120-136):

    - insert:
        - id: hello                       # stable row id; later layers override by id
          name: dsh-hello-plugin          # package name, or '/abs/path/plugin.ts' for --patch
          disabled: !!js "!ctx.get('profileContext')"    # optional
          config:                         # optional; replaces the WHOLE row config, never merges
            greeting: Hi

Layer order (publish.md:122-128): bundle patches in dsh.profile.bundles order, then the
profile's cordis.patch.yml, then $DSH_HOME/cordis.patch.yml, then each --patch in argv order.

## 2. Commands

Service key commands, class CommandRuntime (dsh-commands/src/index.ts:263-278; the Context
merge declares ctx.commands). Inject 'commands'.

    register(definition: CommandDefinition): () => void        // :61-78,285-292

    interface CommandDefinition {
      readonly definitionId?: CommandDefinitionId   // brandString<CommandDefinitionId>('@scope/pkg')
      readonly name: string                          // /^[a-z][a-z0-9_-]*$/u, no leading slash
      readonly description: string                   // non-empty
      readonly input?: CommandInputDescriptor        // { hint: string; attachments?: boolean }
      readonly recordInput?: boolean                 // default true
      readonly handler: (invocation: CommandInvocation) => CommandResult | Promise<CommandResult>
    }

    interface CommandInvocation {                    // :41-58
      readonly commandId: CommandId      // already written to this invocation's command/run
      readonly agent: Agent              // exact receiving agent
      readonly rawInput: string          // text after the name, separator whitespace included
      readonly attachments: readonly (ImageBlock | FileBlock)[]
      readonly signal: AbortSignal       // dispatching UI request's cancellation
    }

**CommandResult is the complete union - exactly two kinds** (dsh-commands/src/types.ts:34-41):

    type CommandResult =
      | { readonly kind: 'success'; readonly text?: string; readonly sourceEventSeq?: SessionSeq }
      | { readonly kind: 'error'; readonly text: string }     // text must be non-empty

Return one of these. success with no text renders only the card; error renders as a failed
command. Throwing also settles as kind: 'error' with the rendered failure (:426-429); any other
shape throws at the registry boundary (:228-256). Lifecycle logs command/run + command/done
(log-only, paired by commandId) - augment SessionEventMap to fold them (types.ts:93-118).

**Reaching the agent** (dsh-agent/src/runtime-types.ts:245-271):

    send(message: UserMessage, target: InboxTarget, wakeup: boolean): void
    followup(message: UserMessage): void   // its own turn; wakes the driver
    steer(message: UserMessage): void      // consumed at the next step boundary; wakes an idle driver
    inject(message: UserMessage): void     // next pre-step context; does NOT wake

InboxTarget = 'next-turn' | 'next-step'. source.kind is merge-extensible
(dsh-llm/src/message.ts:110-115); declaring your own kind is what
dsh-plan-mode/src/index.ts:39-43 does.

    import { createUserMessage } from '@deepseek-ai/dsh-llm'
    invocation.agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'Result:\n' + answer }],
      source: { kind: 'user' },
    }))

## 3. Tools

Service key tools, class ToolsService (dsh-tools/src/index.ts:99-105; static inject
['systemPrompt']).

    register(definition: ToolDefinition, options: ToolRegistrationOptions = {}): () => void   // :110-152

Rejects a missing output ({schema, render, presentationMeta?}), unsupported JSON Schema, a
non-positive timeoutMs, and the reserved name run_code. A scoped registration (through
agent.ctx) shadows a global of the same name; a duplicate inside one layer throws.

    interface ToolRegistrationOptions {
      readonly when?: (context: ToolActivationContext) => boolean | Promise<boolean>
    }
    interface ToolActivationContext {
      readonly agent: Agent
      readonly modelSelection: Readonly<ModelSelection>
      readonly signal: AbortSignal
    }

{ when } decides step admission: false removes the tool from the declaration list and from
dispatch; a rejected condition fails step preparation (ToolActivationError,
dsh-tools/src/contracts.ts:106-150). Precedent: dsh-plan-mode/src/index.ts:375.

**defineTool** (dsh-tools/src/schema.ts:484-633):

    export function defineTool<const S extends ParameterSchemaSpec, const O extends ValueSchemaSpec>(
      options: DefineToolOptions<S, O>): ToolDefinition

    interface DefineToolOptions<S, O> {
      readonly name: string
      readonly description: string
      readonly parameters: S                 // implicit open object root; per-property required: true
      readonly output: {
        readonly schema: O
        render(args: InferArgs<S>, value: InferValue<NoInfer<O>>): ContentBlock[]
        presentationMeta?(args, value): JsonValue
      }
      readonly deferLoading?: true
      readonly timeoutMs?: number
      isConcurrencySafe?(args: InferArgs<S>): boolean
      execute(args: InferArgs<S>, exec: ToolRunContext): Promise<InferValue<NoInfer<O>>>
      projectContent?(exec, result): ContentBlock[] | undefined
      finalizeContent?(exec, result): ContentBlock[] | undefined
      presentCall?(args): ToolCallView | undefined
      presentResult?(args, result: ToolResult): ToolResultView | undefined
    }

Parameter DSL (schema.ts:25-107): string|number|integer|boolean|null (+enum, +const); array
(+items); object (**additionalProperties mandatory**, +properties); json; oneOf (>=2 branches).
Annotations description|title|default|examples. Nested object form:
{ type: 'object', additionalProperties: false, properties: { ... } }.

exec is ToolRunContext = ToolExecution + two methods (contracts.ts:245-262):

    interface ToolRunContext extends ToolExecution {
      deferContext(context: UserMessage): void   // appended after this tool/result
      concludeTurn(): void                       // mark success terminal for the turn
    }

ToolExecution fields (contracts.ts:175-203,220-225): callId, rootCallId, name, schema?,
arguments (frozen parsed JSON), agent?, toolSet?, parent? (opaque token), signal, token.
exec.signal must be observed or forwarded; the executor never abandons your promise.

**restrict** (dsh-tools/src/index.ts:154-190):

    restrict(filter: ToolRestriction): () => void
    interface ToolRestriction { readonly allow?: readonly string[]; readonly deny?: readonly string[] }

All enforced: requires a **scoped** context (agent.ctx or a preset ctx) - a context-global call
throws (:165); an empty filter throws; naming run_code throws; unknown names throw with the
known list. Restrictions **intersect** along the scope chain, the viewing scope's own
registrations stay visible, and the nearest registration shadows farther ones (:196-230).
Per-agent wiring to copy - dsh-subagent/src/child-agent.ts:205-219:

    childCtx.tools.restrict(composition.toolFilter)      // inside the agent's scoped ctx

Call it from the serial agent/created event ({agent, source, signal}) on the agent's own
context, or from the creation-time setup(agentCtx, agent) callback
(dsh-agent/src/index.ts:54-57,120).

**guard** (dsh-tools/src/index.ts:376-410):

    guard(guard: ToolGuard): () => void
    type ToolGuard = (execution: Readonly<ToolExecution>) => string | ToolGuardDenial | undefined
    interface ToolGuardDenial { readonly reason: string; readonly info?: ToolErrorInfo }

Monotonic: runs **after** every pre-execute listener and before the body; a returned reason
denies and no "allow" result exists, so listener order cannot re-permit. checkGuards walks
global guards then the scope chain for exec.agent; first denial wins. Example:
dsh-creation-recommendations/src/index.ts:129-133.

**tools/pre-execute waterfall** (dsh-tools/src/events.ts:18; scope-filtered, so an agent-scoped
listener sees only that agent's calls):

    'tools/pre-execute'(this: Scoped<ToolsService>, exec: ToolExecution,
      next: () => Promise<PreToolDecision>): Promise<PreToolDecision>

    type PreToolDecision =
      | { kind: 'allow' }
      | { kind: 'deny'; reason: string; info?: ToolErrorInfo }
      | { kind: 'cancel' }
      | { kind: 'ask'; reason?: string; displayReason?: { readonly en: string; readonly [locale: string]: string } }

deny materializes reason as the failed call's model-facing content; cancel produces the
canonical cancellation result; ask runs only after an approval service returns allowed-once and
otherwise denies; input rewriting is excluded because arguments are already logged. Siblings:
tools/execute (around-dispatch; may replace signal only), tools/post-execute
(PostToolDecision), tools/result (emit, frozen), tools/change (emit). Deny precedent:
dsh-experimental-auto-review/src/index.ts:696-719.

## 4. System prompt

Service key systemPrompt, class SystemPrompt (dsh-system-prompt/src/index.ts:436-444).

    section(section: PromptSection): () => void
    getSectionOrder(name: PromptSectionOrderName): number
    getContextOrder(name: PromptContextOrderName): number
    context(context: PromptContext): () => void
    tools(provider: (context: AssembleContext) => ToolProviderResult): () => void
    variable(name: string, provider: (context: AssembleContext) => string | undefined): () => void
    assemble(context?: AssembleContext): Promise<PromptAssembly>

    interface PromptSection {
      readonly name: string
      readonly order: number                 // ascending; ties break on name (code-unit order)
      readonly text: string | ((context: AssembleContext) => string)
      readonly interpolate?: boolean         // default true; false keeps literal text
      readonly complete?: boolean            // treat as the WHOLE prompt; >1 active throws
    }

AssembleContext (index.ts:42-50) is merge-extensible, which is how the callback sees the agent:

    interface AssembleContext { scope?: ScopeKey; signal?: AbortSignal }
    // + dsh-agent/src/runtime-types.ts:18-25 -> agent?: Agent; modelSelection?: Readonly<ModelSelection>
    // + dsh-tools/src/index.ts:21-25       -> toolSet?: ResolvedToolSet

So text: ({ agent }) => agent === undefined ? '' : (isReadOnly(agent.session) ? TEXT : '') is the
supported shape (dsh-plan-mode/src/index.ts:197-204); '' contributes nothing, and a scoped
section shadows a global one of the same name.

getSectionOrder constants (index.ts:136-176; not exported as an object, read them through the
method): HARNESS_IDENTITY -1000, DEPLOYMENT_PERSONA_PREFIX 0, PLAN_POLICY 500, TEAM_POLICY 600,
PTC_ONLY 800, FILE_REFERENCE 900, TOOL_BASH 1000, TOOL_READ 1100, TOOL_WRITE 1200, TOOL_EDIT
1300, TOOL_APPLY_PATCH 1350, TOOL_GLOB 1400, TOOL_GREP 1500, TOOL_JOBS 1600, TOOL_PTY 1700,
TOOL_PTY_PANEL 1710, TOOL_WEB_SEARCH 2000, TOOL_WEB_FETCH 2100, TOOL_LSP 2200,
TOOL_SESSION_QUERY 2300, TOOL_GOAL 2400, TOOL_SCHEDULE 2500, TOOL_WORKFLOW 2600, TOOL_RALPH
2700, TOOL_SUBAGENT 2800, TOOL_REPORT 2900, TOOL_COMPUTER_USE 3000, **MCP_SERVERS 3100**,
TOOLS_SDK 5000, DELIVERABLE_FILE_REFERENCES 9000, STRUCTURED_OUTPUT 9900, HARNESS_SOURCE 10000,
WEB_SURFACE 10100, DEPLOYMENT_PERSONA_SUFFIX 10200. Context orders (:178-186):
WORKING_DIRECTORY 100, SANDBOX_POLICY 110, APPROVAL_POLICY 115, SUBAGENT_DELEGATION 120,
HARNESS_SOURCE 200, WEB_SURFACE 210. Prefer context(...) over section(...) for facts that must
refresh per request: contexts are re-resolved by refreshContext() and dropped when optional
runtime context is off unless required: true.

## 5. Sessions, logging, projections

    append(inputs: readonly SessionEventInput[]): readonly SessionEvent[]          // dsh-session/src/index.ts:809
    append<T extends SessionEventType>(type: T, data: SessionEventMap[T],
      ...opts: T extends SurfaceEventType ? [opts: SurfaceIntent<T>] : []): SessionEvent<T>   // :853-871

Log-only types take no surface options; message-producing types (system/message,
developer/message, user/message, assistant/message, tool/result) **require**
{ surfaceOp: 'append' | {op:'replace',startSeq,endSeq}, sourceEventSeqs? }
(dsh-session/src/types.ts:447-491). data must be losslessly JSON (no BigInt, Map, Date,
undefined, -0, NaN, cycles) or the append throws. Returns the committed event with assigned
seq/time plus a snapshot of data.

    declare module '@deepseek-ai/dsh-session/types' {          // types.ts:287-436
      interface SessionEventMap { 'readonly/mode': { active: boolean } }   // log-only, last wins
    }

Copy the shape from dsh-plan-mode/src/index.ts:46-55; log-only types never carry surface
metadata and the compiler rejects it.

**Projections** - service key sessionProjections (dsh-session-projection/src/index.ts:30-34).
stateSchema is **zod**, not schemastery.

    register<K extends keyof SessionProjectionMap, S>(
      definition: Omit<ProjectionDefinition<K, S>, 'wire'> & { wire: NonNullable<ProjectionDefinition<K, S>['wire']> },
    ): Promise<ProjectionHandle<S>>
    register<K extends string, S>(definition: ProjectionDefinition<K, S> & { key: Exclude<K, keyof SessionProjectionMap> })
      : Promise<ProjectionHandle<S>>                                            // host-only unit, :322-336

    interface ProjectionDefinition<K extends string, S> {         // :83-133
      key: K
      stateSchema: ZodType<S>
      init(header: SessionHeader, inheritedEventCount: SessionLogOffset): NoInfer<S>
      apply(state: NoInfer<S>, event: SessionEvent): NoInfer<S>   // same ref when uninterested
      wire?: { viewSchema: ZodType<...>; view(state): ...; summary?: boolean }
      stateVersion: number                                        // bump on any state/semantic change
    }
    interface ProjectionHandle<S> { stateOf(session: Session): S; readerFor(session: Session): () => S; dispose(): Promise<void> }

Every function synchronous; state plain JSON; the drive is eager over every committed
session/event; an unchanged reference means zero downstream work. Register in [Service.init]
and await it before publishing consumers. Read the folded state for an agent's session with
handle.stateOf(agent.session) (dsh-plan-mode/src/index.ts:395-400). The plan unit
(dsh-plan-mode/src/index.ts:135-167) is the shortest complete example.

## 6. LLM one-shot completion

**There is no ctx.llm.complete().** The public call surface is stream(options) and
prepareCall(config, signal?, configure?) (dsh-llm/src/index.ts:975-1033,1185-1187; full method
list :498-1187; grep finds no complete member). The supported one-shot is this recipe, copied
from the shipped auxiliary-call implementation dsh-session-title-llm/src/index.ts:236-291.

    async prepareCall(config: LlmCallConfig,      // { provider, model, reasoningEffort?, temperature?, maxTokens?, stop? }
      signal?: AbortSignal,
      configure?: (controls: Readonly<LlmCallControls>, model: Readonly<LlmResolvedModelInfo>) => LlmCallControls,
    ): Promise<PreparedLlmCall>

    interface PreparedLlmCall {
      readonly config: LlmCallConfig          // deep-frozen; adapter defaults materialized
      stream(options: GenerateOptions): AsyncIterable<StreamChunk>   // dispatchable exactly ONCE
      // + retryPolicy, context?, inputModalities?, systemPromptUpdate?, toolUpdate?, adapterDefaults
    }

    interface GenerateOptions {               // dsh-llm/src/types.ts:564-606
      provider: string; model: string
      reasoningEffort?: ReasoningEffortId
      messages: RequestMessage[]
      system?: string                 // one-shot callers put the system prompt here
      tools?: ToolSchema[]; toolHistory?: ToolHistory
      temperature?: number; maxTokens?: number; stop?: string[]
      signal?: AbortSignal
      sessionId?: Branded<'SessionId'>
      purpose?: Purpose               // declare via LlmRequestPurposeMap for auxiliary calls
    }

Working one-shot, route taken from the invoking agent:

    async function complete(ctx: Context, agent: Agent, system: string, input: string, signal: AbortSignal): Promise<string> {
      const route = agent.session.requestHeader()?.config        // dsh-session/src/index.ts:1007
        ?? { provider: agent.options.provider!, model: agent.options.model! }
      const call = await ctx.llm.prepareCall({ provider: route.provider, model: route.model, maxTokens: 512 }, signal)
      const options: GenerateOptions = {
        ...call.config,
        messages: [createUserMessage({ content: [{ type: 'text', text: input }], source: { kind: 'user' } })],
        system, sessionId: agent.session.id, signal,
      }
      const assembler = new BlockAssembler()                     // dsh-llm/src/assembler.ts:38
      for await (const chunk of call.stream(options)) assembler.push(chunk)
      const finish = assembler.finish
      if (finish.kind === 'error' || finish.kind === 'aborted') throw new Error(finish.failure.message)
      return assembler.blocks()
        .filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text')
        .map(b => b.text).join('')
    }

BlockAssembler: push(chunk), blocks(), interruptedBlocks(), get usage(), get finish(),
get replayState(), message(source) (assembler.ts:38-205). FinishReason kinds: stop |
tool-calls | max-tokens | aborted | error (types.ts:163-169). Message helpers
(dsh-llm/src/message.ts:212-306): createMessage, createUserMessage, createAssistantMessage,
createSystemMessage, createToolResultMessage, freezeMessage. ctx.llm is the service key
(index.ts:58-61); inject 'llm'. Declare a purpose with
declare module '@deepseek-ai/dsh-llm/types' { interface LlmRequestPurposeMap { 'my-cmd': true } }
(dsh-session-title-llm/src/index.ts:9-13). ctx.llm.stream() works too but leaves route, retry,
and validation to you. The no-extra-request alternative is agent.inject()/followup() and let
the loop call the model (section 2) - that produces a turn, not a private one-shot.

## 7. MCP (chrome-devtools-mcp)

Two shipped layers: dsh-mcp-client (one instance = one server) and dsh-mcp-manager (the
ctx.mcpManager fleet). The client performs the tool registration itself.

**Via the manager** (dsh-mcp-manager/src/index.ts:288-305) - preferred, because the manager
owns lifecycle, reconnect, status, and restart:

    import type {} from '@deepseek-ai/dsh-mcp-manager'
    export const inject = ['mcpManager']
    ctx.mcpManager.register('chrome-devtools', {
      transport: 'stdio', command: 'npx', args: ['-y', 'chrome-devtools-mcp@latest'],
      env: {}, cwd: '', startupTimeoutMs: 30_000,   // + toolCallTimeoutMs?, closeTimeoutMs?, reconnect?
    })                                              // -> () => void disposer, effect-owned

    register(name: string, entry: McpServerRegistration): () => void
    type McpServerRegistration = Omit<EntryInput, 'enabled'>   // enabled is implied while registered

Entry fields (:43-68): transport 'stdio'|'streamable-http', command, args, env, cwd, url,
headers, enabled, toolCallTimeoutMs?, startupTimeoutMs, closeTimeoutMs?, reconnect. Validation
rejects cross-transport fields, a bad name (SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/), and
malformed credential templates at write time (:127-165). Status: the mcp-manager/status(name,
status) parallel event, list(), watch(signal) stream, restart(name), probe(name, options?)
(:313-403). Configured servers instead live in manager config as
config.servers: { '<name>': { transport, command, args, ... } } (:195-197).

**Direct mount** (dsh-mcp-client/src/index.ts:203-263):

    import * as McpClient from '@deepseek-ai/dsh-mcp-client'
    ctx.plugin(McpClient, McpClient.Config({
      transport: 'stdio', serverName: 'chrome-devtools',
      command: 'npx', args: ['-y', 'chrome-devtools-mcp@latest'],
    }))

McpClient.Config is a schemastery union filling every default (toolCallTimeoutMs 60000,
closeTimeoutMs 5000, expandTemplates false, failOnStartupError false, maxInstructionBytes
32768, reconnect defaults). apply blocks activation on connect plus initial tool sync, so tools
exist once the fiber is active. serverName must be unique per registration scope.

**Discovery becomes ctx.tools registrations** (dsh-mcp-client/src/tools.ts:126-188):

    const response = client.getServerCapabilities()?.tools === undefined
      ? { tools: [] }
      : await client.listTools(undefined, { cacheMode: 'refresh', signal: opts.signal })
    for (const tool of response.tools) {
      const publicName = publicToolName(opts.serverName, tool.name)     // mcp__<server>__<raw>
      definitions.set(publicName, createMcpToolDefinition(ctx, { name: publicName, rawName: tool.name, ... }))
    }
    for (const dispose of previous.values()) dispose()                   // phase 2: swap generations
    for (const [publicName, definition] of definitions) disposers.set(publicName, ctx.tools.register(definition))

Public naming: mcp__<serverName>__<rawName>, normalized to [A-Za-z0-9_-]{1,64}; a lossy
normalization appends a 12-hex SHA-256 suffix (:91-97). MCP tools are ordinary ToolDefinitions
(the raw JSON Schema passes through as parameters), so restrict and guards apply to them - that
is how read-only mode excludes mutating MCP tools. Exported for reuse (index.ts:30-37,67-69,
151-156): syncTools, createMcpToolDefinition, publicToolName, probeServer,
connectionStatusOf(fiber), SERVER_NAME_PATTERN, ReconnectSchema, assertTemplateSyntax.
dsh-mcp-resources adds resource/prompt bridging on top.

## 8. Config and settings

A row's config: (section 1) is validated by the exported Config schemastery schema and handed
to apply(ctx, config) or the Service constructor. Export an interface plus the same-named
schema and put defaults on fields (docs/user/develop/basic/config.md:11-30); a plain object is
rejected because the schema must be a Standard-Schema validator.

    import z from '@deepseek-ai/schemastery'
    export interface Config { guidance: string; denyTools: string[]; maxTokens: number }
    export const Config = z.object({
      guidance: z.string().required(),
      denyTools: z.array(String).default([]),
      maxTokens: z.number().step(1).min(1).default(512),
    })

ctx.settings (SettingsForms; static inject ['configEditor','profileContext']) is
**schema-driven**: it enumerates active Loader entries, reads each fiber's runtime.Config,
projects only fields under a volatile() node (dsh-settings/src/schema.ts:37-75), and exposes
describe(), update(ns, patch, expectedRevision?), replace(...), mutate(ns, ops,
expectedRevision?) with SettingsConflictError on a stale revision (dsh-settings/src/index.ts:
223-341). ns is the Loader entry id, i.e. your patch row's id. So the third-party settings hook
is: mark tunables volatile and read them live (docs/cookbook/adding-a-settings-card.md:9-30).

    import type { Volatile } from '@deepseek-ai/cordis'
    export interface Config { guidance: Volatile<string>; denyTools: Volatile<string[]> }
    export const Config = z.object({
      guidance: z.string().default('').volatile(),
      denyTools: z.array(String).default([]).volatile(),
    })
    export function apply(ctx: Context, config: Config) {
      ctx.on('loader/volatile-update', () => { /* re-read config.guidance.get() */ })
    }

role('secret') keeps a value out of form responses. ctx.settings.configure({ auto }, owner?)
registers per-instance page policy (dsh-settings/src/index.ts:266-277); auto: false suppresses
the generated page when you ship a custom one. Wire views and events: SettingsNamespaceView,
SettingsPathOpView, 'settings/document-updated'(ns, revision) (dsh-settings/src/types.ts:22-77).

## 9. Client / UI surface

Yes, but the build format is the hard part. A package joins the browser plugin table by
declaring dsh.client and exporting a built bundle at exports["./client"]
(docs/subsystems/client-modules.md:94; scan dsh-client-modules/src/index.ts:891-918). The exact
declaration schema (dsh-client-modules/src/client/manifest.ts:173-193):

    { "dsh": { "client": { "platform": "web", "inject": ["@deepseek-ai/dsh-client-ui-settings"],
                          "external": [], "immediately": false } } }

platform: string (required; only 'web' becomes a row), inject?: string[] (package-name edges),
external?: string[] (module-table requests), immediately?: boolean (stage-one prefetch).
Precedents: dsh-client-ui-settings/package.json (inject), dsh-client-ui-renderer/package.json
(immediately: true). A declaration without exports["./client"] fails composition loudly
(:906-909). The half attaches to the Loader row whose specifier is the **bare package name**; a
subpath row carries no browser half (docs/cookbook/adding-a-settings-card.md:58).

Browser half shape (dsh-client-ui-commands/src/client/index.ts:52-76):

    export const inject = ['inputTriggers', 'sessions', 'remote', 'remote.commands', 'locale']
    export function apply(ctx: ClientContext): void {
      ctx.inject(['slots', 'commandUi', 'sessions'], (scope) => {
        scope.slots.inject('conversation.input.overlay', () => scope.slots.register({
          name: 'conversation.input.overlay', id: 'my-popup', order: 1, locale: 'myNs',
          inject: (sessionId) => ({ /* props */ }),
        }, MyView))
      })
    }

**UNVERIFIED:** @deepseek-ai/dsh-client-ui-slots is not installed in this tree (no match under
node_modules/@deepseek-ai), so slots.register / SlotMap / slots.inject declarations could not
be read here; the shape above is transcribed from a shipped consumer. Also **UNVERIFIED**: the
clientBundle tsdown preset emitting the required lazy-CJS factory(require) format lives only in
the monorepo (packages/client/tsdown.client.ts, per
docs/cookbook/adding-a-settings-card.md:60), so an out-of-repo package must reproduce that
build itself. Minimum viable route: ship the Host half plus the dsh.client declaration, register
the page into an existing slot, and reproduce the lazy-CJS bundle format; no no-build path is
documented.

## 10. Loading and testing without publishing

* **--patch <file> overlay** - dsh <profile> --patch ./extra.yml, repeatable, applied last
  (src/args.ts:170; docs/user/develop/basic/index.md:38-52). It may name a local TS source by
  absolute path (name: '/abs/path/to/plugin.ts'); relative paths resolve against the profile
  dir, not the patch file, so absolute is the safe form.
* **--dump-config** - composes and prints the tree with one "# == <label>" layer per bundle,
  then the profile patch, home patch, and each --patch, without booting or evaluating !!js
  (src/dump-config.ts:32-75; publish.md:114). Siblings --dump-default-config (bundle layers
  only; refuses --patch) and --dump-config-schema (JSON Schema, no mount); the three are
  mutually exclusive and take no app arguments (src/args.ts:115-136).
* **Install into a profile** - dsh plugin --profile <name> add ./my-plugin forwards to pnpm in
  $DSH_HOME/profiles/<name> and appends the bundle to dsh.profile.bundles when the package
  declares dsh.bundle (publish.md:79-118). For git installs ship a prepare script and tell users
  to allowlist it in the profile's pnpm-workspace.yaml (allowBuilds), or distribute a built
  tarball or npm package (publish.md:161-186).
* **@deepseek-ai/dsh-loader-smoke** - listed in docs/config-catalog.md:5272 as
  packages/test-support/loader-smoke/src/index.ts, i.e. a monorepo test-support package; it is
  **not installed** here, so its API is **UNVERIFIED**. The shipped equivalent is the pair
  above: --dump-config proves layer composition, then a real boot proves activation.
* HMR: a config edit hot-replaces the plugin instance and effects clean up automatically
  (docs/user/develop/basic/config.md:100-104).

## 11. Assembled skeleton (a + b + c + d)

    my-plugin/{package.json, cordis.patch.yml, src/index.ts}

    { "name": "dsh-readonly-mcp", "type": "module", "main": "lib/index.js",
      "exports": { ".": "./lib/index.js", "./cordis.patch.yml": "./cordis.patch.yml" },
      "engines": { "dsh": ">=0.2.2 <0.3.0" },
      "dsh": { "bundle": { "patch": "./cordis.patch.yml" } },
      "peerDependencies": { "@deepseek-ai/cordis": "~4.1.0" } }

    - insert:
        - id: readonly-mcp
          name: dsh-readonly-mcp
          config:
            guidance: 'This session is READ-ONLY: do not attempt writes, installs, or edits.'
            denyTools: ['write', 'edit', 'bash']
            maxTokens: 512

src/index.ts - every call uses a signature verified above:

    import { Context, Service } from '@deepseek-ai/cordis'
    import z from '@deepseek-ai/schemastery'
    import { z as zod } from 'zod'
    import { brandString } from '@deepseek-ai/dsh-brand'
    import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
    import type { Agent } from '@deepseek-ai/dsh-agent'
    import type { Session } from '@deepseek-ai/dsh-session'
    import type { CommandDefinitionId } from '@deepseek-ai/dsh-commands'
    import type { ProjectionDefinition, ProjectionHandle } from '@deepseek-ai/dsh-session-projection'
    import type { PreToolDecision } from '@deepseek-ai/dsh-tools'

    export const name = 'readonly-mcp'
    export const inject = ['tools', 'systemPrompt', 'sessionProjections', 'agents', 'commands', 'llm', 'mcpManager']
    export interface Config { guidance: string; denyTools: string[]; maxTokens: number }
    export const Config = z.object({
      guidance: z.string().default('This session is READ-ONLY.'),
      denyTools: z.array(String).default([]),
      maxTokens: z.number().step(1).min(1).default(512),
    })
    interface ModeState { active: boolean }
    declare module '@deepseek-ai/dsh-session/types' { interface SessionEventMap { 'readonly/mode': { active: boolean } } }
    declare module '@deepseek-ai/dsh-session-projection/types' { interface SessionProjectionMap { readonlyMode: { active: boolean } } }
    const modeProjection: ProjectionDefinition<'readonlyMode', ModeState> = {
      key: 'readonlyMode', stateVersion: 1,
      stateSchema: zod.object({ active: zod.boolean() }).strict(),
      init: () => ({ active: false }),
      apply: (state, event) => event.type === 'readonly/mode' ? { active: event.data.active } : state,
    }

    export default class ReadOnlyMode extends Service {
      static inject = inject
      private handle!: ProjectionHandle<ModeState>
      constructor(ctx: Context, private readonly config: Config) { super(ctx, 'readOnlyMode') }

      protected async [Service.init](): Promise<void> {
        const ctx = this.ctx
        this.handle = await ctx.sessionProjections.register({
          ...modeProjection,
          wire: { viewSchema: zod.object({ active: zod.boolean() }).strict(), view: s => ({ active: s.active }) },
        })
        ctx.systemPrompt.section({
          name: 'readonly:policy',
          order: ctx.systemPrompt.getSectionOrder('PLAN_POLICY'),
          text: ({ agent }) => agent !== undefined && this.isActive(agent.session) ? this.config.guidance : '',
        })
        ctx.on('agent/created', ({ agent }) => { if (this.isActive(agent.session)) this.applyRestriction(agent) })
        ctx.on('tools/pre-execute', async (exec, next): Promise<PreToolDecision> =>
          exec.agent !== undefined && this.isActive(exec.agent.session) && this.config.denyTools.includes(exec.name)
            ? { kind: 'deny', reason: 'read-only mode: "' + exec.name + '" is disabled in this session' }
            : next())
        ctx.tools.guard(exec => exec.agent !== undefined && this.isActive(exec.agent.session)
          && this.config.denyTools.includes(exec.name) ? 'read-only mode: "' + exec.name + '" is disabled' : undefined)
        ctx.inject(['commands'], commandCtx => commandCtx.commands.register({
          definitionId: brandString<CommandDefinitionId>('dsh-readonly-mcp'),
          name: 'readonly',
          description: 'Enter or leave read-only mode, or run a one-shot summary',
          input: { hint: '[on|off|summarize <text>]' },
          handler: async ({ agent, rawInput, signal }) => {
            const input = rawInput.trim()
            if (input === 'on' || input === 'off') {
              this.setMode(agent, input === 'on')
              return { kind: 'success', text: 'read-only mode ' + input + '.' }
            }
            if (!input.startsWith('summarize ')) return { kind: 'error', text: 'usage: /readonly on|off|summarize <text>' }
            const text = await this.oneShot(agent, input.slice('summarize '.length), signal)
            agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
            return { kind: 'success', text: 'Summary queued as a follow-up turn.' }
          },
        }))
        ctx.mcpManager.register('chrome-devtools', {
          transport: 'stdio', command: 'npx', args: ['-y', 'chrome-devtools-mcp@latest'],
          env: {}, cwd: '', startupTimeoutMs: 30_000,
        })
      }

      private isActive(session: Session): boolean { return this.handle.stateOf(session).active }
      private setMode(agent: Agent, active: boolean): void {
        agent.session.append('readonly/mode', { active })   // durable; folds again on resume
        if (active) this.applyRestriction(agent)
      }
      private applyRestriction(agent: Agent): void {
        agent.ctx.tools.restrict({ deny: [...this.config.denyTools] })   // must be the agent's scoped ctx
      }
      private async oneShot(agent: Agent, input: string, signal: AbortSignal): Promise<string> {
        const route = agent.session.requestHeader()?.config ?? { provider: agent.options.provider!, model: agent.options.model! }
        const call = await this.ctx.llm.prepareCall({ provider: route.provider, model: route.model, maxTokens: this.config.maxTokens }, signal)
        const assembler = new BlockAssembler()
        for await (const chunk of call.stream({
          ...call.config,
          messages: [createUserMessage({ content: [{ type: 'text', text: input }], source: { kind: 'user' } })],
          system: 'Summarize the following for the user in one paragraph.',
          sessionId: agent.session.id, signal,
        })) assembler.push(chunk)
        const finish = assembler.finish
        if (finish.kind === 'error' || finish.kind === 'aborted') throw new Error(finish.failure.message)
        return assembler.blocks().filter(b => b.type === 'text').map(b => (b as { text: string }).text).join('')
      }
    }

Resume behaviour: the mode lives only in the log, so readonly/mode folds back through
modeProjection on resume; re-apply restrict() from agent/created (source 'resume') because
restrictions are effect-scoped, not durable. session.append from a command handler is legal for
a log-only type; dsh-plan-mode/src/index.ts:431-451 shows the open-turn variant if you must
avoid appending mid-turn.
