/**
 * Host half: skill provider, MCP mounts, and Settings routes.
 * @module
 */

import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadCatalog } from './catalog.ts'
import { mcpClientConfig } from './env.ts'
import { readExtensionsFile, writeExtensionsFile } from './files.ts'
import {
  detectHarnessRoot, detectKitRoot, findGitRoot, globalExtensionsPath,
  optionalAbsolute, projectExtensionsPath, resolveDshHome,
} from './paths.ts'
import { globalMcpIds, parseExtensions, projectMcpIds, resolveCatalog, setEnablement } from './resolve.ts'
import type {
  Enablement, ExtensionsDoc, KitCatalog, KitStateView, ResolvedItem, ResolvedItemView,
} from './types.ts'

export const STATE_PATH = '/api/vae-kit.state'
export const RELOAD_PATH = '/api/vae-kit.reload'
export const ENABLE_PATH = '/api/vae-kit.enable'

const SKILL_PROVIDER = 'vae-kit'
const SKILL_RANK = 350
const TOOL_PREFIX = (serverName: string): string => `mcp__${serverName}__`

/** Bundle configuration from the profile patch. */
export interface Config {
  /** Absolute kit directory containing catalog.yml. Detected from this repo when omitted. */
  kitRoot?: string
  /** DeepSeek Harness home used for extensions.yml. */
  dshHome?: string
}

/** Resolved paths after detection. */
export interface ResolvedOptions {
  kitRoot: string
  dshHome: string
}

interface FetchRoute {
  path: string
  methods: readonly ('GET' | 'HEAD' | 'POST')[]
  requestBody: 'buffered'
  fetch: (request: Request) => Promise<Response>
}

interface FiberLike {
  dispose: () => Promise<void> | void
}

interface SkillControl {
  invalidate: () => void
}

interface SkillCandidate {
  name: string
  description: string
  whenToUse?: string
  invocation: { modelInvocable: boolean; userInvocable: boolean }
  provider: string
  source: string
  rank: number
  locator: unknown
  resourceBase: { kind: 'directory'; path: string }
  path: string
}

interface ToolsLike {
  schemas: (scope?: unknown) => { name: string }[]
  restrict: (filter: { deny: string[] }) => () => void
}

interface ConnectionLike {
  fetch: { register: (route: FetchRoute) => unknown }
}

interface SkillRegistryLike {
  registerProvider: (create: (control: SkillControl) => {
    name: string
    list: (options: { cwd?: string; signal?: AbortSignal }) => Promise<SkillCandidate[]>
    get: (candidate: SkillCandidate) => Promise<{
      name: string
      description: string
      whenToUse?: string
      invocation: { modelInvocable: boolean; userInvocable: boolean }
      provider: string
      source: string
      resourceBase: { kind: 'directory'; path: string }
      path: string
      content: string
    } | undefined>
  }) => () => void
}

/**
 * The slice of the Cordis Context this plugin uses. Declared structurally so
 * the host half stays free of harness imports.
 */
interface HostContext {
  skills: SkillRegistryLike
  plugin: (plugin: unknown, config?: unknown) => Promise<FiberLike> | FiberLike
  effect: (callback: () => (() => void) | void, label?: string) => unknown
  get: (name: string) => unknown
  on: (event: string, listener: (...args: never[]) => unknown, options?: { prepend?: boolean }) => () => void
  inject?: (deps: string[], callback: (ctx: HostContext) => void) => unknown
}

interface WorkspaceLike {
  path: string
  title: string
}

interface AgentLike {
  session: { header: { cwd?: string; origin?: string; delegationDepth?: number } }
  ctx: {
    plugin: (plugin: unknown, config?: unknown) => Promise<FiberLike> | FiberLike
    effect: (callback: () => (() => void) | void, label?: string) => unknown
    get?: (name: string) => unknown
    tools?: ToolsLike
  }
}

interface McpModule {
  apply?: (ctx: unknown, config: unknown) => unknown
  Config?: (value: unknown) => unknown
  name?: string
  inject?: unknown
}

