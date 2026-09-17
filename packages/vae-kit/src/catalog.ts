/**
 * Load kit/catalog.yml plus each mcp/<id>/server.yml and skills/<id>/SKILL.md.
 * @module
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  CatalogDefault, CatalogItem, ItemKind, KitCatalog, KitSkill, McpServerSpec, McpTransport,
} from './types.ts'
import { parseYaml } from './yaml.ts'

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const SERVER_NAME = /^[A-Za-z0-9_-]{1,32}$/

/**
 * Load catalog.yml plus every mcp/<id>/server.yml and skills/<id>/SKILL.md.
 * Unknown ids in enablement files are rejected later; a missing catalog file
 * is an error. Malformed optional files become warnings and drop that item.
 * @param kitRoot - absolute kit directory containing catalog.yml.
 * @returns catalog rows, server specs, skill bodies, and per-item warnings.
 */
export async function loadCatalog(kitRoot: string): Promise<KitCatalog> {
  const warnings: string[] = []
  const raw = await readFile(join(kitRoot, 'catalog.yml'), 'utf8')
  const doc = asMap(parseYaml(raw), 'catalog.yml')
  const mcpEntries = asMap(doc.mcp ?? {}, 'catalog.yml mcp')
  const skillEntries = asMap(doc.skills ?? {}, 'catalog.yml skills')

  const mcp: CatalogItem[] = []
  const servers: Record<string, McpServerSpec> = {}
  for (const [id, value] of Object.entries(mcpEntries)) {
    const item = catalogItem('mcp', id, value)
    try {
      servers[id] = await loadServer(kitRoot, id)
      mcp.push(item)
    } catch (error) {
      const message = errorMessage(error)
      warnings.push(`mcp/${id}: ${message}`)
      mcp.push({ ...item, error: message })
    }
  }

  const skills: CatalogItem[] = []
  const skillBodies: Record<string, KitSkill> = {}
  for (const [id, value] of Object.entries(skillEntries)) {
    const item = catalogItem('skill', id, value)
    try {
      skillBodies[id] = await loadSkill(kitRoot, id)
      skills.push(item)
    } catch (error) {
      const message = errorMessage(error)
      warnings.push(`skills/${id}: ${message}`)
      skills.push({ ...item, error: message })
    }
  }

  return { kitRoot, mcp, skills, servers, skillBodies, warnings }
}

function catalogItem(kind: ItemKind, id: string, value: unknown): CatalogItem {
  if (!ID.test(id)) throw new Error(`${kind} id "${id}" must be kebab-case`)
  const map = asMap(value, `${kind} ${id}`)
  const title = stringField(map, 'title', id)
  const description = stringField(map, 'description', '')
  const defaultValue = defaultField(map.default)
  const tags = arrayOfStrings(map.tags)
  return { kind, id, title, description, default: defaultValue, tags }
}

async function loadServer(kitRoot: string, id: string): Promise<McpServerSpec> {
  const path = join(kitRoot, 'mcp', id, 'server.yml')
  const doc = asMap(parseYaml(await readFile(path, 'utf8')), path)
  const transport = transportField(doc.transport)
  const serverName = stringField(doc, 'serverName', id)
  if (!SERVER_NAME.test(serverName)) {
    throw new Error(`serverName "${serverName}" must match [A-Za-z0-9_-]{1,32}`)
  }
  if (transport === 'stdio') {
    const command = stringField(doc, 'command')
    return {
      id,
      serverName,
      transport,
      command,
      args: arrayOfStrings(doc.args),
      ...optionalString(doc, 'cwd'),
      envFrom: stringMap(doc.envFrom),
      headersFrom: {},
      env: stringMap(doc.env),
      headers: {},
    }
  }
  const url = stringField(doc, 'url')
  return {
    id,
    serverName,
    transport,
    args: [],
    url,
    envFrom: {},
    headersFrom: stringMap(doc.headersFrom),
    env: {},
    headers: stringMap(doc.headers),
  }
}

