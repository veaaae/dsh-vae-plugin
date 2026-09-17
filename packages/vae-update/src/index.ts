/**
 * Host half of `dsh-vae-update`: the authenticated `/api/vae-update.*` routes
 * behind the Settings page.
 *
 * The plugin owns no durable state and imports no harness package: it reads the
 * official checkout and this plugin repository, runs `git pull --ff-only`,
 * `pnpm install`, and `pnpm run build` on demand, and exposes progress in
 * memory. Both checkout paths are detected from the running process, so the
 * bundle patch needs no config; `config.harnessRoot`, `config.pluginsRoot`,
 * and `config.remote` override detection.
 * @module dsh-vae-update
 */

import { existsSync, readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCommandRunner } from './exec.ts'
import { UpdateJobRunner, planUpdate, type JobView } from './jobs.ts'
import { listPatches } from './patches.ts'
import { inspectRepo, type RepoView, type RepoTarget, type CommandRunner } from './repo.ts'
import { detectRestartTarget, restartWithSystemd, type RestartTarget } from './restart.ts'

export { createCommandRunner } from './exec.ts'
export { UpdateJobRunner, planUpdate } from './jobs.ts'
export { listPatches } from './patches.ts'
export type {
  JobStepPlan, JobStepView, JobView, JobPlan, StepKey, StepStatus, UpdateRoots, UpdateTimeouts,
} from './jobs.ts'
export {
  BUILD_RECORD_PATH, countPorcelain, countTracked, firstLine, firstTag, inspectRepo, parseBuildRecord,
  parseDivergenceCounts, parseHeadLog, versionFromTag,
} from './repo.ts'
export { RESTART_DETECTION, detectRestartTarget, restartWithSystemd, unitFromCgroup } from './restart.ts'
export type { RestartDetection, RestartKind, RestartSpawner, RestartTarget } from './restart.ts'
export type { CommitView, CommandResult, CommandRunner, InspectInput, RepoView, RepoTarget, RunOptions } from './repo.ts'

/** Stable Cordis plugin name. */
export const name = 'dsh-vae-update'

/** The connection service owns the authenticated browser transport for the routes below. */
export const inject = ['connection']

/** Current state of both checkouts plus the in-flight job. */
export const STATE_PATH = '/api/vae-update.state'

/** Fetch each checkout's remote and return fresh state. */
export const CHECK_PATH = '/api/vae-update.check'

/** Start one checkout's update. */
export const APPLY_PATH = '/api/vae-update.apply'

/** Poll the in-flight (or last) update job. */
export const JOB_PATH = '/api/vae-update.job'

/** Restart the web process through its supervisor. */
export const RESTART_PATH = '/api/vae-update.restart'

/** Root manifest name identifying the official harness checkout. */
const HARNESS_MANIFEST_NAME = '@deepseek-ai/dsh-root'

/** Release tags published by the official repository. */
const HARNESS_TAG_PATTERN = 'dsh-v*'

/** Remote compared against, unless configured otherwise. */
const DEFAULT_REMOTE = 'origin'

/**
 * Per-step limits used when the configuration sets none. A post-merge install
 * and a full repository build are slow: a harness checkout that jumps many
 * releases can spend most of an hour in them, so the defaults are generous and
 * every field stays configurable.
 */
const DEFAULT_TIMEOUTS: UpdateTimeouts = {
  pullMs: 5 * 60_000,
  installMs: 45 * 60_000,
  buildMs: 90 * 60_000,
}

/** Plugin configuration read from the profile's bundle patch. */
export interface Config {
  /** Absolute official checkout; detected when absent. */
  harnessRoot?: string
  /** Absolute plugin-repository root; detected when absent. */
  pluginsRoot?: string
  /** Remote compared against. */
  remote?: string
  /** Per-step time limits in milliseconds; `0` disables a limit. */
  timeouts?: Partial<UpdateTimeouts>
  /** Directory of `*.patch` files applied to the official checkout around each build. */
  patchesDir?: string
}

