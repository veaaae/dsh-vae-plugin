/**
 * Kit, DSH home, and harness checkout path helpers.
 * @module
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const HARNESS_MANIFEST_NAME = '@deepseek-ai/dsh-root'

/**
 * Expand a leading `~` against the OS home.
 * @param path - path that may start with `~`.
 * @returns the expanded path.
 */
export function expandHome(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/') || path.startsWith('~\\')) return join(homedir(), path.slice(2))
  return path
}

/**
 * Resolve DSH home the same way the harness does: configured path, else
 * `$DSH_HOME`, else `~/.dsh`.
 * @param configured - optional explicit path.
 * @returns an absolute DSH home.
 */
export function resolveDshHome(configured?: string): string {
  const raw = configured?.trim() || process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')
  return resolve(expandHome(raw))
}

/**
 * Global enablement file.
 * @param dshHome - DeepSeek Harness home.
 * @returns `$DSH_HOME/extensions.yml`.
 */
export function globalExtensionsPath(dshHome: string): string {
  return join(dshHome, 'extensions.yml')
}

/**
 * Project enablement file under the git root.
 * @param projectRoot - git root.
 * @returns `<gitRoot>/.dsh/extensions.yml`.
 */
export function projectExtensionsPath(projectRoot: string): string {
  return join(projectRoot, '.dsh', 'extensions.yml')
}

/**
 * Nearest ancestor of `start` that contains `.git`, including `start`.
 * @param start - directory to walk from.
 * @returns the git root, or undefined.
 */
export function findGitRoot(start: string): string | undefined {
  let dir = resolve(start)
  while (true) {
    if (existsSync(join(dir, '.git'))) return dir
    const parent = dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}

/**
 * Locate this package's `kit/` directory. Git subdirectory installs unpack
 * only this package, so the catalog must live next to `package.json`.
 * @returns an absolute kit directory, or empty when none is found.
 */
export function detectKitRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  for (const kit of [resolve(here, '..', 'kit'), resolve(here, 'kit')]) {
    if (existsSync(join(kit, 'catalog.yml'))) return kit
  }
  return ''
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
 * Locate the official harness checkout from the running process. Used to
 * import `@deepseek-ai/dsh-mcp-client` when this plugin is not inside that
 * workspace.
 * @returns the harness git root, or empty when none is found.
 */
export function detectHarnessRoot(): string {
  const entry = process.argv[1]
  const starts = [process.cwd(), ...(entry === undefined ? [] : [dirname(resolve(process.cwd(), entry))])]
  for (const start of starts) {
    const root = findGitRoot(start)
    if (root !== undefined && manifestName(root) === HARNESS_MANIFEST_NAME) return root
  }
  return ''
}

/**
 * Require an absolute path from config.
 * @param value - configured path.
 * @param field - config field name used in the error.
 * @returns the resolved absolute path, or undefined when omitted.
 */
export function optionalAbsolute(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`dsh-vae-kit: config ${field} must be a non-empty path`)
  }
  const expanded = expandHome(value.trim())
  if (!isAbsolute(expanded)) {
    throw new Error(`dsh-vae-kit: config ${field} must be an absolute path`)
  }
  return resolve(expanded)
}
