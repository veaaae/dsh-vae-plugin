/**
 * Client half of `dsh-vae-update`: one Settings page that shows both checkouts
 * and drives the host's update routes.
 *
 * The page renders inside the `settings.section` list, reads the host through
 * the same-origin `/api/vae-update.*` routes, and polls the job route while an
 * update runs. It imports only `react` from the loader's module table, so the
 * bundle requests nothing beyond the shared baseline.
 * @module dsh-vae-update/client
 */

import { createElement, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

/** Locale namespace owned by this plugin. */
export const NS = 'vae-update'

/** The slot service is the only hard dependency. */
export const inject = ['slots']

const STATE_PATH = '/api/vae-update.state'
const CHECK_PATH = '/api/vae-update.check'
const APPLY_PATH = '/api/vae-update.apply'
const JOB_PATH = '/api/vae-update.job'
const RESTART_PATH = '/api/vae-update.restart'

/** Poll interval while an update runs. */
const JOB_POLL_MS = 1500

type RepoTarget = 'harness' | 'plugins'
type StepKey = 'clean' | 'pull' | 'install' | 'patch' | 'build' | 'unpatch'
type StepStatus = 'pending' | 'running' | 'ok' | 'failed' | 'skipped'

interface CommitView {
  sha: string
  subject: string
  date: string
}

/** One checkout as the host reports it. */
interface RepoView {
  key: RepoTarget
  root: string
  ok: boolean
  error?: string
  branch?: string
  commit?: CommitView
  version?: string
  builtVersion?: string
  buildStale?: boolean
  dirty?: number
  modified?: number
  upstream?: string
  ahead?: number
  behind?: number
  latestTag?: string
  updateAvailable?: boolean
  fetchedAt?: string
  fetchError?: string
}

interface JobStepView {
  key: StepKey
  command: string
  status: StepStatus
  log: string[]
}

interface JobView {
  id: string
  target: RepoTarget
  status: 'running' | 'succeeded' | 'failed'
  startedAt: string
  finishedAt?: string
  steps: JobStepView[]
}

/** Identity of one observed job, which is all the transition below needs. */
interface JobMark {
  id: string
  status: JobView['status']
}

/**
 * Whether a build finished between two observations of the same job.
 *
 * A completed build has already replaced the artifacts serving this page — the
 * static shell and every dynamic bundle — so the page that watched it can be
 * left on modules the server no longer serves. The component reloads on this
 * transition; a first observation of an already-finished job is deliberately
 * not a transition, or a reloading page would reload forever.
 * @param previous - the job as last observed, or null before any observation.
 * @param next - the job as just observed.
 * @returns true exactly once per build, in the page that was watching it.
 */
export function buildFinished(previous: JobMark | null, next: JobView | null): boolean {
  if (previous === null || next === null || previous.id !== next.id) return false
  if (previous.status !== 'running' || next.status === 'running') return false
  return next.steps.some(step => step.key === 'build' && step.status === 'ok')
}

interface StateView {
  checkedAt: string | null
  plugin: { name: string; version: string }
  repos: RepoView[]
  job: JobView | null
  /** Absent on a host half older than the page, which must fall back to the manual hint. */
  restart?: RestartView
  options: { harnessRoot: string; pluginsRoot: string; remote: string }
}

/** Whether the host can restart the process serving this page. */
interface RestartView {
  available: boolean
  kind: 'systemd' | 'manual'
  unit?: string
}

const zh = {
  nav: '更新',
  title: '官方与插件更新',
  intro: '检查官方 DeepSeek Harness 源码 checkout 与本插件仓库是否有新提交，并在这里一键拉取、安装依赖、构建。',
  check: '检查更新',
  checking: '检查中…',
  update: '一键更新',
  updating: '更新中…',
  confirm: '确认更新',
  confirmHarness: '将对该 checkout 执行 git pull --ff-only、pnpm install、pnpm run build。完成后需要重启 dsh web。',
  confirmPlugins: '将对该仓库执行 git pull --ff-only、pnpm install、pnpm run build。完成后需要重启 dsh web。',
  cancel: '取消',
  harness: '官方源码',
  plugins: '插件仓库',
  path: '路径',
  branch: '分支',
  commit: '提交',
  version: '版本',
  builtVersion: '构建产物',
  staleBuild: '已拉取但未构建：产物仍是 {version}，请重跑更新',
  latestTag: '最新发布',
  upToDate: '已是最新',
  behind: '落后 {count} 个提交',
  ahead: '领先 {count} 个提交',
  diverged: '本地有未推送提交',
  modified: '有 {count} 处已跟踪文件改动，更新可能失败',
  untracked: '另有 {count} 处未跟踪文件',
  unavailable: '不是可用的 git checkout',
  notDetected: '未检测到 checkout 路径',
  notDetectedHint: '可在 bundle patch 的 config 里设置 harnessRoot / pluginsRoot。',
  noUpstream: '没有上游分支，无法比较',
  fetchError: '拉取远端失败',
  stepPull: '拉取代码',
  stepInstall: '安装依赖',
  stepBuild: '构建',
  stepClean: '撤下本地补丁',
  stepPatch: '应用本地补丁',
  stepUnpatch: '收起本地补丁',
  stepSkipped: '（已跳过）',
  log: '输出',
  jobRunning: '正在更新…',
  jobSucceeded: '更新完成',
  jobFailed: '更新失败',
  restartHint: '请重启 dsh web 让新代码生效：在运行它的终端里 Ctrl-C 后重新执行 pnpm dsh web。',
  refreshHint: '构建替换前端产物期间页面可能白屏；本页已自动刷新，仍未恢复时手动刷新一次即可。',
  buildWarning: '注意：构建会替换正在提供的前端产物，页面可能在构建期间白屏；构建成功后本页会自动刷新一次。',
  restart: '重启 dsh web',
  restartConfirm: '将重启 {unit}（systemd）。页面会断开几秒，服务回来后自动重新加载。',
  restartConfirmManual: '重启后页面会自动重新加载。',
  restartYes: '确认重启',
  restarting: '正在重启 dsh web，等待服务回来…',
  restartWaiting: '服务还没回来，可以稍等或手动刷新页面。',
  restartFailed: '重启请求失败',
  autoReload: '构建完成：页面将在 2 秒后自动刷新，以加载新的前端产物。',
  lastChecked: '上次检查',
  never: '尚未检查',
  pluginLabel: '插件版本',
} as const

const en: Record<keyof typeof zh, string> = {
  nav: 'Updates',
  title: 'Official and plugin updates',
  intro: 'Check the official DeepSeek Harness checkout and this plugin repository for new commits, then pull, install, and build in one click.',
  check: 'Check for updates',
  checking: 'Checking…',
  update: 'Update now',
  updating: 'Updating…',
  confirm: 'Confirm update',
  confirmHarness: 'Runs git pull --ff-only, pnpm install, and pnpm run build in that checkout. Restart dsh web afterwards.',
  confirmPlugins: 'Runs git pull --ff-only, pnpm install, and pnpm run build in that repository. Restart dsh web afterwards.',
  cancel: 'Cancel',
  harness: 'Official source',
  plugins: 'Plugin repository',
  path: 'Path',
  branch: 'Branch',
  commit: 'Commit',
  version: 'Version',
  builtVersion: 'Build artifacts',
  staleBuild: 'Pulled but not built: artifacts still say {version}; run the update again',
  latestTag: 'Latest release',
  upToDate: 'Up to date',
  behind: '{count} commits behind',
  ahead: '{count} commits ahead',
  diverged: 'Local commits not pushed',
  modified: '{count} tracked changes; the update may fail',
  untracked: 'plus {count} untracked files',
  unavailable: 'Not a usable git checkout',
  notDetected: 'Checkout path not detected',
  notDetectedHint: 'Set harnessRoot / pluginsRoot in the bundle patch config.',
  noUpstream: 'No upstream branch to compare',
  fetchError: 'Fetching the remote failed',
  stepPull: 'Pull',
  stepInstall: 'Install dependencies',
  stepBuild: 'Build',
  stepClean: 'Take local patches off',
  stepPatch: 'Apply local patches',
  stepUnpatch: 'Take local patches off again',
  stepSkipped: ' (skipped)',
  log: 'Output',
  jobRunning: 'Updating…',
  jobSucceeded: 'Update finished',
  jobFailed: 'Update failed',
  restartHint: 'Restart dsh web for the new code to take effect: Ctrl-C where it runs, then pnpm dsh web.',
  refreshHint: 'A blank page is expected while the build replaces the served frontend; this page reloads itself, and one manual refresh recovers it otherwise.',
  buildWarning: 'Heads-up: the build replaces the frontend artifacts being served, so the page may go blank while it runs; this page refreshes itself once the build succeeds.',
  restart: 'Restart dsh web',
  restartConfirm: 'Restarts {unit} (systemd). The page disconnects for a few seconds and reloads once the service is back.',
  restartConfirmManual: 'The page reloads itself once the service is back.',
  restartYes: 'Restart now',
  restarting: 'Restarting dsh web, waiting for the service…',
  restartWaiting: 'The service has not answered yet; wait a moment or refresh the page.',
  restartFailed: 'The restart request failed',
  autoReload: 'Build finished: this page refreshes in 2 seconds to load the new frontend artifacts.',
  lastChecked: 'Last check',
  never: 'Never checked',
  pluginLabel: 'Plugin version',
}

type CopyKey = keyof typeof zh

/** Fill `{name}` placeholders in a translated line. */
function fill(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => key in params ? String(params[key]) : match)
}

