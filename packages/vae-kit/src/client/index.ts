/**
 * Client half of `dsh-vae-kit`: Settings page for the personal MCP + Skill kit.
 * @module dsh-vae-kit/client
 */

import { createElement, useCallback, useEffect, useState, type ReactNode } from 'react'

/** Locale namespace owned by this plugin. */
export const NS = 'vae-kit'

/** The slot service is the only hard dependency. */
export const inject = ['slots']

const STATE_PATH = '/api/vae-kit.state'
const RELOAD_PATH = '/api/vae-kit.reload'
const ENABLE_PATH = '/api/vae-kit.enable'

type ItemKind = 'mcp' | 'skill'
type Enablement = 'on' | 'off'
type EffectiveMode = 'off' | 'global' | 'project'

interface ResolvedItemView {
  kind: ItemKind
  id: string
  title: string
  description: string
  default: 'global' | 'project' | 'off'
  tags: string[]
  error?: string
  global: Enablement | 'inherit'
  project: Enablement | 'inherit' | null
  effective: EffectiveMode
  enabled: boolean
  mcp?: {
    serverName: string
    transport: string
    status: 'idle' | 'mounted-global' | 'mounted-project' | 'error'
    error?: string
  }
}

interface KitStateView {
  kitRoot: string
  dshHome: string
  globalFile: string
  projectFile: string | null
  projectRoot: string | null
  projects: { path: string; title: string }[]
  mcp: ResolvedItemView[]
  skills: ResolvedItemView[]
  warnings: string[]
  error: string | null
}

const zh = {
  nav: 'MCP / Skills',
  title: '个人 MCP 与 Skill',
  intro: '货架在 dsh-vae-kit 的 kit/ 目录。这里只改开关：全局写入 ~/.dsh/extensions.yml，当前项目写入仓库的 .dsh/extensions.yml。同名 id 项目赢。',
  reload: '重新加载',
  reloading: '加载中…',
  kitRoot: 'Kit 目录',
  globalFile: '全局开关',
  projectFile: '项目开关',
  noProject: '没有打开的项目，项目开关不可用。',
  project: '当前项目',
  mcp: 'MCP 服务器',
  skills: 'Skills',
  empty: '目录是空的。',
  inherit: '跟随默认',
  on: '开',
  off: '关',
  scopeGlobal: '全局',
  scopeProject: '项目',
  effectiveOff: '未启用',
  effectiveGlobal: '全局启用',
  effectiveProject: '仅此项目',
  defaultGlobal: '目录默认：全局',
  defaultProject: '目录默认：按项目',
  defaultOff: '目录默认：关',
  statusIdle: '未挂载',
  statusMounted: '已在 Host 挂载',
  statusProject: '挂在当前项目的会话里',
  statusError: '挂载失败',
  warnings: '目录警告',
  missingKit: '未检测到 kit 目录。在 bundle 的 config.kitRoot 里写绝对路径。',
} as const

const en: Record<keyof typeof zh, string> = {
  nav: 'MCP / Skills',
  title: 'Personal MCP and Skills',
  intro: 'The catalog lives in this plugin’s kit/ directory. This page only flips switches: global writes ~/.dsh/extensions.yml; the current project writes that repo’s .dsh/extensions.yml. Same id: project wins.',
  reload: 'Reload',
  reloading: 'Loading…',
  kitRoot: 'Kit directory',
  globalFile: 'Global file',
  projectFile: 'Project file',
  noProject: 'No project is open, so project switches are disabled.',
  project: 'Current project',
  mcp: 'MCP servers',
  skills: 'Skills',
  empty: 'The catalog is empty.',
  inherit: 'Follow default',
  on: 'On',
  off: 'Off',
  scopeGlobal: 'Global',
  scopeProject: 'Project',
  effectiveOff: 'Off',
  effectiveGlobal: 'On globally',
  effectiveProject: 'This project only',
  defaultGlobal: 'Catalog default: global',
  defaultProject: 'Catalog default: per project',
  defaultOff: 'Catalog default: off',
  statusIdle: 'Not mounted',
  statusMounted: 'Mounted on the Host',
  statusProject: 'Mounted in this project’s sessions',
  statusError: 'Mount failed',
  warnings: 'Catalog warnings',
  missingKit: 'Kit directory not detected. Set config.kitRoot in the bundle patch.',
}

type CopyKey = keyof typeof zh

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

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function failureText(response: Response): Promise<string> {
  try {
    const body = await response.json() as { error?: unknown }
    if (typeof body.error === 'string') return body.error
  } catch {
    // Non-JSON error bodies still fail; the status is enough.
  }
  return `${String(response.status)} ${response.statusText}`
}

async function readJson<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  headers.set('accept', 'application/json')
  const response = await fetch(path, { ...init, headers })
  if (!response.ok) throw new Error(`${path}: ${await failureText(response)}`)
  return await response.json() as T
}

