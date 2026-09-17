/**
 * The one place this plugin starts child processes: a bounded, timeout-aware
 * runner that streams complete output lines to its caller.
 * @module dsh-vae-update/exec
 */

import { spawn } from 'node:child_process'
import type { CommandResult, CommandRunner, RunOptions } from './repo.ts'

/** Captured bytes kept per stream; longer output keeps its tail. */
const MAX_CAPTURE_BYTES = 256 * 1024

/** Keep the tail of one stream within the capture budget. */
function bound(current: string, chunk: string): string {
  const next = current + chunk
  return next.length > MAX_CAPTURE_BYTES ? next.slice(next.length - MAX_CAPTURE_BYTES) : next
}

/**
 * Create the process runner used by inspection and update jobs.
 * @returns a runner that never rejects: a spawn failure and a timeout both
 * resolve as a non-zero result so callers keep one failure path.
 */
export function createCommandRunner(): CommandRunner {
  return (cwd, argv, options: RunOptions = {}) => new Promise<CommandResult>((resolvePromise) => {
    const [file, ...args] = argv
    if (file === undefined) {
      resolvePromise({ code: -1, stdout: '', stderr: 'empty command' })
      return
    }
    const child = spawn(file, args, { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let settled = false
    let timedOut = false
    let aborted = false
    const carries: Record<'stdout' | 'stderr', string> = { stdout: '', stderr: '' }
    const timeout = options.timeoutMs === undefined || options.timeoutMs <= 0
      ? undefined
      : setTimeout(() => {
        timedOut = true
        child.kill('SIGKILL')
      }, options.timeoutMs)
    const onAbort = (): void => {
      aborted = true
      child.kill('SIGKILL')
    }
    const signal = options.signal
    if (signal?.aborted === true) onAbort()
    else signal?.addEventListener('abort', onAbort, { once: true })

    const emit = (stream: 'stdout' | 'stderr', text: string): void => {
      if (options.onLine === undefined) return
      const parts = (carries[stream] + text).split('\n')
      carries[stream] = parts.pop() ?? ''
      for (const line of parts) options.onLine(line, stream)
    }
    const finish = (code: number, note = ''): void => {
      if (settled) return
      settled = true
      if (timeout !== undefined) clearTimeout(timeout)
      signal?.removeEventListener('abort', onAbort)
      if (note !== '') stderr = bound(stderr, note)
      resolvePromise({ code, stdout, stderr })
    }

    child.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8')
      stdout = bound(stdout, text)
      emit('stdout', text)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8')
      stderr = bound(stderr, text)
      emit('stderr', text)
    })
    child.on('error', (error: Error) => finish(-1, `\n${error.message}`))
    child.on('close', (code: number | null) => {
      for (const stream of ['stdout', 'stderr'] as const) {
        const rest = carries[stream]
        if (rest !== '' && options.onLine !== undefined) options.onLine(rest, stream)
      }
      finish(
        timedOut || aborted ? -1 : code ?? -1,
        timedOut ? `\ncommand timed out after ${String(options.timeoutMs)}ms` : aborted ? '\ncommand aborted' : '',
      )
    })
  })
}
