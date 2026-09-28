/**
 * Client half of `dsh-vae-kit`: Settings page for the personal MCP + Skill kit.
 * @module dsh-vae-kit/client
 */

import { createElement, useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'

/** Locale namespace owned by this plugin. */
export const NS = 'vae-kit'

/** The slot service is the only hard dependency. */
export const inject = ['slots']

const STATE_PATH = '/api/vae-kit.state'
const RELOAD_PATH = '/api/vae-kit.reload'
const ENABLE_PATH = '/api/vae-kit.enable'

type ItemKind = 'mcp' | 'skill'
type TabId = 'mcp' | 'skills'
type FilterId = 'all' | 'on' | 'off'
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
    status: 'idle' | 'mounting' | 'mounted-global' | 'mounted-project' | 'error'
    error?: string
    tools: string[]
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
  intro: '右侧开关控制当前是否启用。点开一行可查看已挂载的工具，并分别设置「所有会话」和「仅当前仓库」。仓库设置优先。',
  tabs: 'MCP 与 Skills',
  reload: '重新加载',
  reloading: '加载中…',
  searchMcp: '搜索服务器',
  searchSkills: '搜索技能',
  filterAll: '全部',
  filterOn: '已开启',
  filterOff: '未开启',
  empty: '目录是空的。',
  emptyFilter: '没有符合筛选的项目。',
  inherit: '跟随上层',
  on: '开',
  off: '关',
  scopeGlobal: '所有会话',
  scopeProject: '仅当前仓库',
  badgeOff: '未启用',
  badgeGlobal: '所有会话',
  badgeProject: '仅此仓库',
  noProject: '没有打开的项目，「仅当前仓库」不可用。',
  project: '当前项目',
  mcp: 'MCP',
  skills: 'Skills',
  statusIdle: '未挂载',
  statusMounting: '正在启动…',
  statusMounted: '已挂载',
  statusProject: '项目会话',
  statusError: '挂载失败',
  toolsCount: '{count} 个工具',
  noTools: '还没有工具名。',
  expand: '展开',
  collapse: '收起',
  warnings: '目录警告',
  missingKit: '未检测到 kit 目录。',
} as const

