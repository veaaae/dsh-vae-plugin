import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { formatVaeStatus } from '../lib/greeting.js'

describe('formatVaeStatus', () => {
  it('joins label, plugin, and note', () => {
    assert.equal(
      formatVaeStatus({ plugin: 'dsh-vae-plugin', label: 'vae', note: 'loaded' }),
      '[vae] dsh-vae-plugin: loaded',
    )
  })
})
