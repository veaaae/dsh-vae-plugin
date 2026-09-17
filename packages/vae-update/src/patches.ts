/**
 * The local patch series the plugin carries for the official checkout.
 *
 * A deployment that patches harness source holds a checkout whose tracked file
 * differs from upstream, and `git pull --ff-only` refuses to merge into a file
 * upstream also changed — so a local edit eventually blocks the update it was
 * making possible. The job therefore treats a patch as build input: taken off
 * before the pull, applied before the build, taken off again after it. The
 * patch itself lives in this package, so it is versioned here rather than in a
 * checkout that the next pull overwrites.
 * @module dsh-vae-update/patches
 */

import { readdirSync } from 'node:fs'
import { join } from 'node:path'

/** Filename suffix that marks a series member. */
const PATCH_SUFFIX = '.patch'

/**
 * List one series directory's patches in application order.
 * @param dir - absolute series directory; an absent directory is an empty series.
 * @returns absolute patch file paths, ordered by filename.
 */
export function listPatches(dir: string): string[] {
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    // No series directory is the ordinary case: this deployment patches nothing.
    return []
  }
  return names.filter(name => name.endsWith(PATCH_SUFFIX)).sort().map(name => join(dir, name))
}