interface HostState {
  options: ResolvedOptions
  catalog: KitCatalog | null
  loadError: string | null
  globalDoc: ExtensionsDoc
  viewProject: string | null
  globalMounts: Map<string, FiberLike>
  mcpStatus: Map<string, { status: 'idle' | 'mounted-global' | 'error'; error?: string }>
  projectMounts: Map<AgentLike, Map<string, FiberLike>>
  projectMasks: Map<AgentLike, () => void>
  skillControl: SkillControl | null
  mcpModule: McpModule | null
}

/** Test seams for MCP loading. */
export interface HostInternals {
  /** Override how `@deepseek-ai/dsh-mcp-client` is imported. */
  loadMcpModule?: () => Promise<McpModule | null>
}

/**
 * Resolve configured paths over detection.
 * @param raw - the row's `config` value.
 * @returns kitRoot and dshHome after expansion.
 */
export function resolveOptions(raw: unknown): ResolvedOptions {
  const config = (typeof raw === 'object' && raw !== null ? raw : {}) as Config
  return {
    kitRoot: optionalAbsolute(config.kitRoot, 'kitRoot') ?? detectKitRoot(),
    dshHome: optionalAbsolute(config.dshHome, 'dshHome') ?? resolveDshHome(),
  }
}

/** JSON response with browser caching disabled. */
function respondJson(status: number, body: unknown): Response {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } })
}

async function readJsonBody(request: Request): Promise<Record<string, unknown> | undefined> {
  try {
    const parsed: unknown = await request.json()
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined
  } catch {
    return undefined
  }
}

function warn(ctx: HostContext, message: string): void {
  const logger = ctx.get('logger') as { warn?: (text: string) => void } | undefined
  logger?.warn?.(`[dsh-vae-kit] ${message}`)
}

function connectionOf(ctx: HostContext): ConnectionLike | undefined {
  return ctx.get('connection') as ConnectionLike | undefined
}

function workspacesOf(ctx: HostContext): WorkspaceLike[] {
  const registry = ctx.get('workspaceRegistry') as { list?: () => WorkspaceLike[] } | undefined
  if (registry?.list === undefined) return []
  try {
    return registry.list().map(item => ({ path: item.path, title: item.title }))
  } catch {
    return []
  }
}

/**
 * Load catalog + global extensions. A missing kit root is a page error, not a throw.
 * @param state - mutable host state.
 * @returns after catalog and globalDoc are refreshed.
 */
async function refreshCatalog(state: HostState): Promise<void> {
  if (state.options.kitRoot === '') {
    state.catalog = null
    state.loadError = 'kit root not detected; set config.kitRoot to the kit/ directory'
    return
  }
  try {
    state.catalog = await loadCatalog(state.options.kitRoot)
    state.loadError = null
  } catch (error) {
    state.catalog = null
    state.loadError = error instanceof Error ? error.message : String(error)
  }
  try {
    state.globalDoc = await readExtensionsFile(globalExtensionsPath(state.options.dshHome))
  } catch (error) {
    state.loadError = error instanceof Error ? error.message : String(error)
    state.globalDoc = parseExtensions(undefined)
  }
}

async function projectDocFor(root: string | null): Promise<ExtensionsDoc | undefined> {
  if (root === null) return undefined
  return await readExtensionsFile(projectExtensionsPath(root))
}

async function resolvedFor(state: HostState, projectRoot: string | null): Promise<{
  mcp: ResolvedItem[]
  skills: ResolvedItem[]
}> {
  if (state.catalog === null) return { mcp: [], skills: [] }
  const project = await projectDocFor(projectRoot)
  try {
    const resolved = resolveCatalog(state.catalog, state.globalDoc, project)
    if (state.loadError !== null && state.loadError.startsWith('extensions.yml')) state.loadError = null
    return resolved
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    state.loadError = message
    return { mcp: [], skills: [] }
  }
}