/** Minimal slice of the client timer service the settings page needs. */
interface TimerLike {
  interval: (callback: () => void, delay: number) => () => void
}

/** Minimal slice of the client context this plugin uses. */
interface ClientContext {
  effect: (callback: () => () => void, label?: string) => unknown
  get: (service: string) => unknown
  slots: {
    inject: (key: string, callback: () => () => void) => unknown
    register: (options: Record<string, unknown>, component: () => ReactNode) => unknown
  }
  locale?: {
    register: (ns: string, dicts: { zh: Record<string, string>; en: Record<string, string> }) => () => void
    bind: (ns: string) => (key: string) => string
  }
}

/** Read a message out of an unknown thrown value. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Read the host's `{ error }` body, falling back to the status code. */
async function failureText(response: Response): Promise<string> {
  try {
    const body = await response.json() as { error?: unknown }
    if (typeof body.error === 'string') return body.error
  } catch {
    // A non-JSON error body is still an error; the status conveys it.
  }
  return `${String(response.status)} ${response.statusText}`
}

/** Fetch JSON from one route, turning a non-OK response into a thrown error. */
async function readJson<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  headers.set('accept', 'application/json')
  const response = await fetch(path, { ...init, headers })
  if (!response.ok) throw new Error(`${path}: ${await failureText(response)}`)
  return await response.json() as T
}

