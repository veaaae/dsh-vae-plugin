/**
 * Host half of `dsh-vae-kit`: personal MCP + Skill catalog, enablement files,
 * a filtered skill provider, and MCP client mounts.
 *
 * @module dsh-vae-kit
 */

export { loadCatalog, parseSkillMarkdown } from './catalog.ts'
export { mcpClientConfig, materializeEnv } from './env.ts'
export { readExtensionsFile, writeExtensionsFile } from './files.ts'
export {
  ENABLE_PATH, RELOAD_PATH, STATE_PATH, apply, loadMcpModule, resolveOptions,
} from './host.ts'
export type { Config, HostInternals, ResolvedOptions } from './host.ts'
export {
  detectHarnessRoot, detectKitRoot, findGitRoot, globalExtensionsPath,
  projectExtensionsPath, resolveDshHome,
} from './paths.ts'
export {
  enabledSkillIds, globalMcpIds, parseExtensions, projectMcpIds, resolveCatalog,
  setEnablement, stringifyExtensions,
} from './resolve.ts'
export { parseYaml, stringifyYaml } from './yaml.ts'
export type {
  CatalogDefault, CatalogItem, EffectiveMode, Enablement, ExtensionsDoc, ItemKind,
  KitCatalog, KitSkill, KitStateView, McpServerSpec, ResolvedItem, ResolvedItemView,
} from './types.ts'

/** Stable Cordis plugin name. */
export const name = 'dsh-vae-kit'

/** The skill registry is required; connection / agents / tools are read with ctx.get. */
export const inject = ['skills']
