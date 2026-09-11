/**
 * Independent DeepSeek Harness bundle that registers `vae_status`.
 * Replace this tool with real work; keep the bundle manifest and patch layer.
 */
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { formatVaeStatus } from './greeting.ts'

export { formatVaeStatus } from './greeting.ts'

export const name = 'dsh-vae-plugin'
export const inject = ['tools']

/** Bundle configuration. */
export interface Config {
  /** Short label shown in `vae_status` output. */
  label: string
}

export const Config: Schema<Config> = Schema.object({
  label: Schema.string().default('vae'),
})

/**
 * Register `vae_status` on `ctx.tools`.
 * @param ctx - plugin context with the tool registry injected
 * @param config - validated bundle config
 */
export function apply(ctx: Context, config: Config): void {
  ctx.tools.register(defineTool({
    name: 'vae_status',
    description: 'Report that the veaaae dsh-vae-plugin is loaded, and echo a short note.',
    parameters: {
      note: {
        type: 'string',
        description: 'Optional note to echo back.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          plugin: { type: 'string', required: true },
          label: { type: 'string', required: true },
          note: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: formatVaeStatus(value) }],
    },
    execute(args) {
      return Promise.resolve({
        plugin: 'dsh-vae-plugin',
        label: config.label,
        note: args.note ?? 'loaded',
      })
    },
    presentCall: args => ({
      card: 'generic',
      title: 'VAE plugin status',
      kind: 'other',
      rawInput: args,
    }),
  }))
}
