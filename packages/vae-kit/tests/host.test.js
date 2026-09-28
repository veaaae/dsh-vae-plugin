import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ENABLE_PATH, RELOAD_PATH, STATE_PATH, apply, detectKitRoot } from '../lib/index.js'

const kitRoot = join(dirname(fileURLToPath(import.meta.url)), '../kit')

function fakeContext() {
  const routes = new Map()
  const providers = []
  const plugins = []
  const created = []
  const toolsChange = []
  const ctx = {
    routes,
    providers,
    plugins,
    created,
    onPlugin: undefined,
    get(name) {
      if (name === 'connection') return this.connection
      if (name === 'skills') return this.skills
      if (name === 'workspaceRegistry') return { list: () => [] }
      return undefined
    },
    connection: {
      fetch: { register: route => routes.set(`${route.methods.join(',')} ${route.path}`, route) },
    },
    skills: {
      registerProvider: (create) => {
        const control = { invalidate() {} }
        providers.push(create(control))
        return () => {}
      },
    },
    plugin: async (mod, config) => {
      plugins.push({ mod, config })
      if (typeof ctx.onPlugin === 'function') await ctx.onPlugin(config)
      return { dispose: async () => {} }
    },
    effect: (callback) => callback(),
    on: (event, listener) => {
      if (event === 'tools/change') toolsChange.push(listener)
      else created.push({ event, listener })
      return () => {}
    },
    inject: () => {},
  }
  return ctx
}

const stubMcp = {
  loadMcpModule: async () => ({
    name: 'mcp-client',
    apply() {},
    Config: value => value,
  }),
}