/** Resolved configuration, after detection. */
export interface ResolvedOptions {
  harnessRoot: string
  pluginsRoot: string
  remote: string
  timeouts: UpdateTimeouts
  patchesDir: string
}

/** The state one Settings page renders. */
export interface StateView {
  /** When the last successful check finished, or null before one. */
  checkedAt: string | null
  /** This plugin's own identity, so the page can name what is talking. */
  plugin: { name: string; version: string }
  /** Both checkouts, in page order. */
  repos: RepoView[]
  /** The in-flight or most recent job. */
  job: JobView | null
  /** Whether, and how, this host can restart the process serving the page. */
  restart: RestartTarget
  /** Resolved options, so a page can show what was detected. */
  options: ResolvedOptions
}

/** How the host reads its own version. */
function pluginVersion(): string {
  try {
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version?: unknown }
    return typeof manifest.version === 'string' ? manifest.version : '0.0.0'
  } catch {
    // The manifest always ships beside lib/; a read failure only degrades a label.
    return '0.0.0'
  }
}

/** Nearest ancestor of `start` that is a git checkout, including `start`. */
function findGitRoot(start: string): string | undefined {
  let dir = resolve(start)
  while (true) {
    if (existsSync(join(dir, '.git'))) return dir
    const parent = dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}

/** `name` from a checkout's root manifest; undefined when it cannot be read. */
function manifestName(root: string): string | undefined {
  try {
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { name?: unknown }
    return typeof manifest.name === 'string' ? manifest.name : undefined
  } catch {
    return undefined
  }
}

/**
 * Locate the official checkout from the running process: the CLI entry and the
 * current directory, walking to the nearest ancestor whose root manifest is the
 * harness. An installed CLI has no such checkout and reports none.
 */
function detectHarnessRoot(): string {
  const entry = process.argv[1]
  const starts = [process.cwd(), ...(entry === undefined ? [] : [dirname(resolve(process.cwd(), entry))])]
  for (const start of starts) {
    const root = findGitRoot(start)
    if (root !== undefined && manifestName(root) === HARNESS_MANIFEST_NAME) return root
  }
  return ''
}

/**
 * Locate this plugin's repository from its own module path. A `link:` install
 * resolves to the checkout; a copied install inside a profile has no checkout
 * above it and reports none.
 */
function detectPluginsRoot(): string {
  const root = findGitRoot(dirname(fileURLToPath(import.meta.url)))
  if (root === undefined || manifestName(root) === HARNESS_MANIFEST_NAME) return ''
  return root
}

/** One optional string config field, validated loudly. */
function optionalPath(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`dsh-vae-update: config ${field} must be a non-empty absolute path`)
  }
  return resolve(value.trim())
}

/** One optional millisecond limit, validated loudly. */
function optionalLimit(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`dsh-vae-update: config timeouts.${field} must be a non-negative integer of milliseconds`)
  }
  return value
}

/**
 * Resolve configured overrides over detection.
 * @param raw - the row's `config` value, unvalidated.
 * @returns the effective paths, remote, and per-step time limits.
 * @throws when a configured value has the wrong type, so a typo fails the load
 * instead of silently falling back to detection.
 */
export function resolveOptions(raw: unknown): ResolvedOptions {
  const config = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const remote = config.remote
  if (remote !== undefined && (typeof remote !== 'string' || remote.trim() === '')) {
    throw new Error('dsh-vae-update: config remote must be a non-empty string')
  }
  const timeouts = (typeof config.timeouts === 'object' && config.timeouts !== null ? config.timeouts : {}) as Record<string, unknown>
  return {
    harnessRoot: optionalPath(config.harnessRoot, 'harnessRoot') ?? detectHarnessRoot(),
    pluginsRoot: optionalPath(config.pluginsRoot, 'pluginsRoot') ?? detectPluginsRoot(),
    remote: typeof remote === 'string' ? remote.trim() : DEFAULT_REMOTE,
    patchesDir: optionalPath(config.patchesDir, 'patchesDir') ?? defaultPatchesDir(),
    timeouts: {
      pullMs: optionalLimit(timeouts.pullMs, 'pullMs') ?? DEFAULT_TIMEOUTS.pullMs,
      installMs: optionalLimit(timeouts.installMs, 'installMs') ?? DEFAULT_TIMEOUTS.installMs,
      buildMs: optionalLimit(timeouts.buildMs, 'buildMs') ?? DEFAULT_TIMEOUTS.buildMs,
    },
  }
}