function viewItems(items: readonly ResolvedItem[], state: HostState): ResolvedItemView[] {
  return items.map((item) => {
    if (item.kind !== 'mcp') return item
    const spec = state.catalog?.servers[item.id]
    const status = state.mcpStatus.get(item.id) ?? { status: 'idle' as const }
    return {
      ...item,
      mcp: {
        serverName: spec?.serverName ?? item.id,
        transport: spec?.transport ?? 'stdio',
        status: item.effective === 'global'
          ? status.status
          : item.effective === 'project' ? 'mounted-project' : 'idle',
        ...status.error === undefined ? {} : { error: status.error },
      },
    }
  })
}

async function stateView(ctx: HostContext, state: HostState, projectRoot: string | null): Promise<KitStateView> {
  const projects = workspacesOf(ctx)
  const resolved = await resolvedFor(state, projectRoot)
  return {
    kitRoot: state.options.kitRoot,
    dshHome: state.options.dshHome,
    globalFile: globalExtensionsPath(state.options.dshHome),
    projectFile: projectRoot === null ? null : projectExtensionsPath(projectRoot),
    projectRoot,
    projects,
    mcp: viewItems(resolved.mcp, state),
    skills: viewItems(resolved.skills, state),
    warnings: state.catalog?.warnings ?? [],
    error: state.loadError,
  }
}

async function tryImport(specifier: string): Promise<McpModule | null> {
  try {
    return await import(specifier) as McpModule
  } catch {
    return null
  }
}

/**
 * Load the harness MCP client. A linked user bundle cannot resolve
 * `@deepseek-ai/dsh-mcp-client` from its own node_modules, so fall back to the
 * running CLI and the detected harness checkout.
 * @returns the namespace plugin, or null when it cannot be resolved.
 */
export async function loadMcpModule(): Promise<McpModule | null> {
  const direct = await tryImport('@deepseek-ai/dsh-mcp-client')
  if (direct !== null) return direct
  for (const base of [import.meta.url, process.argv[1]]) {
    if (base === undefined) continue
    try {
      const resolved = createRequire(base).resolve('@deepseek-ai/dsh-mcp-client')
      const loaded = await tryImport(pathToFileURL(resolved).href)
      if (loaded !== null) return loaded
    } catch {
      // This require graph does not include the harness MCP client.
    }
  }
  const harness = detectHarnessRoot()
  if (harness === '') return null
  return await tryImport(pathToFileURL(join(harness, 'packages/mcp/mcp-client/lib/index.js')).href)
}

function configFor(state: HostState, id: string): unknown {
  const spec = state.catalog?.servers[id]
  if (spec === undefined) throw new Error(`unknown MCP id ${id}`)
  const raw = mcpClientConfig(spec)
  return state.mcpModule?.Config === undefined ? raw : state.mcpModule.Config(raw)
}

async function disposeMount(fiber: FiberLike | undefined): Promise<void> {
  if (fiber === undefined) return
  await fiber.dispose()
}

async function ensureMcpModule(state: HostState, internals: HostInternals): Promise<McpModule | null> {
  if (state.mcpModule !== null) return state.mcpModule
  const loaded = await (internals.loadMcpModule ?? loadMcpModule)()
  state.mcpModule = loaded
  return loaded
}

async function remountGlobal(ctx: HostContext, state: HostState, internals: HostInternals): Promise<void> {
  const wanted = new Set(state.catalog === null ? [] : globalMcpIds((await resolvedFor(state, null)).mcp))
  for (const [id, fiber] of [...state.globalMounts]) {
    if (wanted.has(id)) continue
    await disposeMount(fiber)
    state.globalMounts.delete(id)
    state.mcpStatus.set(id, { status: 'idle' })
  }
  if (wanted.size === 0) return
  const mod = await ensureMcpModule(state, internals)
  if (mod === null) {
    for (const id of wanted) {
      if (state.globalMounts.has(id)) continue
      state.mcpStatus.set(id, { status: 'error', error: '@deepseek-ai/dsh-mcp-client is not installed in this process' })
    }
    return
  }
  for (const id of wanted) {
    if (state.globalMounts.has(id)) continue
    try {
      const fiber = await ctx.plugin(mod, configFor(state, id))
      state.globalMounts.set(id, fiber)
      state.mcpStatus.set(id, { status: 'mounted-global' })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      state.mcpStatus.set(id, { status: 'error', error: message })
      warn(ctx, `global MCP ${id}: ${message}`)
    }
  }
}