async function loadSkill(kitRoot: string, id: string): Promise<KitSkill> {
  const directory = join(kitRoot, 'skills', id)
  const path = join(directory, 'SKILL.md')
  const raw = await readFile(path, 'utf8')
  const parsed = parseSkillMarkdown(raw)
  const name = parsed.name ?? id
  if (name !== id) throw new Error(`SKILL.md name "${name}" must equal catalog id "${id}"`)
  if (!ID.test(name)) throw new Error(`skill name "${name}" must be kebab-case`)
  if (parsed.description.length === 0) throw new Error('SKILL.md description is required')
  return {
    id,
    name,
    description: parsed.description,
    ...parsed.whenToUse === undefined ? {} : { whenToUse: parsed.whenToUse },
    modelInvocable: parsed.disableModelInvocation !== true,
    userInvocable: parsed.userInvocable !== false,
    content: parsed.body,
    directory,
    path,
  }
}

/**
 * Parse SKILL.md frontmatter + body. Missing frontmatter is an error.
 * @param raw - file contents.
 * @returns parsed frontmatter fields and the markdown body.
 */
export function parseSkillMarkdown(raw: string): {
  name?: string
  description: string
  whenToUse?: string
  disableModelInvocation?: boolean
  userInvocable?: boolean
  body: string
} {
  const parsed = parseFrontmatter(raw)
  if (parsed === undefined) throw new Error('SKILL.md must start with YAML frontmatter')
  const data = parsed.data
  return {
    ...optionalString(data, 'name'),
    description: stringField(data, 'description', ''),
    ...optionalString(data, 'whenToUse'),
    disableModelInvocation: optionalBoolean(data, 'disable-model-invocation'),
    userInvocable: optionalBoolean(data, 'user-invocable'),
    body: parsed.body.replace(/^\n/, ''),
  }
}

function parseFrontmatter(raw: string): { data: Record<string, unknown>; body: string } | undefined {
  const firstLineEnd = raw.indexOf('\n')
  if (firstLineEnd < 0) return undefined
  const firstLine = raw.slice(0, firstLineEnd).replace(/\r$/, '')
  if (firstLine !== '---') return undefined
  const start = firstLineEnd + 1
  let lineStart = start
  while (lineStart <= raw.length) {
    const nextNewline = raw.indexOf('\n', lineStart)
    const lineEnd = nextNewline < 0 ? raw.length : nextNewline
    const line = raw.slice(lineStart, lineEnd).replace(/\r$/, '')
    if (line === '---') {
      const yaml = raw.slice(start, lineStart)
      const data = asMap(parseYaml(yaml), 'frontmatter')
      const bodyStart = nextNewline < 0 ? raw.length : nextNewline + 1
      return { data, body: raw.slice(bodyStart) }
    }
    if (nextNewline < 0) return undefined
    lineStart = nextNewline + 1
  }
  return undefined
}

function transportField(value: unknown): McpTransport {
  if (value === 'stdio' || value === 'streamable-http') return value
  throw new Error('transport must be stdio or streamable-http')
}

function defaultField(value: unknown): CatalogDefault {
  if (value === undefined || value === 'global') return 'global'
  if (value === 'project' || value === 'off') return value
  throw new Error('default must be global, project, or off')
}

function asMap(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be a mapping`)
  }
  return value as Record<string, unknown>
}

function stringField(map: Record<string, unknown>, key: string, fallback?: string): string {
  const value = map[key]
  if (typeof value === 'string' && value.trim() !== '') return value.trim()
  if (fallback !== undefined && value === undefined) return fallback
  throw new Error(`${key} must be a non-empty string`)
}

function optionalString(map: Record<string, unknown>, key: string): { [K in typeof key]?: string } {
  const value = map[key]
  if (typeof value === 'string' && value.trim() !== '') return { [key]: value.trim() }
  return {}
}

function optionalBoolean(map: Record<string, unknown>, key: string): boolean | undefined {
  const value = map[key]
  if (value === undefined) return undefined
  if (typeof value === 'boolean') return value
  throw new Error(`${key} must be a boolean`)
}

function arrayOfStrings(value: unknown): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new Error('expected a list of strings')
  }
  return value
}

function stringMap(value: unknown): Record<string, string> {
  if (value === undefined) return {}
  const map = asMap(value, 'map')
  const result: Record<string, string> = {}
  for (const [key, item] of Object.entries(map)) {
    if (typeof item !== 'string' || item.trim() === '') {
      throw new Error(`${key} must be a non-empty string`)
    }
    result[key] = item.trim()
  }
  return result
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
