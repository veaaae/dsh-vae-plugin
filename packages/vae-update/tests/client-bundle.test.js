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
  const sandbox = { window: { __ModuleLoader__: { load: registration => registrations.push(registration) } } }
  vm.createContext(sandbox)
  vm.runInContext(source, sandbox)
  assert.equal(registrations.length, 1, 'the bundle must register exactly one factory')
  return registrations[0]
}

/** The hooks the client half destructures; each returns a stable stub. */
function reactStub() {
  return {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useState: value => [value, () => {}],
    useCallback: callback => callback,
    useEffect: () => {},
    useRef: value => ({ current: value }),
  }
}

describe('client bundle', () => {
  it('registers the package id and asks the module table only for react', () => {
    const registration = loadBundle()
    assert.equal(registration.id, 'dsh-vae-update')
    const requested = []
    const exports = registration.factory((specifier) => {
      requested.push(specifier)
      if (specifier === 'react') return reactStub()
      throw new Error(`unexpected module request: ${specifier}`)
    })
    assert.deepEqual(requested, ['react'])
    assert.deepEqual([...exports.inject], ['slots'])
    assert.equal(typeof exports.apply, 'function')
    assert.equal(exports.NS, 'vae-update')
  })

  it('registers one settings page and renders it', () => {
    const registration = loadBundle()
    const exports = registration.factory(() => reactStub())

    const injected = []
    const registered = []
    const effects = []
    const ctx = {
      effect: (callback, label) => {
        effects.push(label)
        return callback()
      },
      get: () => undefined,
      slots: {
        inject: (key, callback) => injected.push([key, callback]),
        register: (options, component) => registered.push([options, component]),
      },
    }
    exports.apply(ctx)

    assert.deepEqual(injected.map(([key]) => key), ['settings.section'])
    assert.equal(registered.length, 0, 'registration waits for the slot declaration')

    injected[0][1]()
    assert.equal(registered.length, 1)
    const [options, component] = registered[0]
    assert.equal(options.name, 'settings.section')
    assert.equal(options.id, 'vae-update')
    assert.equal(typeof options.label(), 'string')
    assert.ok(options.label().length > 0)

    // The owner renders the section with no props of its own; the element tree
    // must build without touching fetch or the DOM.
    const element = component()
    assert.ok(element !== undefined)
    assert.equal(element.type.name, 'UpdateSection')
    const rendered = element.type(element.props)
    assert.ok(Array.isArray(rendered.children))
  })

  it('reloads only when a build finishes under a page that watched it run', () => {
    const registration = loadBundle()
    const { buildFinished } = registration.factory(() => reactStub())
    const running = { id: 'j1', status: 'running' }
    const built = {
      id: 'j1',
      status: 'succeeded',
      steps: [{ key: 'build', command: 'pnpm run build', status: 'ok', log: [] }],
    }

    assert.equal(buildFinished(running, built), true)
    // A page that first sees an already-finished job must not reload in a loop.
    assert.equal(buildFinished(null, built), false)
    assert.equal(buildFinished(built, built), false)
    // A different job, a still-running job, and a build that never succeeded.
    assert.equal(buildFinished(running, { ...built, id: 'j2' }), false)
    assert.equal(buildFinished(running, { ...built, status: 'running' }), false)
    // A job that failed after its build still replaced the served artifacts.
    assert.equal(buildFinished(running, { ...built, status: 'failed' }), true)
    assert.equal(buildFinished(running, {
      ...built,
      steps: [{ key: 'build', command: 'pnpm run build', status: 'failed', log: [] }],
    }), false)
  })
})
