import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

/**
 * Load the built client bundle the way the browser module loader does: the file
 * runs with only `window.__ModuleLoader__` available and must register exactly
 * one factory under this package's name.
 */
function loadBundle() {
  const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  const registrations = []
  const sandbox = {
    window: { __ModuleLoader__: { load: registration => registrations.push(registration) } },
    globalThis: undefined,
    fetch: (...args) => globalThis.fetch(...args),
    Headers,
    Request,
    Response,
    URL,
    URLSearchParams,
  }
  sandbox.globalThis = sandbox
  sandbox.window.fetch = sandbox.fetch
  vm.createContext(sandbox)
  vm.runInContext(source, sandbox)
  assert.equal(registrations.length, 1, 'the bundle must register exactly one factory')
  return registrations[0]
}

/**
 * Enough of React for this page: state, effects, and refs persist across
 * renders so the first fetch can populate the tablist.
 */
function createReact() {
  let hookIndex = 0
  const states = []
  const refs = []
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useState(value) {
      const index = hookIndex++
      if (states[index] === undefined) states[index] = typeof value === 'function' ? value() : value
      return [states[index], (next) => {
        states[index] = typeof next === 'function' ? next(states[index]) : next
      }]
    },
    useCallback: callback => callback,
    useEffect(callback) {
      void callback()
    },
    useRef(value) {
      const index = hookIndex++
      if (refs[index] === undefined) refs[index] = { current: value }
      return refs[index]
    },
    useId: () => ':kit:',
  }
  function render(component, props) {
    hookIndex = 0
    return component(props)
  }
  return { react, render }
}

function walk(node, visit) {
  if (node === null || node === undefined || typeof node !== 'object') return
  visit(node)
  const children = node.children
  if (!Array.isArray(children)) return
  for (const child of children.flat()) walk(child, visit)
}

describe('client bundle', () => {
  it('registers the package id and asks the module table only for react', () => {
    const registration = loadBundle()
    assert.equal(registration.id, 'dsh-vae-kit')
    const requested = []
    const { react } = createReact()
    const exports = registration.factory((specifier) => {
      requested.push(specifier)
      if (specifier === 'react') return react
      throw new Error(`unexpected module request: ${specifier}`)
    })
    assert.deepEqual(requested, ['react'])
    assert.deepEqual([...exports.inject], ['slots'])
    assert.equal(typeof exports.apply, 'function')
    assert.equal(exports.NS, 'vae-kit')
  })

  it('registers one settings page with MCP and Skills tabs', async () => {
    const registration = loadBundle()
    const { react, render } = createReact()
    const exports = registration.factory(() => react)

    const injected = []
    const registered = []
    const ctx = {
      effect: callback => callback(),
      get: () => undefined,
      slots: {
        inject: (key, callback) => injected.push([key, callback]),
        register: (options, component) => registered.push([options, component]),
      },
    }
    exports.apply(ctx)

    assert.deepEqual(injected.map(([key]) => key), ['settings.section'])
    injected[0][1]()
    assert.equal(registered.length, 1)
    const [options, component] = registered[0]
    assert.equal(options.name, 'settings.section')
    assert.equal(options.id, 'vae-kit')
    assert.equal(options.label(), 'MCP / Skills')

    const originalFetch = globalThis.fetch
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        kitRoot: '/kit',
        dshHome: '/dsh',
        globalFile: '/dsh/extensions.yml',
        projectFile: null,
        projectRoot: null,
        projects: [],
        mcp: [],
        skills: [],
        warnings: [],
        error: null,
      }),
    })
    try {
      const element = component()
      assert.equal(element.type.name, 'KitSection')
      let rendered
      let roles = []
      let labels = []
      for (let i = 0; i < 20; i++) {
        rendered = render(element.type, element.props)
        roles = []
        labels = []
        walk(rendered, (node) => {
          if (node.props?.role !== undefined) roles.push(node.props.role)
          if (node.props?.role === 'tab') labels.push(node.children.flat().join(''))
        })
        if (roles.includes('tablist')) break
        await Promise.resolve()
      }
      assert.ok(roles.includes('tablist'), 'expected MCP/Skills tablist after state loads')
      assert.deepEqual(roles.filter(role => role === 'tab'), ['tab', 'tab'])
      assert.deepEqual(labels, ['MCP', 'Skills'])
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
