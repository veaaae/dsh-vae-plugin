/**
 * Parse extensions.yml and apply catalog defaults, then global, then project.
 * @module
 */

import type {
  CatalogDefault, CatalogItem, EffectiveMode, Enablement, ExtensionsDoc, KitCatalog, ResolvedItem,
} from './types.ts'
import { parseYaml, stringifyYaml } from './yaml.ts'

const EMPTY: ExtensionsDoc = { mcp: {}, skills: {} }

/**
 * Parse an extensions.yml document. Unknown top-level keys are ignored.
 * mcp/skills values must be on or off. Empty or missing text is an empty doc.
 * @param text - file contents, or undefined for a missing file.
 * @returns mcp/skills maps of on|off.
 */
export function parseExtensions(text: string | undefined): ExtensionsDoc {
  if (text === undefined || text.trim() === '') return EMPTY
  const doc = parseYaml(text)
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
    throw new Error('extensions.yml must be a mapping')
  }
  const map = doc as Record<string, unknown>
  return {
    mcp: enablementMap(map.mcp, 'mcp'),
    skills: enablementMap(map.skills, 'skills'),
  }
}

/**
 * Serialize an extensions document. Empty maps are omitted; an empty doc is an empty file.
 * @param doc - enablement maps.
 * @returns YAML text, or an empty string.
 */
export function stringifyExtensions(doc: ExtensionsDoc): string {
  const out: Record<string, unknown> = {}
  if (Object.keys(doc.mcp).length > 0) out.mcp = { ...doc.mcp }
  if (Object.keys(doc.skills).length > 0) out.skills = { ...doc.skills }
  if (Object.keys(out).length === 0) return ''
  return stringifyYaml(out)
}

function enablementMap(value: unknown, label: string): Record<string, Enablement> {
  if (value === undefined) return {}
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be a mapping of id: on|off`)
  }
  const result: Record<string, Enablement> = {}
  for (const [id, item] of Object.entries(value as Record<string, unknown>)) {
    if (item !== 'on' && item !== 'off') {
      throw new Error(`${label}.${id} must be on or off`)
    }
    result[id] = item
  }
  return result
}

/**
 * Apply catalog defaults, then the global file, then the project file.
 * Project `on`/`off` wins. Catalog `default: project` is off until the
 * project file turns it on. Unknown ids in either file are errors.
 * @param catalog - loaded kit catalog.
 * @param globalDoc - ~/.dsh/extensions.yml
 * @param projectDoc - <gitRoot>/.dsh/extensions.yml, or undefined with no project.
 * @returns resolved MCP and Skill rows for that view.
 */
export function resolveCatalog(
  catalog: KitCatalog,
  globalDoc: ExtensionsDoc,
  projectDoc: ExtensionsDoc | undefined,
): { mcp: ResolvedItem[]; skills: ResolvedItem[] } {
  assertKnownIds('mcp', globalDoc.mcp, catalog.mcp)
  assertKnownIds('skills', globalDoc.skills, catalog.skills)
  if (projectDoc !== undefined) {
    assertKnownIds('mcp', projectDoc.mcp, catalog.mcp)
    assertKnownIds('skills', projectDoc.skills, catalog.skills)
  }
  return {
    mcp: catalog.mcp.map(item => resolveItem(item, globalDoc.mcp[item.id], projectDoc?.mcp[item.id], projectDoc !== undefined)),
    skills: catalog.skills.map(item => resolveItem(item, globalDoc.skills[item.id], projectDoc?.skills[item.id], projectDoc !== undefined)),
  }
}

function assertKnownIds(kind: string, doc: Readonly<Record<string, Enablement>>, items: readonly CatalogItem[]): void {
  const known = new Set(items.map(item => item.id))
  const unknown = Object.keys(doc).filter(id => !known.has(id))
  if (unknown.length > 0) {
    throw new Error(`extensions.yml names unknown ${kind} id${unknown.length > 1 ? 's' : ''} ${unknown.join(', ')}`)
  }
}

function resolveItem(
  item: CatalogItem,
  globalValue: Enablement | undefined,
  projectValue: Enablement | undefined,
  hasProject: boolean,
): ResolvedItem {
  const global: Enablement | 'inherit' = globalValue ?? 'inherit'
  const project: Enablement | 'inherit' | null = hasProject ? (projectValue ?? 'inherit') : null
  const effective = effectiveMode(item.default, globalValue, projectValue, hasProject)
  return {
    kind: item.kind,
    id: item.id,
    title: item.title,
    description: item.description,
    default: item.default,
    tags: item.tags,
    ...item.error === undefined ? {} : { error: item.error },
    global,
    project,
    effective,
    enabled: effective !== 'off' && item.error === undefined,
  }
}

function effectiveMode(
  fallback: CatalogDefault,
  globalValue: Enablement | undefined,
  projectValue: Enablement | undefined,
  hasProject: boolean,
): EffectiveMode {
  if (hasProject && projectValue === 'on') return 'project'
  if (hasProject && projectValue === 'off') return 'off'
  if (globalValue === 'on') return 'global'
  if (globalValue === 'off') return 'off'
  if (fallback === 'global') return 'global'
  return 'off'
}

/**
 * Set one id in a document. `inherit` deletes the key so the catalog default
 * or the other file applies.
 * @param doc - current document.
 * @param kind - mcp or skills map.
 * @param id - catalog id.
 * @param value - on, off, or inherit.
 * @returns a new document.
 */
export function setEnablement(
  doc: ExtensionsDoc,
  kind: 'mcp' | 'skills',
  id: string,
  value: Enablement | 'inherit',
): ExtensionsDoc {
  const next = { ...doc[kind] }
  if (value === 'inherit') delete next[id]
  else next[id] = value
  return kind === 'mcp' ? { mcp: next, skills: doc.skills } : { mcp: doc.mcp, skills: next }
}

/**
 * Skill ids that are enabled for a given cwd's resolved catalog.
 * @param items - resolved skill rows.
 * @returns enabled skill ids.
 */
export function enabledSkillIds(items: readonly ResolvedItem[]): string[] {
  return items.filter(item => item.enabled).map(item => item.id)
}

/**
 * MCP ids that should be mounted on the host (global effective).
 * @param items - resolved MCP rows.
 * @returns globally enabled MCP ids.
 */
export function globalMcpIds(items: readonly ResolvedItem[]): string[] {
  return items.filter(item => item.effective === 'global' && item.enabled).map(item => item.id)
}

/**
 * MCP ids that should be mounted on the current project's agent.
 * @param items - resolved MCP rows.
 * @returns project-enabled MCP ids.
 */
export function projectMcpIds(items: readonly ResolvedItem[]): string[] {
  return items.filter(item => item.effective === 'project' && item.enabled).map(item => item.id)
}
