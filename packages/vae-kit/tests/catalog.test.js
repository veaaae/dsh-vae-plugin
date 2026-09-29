import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { loadCatalog, mcpClientConfig, parseSkillMarkdown } from '../lib/index.js'

const kitRoot = join(dirname(fileURLToPath(import.meta.url)), '../kit')

describe('loadCatalog', () => {
  it('loads the checked-in kit', async () => {
    const catalog = await loadCatalog(kitRoot)
    assert.equal(catalog.warnings.length, 0)
    assert.ok(catalog.servers.playwright.command)
    assert.equal(catalog.servers.playwright.transport, 'stdio')
    assert.equal(catalog.servers.playwright.serverName, 'playwright')
    assert.equal(catalog.servers.github.serverName, 'github')
    assert.equal(catalog.servers.context7.serverName, 'context7')
    assert.equal(catalog.skillBodies.officecli.name, 'officecli')
    assert.ok(catalog.skillBodies.officecli.content.includes('officecli'))
    assert.equal(catalog.skillBodies['ui-ux-pro-max'].name, 'ui-ux-pro-max')
  })
})

describe('parseSkillMarkdown', () => {
  it('rejects a file without frontmatter', () => {
    assert.throws(() => parseSkillMarkdown('# hi\n'), /frontmatter/)
  })
})

describe('loadCatalog HTTP servers', () => {
  it('reads a streamable-http server.yml', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vae-kit-cat-'))
    await writeFile(join(root, 'catalog.yml'), 'mcp:\n  remote:\n    title: Remote\n    default: off\nskills: {}\n')
    await mkdir(join(root, 'mcp', 'remote'), { recursive: true })
    await writeFile(join(root, 'mcp', 'remote', 'server.yml'), [
      'serverName: remote',
      'transport: streamable-http',
      'url: https://example.test/mcp',
      'headersFrom:',
      '  Authorization: MCP_TOKEN',
      '',
    ].join('\n'))
    const catalog = await loadCatalog(root)
    assert.equal(catalog.warnings.length, 0)
    assert.equal(catalog.servers.remote.transport, 'streamable-http')
    assert.equal(catalog.servers.remote.url, 'https://example.test/mcp')
    const config = mcpClientConfig(catalog.servers.remote, { MCP_TOKEN: 'abc' })
    assert.equal(config.headers.Authorization, 'abc')
  })
})

describe('mcpClientConfig', () => {
  it('copies envFrom from the process environment', async () => {
    const catalog = await loadCatalog(kitRoot)
    const config = mcpClientConfig(catalog.servers.playwright, {})
    assert.equal(config.transport, 'stdio')
    assert.equal(config.serverName, 'playwright')
    assert.equal(config.failOnStartupError, false)
  })
})