function buttonStyle(primary: boolean, disabled = false): Record<string, string | number> {
  return {
    padding: '4px 10px',
    fontSize: 12,
    borderRadius: 8,
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.5 : 1,
    border: `1px solid ${primary ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-border-l2)'}`,
    background: primary ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-bg-layer-1)',
    color: primary ? 'var(--dsw-alias-bg-base)' : 'var(--dsw-alias-label-primary)',
  }
}

function effectiveLabel(mode: EffectiveMode, t: (key: CopyKey) => string): string {
  if (mode === 'global') return t('effectiveGlobal')
  if (mode === 'project') return t('effectiveProject')
  return t('effectiveOff')
}

function defaultLabel(value: ResolvedItemView['default'], t: (key: CopyKey) => string): string {
  if (value === 'global') return t('defaultGlobal')
  if (value === 'project') return t('defaultProject')
  return t('defaultOff')
}

function mcpStatus(item: ResolvedItemView, t: (key: CopyKey) => string): { text: string; color: string } {
  const status = item.mcp?.status
  if (status === 'mounted-global') {
    return { text: t('statusMounted'), color: 'var(--dsw-alias-state-success-primary)' }
  }
  if (status === 'mounted-project') {
    return { text: t('statusProject'), color: 'var(--dsw-alias-state-success-primary)' }
  }
  if (status === 'error') {
    return { text: `${t('statusError')}: ${item.mcp?.error ?? ''}`, color: 'var(--dsw-alias-state-error-primary)' }
  }
  return { text: t('statusIdle'), color: 'var(--dsw-alias-label-secondary)' }
}

function KitSection({ t }: { t: (key: CopyKey) => string }): ReactNode {
  const [state, setState] = useState<KitStateView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [project, setProject] = useState<string>('')

  const load = useCallback(async (nextProject?: string) => {
    const query = nextProject === undefined || nextProject === '' ? '' : `?project=${encodeURIComponent(nextProject)}`
    const view = await readJson<KitStateView>(`${STATE_PATH}${query}`)
    setState(view)
    setProject(view.projectRoot ?? '')
    setError(view.error)
  }, [])

  useEffect(() => {
    void load().catch((caught: unknown) => setError(messageOf(caught)))
  }, [load])

  const reload = async () => {
    setBusy(true)
    try {
      const query = project === '' ? '' : `?project=${encodeURIComponent(project)}`
      const view = await readJson<KitStateView>(`${RELOAD_PATH}${query}`, { method: 'POST', body: '{}' })
      const refreshed = view
      setState(refreshed)
      setProject(refreshed.projectRoot ?? '')
      setError(refreshed.error)
    } catch (caught) {
      setError(messageOf(caught))
    } finally {
      setBusy(false)
    }
  }

  const enable = async (kind: ItemKind, id: string, scope: 'global' | 'project', value: Enablement | 'inherit') => {
    setBusy(true)
    try {
      const view = await readJson<KitStateView>(ENABLE_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind, id, scope, value, project: project === '' ? undefined : project }),
      })
      setState(view)
      setProject(view.projectRoot ?? '')
      setError(view.error)
    } catch (caught) {
      setError(messageOf(caught))
    } finally {
      setBusy(false)
    }
  }

  const switchProject = async (path: string) => {
    setBusy(true)
    try {
      await load(path)
    } catch (caught) {
      setError(messageOf(caught))
    } finally {
      setBusy(false)
    }
  }

  const group = (title: CopyKey, items: ResolvedItemView[]): ReactNode => createElement('section', {
    style: { display: 'flex', flexDirection: 'column', gap: 10 },
  },
    createElement('h3', { style: { margin: 0, fontSize: 15 } }, t(title)),
    items.length === 0
      ? createElement('div', { style: { fontSize: 13, color: 'var(--dsw-alias-label-secondary)' } }, t('empty'))
      : items.map(item => card(item, t, busy, project, enable)),
  )

  return createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 820, paddingBottom: 24 } },
    createElement('div', null,
      createElement('h2', { style: { margin: '0 0 6px', fontSize: 18 } }, t('title')),
      createElement('p', { style: { margin: 0, color: 'var(--dsw-alias-label-secondary)', fontSize: 13, lineHeight: 1.6 } }, t('intro')),
    ),
    createElement('div', { style: { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' } },
      createElement('button', { type: 'button', disabled: busy, onClick: () => void reload(), style: buttonStyle(false, busy) },
        busy ? t('reloading') : t('reload')),
      state === null ? null : createElement('span', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } },
        `${t('kitRoot')}: ${state.kitRoot || t('missingKit')}`),
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
    state === null
      ? createElement('div', { style: { fontSize: 13, color: 'var(--dsw-alias-label-secondary)' } }, t('reloading'))
      : createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 16 } },
        fact(t, 'globalFile', state.globalFile),
        fact(t, 'projectFile', state.projectFile ?? t('noProject')),
        state.warnings.length === 0
          ? null
          : createElement('div', {
            style: {
              border: '1px solid var(--dsw-alias-state-warn-primary)',
              color: 'var(--dsw-alias-state-warn-primary)',
              borderRadius: 8,
              padding: '8px 12px',
              fontSize: 13,
              whiteSpace: 'pre-wrap',
            },
          }, `${t('warnings')}\n${state.warnings.join('\n')}`),
        state.projects.length === 0
          ? createElement('div', { style: { fontSize: 13, color: 'var(--dsw-alias-label-secondary)' } }, t('noProject'))
          : createElement('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 } },
            t('project'),
            createElement('select', {
              value: project,
              disabled: busy,
              onChange: (event: { target: { value: string } }) => void switchProject(event.target.value),
              style: {
                flex: 1,
                padding: '4px 8px',
                borderRadius: 8,
                border: '1px solid var(--dsw-alias-border-l2)',
                background: 'var(--dsw-alias-bg-layer-1)',
                color: 'var(--dsw-alias-label-primary)',
              },
            }, ...state.projects.map(row => createElement('option', { key: row.path, value: row.path }, `${row.title} — ${row.path}`))),
          ),
        group('mcp', state.mcp),
        group('skills', state.skills),
      ),
  )
}

