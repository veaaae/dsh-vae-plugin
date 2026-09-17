/**
 * The update job: the ordered commands one "one-click update" runs, and the
 * in-memory progress record the Settings page polls.
 *
 * The plan carries commands, not copy: the client localizes each step from its
 * `key`, so the wire stays language-free. Only one job runs at a time, and the
 * record is process-local by design — an update is a property of the running
 * server, not durable user data.
 * @module dsh-vae-update/jobs
 */

import type { CommandRunner, RepoTarget } from './repo.ts'

/** Ordered step keys; the client owns their localized labels. */
export type StepKey = 'clean' | 'pull' | 'install' | 'patch' | 'build' | 'unpatch'

/** Lifecycle of one step. */
export type StepStatus = 'pending' | 'running' | 'ok' | 'failed' | 'skipped'

/** One command in a plan. */
export interface JobStepPlan {
  /** Stable step key. */
  key: StepKey
  /** Working directory. */
  cwd: string
  /** Command and arguments. */
  argv: readonly string[]
  /** Kill the command after this many milliseconds. */
  timeoutMs: number
  /**
   * Whether a non-zero exit leaves the job running. Only the local patch steps
   * set it: a patch that is already off, or that upstream rewrote, must not
   * stop an otherwise good update.
   */
  optional?: boolean
}

/** One complete update plan. */
export interface JobPlan {
  /** Which checkout the plan updates. */
  target: RepoTarget
  /** Steps run in order; the first failure stops the job. */
  steps: readonly JobStepPlan[]
}

/** One step as the Settings page sees it. */
export interface JobStepView {
  key: StepKey
  command: string
  status: StepStatus
  log: string[]
}

/** One job as the Settings page sees it. */
export interface JobView {
  id: string
  target: RepoTarget
  status: 'running' | 'succeeded' | 'failed'
  startedAt: string
  finishedAt?: string
  steps: JobStepView[]
}

/** Output lines retained per step. */
const MAX_STEP_LINES = 300

/** Absolute checkout paths a plan needs. */
export interface UpdateRoots {
  harnessRoot: string
  pluginsRoot: string
}

/**
 * Per-step time limits in milliseconds. A step is SIGKILLed when it exceeds its
 * limit, and `0` means no limit; a post-merge install and a full repository
 * build are legitimately long, so both limits are deployment configuration.
 */
export interface UpdateTimeouts {
  /** Limit for `git pull --ff-only`. */
  pullMs: number
  /** Limit for `pnpm install`. */
  installMs: number
  /** Limit for `pnpm run build`. */
  buildMs: number
}

/**
 * The commands one target's update runs. The install and build steps are the
 * repository's own declared scripts, so a checkout that changes its toolchain
 * keeps working without a plugin release.
 *
 * A local patch series adds three tolerated steps around the same commands, in
 * the order `clean`, `patch`, `unpatch`, so the pull always sees a checkout
 * with no local modification to the files the series touches. Patch steps share
 * the pull step's limit: applying a patch is local and fast, and a separate
 * configuration field would carry no decision.
 * @param target - which checkout to update.
 * @param roots - absolute checkout paths.
 * @param timeouts - resolved per-step limits.
 * @param patches - absolute patch files re-applied around the build; only the
 * official checkout takes them, because the plugin repository is the series'
 * home and holds its own working tree.
 * @returns the ordered plan handed to {@link UpdateJobRunner.start}.
 */