/** This package's own series directory, which ships beside `lib/`. */
function defaultPatchesDir(): string {
  return fileURLToPath(new URL('../patches', import.meta.url))
}

/** JSON response with browser caching disabled. */
function respondJson(status: number, body: unknown): Response {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } })
}

/** Read a JSON request body, or undefined when it is not a JSON object. */
async function readJsonBody(request: Request): Promise<Record<string, unknown> | undefined> {
  try {
    const parsed: unknown = await request.json()
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined
  } catch {
    // A malformed body is a caller error, not a plugin fault.
    return undefined
  }
}

/** Per-checkout remote-fetch outcome carried into the next state read. */
interface FetchOutcome {
  fetchedAt?: string
  fetchError?: string
}

/** The container the host half owns for the lifetime of its fiber. */
interface HostState {
  options: ResolvedOptions
  run: CommandRunner
  jobs: UpdateJobRunner
  fetched: Map<RepoTarget, FetchOutcome>
  checkedAt: string | null
  checking: boolean
  /** Restart capability, detected once at load. */
  restart: RestartTarget
}

/** Inspect one checkout, reporting an absent path instead of throwing. */
async function inspectTarget(
  key: RepoTarget,
  root: string,
  tagPattern: string | undefined,
  state: HostState,
): Promise<RepoView> {
  if (root === '') {
    return { key, root, ok: false, error: 'checkout path not detected' }
  }
  const view = await inspectRepo({
    key,
    root,
    ...(tagPattern === undefined ? {} : { tagPattern }),
    run: state.run,
    readText: path => readFile(path, 'utf8'),
  })
  const outcome = state.fetched.get(key)
  if (outcome === undefined) return view
  return {
    ...view,
    ...(outcome.fetchedAt === undefined ? {} : { fetchedAt: outcome.fetchedAt }),
    ...(outcome.fetchError === undefined ? {} : { fetchError: outcome.fetchError }),
  }
}

/** Read both checkouts into one page state. */
async function readState(state: HostState): Promise<StateView> {
  const repos = await Promise.all([
    inspectTarget('harness', state.options.harnessRoot, HARNESS_TAG_PATTERN, state),
    inspectTarget('plugins', state.options.pluginsRoot, undefined, state),
  ])
  return {
    checkedAt: state.checkedAt,
    plugin: { name: name, version: pluginVersion() },
    repos,
    job: state.jobs.view() ?? null,
    restart: state.restart,
    options: state.options,
  }
}

/** Fetch one checkout's remote, recording why it failed rather than throwing. */
async function fetchTarget(key: RepoTarget, root: string, state: HostState): Promise<void> {
  if (root === '') return
  const result = await state.run(root, ['git', 'fetch', '--prune', '--tags', state.options.remote], {
    timeoutMs: 5 * 60_000,
  })
  state.fetched.set(key, result.code === 0
    ? { fetchedAt: new Date().toISOString() }
    : { fetchedAt: new Date().toISOString(), fetchError: (result.stderr || result.stdout).trim().slice(-2000) })
}

/** One exact Fetch route as the connection service registers it. */
interface FetchRoute {
  path: string
  methods: readonly ('GET' | 'HEAD' | 'POST')[]
  requestBody: 'buffered'
  fetch: (request: Request) => Promise<Response>
}

/**
 * The slice of the Cordis Context this plugin uses. Declared structurally so
 * the host half stays free of harness imports — it is loaded inside the
 * harness process, where the real Context already satisfies this.
 */