function isRootSession(agent: AgentLike): boolean {
  return agent.session.header.origin !== 'subagent' && (agent.session.header.delegationDepth ?? 0) === 0
}

function applyMask(agent: AgentLike, state: HostState, resolved: { mcp: ResolvedItem[] }): void {
  state.projectMasks.get(agent)?.()
  state.projectMasks.delete(agent)
  const tools = agent.ctx.tools
  if (tools === undefined || state.catalog === null) return
  const deny: string[] = []
  for (const item of resolved.mcp) {
    if (item.effective !== 'off') continue
    const spec = state.catalog.servers[item.id]
    if (spec === undefined) continue
    const prefix = TOOL_PREFIX(spec.serverName)
    for (const tool of tools.schemas(agent)) {
      if (tool.name.startsWith(prefix)) deny.push(tool.name)
    }
  }
  if (deny.length === 0) return
  try {
    state.projectMasks.set(agent, tools.restrict({ deny }))
  } catch (unknownTools) {
    // restrict() rejects names the MCP client has not published yet; tools/change retries.
    void unknownTools
  }
}

async function remountProject(
  ctx: HostContext,
  state: HostState,
  agent: AgentLike,
  internals: HostInternals,
): Promise<void> {
  const cwd = agent.session.header.cwd
  const projectRoot = cwd === undefined ? undefined : findGitRoot(cwd)
  const root = isRootSession(agent)
  const mounts = state.projectMounts.get(agent) ?? new Map<string, FiberLike>()
  if (root) state.projectMounts.set(agent, mounts)

  if (projectRoot === undefined || state.catalog === null) {
    if (root) {
      for (const [, fiber] of mounts) await disposeMount(fiber)
      mounts.clear()
    }
    state.projectMasks.get(agent)?.()
    state.projectMasks.delete(agent)
    return
  }

  const resolved = await resolvedFor(state, projectRoot)
  if (root) {
    const wanted = new Set(projectMcpIds(resolved.mcp))
    for (const [id, fiber] of [...mounts]) {
      if (wanted.has(id)) continue
      await disposeMount(fiber)
      mounts.delete(id)
    }
    if (wanted.size > 0) {
      const mod = await ensureMcpModule(state, internals)
      if (mod !== null) {
        for (const id of wanted) {
          if (mounts.has(id)) continue
          try {
            const fiber = await agent.ctx.plugin(mod, configFor(state, id))
            mounts.set(id, fiber)
          } catch (error) {
            warn(ctx, `project MCP ${id}: ${error instanceof Error ? error.message : String(error)}`)
          }
        }
      }
    }
  }

  applyMask(agent, state, resolved)
}

async function remountLiveProjects(ctx: HostContext, state: HostState, internals: HostInternals): Promise<void> {
  const agents = ctx.get('agents') as { list?: () => AgentLike[] } | undefined
  if (agents?.list === undefined) return
  for (const agent of agents.list()) await remountProject(ctx, state, agent, internals)
}

async function refreshMasks(ctx: HostContext, state: HostState): Promise<void> {
  const agents = ctx.get('agents') as { list?: () => AgentLike[] } | undefined
  if (agents?.list === undefined) return
  for (const agent of agents.list()) {
    const cwd = agent.session.header.cwd
    const projectRoot = cwd === undefined ? undefined : findGitRoot(cwd)
    if (projectRoot === undefined || state.catalog === null) {
      state.projectMasks.get(agent)?.()
      state.projectMasks.delete(agent)
      continue
    }
    applyMask(agent, state, await resolvedFor(state, projectRoot))
  }
}

