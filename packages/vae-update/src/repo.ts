/**
 * Read-only inspection of one git checkout: current commit, divergence from its
 * tracked upstream, working-tree dirt, and (for the official checkout) the
 * newest release tag.
 *
 * Every parser is exported so the wire values are unit-testable without
 * spawning git, and the module knows nothing about Cordis: `inspectRepo` takes
 * the command runner it should use.
 * @module dsh-vae-update/repo
 */

/** Which checkout a view describes. */
export type RepoTarget = 'harness' | 'plugins'

/** One finished child process, with bounded output. */
export interface CommandResult {
  /** Exit code; `-1` when the process never started or was killed. */
  code: number
  stdout: string
  stderr: string
}

/** Run one command in a directory and resolve with its bounded output. */
export type CommandRunner = (
  cwd: string,
  argv: readonly string[],
  options?: RunOptions,
) => Promise<CommandResult>

/** Per-command options. */
export interface RunOptions {
  /** Kill the command after this many milliseconds. */
  timeoutMs?: number
  /** Receive each complete output line as it is produced. */
  onLine?: (line: string, stream: 'stdout' | 'stderr') => void
  /** Abort signal killing the command when the owning plugin unloads. */
  signal?: AbortSignal
}

/** One commit as the Settings page shows it. */
export interface CommitView {
  /** Abbreviated commit id. */
  sha: string
  /** First line of the commit message. */
  subject: string
  /** Committer date, ISO 8601. */
  date: string
}

/** Everything the Settings page shows about one checkout. */
export interface RepoView {
  /** Stable target key; the client owns the localized label. */
  key: RepoTarget
  /** Absolute checkout path. */
  root: string
  /** Whether the path is a readable git checkout. */
  ok: boolean
  /** Why the checkout is unusable, when `ok` is false. */
  error?: string
  /** Current branch name, or the detached-HEAD marker. */
  branch?: string
  /** Current commit. */
  commit?: CommitView
  /** `version` from the checkout's root `package.json`. */
  version?: string
  /** Version recorded by the checkout's last build, when it records one. */
  builtVersion?: string
  /**
   * Whether that build predates the current commit. Browser artifacts embed
   * their version at build time, so a checkout pulled without a following
   * build keeps serving the version it was built with.
   */
  buildStale?: boolean
  /** Number of changed paths in the working tree, untracked files included. */
  dirty?: number
  /** Changed paths git already tracks; these are the ones that can block a fast-forward pull. */
  modified?: number
  /** Tracked upstream, e.g. `origin/master`. */
  upstream?: string
  /** Commits the local branch has that its upstream lacks. */
  ahead?: number
  /** Commits the upstream has that the local branch lacks. */
  behind?: number
  /** Newest release tag the checkout knows about. */
  latestTag?: string
  /** Whether a newer commit or release exists upstream. */
  updateAvailable?: boolean
  /** When the last successful `git fetch` for this checkout finished. */
  fetchedAt?: string
  /** Why the last `git fetch` failed. */
  fetchError?: string
}

/** Whether two values can be compared as records. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** First non-empty line of a command's stderr, for a compact error message. */
export function firstLine(text: string): string {
  return text.split('\n').map(line => line.trim()).filter(line => line !== '')[0] ?? ''
}

/**
 * Parse `git log -1 --format=%h%x00%s%x00%cI`.
 * @param stdout - raw command output.
 * @returns the commit, or undefined when the output is not one formatted record.
 */
export function parseHeadLog(stdout: string): CommitView | undefined {
  const [sha, subject, date] = (stdout.split('\n', 1)[0] ?? '').split('\0')
  if (sha === undefined || sha === '' || subject === undefined || subject === '' || date === undefined) {
    return undefined
  }
  return { sha, subject, date }
}

/**
 * Parse `git rev-list --left-right --count HEAD...@{upstream}`: the left count
 * is local-only (ahead), the right count is upstream-only (behind).
 * @param stdout - raw command output.
 * @returns both counts, or undefined when the output is not two integers.
 */
