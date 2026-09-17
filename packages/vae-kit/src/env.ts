/**
 * Copy process environment names into an MCP client config.
 * @module
 */

import type { McpServerSpec } from './types.ts'

/**
 * Copy named environment values into the MCP child. Missing names stay
 * absent; empty values are skipped. Literal `env` / `headers` from the
 * server file win over envFrom when both name the same key.
 * @param spec - resolved server.yml.
 * @param env - process environment.
 * @returns child env, headers, and missing source names.
 */
export function materializeEnv(spec: McpServerSpec, env: NodeJS.ProcessEnv = process.env): {
  env: Record<string, string>
  headers: Record<string, string>
  missing: string[]
} {
  const missing: string[] = []
  const resolvedEnv: Record<string, string> = {}
  for (const [childName, source] of Object.entries(spec.envFrom)) {
    const value = env[source]
    if (value === undefined || value === '') {
      missing.push(source)
      continue
    }
    resolvedEnv[childName] = value
  }
  Object.assign(resolvedEnv, spec.env)

  const headers: Record<string, string> = {}
  for (const [headerName, source] of Object.entries(spec.headersFrom)) {
    const value = env[source]
    if (value === undefined || value === '') {
      missing.push(source)
      continue
    }
    headers[headerName] = value
  }
  Object.assign(headers, spec.headers)
  return { env: resolvedEnv, headers, missing }
}

/**
 * Config object passed to `@deepseek-ai/dsh-mcp-client`.
 * @param spec - resolved server.yml.
 * @param env - process environment used for envFrom / headersFrom.
 * @returns a stdio or streamable-http client config.
 */
export function mcpClientConfig(spec: McpServerSpec, env: NodeJS.ProcessEnv = process.env): Record<string, unknown> {
  const materialized = materializeEnv(spec, env)
  if (spec.transport === 'stdio') {
    return {
      transport: 'stdio',
      serverName: spec.serverName,
      command: spec.command,
      args: [...spec.args],
      env: materialized.env,
      ...spec.cwd === undefined ? {} : { cwd: spec.cwd },
      failOnStartupError: false,
    }
  }
  return {
    transport: 'streamable-http',
    serverName: spec.serverName,
    url: spec.url,
    headers: materialized.headers,
    failOnStartupError: false,
  }
}