const en: Record<keyof typeof zh, string> = {
  nav: 'MCP / Skills',
  title: 'Personal MCP and Skills',
  intro: 'The switch on the right turns an item on or off for this view. Expand a row to see mounted tools and to set “every session” versus “this repo only”. The repo setting wins.',
  tabs: 'MCP and Skills',
  reload: 'Reload',
  reloading: 'Loading…',
  searchMcp: 'Search servers',
  searchSkills: 'Search skills',
  filterAll: 'All',
  filterOn: 'On',
  filterOff: 'Off',
  empty: 'The catalog is empty.',
  emptyFilter: 'Nothing matches this filter.',
  inherit: 'Follow parent',
  on: 'On',
  off: 'Off',
  scopeGlobal: 'Every session',
  scopeProject: 'This repo only',
  badgeOff: 'Off',
  badgeGlobal: 'Every session',
  badgeProject: 'This repo only',
  noProject: 'No project is open, so the repo switch is disabled.',
  project: 'Current project',
  mcp: 'MCP',
  skills: 'Skills',
  statusIdle: 'Not mounted',
  statusMounting: 'Starting…',
  statusMounted: 'Mounted',
  statusProject: 'Project session',
  statusError: 'Mount failed',
  toolsCount: '{count} tools',
  noTools: 'No tool names yet.',
  expand: 'Expand',
  collapse: 'Collapse',
  warnings: 'Catalog warnings',
  missingKit: 'Kit directory not detected.',
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

function mcpStatus(item: ResolvedItemView, t: (key: CopyKey) => string): { text: string; color: string } {
  const status = item.mcp?.status
  if (status === 'mounted-global') {
    return { text: t('statusMounted'), color: 'var(--dsw-alias-state-success-primary)' }
  }
  if (status === 'mounted-project') {
    return { text: t('statusProject'), color: 'var(--dsw-alias-state-success-primary)' }
  }
  if (status === 'mounting') {
    return { text: t('statusMounting'), color: 'var(--dsw-alias-state-warn-primary)' }
  }
  if (status === 'error') {
    return { text: `${t('statusError')}: ${item.mcp?.error ?? ''}`, color: 'var(--dsw-alias-state-error-primary)' }
  }
  return { text: t('statusIdle'), color: 'var(--dsw-alias-label-secondary)' }
}

function isMounting(view: KitStateView | null): boolean {
  return view?.mcp.some(item => item.mcp?.status === 'mounting') === true
}

function scopeBadge(item: ResolvedItemView, t: (key: CopyKey) => string): string {
  if (item.effective === 'global') return t('badgeGlobal')
  if (item.effective === 'project') return t('badgeProject')
  return t('badgeOff')
}

function matchesQuery(item: ResolvedItemView, query: string): boolean {
  if (query === '') return true
  const haystack = [
    item.title, item.id, item.description, item.mcp?.serverName ?? '',
    ...(item.mcp?.tools ?? []),
  ].join(' ').toLowerCase()
  return haystack.includes(query)
}

function KitSection({ t }: { t: (key: CopyKey) => string }): ReactNode {
  const [state, setState] = useState<KitStateView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [project, setProject] = useState<string>('')
  const [tab, setTab] = useState<TabId>('mcp')
  const [filter, setFilter] = useState<FilterId>('all')
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const [visited, setVisited] = useState<ReadonlySet<TabId>>(() => new Set(['mcp']))
  const tabsId = useId()
  const tabRefs = useRef<unknown[]>([])

  const load = useCallback(async (nextProject?: string) => {
    const path = nextProject === undefined || nextProject === '' ? '' : `?project=${encodeURIComponent(nextProject)}`
    const view = await readJson<KitStateView>(`${STATE_PATH}${path}`)
    setState(view)
    setProject(view.projectRoot ?? '')
    setError(view.error)
  }, [])

  useEffect(() => {
    void load().catch((caught: unknown) => setError(messageOf(caught)))
  }, [load])

  const mounting = isMounting(state)
  useEffect(() => {
    if (!mounting) return undefined
    const timer = setInterval(() => {
      void load(project === '' ? undefined : project).catch((caught: unknown) => setError(messageOf(caught)))
    }, 1500)
    return () => clearInterval(timer)
  }, [load, project, mounting])

  const reload = async () => {
    setBusy(true)
    try {
      const path = project === '' ? '' : `?project=${encodeURIComponent(project)}`
      const view = await readJson<KitStateView>(`${RELOAD_PATH}${path}`, { method: 'POST', body: '{}' })
      setState(view)
      setProject(view.projectRoot ?? '')
      setError(view.error)
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

  const selectTab = (next: TabId) => {
    setTab(next)
    setQuery('')
    setFilter('all')
    setVisited((previous) => {
      if (previous.has(next)) return previous
      return new Set([...previous, next])
    })
  }

  const toggleExpanded = (key: string) => {
    setExpanded((previous) => {
      const next = new Set(previous)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const toggleEffective = (item: ResolvedItemView) => {
    if (item.effective !== 'off') {
      if (item.effective === 'project' || item.project === 'on') {
        void enable(item.kind, item.id, 'project', 'off')
        return
      }
      void enable(item.kind, item.id, 'global', 'off')
      return
    }
    void enable(item.kind, item.id, 'global', 'on')
  }

  const tabs: { id: TabId; label: CopyKey }[] = [
    { id: 'mcp', label: 'mcp' },
    { id: 'skills', label: 'skills' },
  ]

  const panel = (kind: TabId, items: ResolvedItemView[]): ReactNode => {
    const needle = query.trim().toLowerCase()
    const matched = items.filter(item => matchesQuery(item, needle))
    const onItems = matched.filter(item => item.effective !== 'off')
    const offItems = matched.filter(item => item.effective === 'off')
    const shown = filter === 'on' ? onItems : filter === 'off' ? offItems : matched
    const emptyKey: CopyKey = items.length === 0 ? 'empty' : 'emptyFilter'

    return createElement('div', {
      key: kind,
      id: `${tabsId}-panel-${kind}`,
      role: 'tabpanel',
      'aria-labelledby': `${tabsId}-tab-${kind}`,
      hidden: tab !== kind,
      style: { display: tab === kind ? 'flex' : 'none', flexDirection: 'column', gap: 12, minWidth: 0, paddingTop: 4 },
    },
      toolbar(t, kind, matched, onItems, offItems, filter, setFilter, query, setQuery, busy, project, state, switchProject, reload),
      shown.length === 0
        ? createElement('div', { style: { fontSize: 13, color: 'var(--dsw-alias-label-tertiary)', padding: '28px 0', textAlign: 'center' } }, t(emptyKey))
        : createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
          ...shown.map(item => row(
            item, t, busy, project, expanded.has(`${item.kind}-${item.id}`),
            () => toggleExpanded(`${item.kind}-${item.id}`), enable, () => toggleEffective(item),
          ))),
    )
  }

  return createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 920, paddingBottom: 24, color: 'var(--dsw-alias-label-primary)' } },
    createElement('div', null,
      createElement('h2', { style: { margin: 0, fontSize: 18, fontWeight: 600 } }, t('title')),
      createElement('p', { style: { margin: '4px 0 0', color: 'var(--dsw-alias-label-tertiary)', fontSize: 13, lineHeight: 1.6 } }, t('intro')),
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
      : createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
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
        createElement('div', {
          role: 'tablist',
          'aria-label': t('tabs'),
          style: {
            display: 'flex',
            alignItems: 'flex-end',
            gap: 22,
            borderBottom: '0.5px solid var(--dsw-alias-border-l2)',
          },
        }, ...tabs.map((rowTab, index) => {
          const selected = rowTab.id === tab
          return createElement('button', {
            key: rowTab.id,
            ref: (element: unknown) => { tabRefs.current[index] = element },
            id: `${tabsId}-tab-${rowTab.id}`,
            type: 'button',
            role: 'tab',
            'aria-selected': selected,
            'aria-controls': `${tabsId}-panel-${rowTab.id}`,
            tabIndex: selected ? 0 : -1,
            onClick: () => selectTab(rowTab.id),
            onKeyDown: (event: { key: string; preventDefault: () => void }) => {
              let nextIndex: number
              switch (event.key) {
                case 'ArrowRight': nextIndex = (index + 1) % tabs.length; break
                case 'ArrowLeft': nextIndex = (index - 1 + tabs.length) % tabs.length; break
                case 'Home': nextIndex = 0; break
                case 'End': nextIndex = tabs.length - 1; break
                default: return
              }
              event.preventDefault()
              const next = tabs[nextIndex]
              if (next === undefined) return
              selectTab(next.id)
              const node = tabRefs.current[nextIndex] as { focus?: () => void } | null
              node?.focus?.()
            },
            style: {
              position: 'relative',
              border: 0,
              borderBottom: selected ? '2px solid var(--dsw-alias-label-primary)' : '2px solid transparent',
              marginBottom: -1,
              padding: '7px 1px 9px',
              background: 'transparent',
              color: selected ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-tertiary)',
              font: 'inherit',
              fontSize: 13,
              lineHeight: '20px',
              cursor: 'pointer',
            },
          }, t(rowTab.label))
        })),
        visited.has('mcp') ? panel('mcp', state.mcp) : null,
        visited.has('skills') ? panel('skills', state.skills) : null,
      ),
  )
}

function toolbar(
  t: (key: CopyKey) => string,
  kind: TabId,
  matched: ResolvedItemView[],
  onItems: ResolvedItemView[],
  offItems: ResolvedItemView[],
  filter: FilterId,
  setFilter: (next: FilterId) => void,
  query: string,
  setQuery: (next: string) => void,
  busy: boolean,
  project: string,
  state: KitStateView | null,
  switchProject: (path: string) => Promise<void>,
  reload: () => Promise<void>,
): ReactNode {
  const chips: { id: FilterId; label: CopyKey; count: number }[] = [
    { id: 'all', label: 'filterAll', count: matched.length },
    { id: 'on', label: 'filterOn', count: onItems.length },
    { id: 'off', label: 'filterOff', count: offItems.length },
  ]
  return createElement('div', { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
    createElement('div', { style: { display: 'flex', gap: 6 } }, ...chips.map(chip => {
      const selected = chip.id === filter
      return createElement('button', {
        key: chip.id,
        type: 'button',
        onClick: () => setFilter(chip.id),
        style: {
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 10px',
          borderRadius: 999,
          border: selected ? '1px solid var(--dsw-alias-label-primary)' : '1px solid var(--dsw-alias-border-l2)',
          background: selected ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-bg-layer-1)',
          color: selected ? 'var(--dsw-alias-bg-base)' : 'var(--dsw-alias-label-primary)',
          fontSize: 12,
          cursor: 'pointer',
        },
      }, t(chip.label), createElement('span', { style: { opacity: 0.72 } }, String(chip.count)))
    })),
    createElement('input', {
      type: 'search',
      value: query,
      placeholder: t(kind === 'mcp' ? 'searchMcp' : 'searchSkills'),
      onChange: (event: { target: { value: string } }) => setQuery(event.target.value),
      style: {
        flex: '1 1 160px',
        minWidth: 140,
        padding: '6px 10px',
        borderRadius: 999,
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-layer-1)',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: 12,
      },
    }),
    state === null || state.projects.length === 0
      ? null
      : createElement('select', {
        value: project,
        disabled: busy,
        'aria-label': t('project'),
        onChange: (event: { target: { value: string } }) => void switchProject(event.target.value),
        style: {
          maxWidth: 240,
          padding: '6px 8px',
          borderRadius: 8,
          border: '1px solid var(--dsw-alias-border-l2)',
          background: 'var(--dsw-alias-bg-layer-1)',
          color: 'var(--dsw-alias-label-primary)',
          fontSize: 12,
        },
      }, ...state.projects.map(row => createElement('option', { key: row.path, value: row.path }, `${row.title}`))),
    createElement('button', { type: 'button', disabled: busy, onClick: () => void reload(), style: buttonStyle(false, busy) },
      busy ? t('reloading') : t('reload')),
  )
}