export function parseDivergenceCounts(stdout: string): { ahead: number; behind: number } | undefined {
  const [aheadText, behindText, rest] = stdout.trim().split(/\s+/)
  if (aheadText === undefined || behindText === undefined || rest !== undefined) return undefined
  const ahead = Number(aheadText)
  const behind = Number(behindText)
  if (!Number.isSafeInteger(ahead) || !Number.isSafeInteger(behind) || ahead < 0 || behind < 0) return undefined
  return { ahead, behind }
}

/**
 * Count changed paths in `git status --porcelain` output.
 * @param stdout - raw command output.
 * @returns the number of reported paths.
 */
export function countPorcelain(stdout: string): number {
  return stdout.split('\n').filter(line => line.trim() !== '').length
}

/**
 * Count only tracked changes in `git status --porcelain` output. Untracked
 * files carry the `??` status and never make a fast-forward pull conflict; a
 * modified tracked file may.
 * @param stdout - raw command output.
 * @returns the number of changed paths git already tracks.
 */
export function countTracked(stdout: string): number {
  return stdout.split('\n').filter(line => line.trim() !== '' && !line.startsWith('??')).length
}

/**
 * First tag of an already-version-sorted `git tag --list` result.
 * @param stdout - raw command output.
 * @returns the tag name, or undefined when the checkout has no matching tag.
 */
export function firstTag(stdout: string): string | undefined {
  const line = stdout.split('\n').map(entry => entry.trim()).find(entry => entry !== '')
  return line === undefined || line === '' ? undefined : line
}

/**
 * Strip the release-tag prefix to compare a tag against a package version.
 * @param tag - release tag, e.g. `dsh-v0.1.5-rc.2`.
 * @param prefix - configured prefix, e.g. `dsh-v`.
 * @returns the version part, or undefined when the tag does not carry the prefix.
 */
export function versionFromTag(tag: string, prefix: string): string | undefined {
  if (!tag.startsWith(prefix)) return undefined
  const version = tag.slice(prefix.length)
  return version === '' ? undefined : version
}

/** Read `version` from a checkout's root manifest; an unreadable manifest simply reports none. */
async function readManifestVersion(readText: (path: string) => Promise<string>, root: string): Promise<string | undefined> {
  try {
    const parsed: unknown = JSON.parse(await readText(`${root}/package.json`))
    if (!isRecord(parsed)) return undefined
    return typeof parsed.version === 'string' ? parsed.version : undefined
  } catch {
    // A checkout without a readable root manifest is still a valid update
    // target; only the version line is missing.
    return undefined
  }
}

/** Repository-relative path of the build record the harness build writes. */
export const BUILD_RECORD_PATH = '.dsh-build/client-build-environment.json'

/**
 * Read the version and source commit recorded by a checkout's last build. A
 * repository that never ran that build simply has no record, and a version or
 * commit embedded in a browser artifact does not change until it is rebuilt,
 * so this is the only way to tell "pulled" from "built".
 * @param text - the decoded build record.
 * @returns the recorded values, or undefined when the text is not a record.
 */
export function parseBuildRecord(text: string): { version?: string; commit?: string } | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return undefined
  }
  if (!isRecord(parsed) || !isRecord(parsed.environment)) return undefined
  const version = parsed.environment.DSH_CLIENT_VERSION
  const commit = parsed.environment.DSH_CLIENT_COMMIT_HASH
  const record: { version?: string; commit?: string } = {}
  if (typeof version === 'string' && version !== '') record.version = version
  if (typeof commit === 'string' && commit !== '') record.commit = commit
  return record
}

/** Read a checkout's build record; a checkout that never built reports none. */
async function readBuildRecord(readText: (path: string) => Promise<string>, root: string): Promise<{ version?: string; commit?: string } | undefined> {
  try {
    return parseBuildRecord(await readText(`${root}/${BUILD_RECORD_PATH}`))
  } catch {
    // Every checkout that is not the harness build lacks this file.
    return undefined
  }
}