interface HostContext {
  /** Authenticated browser transport owning the `/api` routes. */
  connection: { fetch: { register: (route: FetchRoute) => unknown } }
  /** Register a contribution owned by this plugin's fiber. */
  effect: (callback: () => () => void, label?: string) => unknown
}

/**
 * Test seams for the parts of the host half that touch the live machine.
 */
export interface HostInternals {
  /** Restart capability of this process; defaults to live detection. */
  restartTarget?: () => RestartTarget
  /** Arrange one systemd restart; defaults to the detached `systemctl`. */
  restart?: (unit: string) => void
}

/**
 * Register the update routes and own the single update job.
 * @param ctx - plugin context carrying the `connection` service.
 * @param config - optional path, remote, and timeout overrides from the bundle patch.
 * @param internals - test seams for detection and the restart command.
 * @throws when a configured path is not a non-empty string.
 */
export function apply(ctx: HostContext, config?: Config, internals: HostInternals = {}): void {
  const options = resolveOptions(config)
  const lifetime = new AbortController()
  ctx.effect(() => () => lifetime.abort(), 'vae-update: cancel in-flight commands on unload')

  const run = createCommandRunner()
  const state: HostState = {
    options,
    run,
    jobs: new UpdateJobRunner(run, lifetime.signal),
    fetched: new Map(),
    checkedAt: null,
    checking: false,
    restart: (internals.restartTarget ?? detectRestartTarget)(),
  }

  ctx.connection.fetch.register({
    path: STATE_PATH,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async () => respondJson(200, await readState(state)),
  })

  ctx.connection.fetch.register({
    path: CHECK_PATH,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async () => {
      if (state.checking) return respondJson(409, { error: 'check-in-progress' })
      state.checking = true
      try {
        await Promise.all([
          fetchTarget('harness', options.harnessRoot, state),
          fetchTarget('plugins', options.pluginsRoot, state),
        ])
        state.checkedAt = new Date().toISOString()
        return respondJson(200, await readState(state))
      } finally {
        state.checking = false
      }
    },
  })

  ctx.connection.fetch.register({
    path: APPLY_PATH,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      const body = await readJsonBody(request)
      if (body === undefined) return respondJson(400, { error: 'invalid-json-body' })
      const target = body.target
      if (target !== 'harness' && target !== 'plugins') return respondJson(400, { error: 'unknown-target' })
      // The page asks once more before running: this route is the only path
      // that writes to a checkout, so an unconfirmed call is refused here too.
      if (body.confirm !== true) return respondJson(400, { error: 'confirmation-required' })
      if (target === 'harness' ? options.harnessRoot === '' : options.pluginsRoot === '') {
        return respondJson(409, { error: 'checkout-not-detected' })
      }
      if (state.jobs.running) return respondJson(409, { error: 'update-in-progress' })
      // The series is read per request, so adding a patch file needs no reload.
      const job = state.jobs.start(planUpdate(target, {
        harnessRoot: options.harnessRoot,
        pluginsRoot: options.pluginsRoot,
      }, options.timeouts, listPatches(options.patchesDir)))
      return respondJson(202, { job })
    },
  })

  ctx.connection.fetch.register({
    path: JOB_PATH,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async () => respondJson(200, { job: state.jobs.view() ?? null }),
  })

  ctx.connection.fetch.register({
    path: RESTART_PATH,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      const body = await readJsonBody(request)
      if (body === undefined) return respondJson(400, { error: 'invalid-json-body' })
      // This route ends the process serving the caller, so it takes the same
      // explicit confirmation as a write to a checkout.
      if (body.confirm !== true) return respondJson(400, { error: 'confirmation-required' })
      const { available, unit } = state.restart
      if (!available || unit === undefined) return respondJson(409, { error: 'restart-unavailable' })
      if (state.jobs.running) return respondJson(409, { error: 'update-in-progress' })
      // The restart lands after this response is flushed, which is why the
      // arranged command waits rather than replacing the process inline.
      ;(internals.restart ?? restartWithSystemd)(unit)
      return respondJson(202, { restarting: true, unit })
    },
  })
}