function registerSkillProvider(ctx: HostContext, state: HostState): void {
  ctx.skills.registerProvider((control) => {
    state.skillControl = control
    return {
      name: SKILL_PROVIDER,
      async list(options) {
        if (state.catalog === null) return []
        const projectRoot = options.cwd === undefined ? null : findGitRoot(options.cwd) ?? null
        const resolved = await resolvedFor(state, projectRoot)
        const candidates: SkillCandidate[] = []
        for (const item of resolved.skills) {
          if (!item.enabled) continue
          const body = state.catalog.skillBodies[item.id]
          if (body === undefined) continue
          candidates.push({
            name: body.name,
            description: body.description,
            ...body.whenToUse === undefined ? {} : { whenToUse: body.whenToUse },
            invocation: { modelInvocable: body.modelInvocable, userInvocable: body.userInvocable },
            provider: SKILL_PROVIDER,
            source: 'kit',
            rank: SKILL_RANK,
            locator: body.id,
            resourceBase: { kind: 'directory', path: body.directory },
            path: body.path,
          })
        }
        return candidates
      },
      async get(candidate) {
        if (state.catalog === null) return undefined
        const id = typeof candidate.locator === 'string' ? candidate.locator : candidate.name
        const body = state.catalog.skillBodies[id]
        if (body === undefined) return undefined
        return {
          name: body.name,
          description: body.description,
          ...body.whenToUse === undefined ? {} : { whenToUse: body.whenToUse },
          invocation: { modelInvocable: body.modelInvocable, userInvocable: body.userInvocable },
          provider: SKILL_PROVIDER,
          source: 'kit',
          resourceBase: { kind: 'directory', path: body.directory },
          path: body.path,
          content: body.content,
        }
      },
    }
  })
}

/**
 * Apply catalog + enablement: remount global MCP, refresh live project MCP, invalidate skills.
 * @param ctx - host context.
 * @param state - mutable host state.
 * @param internals - MCP loader seam.
 * @returns after MCP mounts and skill invalidation settle.
 */
async function applyRuntime(ctx: HostContext, state: HostState, internals: HostInternals = {}): Promise<void> {
  await remountGlobal(ctx, state, internals)
  await remountLiveProjects(ctx, state, internals)
  state.skillControl?.invalidate()
}

function createQueue(): (work: () => Promise<void>) => Promise<void> {
  let tail: Promise<void> = Promise.resolve()
  return (work) => {
    const run = tail.then(work, work)
    tail = run.then(() => undefined, () => undefined)
    return run
  }
}

function projectFromQuery(url: string, fallback: string | null): string | null {
  try {
    const value = new URL(url, 'http://dsh.local').searchParams.get('project')
    if (value === null || value.trim() === '') return fallback
    return findGitRoot(value) ?? value
  } catch {
    return fallback
  }
}

function registerRoutes(
  ctx: HostContext,
  state: HostState,
  internals: HostInternals,
  enqueue: (work: () => Promise<void>) => Promise<void>,
): void {
  const connection = connectionOf(ctx)
  if (connection === undefined) return

  connection.fetch.register({
    path: STATE_PATH,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async (request) => {
      await enqueue(async () => {})
      const project = projectFromQuery(request.url, state.viewProject ?? workspacesOf(ctx)[0]?.path ?? null)
      state.viewProject = project
      return respondJson(200, await stateView(ctx, state, project))
    },
  })

  connection.fetch.register({
    path: RELOAD_PATH,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      await enqueue(async () => {
        await refreshCatalog(state)
        await applyRuntime(ctx, state, internals)
      })
      const project = projectFromQuery(request.url, state.viewProject)
      return respondJson(200, await stateView(ctx, state, project))
    },
  })

  connection.fetch.register({
    path: ENABLE_PATH,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      const body = await readJsonBody(request)
      if (body === undefined) return respondJson(400, { error: 'invalid-json-body' })
      const kind = body.kind === 'mcp' || body.kind === 'skill' ? body.kind : undefined
      const id = typeof body.id === 'string' ? body.id : undefined
      const scope = body.scope === 'global' || body.scope === 'project' ? body.scope : undefined
      const value = body.value === 'on' || body.value === 'off' || body.value === 'inherit' ? body.value : undefined
      if (kind === undefined || id === undefined || scope === undefined || value === undefined) {
        return respondJson(400, { error: 'kind, id, scope, and value are required' })
      }
      const key = kind === 'mcp' ? 'mcp' : 'skills'
      let error: string | undefined
      await enqueue(async () => {
        if (state.catalog === null) {
          error = state.loadError ?? 'catalog-unavailable'
          return
        }
        const known = kind === 'mcp' ? state.catalog.mcp : state.catalog.skills
        if (!known.some(item => item.id === id)) {
          error = `unknown ${kind} id ${id}`
          return
        }
        if (scope === 'global') {
          const next = setEnablement(state.globalDoc, key, id, value as Enablement | 'inherit')
          await writeExtensionsFile(globalExtensionsPath(state.options.dshHome), next)
          state.globalDoc = next
        } else {
          const project = typeof body.project === 'string' ? findGitRoot(body.project) ?? body.project : state.viewProject
          if (project === null || project === undefined) {
            error = 'no-project'
            return
          }
          const current = await readExtensionsFile(projectExtensionsPath(project))
          const next = setEnablement(current, key, id, value as Enablement | 'inherit')
          await writeExtensionsFile(projectExtensionsPath(project), next)
          state.viewProject = project
        }
        await applyRuntime(ctx, state, internals)
      })
      if (error !== undefined) {
        const status = error === 'no-project' || state.catalog === null ? 409 : 400
        return respondJson(status, { error })
      }
      return respondJson(200, await stateView(ctx, state, state.viewProject))
    },
  })
}