/** Input for {@link inspectRepo}. */
export interface InspectInput {
  /** Which checkout this is. */
  key: RepoTarget
  /** Absolute checkout path. */
  root: string
  /** Release-tag glob, e.g. `dsh-v*`; omit for a repository without releases. */
  tagPattern?: string
  /** Command runner to use. */
  run: CommandRunner
  /** Root-manifest reader, injected so the version lookup stays testable. */
  readText: (path: string) => Promise<string>
}

/**
 * Inspect one checkout. Optional facts (upstream, tags, version) degrade to
 * absent fields; only a path that is not a usable checkout produces `ok: false`.
 * @param input - checkout, runner, and readers.
 * @returns the view the Settings page renders.
 */
export async function inspectRepo(input: InspectInput): Promise<RepoView> {
  const { key, root, tagPattern, run, readText } = input
  const view: RepoView = { key, root, ok: false }

  // Every command is spelled with its executable: the runner takes an argv
  // vector and performs no shell lookup of its own.
  const top = await run(root, ['git', 'rev-parse', '--show-toplevel'], { timeoutMs: 15_000 })
  if (top.code !== 0) {
    return { ...view, error: firstLine(top.stderr) || firstLine(top.stdout) || 'not a git checkout' }
  }
  view.ok = true

  const version = await readManifestVersion(readText, root)
  if (version !== undefined) view.version = version

  const branch = await run(root, ['git', 'rev-parse', '--abbrev-ref', 'HEAD'], { timeoutMs: 15_000 })
  if (branch.code === 0 && branch.stdout.trim() !== '') view.branch = branch.stdout.trim()

  const head = await run(root, ['git', 'log', '-1', '--format=%h%x00%s%x00%cI'], { timeoutMs: 15_000 })
  const commit = head.code === 0 ? parseHeadLog(head.stdout) : undefined
  if (commit !== undefined) view.commit = commit

  const built = await readBuildRecord(readText, root)
  if (built?.version !== undefined) view.builtVersion = built.version
  if (built?.commit !== undefined && commit !== undefined) {
    view.buildStale = !commit.sha.startsWith(built.commit)
  }

  const status = await run(root, ['git', 'status', '--porcelain'], { timeoutMs: 30_000 })
  if (status.code === 0) {
    view.dirty = countPorcelain(status.stdout)
    view.modified = countTracked(status.stdout)
  }

  const upstream = await run(root, ['git', 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], { timeoutMs: 15_000 })
  if (upstream.code === 0 && upstream.stdout.trim() !== '') {
    const name = upstream.stdout.trim()
    view.upstream = name
    const counts = await run(root, ['git', 'rev-list', '--left-right', '--count', 'HEAD...@{u}'], { timeoutMs: 30_000 })
    const parsed = counts.code === 0 ? parseDivergenceCounts(counts.stdout) : undefined
    if (parsed !== undefined) {
      view.ahead = parsed.ahead
      view.behind = parsed.behind
    }
  }

  if (tagPattern !== undefined) {
    const tags = await run(root, ['git', 'tag', '--list', tagPattern, '--sort=-v:refname'], { timeoutMs: 15_000 })
    const tag = tags.code === 0 ? firstTag(tags.stdout) : undefined
    if (tag !== undefined) view.latestTag = tag
  }

  const behind = view.behind ?? 0
  // The glob's literal head is the tag prefix: `dsh-v*` compares `dsh-v0.1.5-rc.2`
  // as the release of version `0.1.5-rc.2`.
  const prefix = tagPattern?.endsWith('*') === true ? tagPattern.slice(0, -1) : tagPattern
  const tagVersion = view.latestTag === undefined || prefix === undefined
    ? undefined
    : versionFromTag(view.latestTag, prefix)
  view.updateAvailable = behind > 0 || (tagVersion !== undefined && version !== undefined && tagVersion !== version)
  return view
}