function fact(t: (key: CopyKey) => string, label: CopyKey, value: string): ReactNode {
  return createElement('div', { style: { display: 'flex', gap: 8, fontSize: 12 } },
    createElement('span', { style: { color: 'var(--dsw-alias-label-secondary)', minWidth: 72 } }, t(label)),
    createElement('span', { style: { wordBreak: 'break-all' } }, value),
  )
}

function card(
  item: ResolvedItemView,
  t: (key: CopyKey) => string,
  busy: boolean,
  project: string,
  enable: (kind: ItemKind, id: string, scope: 'global' | 'project', value: Enablement | 'inherit') => Promise<void>,
): ReactNode {
  const color = item.effective === 'off'
    ? 'var(--dsw-alias-label-secondary)'
    : 'var(--dsw-alias-state-success-primary)'
  const status = item.kind === 'mcp' ? mcpStatus(item, t) : undefined
  return createElement('div', {
    key: `${item.kind}-${item.id}`,
    style: {
      border: '1px solid var(--dsw-alias-border-l2)',
      borderRadius: 10,
      padding: 12,
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
    },
  },
    createElement('div', { style: { display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' } },
      createElement('strong', { style: { fontSize: 14 } }, item.title),
      createElement('span', { style: { fontSize: 12, color } }, effectiveLabel(item.effective, t)),
    ),
    createElement('div', { style: { fontSize: 13, color: 'var(--dsw-alias-label-secondary)', lineHeight: 1.5 } }, item.description),
    createElement('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } },
      `${item.id} · ${defaultLabel(item.default, t)}`),
    item.error === undefined
      ? null
      : createElement('div', { style: { fontSize: 12, color: 'var(--dsw-alias-state-error-primary)' } }, item.error),
    status === undefined
      ? null
      : createElement('div', { style: { fontSize: 12, color: status.color } },
        `${item.mcp?.serverName ?? ''} · ${status.text}`),
    createElement('div', { style: { display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12 } },
      toggles(t('scopeGlobal'), item.global, busy, value => void enable(item.kind, item.id, 'global', value), t),
      toggles(t('scopeProject'), item.project ?? 'inherit', busy || project === '', value => void enable(item.kind, item.id, 'project', value), t),
    ),
  )
}

function toggles(
  label: string,
  current: Enablement | 'inherit',
  disabled: boolean,
  onChange: (value: Enablement | 'inherit') => void,
  t: (key: CopyKey) => string,
): ReactNode {
  const options: { id: Enablement | 'inherit'; label: CopyKey }[] = [
    { id: 'inherit', label: 'inherit' },
    { id: 'on', label: 'on' },
    { id: 'off', label: 'off' },
  ]
  return createElement('div', { style: { display: 'flex', gap: 6, alignItems: 'center' } },
    createElement('span', { style: { color: 'var(--dsw-alias-label-secondary)' } }, label),
    ...options.map(option => createElement('button', {
      key: option.id,
      type: 'button',
      disabled,
      onClick: () => onChange(option.id),
      style: buttonStyle(current === option.id, disabled),
    }, t(option.label))),
  )
}

/**
 * Contribute the kit page to Settings.
 * @param ctx - client context carrying slots.
 */
export function apply(ctx: ClientContext): void {
  const locale = ctx.get('locale') as ClientContext['locale']
  if (locale !== undefined) {
    ctx.effect(() => locale.register(NS, { zh, en }), 'vae-kit: dictionaries')
  }
  const translate = locale === undefined ? undefined : locale.bind(NS)
  const t = (key: CopyKey): string => translate?.(key) ?? zh[key]
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'vae-kit',
    order: 35,
    label: () => t('nav'),
  }, () => createElement(KitSection, { t })))
}