/**
 * Register the skill provider, MCP mounts, and Settings routes.
 * @param ctx - plugin context carrying the `skills` service.
 * @param config - optional kitRoot / dshHome overrides from the bundle patch.
 * @param internals - test seams for MCP loading.
 * @returns after the skill provider, listeners, and routes are registered.
 */
export function apply(ctx: HostContext, config?: Config, internals: HostInternals = {}): void {
  const options = resolveOptions(config)
  const state: HostState = {
    options,
    catalog: null,
    loadError: null,
    globalDoc: parseExtensions(undefined),
    viewProject: null,
    globalMounts: new Map(),
    mcpStatus: new Map(),
    projectMounts: new Map(),
    projectMasks: new Map(),
    skillControl: null,
    mcpModule: null,
  }

  ctx.effect(() => () => {
    for (const fiber of state.globalMounts.values()) void disposeMount(fiber)
    state.globalMounts.clear()
    for (const mounts of state.projectMounts.values()) {
      for (const fiber of mounts.values()) void disposeMount(fiber)
    }
    state.projectMounts.clear()
    for (const lift of state.projectMasks.values()) lift()
    state.projectMasks.clear()
  }, 'vae-kit: dispose MCP mounts')

  registerSkillProvider(ctx, state)

  const enqueue = createQueue()
  void enqueue(async () => {
    await refreshCatalog(state)
    await applyRuntime(ctx, state, internals)
  }).catch((error: unknown) => {
    warn(ctx, error instanceof Error ? error.message : String(error))
  })

  ctx.on('agent/created', (async (payload: { agent: AgentLike }) => {
    payload.agent.ctx.effect(() => () => {
      const mounts = state.projectMounts.get(payload.agent)
      if (mounts !== undefined) {
        for (const fiber of mounts.values()) void disposeMount(fiber)
        state.projectMounts.delete(payload.agent)
      }
      state.projectMasks.get(payload.agent)?.()
      state.projectMasks.delete(payload.agent)
    }, 'vae-kit: project MCP')
    await enqueue(async () => {
      await remountProject(ctx, state, payload.agent, internals)
    })
  }) as (...args: never[]) => unknown, { prepend: true })

  ctx.on('tools/change', (() => {
    void enqueue(async () => {
      await refreshMasks(ctx, state)
    })
  }) as (...args: never[]) => unknown)

  let routesRegistered = false
  const tryRegisterRoutes = (from: HostContext): void => {
    if (routesRegistered || connectionOf(from) === undefined) return
    routesRegistered = true
    registerRoutes(from, state, internals, enqueue)
  }
  tryRegisterRoutes(ctx)
  ctx.inject?.(['connection'], (wired) => tryRegisterRoutes(wired))
}
