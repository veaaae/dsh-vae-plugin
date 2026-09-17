/**
 * Catalog, enablement, and Settings-page types for dsh-vae-kit.
 * @module
 */

/** Catalog default: on everywhere, off until a project opts in, or off until a file turns it on. */
export type CatalogDefault = 'global' | 'project' | 'off'

/** Explicit enablement stored in an extensions file. */
export type Enablement = 'on' | 'off'

/** Why an item is on for the current view, or off. */
export type EffectiveMode = 'off' | 'global' | 'project'

/** MCP or Skill catalog family. */
export type ItemKind = 'mcp' | 'skill'

/** One catalog row before enablement is applied. */
export interface CatalogItem {
  readonly kind: ItemKind
  readonly id: string
  readonly title: string
  readonly description: string
  readonly default: CatalogDefault
  readonly tags: readonly string[]
  readonly error?: string
}

/** MCP transport taken from server.yml. */
export type McpTransport = 'stdio' | 'streamable-http'

/** Resolved MCP server declaration. Secrets are env names, never values. */
export interface McpServerSpec {
  readonly id: string
  readonly serverName: string
  readonly transport: McpTransport
  readonly command?: string
  readonly args: readonly string[]
  readonly cwd?: string
  readonly url?: string
  readonly envFrom: Readonly<Record<string, string>>
  readonly headersFrom: Readonly<Record<string, string>>
  readonly env: Readonly<Record<string, string>>
  readonly headers: Readonly<Record<string, string>>
}

/** Parsed SKILL.md used by the kit skill provider. */
export interface KitSkill {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly whenToUse?: string
  readonly modelInvocable: boolean
  readonly userInvocable: boolean
  readonly content: string
  readonly directory: string
  readonly path: string
}

/** Full catalog loaded from kit/. */
export interface KitCatalog {
  readonly kitRoot: string
  readonly mcp: readonly CatalogItem[]
  readonly skills: readonly CatalogItem[]
  readonly servers: Readonly<Record<string, McpServerSpec>>
  readonly skillBodies: Readonly<Record<string, KitSkill>>
  readonly warnings: readonly string[]
}

/** One extensions.yml document. Missing keys inherit. */
export interface ExtensionsDoc {
  readonly mcp: Readonly<Record<string, Enablement>>
  readonly skills: Readonly<Record<string, Enablement>>
}

/** Enablement after catalog defaults, then global file, then project file. */
export interface ResolvedItem {
  readonly kind: ItemKind
  readonly id: string
  readonly title: string
  readonly description: string
  readonly default: CatalogDefault
  readonly tags: readonly string[]
  readonly error?: string
  readonly global: Enablement | 'inherit'
  readonly project: Enablement | 'inherit' | null
  readonly effective: EffectiveMode
  readonly enabled: boolean
}

/** JSON the Settings page renders. */
export interface KitStateView {
  readonly kitRoot: string
  readonly dshHome: string
  readonly globalFile: string
  readonly projectFile: string | null
  readonly projectRoot: string | null
  readonly projects: readonly { readonly path: string; readonly title: string }[]
  readonly mcp: readonly ResolvedItemView[]
  readonly skills: readonly ResolvedItemView[]
  readonly warnings: readonly string[]
  readonly error: string | null
}

/** One row on the Settings page, including MCP runtime status. */
export interface ResolvedItemView extends ResolvedItem {
  readonly mcp?: {
    readonly serverName: string
    readonly transport: McpTransport
    readonly status: 'idle' | 'mounted-global' | 'mounted-project' | 'error'
    readonly error?: string
  }
}