function badge(text: string, tone: 'muted' | 'ok' | 'warn' = 'muted'): ReactNode {
  const color = tone === 'ok'
    ? 'var(--dsw-alias-state-success-primary)'
    : tone === 'warn'
      ? 'var(--dsw-alias-state-warn-primary)'
      : 'var(--dsw-alias-label-secondary)'
  return createElement('span', { style: { fontSize: 11, color } }, text)
}

function switchControl(on: boolean, disabled: boolean, onClick: () => void, label: string): ReactNode {
  return createElement('button', {
    type: 'button',
    role: 'switch',
    'aria-checked': on,
    'aria-label': label,
    disabled,
    onClick,
    style: {
      width: 40,
      height: 22,
      padding: 2,
      borderRadius: 999,
      border: 0,
      cursor: disabled ? 'default' : 'pointer',
      opacity: disabled ? 0.5 : 1,
      background: on ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-border-l2)',
      flex: '0 0 auto',
    },
  }, createElement('span', {
    style: {
      display: 'block',
      width: 18,
      height: 18,
      borderRadius: 999,
      background: 'var(--dsw-alias-bg-base)',
      transform: on ? 'translateX(18px)' : 'translateX(0)',
    },
  }))
}

function row(
  item: ResolvedItemView,
  t: (key: CopyKey) => string,
  busy: boolean,
  project: string,
  open: boolean,
  onToggleOpen: () => void,
  enable: (kind: ItemKind, id: string, scope: 'global' | 'project', value: Enablement | 'inherit') => Promise<void>,
  onToggle: () => void,
): ReactNode {
  const on = item.effective !== 'off'
  const status = item.kind === 'mcp' ? mcpStatus(item, t) : undefined
  const tools = item.mcp?.tools ?? []
  const mounted = item.mcp?.status === 'mounted-global' || item.mcp?.status === 'mounted-project'
  return createElement('div', {
    key: `${item.kind}-${item.id}`,
    style: {
      border: '1px solid var(--dsw-alias-border-l2)',
      borderRadius: 12,
      padding: '12px 14px',
      background: 'var(--dsw-alias-bg-layer-1)',
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
    },
  },
    createElement('div', { style: { display: 'flex', gap: 12, alignItems: 'flex-start' } },
      createElement('button', {
        type: 'button',
        onClick: onToggleOpen,
        'aria-expanded': open,
        'aria-label': open ? t('collapse') : t('expand'),
        style: {
          width: 36,
          height: 36,
          borderRadius: 10,
          border: '1px solid var(--dsw-alias-border-l2)',
          background: on ? 'color-mix(in srgb, var(--dsw-alias-state-success-primary) 16%, var(--dsw-alias-bg-layer-1))' : 'var(--dsw-alias-bg-layer-2)',
          color: on ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-label-secondary)',
          fontSize: 14,
          fontWeight: 600,
          cursor: 'pointer',
          flex: '0 0 auto',
        },
      }, item.title.slice(0, 1).toUpperCase()),
      createElement('div', { style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 } },
        createElement('div', { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
          createElement('strong', { style: { fontSize: 14 } }, item.title),
          badge(scopeBadge(item, t), on ? 'ok' : 'muted'),
          item.kind !== 'mcp' || item.mcp === undefined ? null : badge(item.mcp.transport),
          status === undefined || !on ? null : badge(status.text, item.mcp?.status === 'error' ? 'warn' : 'ok'),
          item.kind !== 'mcp' || !mounted ? null : badge(t('toolsCount').replace('{count}', String(tools.length)), 'ok'),
        ),
        createElement('div', {
          style: {
            fontSize: 12,
            color: 'var(--dsw-alias-label-secondary)',
            lineHeight: 1.5,
            overflow: 'hidden',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
          },
        }, item.description),
        item.error === undefined
          ? null
          : createElement('div', { style: { fontSize: 12, color: 'var(--dsw-alias-state-error-primary)' } }, item.error),
      ),
      switchControl(on, busy, onToggle, item.title),
    ),
    open
      ? createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 8, paddingLeft: 48 } },
        item.kind !== 'mcp' || !mounted
          ? null
          : createElement('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', lineHeight: 1.5 } },
            tools.length === 0
              ? t('noTools')
              : createElement('ul', {
                style: { margin: 0, paddingLeft: 18, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
              }, ...tools.map(name => createElement('li', { key: name }, name)))),
        createElement('div', { style: { display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12 } },
          toggles(t('scopeGlobal'), item.global, busy, value => void enable(item.kind, item.id, 'global', value), t),
          toggles(t('scopeProject'), item.project ?? 'inherit', busy || project === '', value => void enable(item.kind, item.id, 'project', value), t),
        ),
      )
      : null,
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