/** One labelled fact row. */
function fact(t: (key: CopyKey) => string, label: CopyKey, value: string): ReactNode {
  return createElement('div', { key: `${label}-${value}`, style: { display: 'flex', gap: 8, alignItems: 'baseline' } },
    createElement('span', { style: { color: 'var(--dsw-alias-label-secondary)', minWidth: 84 } }, t(label)),
    createElement('span', { style: { wordBreak: 'break-all' } }, value),
  )
}

/** The state line shown on one checkout card. */
function statusOf(repo: RepoView, t: (key: CopyKey) => string): { text: string; color: string } {
  if (!repo.ok) {
    return { text: repo.root === '' ? t('notDetected') : t('unavailable'), color: 'var(--dsw-alias-label-secondary)' }
  }
  // A checkout whose browser artifacts predate its commit has been pulled but
  // not rebuilt; that is the state a reader most easily mistakes for "done".
  if (repo.buildStale === true) {
    return {
      text: fill(t('staleBuild'), { version: repo.builtVersion ?? '?' }),
      color: 'var(--dsw-alias-state-warn-primary)',
    }
  }
  if ((repo.modified ?? 0) > 0) {
    return { text: fill(t('modified'), { count: repo.modified ?? 0 }), color: 'var(--dsw-alias-state-warn-primary)' }
  }
  if ((repo.behind ?? 0) > 0) {
    return { text: fill(t('behind'), { count: repo.behind ?? 0 }), color: 'var(--dsw-alias-state-warn-primary)' }
  }
  if ((repo.ahead ?? 0) > 0) return { text: t('diverged'), color: 'var(--dsw-alias-label-secondary)' }
  if ((repo.dirty ?? 0) > 0) {
    return { text: fill(t('untracked'), { count: repo.dirty ?? 0 }), color: 'var(--dsw-alias-label-secondary)' }
  }
  if (repo.upstream === undefined) return { text: t('noUpstream'), color: 'var(--dsw-alias-label-secondary)' }
  return { text: t('upToDate'), color: 'var(--dsw-alias-state-success-primary)' }
}

