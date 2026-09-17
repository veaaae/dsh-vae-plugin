import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  countPorcelain, countTracked, firstTag, listPatches, parseBuildRecord, parseDivergenceCounts, parseHeadLog,
  unitFromCgroup, versionFromTag,
} from '../lib/index.js'

describe('unitFromCgroup', () => {
  it('reads the unit owning this process', () => {
    assert.equal(unitFromCgroup('0::/system.slice/dsh-web.service\n'), 'dsh-web.service')
    assert.equal(unitFromCgroup('2:devices:/system.slice/dsh-web.service\n'), 'dsh-web.service')
    assert.equal(unitFromCgroup('0::/user.slice/user-0.slice/user@0.service/app.slice/dsh.service'), 'dsh.service')
  })

  it('reports no unit for a process outside a service', () => {
    assert.equal(unitFromCgroup('0::/system.slice/\n'), undefined)
    assert.equal(unitFromCgroup('0::/\n'), undefined)
    assert.equal(unitFromCgroup('0::/system.slice/sshd.scope\n'), undefined)
    assert.equal(unitFromCgroup(''), undefined)
  })
})

describe('parseBuildRecord', () => {
  it('reads the version and commit embedded in browser artifacts', () => {
    const text = JSON.stringify({ formatVersion: 1, environment: { DSH_CLIENT_VERSION: '0.1.5-rc.2', DSH_CLIENT_COMMIT_HASH: 'c291e79' } })
    assert.deepEqual(parseBuildRecord(text), { version: '0.1.5-rc.2', commit: 'c291e79' })
  })

  it('reports only the values the record carries', () => {
    assert.deepEqual(parseBuildRecord('{"environment":{"DSH_CLIENT_VERSION":"1.0.0"}}'), { version: '1.0.0' })
    assert.deepEqual(parseBuildRecord('{"environment":{}}'), {})
  })

  it('rejects anything that is not a record', () => {
    assert.equal(parseBuildRecord('{"formatVersion":1}'), undefined)
    assert.equal(parseBuildRecord('not json'), undefined)
    assert.equal(parseBuildRecord('[]'), undefined)
  })
})

describe('parseHeadLog', () => {
  it('splits the NUL-separated format', () => {
    assert.deepEqual(parseHeadLog('abc1234\u0000subject line\u00002026-09-11T10:00:00+08:00\n'), {
      sha: 'abc1234',
      subject: 'subject line',
      date: '2026-09-11T10:00:00+08:00',
    })
  })

  it('rejects output without all three fields', () => {
    assert.equal(parseHeadLog('abc1234\u0000subject line'), undefined)
    assert.equal(parseHeadLog(''), undefined)
  })
})

describe('parseDivergenceCounts', () => {
  it('reads ahead then behind', () => {
    assert.deepEqual(parseDivergenceCounts('0\t2\n'), { ahead: 0, behind: 2 })
    assert.deepEqual(parseDivergenceCounts('3 1'), { ahead: 3, behind: 1 })
  })

  it('rejects malformed counts', () => {
    assert.equal(parseDivergenceCounts('0'), undefined)
    assert.equal(parseDivergenceCounts('a b'), undefined)
    assert.equal(parseDivergenceCounts('-1 2'), undefined)
  })
})

describe('countPorcelain', () => {
  it('counts reported paths and ignores blank lines', () => {
    assert.equal(countPorcelain(' M a.ts\n?? b.ts\n'), 2)
    assert.equal(countPorcelain(''), 0)
  })
})

describe('countTracked', () => {
  it('leaves untracked files out of the count that can block a pull', () => {
    assert.equal(countTracked(' M a.ts\n?? b.ts\n'), 1)
    assert.equal(countTracked('?? b.ts\n?? c/\n'), 0)
    assert.equal(countTracked(''), 0)
  })
})

describe('firstTag', () => {
  it('takes the first non-empty line of a version-sorted listing', () => {
    assert.equal(firstTag('dsh-v0.1.5-rc.2\ndsh-v0.1.5-rc.1\n'), 'dsh-v0.1.5-rc.2')
    assert.equal(firstTag('\n'), undefined)
  })
})

describe('versionFromTag', () => {
  it('strips the release prefix', () => {
    assert.equal(versionFromTag('dsh-v0.1.5-rc.2', 'dsh-v'), '0.1.5-rc.2')
    assert.equal(versionFromTag('v1.0.0', 'dsh-v'), undefined)
    assert.equal(versionFromTag('dsh-v', 'dsh-v'), undefined)
  })
})

describe('listPatches', () => {
  it('lists a series in filename order and ignores other files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vae-patches-'))
    writeFileSync(join(dir, 'b-second.patch'), '')
    writeFileSync(join(dir, 'a-first.patch'), '')
    writeFileSync(join(dir, 'README.md'), '')
    assert.deepEqual(listPatches(dir), [join(dir, 'a-first.patch'), join(dir, 'b-second.patch')])
  })

  it('treats an absent series directory as an empty series', () => {
    assert.deepEqual(listPatches('/nonexistent/vae-update-patches'), [])
  })
})