export function planUpdate(
  target: RepoTarget,
  roots: UpdateRoots,
  timeouts: UpdateTimeouts,
  patches: readonly string[] = [],
): JobPlan {
  const cwd = target === 'harness' ? roots.harnessRoot : roots.pluginsRoot
  const series = target === 'harness' ? patches : []
  const reverse = ['git', 'apply', '--reverse', ...series]
  return {
    target,
    steps: [
      ...(series.length === 0 ? [] : [
        { key: 'clean' as const, cwd, argv: reverse, timeoutMs: timeouts.pullMs, optional: true },
      ]),
      { key: 'pull', cwd, argv: ['git', 'pull', '--ff-only'], timeoutMs: timeouts.pullMs },
      { key: 'install', cwd, argv: ['pnpm', 'install'], timeoutMs: timeouts.installMs },
      ...(series.length === 0 ? [] : [
        { key: 'patch' as const, cwd, argv: ['git', 'apply', ...series], timeoutMs: timeouts.pullMs, optional: true },
      ]),
      { key: 'build', cwd, argv: ['pnpm', 'run', 'build'], timeoutMs: timeouts.buildMs },
      ...(series.length === 0 ? [] : [
        { key: 'unpatch' as const, cwd, argv: reverse, timeoutMs: timeouts.pullMs, optional: true },
      ]),
    ],
  }
}

/** Append one output line, keeping the newest lines within the budget. */
function pushLine(step: JobStepView, line: string): void {
  step.log.push(line)
  if (step.log.length > MAX_STEP_LINES) step.log.splice(0, step.log.length - MAX_STEP_LINES)
}

/** Deep copy so a serialized response never shares state with a running job. */
function copyStep(step: JobStepView): JobStepView {
  return { key: step.key, command: step.command, status: step.status, log: [...step.log] }
}

/**
 * Owns the single in-flight update job and its observable progress.
 */
export class UpdateJobRunner {
  private current: JobView | undefined
  private sequence = 0

  /**
   * @param run - the process runner every step uses.
   * @param lifetime - aborts the in-flight command and any later step when the
   * owning plugin unloads, so a stopped plugin leaves no build running.
   */
  constructor(private readonly run: CommandRunner, private readonly lifetime?: AbortSignal) {}

  /** Whether a job is currently running. */
  get running(): boolean {
    return this.current?.status === 'running'
  }

  /** The current job's snapshot, or undefined before the first start. */
  view(): JobView | undefined {
    const job = this.current
    if (job === undefined) return undefined
    return {
      id: job.id,
      target: job.target,
      status: job.status,
      startedAt: job.startedAt,
      ...(job.finishedAt === undefined ? {} : { finishedAt: job.finishedAt }),
      steps: job.steps.map(copyStep),
    }
  }

  /**
   * Start one job. The returned snapshot is already `running`; callers observe
   * progress through {@link view}.
   * @param plan - the ordered commands to run.
   * @returns the started job's snapshot.
   * @throws when a job is already running — two concurrent `pnpm install` runs
   * in one checkout can corrupt its state.
   */
  start(plan: JobPlan): JobView {
    if (this.running) throw new Error('an update is already running')
    this.sequence += 1
    const job: JobView = {
      id: `${String(Date.now())}-${String(this.sequence)}`,
      target: plan.target,
      status: 'running',
      startedAt: new Date().toISOString(),
      steps: plan.steps.map(step => ({ key: step.key, command: step.argv.join(' '), status: 'pending', log: [] })),
    }
    this.current = job
    void this.execute(plan, job)
    return this.view() as JobView
  }

  private async execute(plan: JobPlan, job: JobView): Promise<void> {
    for (const [index, stepPlan] of plan.steps.entries()) {
      const step = job.steps[index]
      /* v8 ignore next -- the plan and the job record are built from one array */
      if (step === undefined) break
      if (this.lifetime?.aborted === true) break
      step.status = 'running'
      const result = await this.run(stepPlan.cwd, stepPlan.argv, {
        timeoutMs: stepPlan.timeoutMs,
        onLine: (line) => pushLine(step, line),
        ...(this.lifetime === undefined ? {} : { signal: this.lifetime }),
      })
      if (result.code !== 0) {
        if (stepPlan.optional === true) {
          // A patch step that has nothing to do (already off, or rewritten
          // upstream) records why and lets the update finish.
          step.status = 'skipped'
          continue
        }
        step.status = 'failed'
        job.status = 'failed'
        job.finishedAt = new Date().toISOString()
        return
      }
      step.status = 'ok'
    }
    job.status = this.lifetime?.aborted === true ? 'failed' : 'succeeded'
    job.finishedAt = new Date().toISOString()
  }
}