/** One step's status marker. */
function stepColor(status: StepStatus): string {
  if (status === 'failed') return 'var(--dsw-alias-state-error-primary)'
  if (status === 'ok') return 'var(--dsw-alias-state-success-primary)'
  if (status === 'running') return 'var(--dsw-alias-brand-primary)'
  return 'var(--dsw-alias-label-secondary)'
}

/** Localized name of one step key. */
function stepLabel(key: StepKey, t: (key: CopyKey) => string): string {
  if (key === 'clean') return t('stepClean')
  if (key === 'pull') return t('stepPull')
  if (key === 'install') return t('stepInstall')
  if (key === 'patch') return t('stepPatch')
  if (key === 'build') return t('stepBuild')
  return t('stepUnpatch')
}

interface SectionProps {
  t: (key: CopyKey) => string
  timer: TimerLike | undefined
}

/** How often to check whether the restarted service answers again. */
const RESTART_POLL_MS = 2000

/** Delay before refreshing a page whose build just finished, as the graph settles. */
const AUTO_RELOAD_MS = 2500

/** Reload the page once the restarted service answers. Returns a stop function. */
function awaitServerThenReload(onGiveUp: () => void): () => void {
  let stopped = false
  let attempts = 0
  const probe = (): void => {
    if (stopped) return
    attempts += 1
    void fetch(STATE_PATH, { headers: { accept: 'application/json' } }).then((response) => {
      if (stopped) return
      // A rejection means the process is still down; a rejection of our own
      // session would survive the reload, so stop rather than loop into it.
      if (response.status === 401 || response.status === 403) onGiveUp()
      else location.reload()
    }).catch(() => {
      if (attempts >= 45) onGiveUp()
      else setTimeout(probe, RESTART_POLL_MS)
    })
  }
  const handle = setTimeout(probe, RESTART_POLL_MS)
  return () => {
    stopped = true
    clearTimeout(handle)
  }
}