async function waitFor(route, request = new Request('http://dsh.local/api/vae-kit.state')) {
  for (let i = 0; i < 50; i++) {
    const response = await route.fetch(request)
    const body = await response.json()
    if (body.mcp.length > 0 || body.error !== null) return body
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error('kit state never loaded')
}

async function waitUntil(route, predicate, request = new Request('http://dsh.local/api/vae-kit.state')) {
  for (let i = 0; i < 50; i++) {
    const body = await (await route.fetch(request)).json()
    if (predicate(body)) return body
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error('kit state never matched')
}

describe('detectKitRoot', () => {
  it('finds the package kit directory', () => {
    assert.equal(detectKitRoot(), kitRoot)
  })
})

describe('apply', () => {
  it('registers routes and lists the kit with catalog defaults', async () => {
    const dshHome = await mkdtemp(join(tmpdir(), 'vae-kit-'))
    const ctx = fakeContext()
    apply(ctx, { kitRoot, dshHome }, stubMcp)
    const state = ctx.routes.get(`GET ${STATE_PATH}`)
    const body = await waitFor(state)
    assert.equal(body.error, null)
    const playwright = body.mcp.find(item => item.id === 'playwright')
    assert.equal(playwright.effective, 'off')
    assert.equal(ctx.providers[0].name, 'vae-kit')
    const skills = await ctx.providers[0].list({ cwd: dshHome })
    assert.ok(skills.some(skill => skill.name === 'officecli'))
    assert.equal(ctx.plugins.length, 0)
  })

  it('writes a global switch and hides a default-on skill', async () => {
    const dshHome = await mkdtemp(join(tmpdir(), 'vae-kit-'))
    const ctx = fakeContext()
    apply(ctx, { kitRoot, dshHome }, stubMcp)
    const enable = ctx.routes.get(`POST ${ENABLE_PATH}`)
    const response = await enable.fetch(new Request('http://dsh.local/api/vae-kit.enable', {
      method: 'POST',
      body: JSON.stringify({ kind: 'skill', id: 'officecli', scope: 'global', value: 'off' }),
    }))
    const body = await response.json()
    assert.equal(response.status, 200)
    assert.equal(body.skills.find(item => item.id === 'officecli').effective, 'off')
    const skills = await ctx.providers[0].list({})
    assert.ok(!skills.some(skill => skill.name === 'officecli'))
    const written = await readFile(join(dshHome, 'extensions.yml'), 'utf8')
    assert.match(written, /officecli: off/)
  })

  it('returns kit state while a slow MCP mount is still running', async () => {
    const dshHome = await mkdtemp(join(tmpdir(), 'vae-kit-'))
    const ctx = fakeContext()
    let release
    const blocked = new Promise((resolve) => { release = resolve })
    ctx.onPlugin = async () => { await blocked }
    apply(ctx, { kitRoot, dshHome }, stubMcp)
    const enable = ctx.routes.get(`POST ${ENABLE_PATH}`)
    const response = await enable.fetch(new Request('http://dsh.local/api/vae-kit.enable', {
      method: 'POST',
      body: JSON.stringify({ kind: 'mcp', id: 'playwright', scope: 'global', value: 'on' }),
    }))
    const body = await response.json()
    assert.equal(response.status, 200)
    assert.equal(body.mcp.find(item => item.id === 'playwright').mcp.status, 'mounting')
    const during = await (await ctx.routes.get(`GET ${STATE_PATH}`).fetch(new Request('http://dsh.local/api/vae-kit.state'))).json()
    assert.equal(during.mcp.find(item => item.id === 'playwright').mcp.status, 'mounting')
    assert.deepEqual(during.mcp.find(item => item.id === 'playwright').mcp.tools, [])
    release()
    const after = await waitUntil(ctx.routes.get(`GET ${STATE_PATH}`), body => body.mcp.find(item => item.id === 'playwright').mcp.status === 'mounted-global')
    assert.equal(after.mcp.find(item => item.id === 'playwright').mcp.status, 'mounted-global')
  })

  it('lists published MCP tool names after a global mount', async () => {
    const dshHome = await mkdtemp(join(tmpdir(), 'vae-kit-'))
    const ctx = fakeContext()
    const originalGet = ctx.get.bind(ctx)
    ctx.get = (name) => {
      if (name === 'tools') {
        return {
          schemas: () => [
            { name: 'mcp__playwright__browser_navigate' },
            { name: 'bash' },
          ],
        }
      }
      return originalGet(name)
    }
    apply(ctx, { kitRoot, dshHome }, stubMcp)
    const enable = ctx.routes.get(`POST ${ENABLE_PATH}`)
    await enable.fetch(new Request('http://dsh.local/api/vae-kit.enable', {
      method: 'POST',
      body: JSON.stringify({ kind: 'mcp', id: 'playwright', scope: 'global', value: 'on' }),
    }))
    const body = await waitUntil(ctx.routes.get(`GET ${STATE_PATH}`), view => view.mcp.find(item => item.id === 'playwright').mcp.status === 'mounted-global')
    assert.deepEqual(body.mcp.find(item => item.id === 'playwright').mcp.tools, ['mcp__playwright__browser_navigate'])
  })

  it('mounts a globally enabled MCP through the client plugin', async () => {
    const dshHome = await mkdtemp(join(tmpdir(), 'vae-kit-'))
    const ctx = fakeContext()
    apply(ctx, { kitRoot, dshHome }, stubMcp)
    const enable = ctx.routes.get(`POST ${ENABLE_PATH}`)
    const response = await enable.fetch(new Request('http://dsh.local/api/vae-kit.enable', {
      method: 'POST',
      body: JSON.stringify({ kind: 'mcp', id: 'playwright', scope: 'global', value: 'on' }),
    }))
    const body = await response.json()
    assert.equal(response.status, 200)
    assert.equal(body.mcp.find(item => item.id === 'playwright').effective, 'global')
    assert.ok(['mounting', 'mounted-global'].includes(body.mcp.find(item => item.id === 'playwright').mcp.status))
    const after = await waitUntil(ctx.routes.get(`GET ${STATE_PATH}`), view => view.mcp.find(item => item.id === 'playwright').mcp.status === 'mounted-global')
    assert.equal(after.mcp.find(item => item.id === 'playwright').mcp.status, 'mounted-global')
    assert.equal(ctx.plugins.length, 1)
    assert.equal(ctx.plugins[0].config.serverName, 'playwright')
    assert.equal(ctx.plugins[0].config.failOnStartupError, false)
  })

  it('records a mount error when the MCP client cannot be imported', async () => {
    const dshHome = await mkdtemp(join(tmpdir(), 'vae-kit-'))
    const ctx = fakeContext()
    apply(ctx, { kitRoot, dshHome }, { loadMcpModule: async () => null })
    const enable = ctx.routes.get(`POST ${ENABLE_PATH}`)
    const response = await enable.fetch(new Request('http://dsh.local/api/vae-kit.enable', {
      method: 'POST',
      body: JSON.stringify({ kind: 'mcp', id: 'playwright', scope: 'global', value: 'on' }),
    }))
    const body = await response.json()
    assert.ok(['mounting', 'error'].includes(body.mcp.find(item => item.id === 'playwright').mcp.status))
    const after = await waitUntil(ctx.routes.get(`GET ${STATE_PATH}`), view => view.mcp.find(item => item.id === 'playwright').mcp.status === 'error')
    assert.equal(after.mcp.find(item => item.id === 'playwright').mcp.status, 'error')
    assert.match(after.mcp.find(item => item.id === 'playwright').mcp.error, /dsh-mcp-client/)
    assert.equal(ctx.plugins.length, 0)
  })

  it('does not mount project MCP on a subagent', async () => {
    const dshHome = await mkdtemp(join(tmpdir(), 'vae-kit-'))
    const project = await mkdtemp(join(tmpdir(), 'vae-kit-proj-'))
    await mkdir(join(project, '.git'))
    await mkdir(join(project, '.dsh'), { recursive: true })
    await writeFile(join(project, '.dsh', 'extensions.yml'), 'mcp:\n  playwright: on\n')
    const ctx = fakeContext()
    const childPlugins = []
    const child = {
      session: { header: { cwd: project, origin: 'subagent', delegationDepth: 1 } },
      ctx: {
        plugin: async (mod, config) => {
          childPlugins.push({ mod, config })
          return { dispose: async () => {} }
        },
        effect: (callback) => callback(),
        get() { return undefined },
      },
    }
    const originalGet = ctx.get.bind(ctx)
    ctx.get = (name) => {
      if (name === 'agents') return { list: () => [child] }
      return originalGet(name)
    }
    apply(ctx, { kitRoot, dshHome }, stubMcp)
    await waitFor(ctx.routes.get(`GET ${STATE_PATH}`), new Request(`http://dsh.local/api/vae-kit.state?project=${encodeURIComponent(project)}`))
    assert.equal(childPlugins.length, 0)
    assert.equal(ctx.plugins.length, 0)
  })

  it('mounts a project MCP on the agent scope', async () => {
    const dshHome = await mkdtemp(join(tmpdir(), 'vae-kit-'))
    const project = await mkdtemp(join(tmpdir(), 'vae-kit-proj-'))
    await mkdir(join(project, '.git'))
    const ctx = fakeContext()
    const agentPlugins = []
    const agent = {
      session: { header: { cwd: project } },
      ctx: {
        plugin: async (mod, config) => {
          agentPlugins.push({ mod, config })
          return { dispose: async () => {} }
        },
        effect: (callback) => callback(),
        get() { return undefined },
      },
    }
    const originalGet = ctx.get.bind(ctx)
    ctx.get = (name) => {
      if (name === 'agents') return { list: () => [agent] }
      return originalGet(name)
    }
    apply(ctx, { kitRoot, dshHome }, stubMcp)
    const enable = ctx.routes.get(`POST ${ENABLE_PATH}`)
    const response = await enable.fetch(new Request('http://dsh.local/api/vae-kit.enable', {
      method: 'POST',
      body: JSON.stringify({
        kind: 'mcp', id: 'playwright', scope: 'project', value: 'on', project,
      }),
    }))
    const body = await response.json()
    assert.equal(response.status, 200)
    assert.equal(body.mcp.find(item => item.id === 'playwright').effective, 'project')
    assert.equal(ctx.plugins.length, 0)
    await waitUntil(ctx.routes.get(`GET ${STATE_PATH}`), () => agentPlugins.length === 1)
    assert.equal(agentPlugins.length, 1)
    assert.equal(agentPlugins[0].config.serverName, 'playwright')
    const skills = await ctx.providers[0].list({ cwd: project })
    assert.ok(skills.some(skill => skill.name === 'officecli'))
  })

  it('unmounts a global MCP when turned off', async () => {
    const dshHome = await mkdtemp(join(tmpdir(), 'vae-kit-'))
    const ctx = fakeContext()
    let disposed = 0
    ctx.plugin = async (mod, config) => {
      ctx.plugins.push({ mod, config })
      return { dispose: async () => { disposed += 1 } }
    }
    apply(ctx, { kitRoot, dshHome }, stubMcp)
    const enable = ctx.routes.get(`POST ${ENABLE_PATH}`)
    await enable.fetch(new Request('http://dsh.local/api/vae-kit.enable', {
      method: 'POST',
      body: JSON.stringify({ kind: 'mcp', id: 'playwright', scope: 'global', value: 'on' }),
    }))
    const response = await enable.fetch(new Request('http://dsh.local/api/vae-kit.enable', {
      method: 'POST',
      body: JSON.stringify({ kind: 'mcp', id: 'playwright', scope: 'global', value: 'off' }),
    }))
    const body = await response.json()
    const after = await waitUntil(ctx.routes.get(`GET ${STATE_PATH}`), view => view.mcp.find(item => item.id === 'playwright').mcp.status === 'idle')
    assert.equal(disposed, 1)
    assert.equal(after.mcp.find(item => item.id === 'playwright').mcp.status, 'idle')
    assert.equal(body.mcp.find(item => item.id === 'playwright').effective, 'off')
  })

  it('masks a globally mounted MCP when the project turns it off', async () => {
    const dshHome = await mkdtemp(join(tmpdir(), 'vae-kit-'))
    const project = await mkdtemp(join(tmpdir(), 'vae-kit-proj-'))
    await mkdir(join(project, '.git'))
    const ctx = fakeContext()
    let lastDeny = []
    const agent = {
      session: { header: { cwd: project } },
      ctx: {
        plugin: async () => ({ dispose: async () => {} }),
        effect: (callback) => callback(),
        get(name) { return name === 'tools' ? this.tools : undefined },
        tools: {
          schemas: () => [{ name: 'mcp__playwright__browser_navigate' }],
          restrict({ deny }) {
            lastDeny = [...deny]
            return () => {}
          },
        },
      },
    }
    const originalGet = ctx.get.bind(ctx)
    ctx.get = (name) => {
      if (name === 'agents') return { list: () => [agent] }
      return originalGet(name)
    }
    apply(ctx, { kitRoot, dshHome }, stubMcp)
    const enable = ctx.routes.get(`POST ${ENABLE_PATH}`)
    await enable.fetch(new Request('http://dsh.local/api/vae-kit.enable', {
      method: 'POST',
      body: JSON.stringify({ kind: 'mcp', id: 'playwright', scope: 'global', value: 'on' }),
    }))
    const response = await enable.fetch(new Request('http://dsh.local/api/vae-kit.enable', {
      method: 'POST',
      body: JSON.stringify({
        kind: 'mcp', id: 'playwright', scope: 'project', value: 'off', project,
      }),
    }))
    const body = await response.json()
    assert.equal(response.status, 200)
    assert.equal(body.mcp.find(item => item.id === 'playwright').effective, 'off')
    assert.equal(ctx.plugins.length, 1)
    await waitUntil(ctx.routes.get(`GET ${STATE_PATH}`), () => lastDeny.includes('mcp__playwright__browser_navigate'))
    assert.deepEqual(lastDeny, ['mcp__playwright__browser_navigate'])
  })

  it('hides a default-on skill when the project file turns it off', async () => {
    const dshHome = await mkdtemp(join(tmpdir(), 'vae-kit-'))
    const project = await mkdtemp(join(tmpdir(), 'vae-kit-proj-'))
    await mkdir(join(project, '.git'))
    await mkdir(join(project, '.dsh'), { recursive: true })
    await writeFile(join(project, '.dsh', 'extensions.yml'), 'skills:\n  officecli: off\n')
    const ctx = fakeContext()
    apply(ctx, { kitRoot, dshHome }, stubMcp)
    await waitFor(ctx.routes.get(`GET ${STATE_PATH}`))
    const skills = await ctx.providers[0].list({ cwd: project })
    assert.ok(!skills.some(skill => skill.name === 'officecli'))
  })

  it('ignores unknown ids in extensions.yml and rejects them on enable', async () => {
    const dshHome = await mkdtemp(join(tmpdir(), 'vae-kit-'))
    await mkdir(dshHome, { recursive: true })
    await writeFile(join(dshHome, 'extensions.yml'), 'mcp:\n  nope: on\n')
    const ctx = fakeContext()
    apply(ctx, { kitRoot, dshHome }, stubMcp)
    const reload = ctx.routes.get(`POST ${RELOAD_PATH}`)
    const body = await (await reload.fetch(new Request('http://dsh.local/api/vae-kit.reload', { method: 'POST', body: '{}' }))).json()
    assert.equal(body.error, null)
    const enable = ctx.routes.get(`POST ${ENABLE_PATH}`)
    const denied = await enable.fetch(new Request('http://dsh.local/api/vae-kit.enable', {
      method: 'POST',
      body: JSON.stringify({ kind: 'mcp', id: 'nope', scope: 'global', value: 'on' }),
    }))
    assert.equal(denied.status, 400)
  })
})
