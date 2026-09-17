import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { parseYaml, stringifyYaml } from '../lib/index.js'

const kitRoot = join(dirname(fileURLToPath(import.meta.url)), '../kit')

describe('parseYaml', () => {
  it('reads nested maps, comments, and flow lists', () => {
    const doc = parseYaml(`
# heading
mcp:
  github:
    title: GitHub
    tags: [vcs, git]
    default: global
skills: {}
`)
    assert.deepEqual(doc, {
      mcp: { github: { title: 'GitHub', tags: ['vcs', 'git'], default: 'global' } },
      skills: {},
    })
  })

  it('round-trips a mapping of on/off', () => {
    const text = stringifyYaml({ mcp: { github: 'on', playwright: 'off' }, skills: {} })
    assert.deepEqual(parseYaml(text), { mcp: { github: 'on', playwright: 'off' }, skills: {} })
  })

  it('reads a flow-empty document', () => {
    assert.deepEqual(parseYaml('{}\n'), {})
    assert.deepEqual(parseYaml('[]\n'), [])
  })

  it('parses the checked-in catalog.yml', async () => {
    const doc = parseYaml(await readFile(join(kitRoot, 'catalog.yml'), 'utf8'))
    assert.equal(doc.mcp.github.default, 'off')
    assert.equal(doc.mcp.playwright.default, 'project')
    assert.deepEqual(doc.mcp.github.tags, ['vcs'])
    assert.equal(doc.skills['dsh-kit'].default, 'global')
  })
})