/** The Settings page body. */
function UpdateSection({ t, timer }: SectionProps): ReactNode {
  const [state, setState] = useState<StateView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const [confirming, setConfirming] = useState<RepoTarget | null>(null)
  const [starting, setStarting] = useState(false)
  const [confirmRestart, setConfirmRestart] = useState(false)
  const [restartPhase, setRestartPhase] = useState<'idle' | 'restarting' | 'waiting'>('idle')
  const [reloading, setReloading] = useState(false)
  const lastJob = useRef<JobMark | null>(null)

  /** Record what this page has seen, and react to a build that finished under it. */
  const noteJob = useCallback((job: JobView | null): void => {
    const previous = lastJob.current
    lastJob.current = job === null ? null : { id: job.id, status: job.status }
    if (buildFinished(previous, job)) setReloading(true)
  }, [])

  const refresh = useCallback(async () => {
    const next = await readJson<StateView>(STATE_PATH)
    setState(next)
    noteJob(next.job)
  }, [noteJob])

  useEffect(() => {
    void refresh().catch((cause: unknown) => setError(messageOf(cause)))
  }, [refresh])

  const jobStatus = state?.job?.status
  useEffect(() => {
    if (jobStatus !== 'running') return undefined
    const poll = (): void => {
      void readJson<{ job: JobView | null }>(JOB_PATH)
        .then((payload) => {
          setState(previous => previous === null ? previous : { ...previous, job: payload.job })
          noteJob(payload.job)
        })
        .catch((cause: unknown) => setError(messageOf(cause)))
    }
    if (timer !== undefined) return timer.interval(poll, JOB_POLL_MS)
    const handle = setInterval(poll, JOB_POLL_MS)
    return () => clearInterval(handle)
  }, [jobStatus, timer, noteJob])

  const check = (): void => {
    setChecking(true)
    setError(null)
    void readJson<StateView>(CHECK_PATH, { method: 'POST' })
      .then(setState)
      .catch((cause: unknown) => setError(messageOf(cause)))
      .finally(() => setChecking(false))
  }

  const update = (target: RepoTarget): void => {
    setConfirming(null)
    setStarting(true)
    setError(null)
    void readJson<{ job: JobView }>(APPLY_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target, confirm: true }),
    })
      .then(({ job }) => {
        setState(previous => previous === null ? previous : { ...previous, job })
        noteJob(job)
      })
      .catch((cause: unknown) => setError(messageOf(cause)))
      .finally(() => setStarting(false))
  }

  const restart = (): void => {
    setConfirmRestart(false)
    setError(null)
    void readJson<{ restarting: boolean; unit: string }>(RESTART_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirm: true }),
    })
      .then(() => {
        setRestartPhase('restarting')
        awaitServerThenReload(() => setRestartPhase('waiting'))
      })
      .catch((cause: unknown) => {
        setRestartPhase('idle')
        setError(`${t('restartFailed')}: ${messageOf(cause)}`)
      })
  }

  useEffect(() => {
    if (!reloading) return undefined
    const handle = setTimeout(() => location.reload(), AUTO_RELOAD_MS)
    return () => clearTimeout(handle)
  }, [reloading])

  const running = state?.job?.status === 'running'
  const busy = checking || starting || running

  const card = (repo: RepoView): ReactNode => {
    const status = statusOf(repo, t)
    const label = repo.key === 'harness' ? t('harness') : t('plugins')
    return createElement('section', {
      key: repo.key,
      style: {
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: 10,
        background: 'var(--dsw-alias-bg-layer-1)',
        padding: '14px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      },
    },
      createElement('div', { style: { display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' } },
        createElement('strong', { style: { fontSize: 15 } }, label),
        createElement('span', { style: { color: status.color, fontSize: 13 } }, status.text),
      ),
      repo.root === '' ? fact(t, 'path', t('notDetected')) : fact(t, 'path', repo.root),
      repo.branch === undefined ? null : fact(t, 'branch', repo.branch),
      repo.commit === undefined
        ? null
        : fact(t, 'commit', `${repo.commit.sha} ${repo.commit.subject} · ${repo.commit.date.slice(0, 10)}`),
      repo.version === undefined ? null : fact(t, 'version', repo.version),
      repo.builtVersion === undefined ? null : fact(t, 'builtVersion', repo.builtVersion),
      repo.latestTag === undefined ? null : fact(t, 'latestTag', repo.latestTag),
      repo.root === '' ? createElement('div', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: 12 } }, t('notDetectedHint')) : null,
      repo.ok || repo.root === '' ? null : createElement('div', { style: { color: 'var(--dsw-alias-state-error-primary)', fontSize: 12 } }, repo.error ?? ''),
      repo.fetchError === undefined
        ? null
        : createElement('div', { style: { color: 'var(--dsw-alias-state-error-primary)', fontSize: 12, whiteSpace: 'pre-wrap' } },
          `${t('fetchError')}: ${repo.fetchError}`),
      confirming === repo.key
        ? createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 } },
          createElement('div', { style: { fontSize: 13, color: 'var(--dsw-alias-state-warn-primary)' } },
            repo.key === 'harness' ? t('confirmHarness') : t('confirmPlugins')),
          repo.key === 'harness'
            ? createElement('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } }, t('buildWarning'))
            : null,
          createElement('div', { style: { display: 'flex', gap: 8 } },
            createElement('button', {
              type: 'button',
              disabled: busy,
              onClick: () => update(repo.key),
              style: buttonStyle(true),
            }, t('confirm')),
            createElement('button', {
              type: 'button',
              onClick: () => setConfirming(null),
              style: buttonStyle(false),
            }, t('cancel')),
          ),
        )
        : createElement('div', { style: { marginTop: 4 } },
          createElement('button', {
            type: 'button',
            disabled: busy || !repo.ok,
            onClick: () => setConfirming(repo.key),
            style: buttonStyle(false),
          }, running ? t('updating') : t('update')),
        ),
    )
  }

  const jobPanel = (job: JobView): ReactNode => createElement('section', {
    style: {
      border: '1px solid var(--dsw-alias-border-l1)',
      borderRadius: 10,
      background: 'var(--dsw-alias-bg-layer-2)',
      padding: '14px 16px',
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
    },
  },
    createElement('strong', {
      style: {
        fontSize: 14,
        color: job.status === 'failed'
          ? 'var(--dsw-alias-state-error-primary)'
          : job.status === 'succeeded' ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-brand-primary)',
      },
    }, job.status === 'running' ? t('jobRunning') : job.status === 'succeeded' ? t('jobSucceeded') : t('jobFailed')),
    ...job.steps.map(step => createElement('details', {
      key: step.key,
      // A failed step opens itself: its last line carries the reason, which is
      // exactly what a reader needs without hunting for the disclosure. A patch
      // that would not apply opens too, since that is the warning worth reading.
      open: step.status === 'running' || step.status === 'failed'
        || (step.status === 'skipped' && step.key === 'patch'),
    },
      createElement('summary', { style: { cursor: 'pointer', color: stepColor(step.status), fontSize: 13 } },
        `${step.status === 'pending' ? '○' : step.status === 'running' ? '◐' : step.status === 'ok' ? '●' : step.status === 'skipped' ? '⊘' : '✕'} `
        + `${stepLabel(step.key, t)} · ${step.command}`
        + `${step.status === 'skipped' ? t('stepSkipped') : ''}`),
      step.log.length === 0
        ? null
        : createElement('pre', {
          style: {
            margin: '6px 0 0',
            padding: 10,
            maxHeight: 260,
            overflow: 'auto',
            fontSize: 12,
            lineHeight: 1.5,
            background: 'var(--dsw-alias-bg-base)',
            border: '1px solid var(--dsw-alias-border-l1)',
            borderRadius: 8,
            whiteSpace: 'pre-wrap',
          },
        }, step.log.join('\n')),
    )),
    job.status === 'succeeded' ? createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
      restartPhase === 'idle' ? null : createElement('div', {
        style: { fontSize: 13, color: 'var(--dsw-alias-brand-primary)' },
      }, restartPhase === 'restarting' ? t('restarting') : t('restartWaiting')),
      createElement('div', { style: { fontSize: 13, color: 'var(--dsw-alias-state-warn-primary)' } }, t('refreshHint')),
      state?.restart?.available === true
        ? restartPhase === 'idle'
          ? (confirmRestart
            ? createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
              createElement('div', { style: { fontSize: 13, color: 'var(--dsw-alias-state-warn-primary)' } },
                fill(t('restartConfirm'), { unit: state.restart?.unit ?? 'dsh-web.service' })),
              createElement('div', { style: { display: 'flex', gap: 8 } },
                createElement('button', { type: 'button', onClick: restart, style: buttonStyle(true) }, t('restartYes')),
                createElement('button', { type: 'button', onClick: () => setConfirmRestart(false), style: buttonStyle(false) }, t('cancel')),
              ),
            )
            : createElement('div', null,
              createElement('button', {
                type: 'button',
                onClick: () => setConfirmRestart(true),
                style: buttonStyle(true),
              }, t('restart')),
            ))
          : null
        : createElement('div', { style: { fontSize: 13, color: 'var(--dsw-alias-state-warn-primary)' } }, t('restartHint')),
    ) : null,
    job.status === 'failed'
      ? createElement('div', { style: { fontSize: 13, color: 'var(--dsw-alias-state-error-primary)' } }, t('refreshHint'))
      : null,
  )

  return createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 780, paddingBottom: 24 } },
    createElement('div', null,
      createElement('h2', { style: { margin: '0 0 6px', fontSize: 18 } }, t('title')),
      createElement('p', { style: { margin: 0, color: 'var(--dsw-alias-label-secondary)', fontSize: 13, lineHeight: 1.6 } }, t('intro')),
    ),
    createElement('div', { style: { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' } },
      createElement('button', {
        type: 'button',
        disabled: busy,
        onClick: check,
        style: buttonStyle(false),
      }, checking ? t('checking') : t('check')),
      createElement('span', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } },
        `${t('lastChecked')}: ${state?.checkedAt === null || state?.checkedAt === undefined ? t('never') : state.checkedAt}`),
      state === null
        ? null
        : createElement('span', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', marginLeft: 'auto' } },
          `${t('pluginLabel')} ${state.plugin.version}`),
    ),
    error === null
      ? null
      : createElement('div', {
        style: {
          border: '1px solid var(--dsw-alias-state-error-primary)',
          color: 'var(--dsw-alias-state-error-primary)',
          borderRadius: 8,
          padding: '8px 12px',
          fontSize: 13,
          whiteSpace: 'pre-wrap',
        },
      }, error),
    reloading
      ? createElement('div', {
        style: {
          border: '1px solid var(--dsw-alias-brand-primary)',
          color: 'var(--dsw-alias-brand-primary)',
          borderRadius: 8,
          padding: '8px 12px',
          fontSize: 13,
        },
      }, t('autoReload'))
      : null,
    state === null
      ? createElement('div', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: 13 } }, t('checking'))
      : createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } }, ...state.repos.map(card)),
    state?.job === null || state?.job === undefined ? null : jobPanel(state.job),
  )
}

/** One button's inline style; the primary variant carries the brand accent. */
function buttonStyle(primary: boolean): Record<string, string> {
  return {
    padding: '6px 14px',
    fontSize: 13,
    borderRadius: 8,
    cursor: 'pointer',
    border: `1px solid ${primary ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-border-l2)'}`,
    background: primary ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-bg-layer-1)',
    color: primary ? 'var(--dsw-alias-bg-base)' : 'var(--dsw-alias-label-primary)',
  }
}

/**
 * Contribute the update page to the Settings navigation.
 * @param ctx - client context carrying the slot service.
 */
export function apply(ctx: ClientContext): void {
  const locale = ctx.get('locale') as ClientContext['locale']
  if (locale !== undefined) {
    ctx.effect(() => locale.register(NS, { zh, en }), 'vae-update: dictionaries')
  }
  const translate = locale === undefined ? undefined : locale.bind(NS)
  const t = (key: CopyKey): string => translate?.(key) ?? zh[key]
  const timer = ctx.get('timer') as TimerLike | undefined

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'vae-update',
    order: 30,
    label: () => t('nav'),
  }, () => createElement(UpdateSection, { t, timer })))
}
