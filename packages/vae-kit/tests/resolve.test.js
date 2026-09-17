import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseExtensions, resolveCatalog, resolveOptions, setEnablement, stringifyExtensions,
  globalMcpIds, projectMcpIds,
} from '../lib/index.js'

function catalog(overrides = {}) {
  return {
    kitRoot: '/kit',
    mcp: [
      { kind: 'mcp', id: 'github', title: 'GitHub', description: '', default: 'global', tags: [] },
      { kind: 'mcp', id: 'playwright', title: 'PW', description: '', default: 'project', tags: [] },
    ],
    skills: [
      { kind: 'skill', id: 'dsh-kit', title: 'Kit', description: '', default: 'global', tags: [] },
      { kind: 'skill', id: 'pr-review', title: 'PR', description: '', default: 'project', tags: [] },
    ],
    servers: {},
    skillBodies: {},
    warnings: [],
    ...overrides,
  }
}

describe('parseExtensions', () => {
  it('treats missing text as empty', () => {
    assert.deepEqual(parseExtensions(undefined), { mcp: {}, skills: {} })
  })

  it('rejects a non-on/off value', () => {
    assert.throws(() => parseExtensions('mcp:\n  github: true\n'), /on or off/)
  })

  it('round-trips through stringify', () => {
    const doc = parseExtensions('mcp:\n  github: on\nskills:\n  pr-review: off\n')
    assert.deepEqual(parseExtensions(stringifyExtensions(doc)), doc)
  })

  it('writes an empty document as an empty file', () => {
    assert.equal(stringifyExtensions({ mcp: {}, skills: {} }), '')
    assert.deepEqual(parseExtensions('{}'), { mcp: {}, skills: {} })
  })
})

describe('resolveCatalog', () => {
  it('uses catalog defaults when no files exist', () => {
    const resolved = resolveCatalog(catalog(), parseExtensions(undefined), undefined)
    assert.equal(resolved.mcp.find(item => item.id === 'github').effective, 'global')
    assert.equal(resolved.mcp.find(item => item.id === 'playwright').effective, 'off')
    assert.equal(resolved.skills.find(item => item.id === 'pr-review').effective, 'off')
    assert.deepEqual(globalMcpIds(resolved.mcp), ['github'])
    assert.deepEqual(projectMcpIds(resolved.mcp), [])
  })

  it('lets the project file win over global and defaults', () => {
    const resolved = resolveCatalog(
      catalog(),
      parseExtensions('mcp:\n  github: on\n  playwright: off\n'),
      parseExtensions('mcp:\n  github: off\n  playwright: on\n'),
    )
    assert.equal(resolved.mcp.find(item => item.id === 'github').effective, 'off')
    assert.equal(resolved.mcp.find(item => item.id === 'playwright').effective, 'project')
    assert.deepEqual(globalMcpIds(resolved.mcp), [])
    assert.deepEqual(projectMcpIds(resolved.mcp), ['playwright'])
  })

  it('rejects unknown ids instead of skipping them', () => {
    assert.throws(
      () => resolveCatalog(catalog(), parseExtensions('mcp:\n  nope: on\n'), undefined),
      /unknown mcp id nope/,
    )
  })
})

describe('setEnablement', () => {
  it('deletes a key on inherit', () => {
    const next = setEnablement(parseExtensions('mcp:\n  github: on\n'), 'mcp', 'github', 'inherit')
    assert.deepEqual(next.mcp, {})
  })
})

describe('resolveOptions paths', () => {
  it('rejects a relative kitRoot', () => {
    assert.throws(() => resolveOptions({ kitRoot: 'kit' }), /absolute path/)
  })
})
