/**
 * How this process can be restarted from inside itself.
 *
 * The plugin runs inside the same process that serves the page, so a restart
 * has to be arranged by something that outlives that process. Under systemd the
 * answer is a detached `systemctl restart` for the unit this process belongs
 * to; anywhere else the answer is the operator's own command, and the page
 * says so instead of offering a button that cannot work.
 * @module dsh-vae-update/restart
 */

import { spawn, type SpawnOptions } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

/** Who can restart the web process. */
export type RestartKind = 'systemd' | 'manual'

/** Restart capability of the host serving the page. */
export interface RestartTarget {
  /** Whether the host can restart itself, so the page may offer the action. */
  available: boolean
  /** Owning supervisor, which decides the copy the page shows. */
  kind: RestartKind
  /** systemd unit name; present exactly when `kind` is `systemd`. */
  unit?: string
}

/** The systemd unit that owns a cgroup membership file's process, if any. */
export function unitFromCgroup(text: string): string | undefined {
  for (const line of text.split('\n')) {
    // Both layouts end in `<controller>:<path>`; cgroup v2 leaves the
    // controller list empty, so the path is simply the last field.
    const path = line.slice(line.lastIndexOf(':') + 1).trim()
    if (path === '' || path === '/') continue
    const segment = path.slice(path.lastIndexOf('/') + 1)
    // A transient or template unit name may carry `@`, `-`, `.`, and `_`.
    if (/^[A-Za-z0-9_.@-]+\.service$/.test(segment)) return segment
  }
  return undefined
}

/** Inputs the detection reads, injected so tests pin them. */
export interface RestartDetection {
  /** Contents of the calling process's cgroup membership file. */
  readCgroup: () => string
  /** Whether systemd is the running init, making `systemctl` meaningful. */
  systemdAvailable: () => boolean
}

/** Detection against the live host. */
export const RESTART_DETECTION: RestartDetection = {
  readCgroup: () => {
    try {
      return readFileSync('/proc/self/cgroup', 'utf8')
    } catch {
      // A platform without cgroup files has no systemd unit to restart.
      return ''
    }
  },
  systemdAvailable: () => existsSync('/run/systemd/system'),
}

/**
 * Decide whether the page may offer a restart.
 * @param detection - host facts, defaulting to the live ones.
 * @returns the capability the page renders.
 */
export function detectRestartTarget(detection: RestartDetection = RESTART_DETECTION): RestartTarget {
  const unit = unitFromCgroup(detection.readCgroup())
  if (unit !== undefined && detection.systemdAvailable()) return { available: true, kind: 'systemd', unit }
  return { available: false, kind: 'manual' }
}

/** Spawner seam so the restart can be asserted without running systemd. */
export type RestartSpawner = (command: string, args: readonly string[], options: SpawnOptions) => { unref: () => void }

/**
 * Arrange the restart of `unit` from a process that is about to be terminated by
 * it. The detached shell waits out the response flush and then replaces itself
 * with `systemctl`, so nothing here survives as a stray process. The unit name
 * arrives as a positional parameter rather than as shell source.
 * @param unit - validated systemd unit name.
 * @param spawner - process spawner, injected by tests.
 */
export function restartWithSystemd(unit: string, spawner: RestartSpawner = spawn): void {
  spawner('/bin/sh', ['-c', 'sleep 1; exec systemctl restart "$1"', 'sh', unit], {
    detached: true,
    stdio: 'ignore',
  }).unref()
}
