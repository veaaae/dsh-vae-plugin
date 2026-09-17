import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  APPLY_PATH,
  CHECK_PATH,
  JOB_PATH,
  RESTART_PATH,
  STATE_PATH,
  UpdateJobRunner,
  apply,
  createCommandRunner,
  detectRestartTarget,
  inspectRepo,
  planUpdate,
  resolveOptions,
} from '../lib/index.js'

/** Per-step limits the harness resolves before planning a job. */
const LIMITS = { pullMs: 60_000, installMs: 120_000, buildMs: 180_000 }

/** Capture every route the host half registers. */
function fakeContext() {
  const routes = new Map()
  const effects = []
  return {
    routes,
    effects,
    connection: { fetch: { register: route => routes.set(`${route.methods.join(',')} ${route.path}`, route) } },
    effect: (callback, label) => {
      effects.push(label)
      return callback()
    },
  }
}

/** Wait until a job stops running, or fail the test. */
async function settle(runner) {
  for (let attempt = 0; attempt < 200 && runner.running; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  assert.equal(runner.running, false, 'job did not settle')
}

describe('resolveOptions', () => {
  it('defaults the remote and detects checkout paths as strings', () => {
    const options = resolveOptions(undefined)
    assert.equal(options.remote, 'origin')
    assert.equal(typeof options.harnessRoot, 'string')
    assert.equal(typeof options.pluginsRoot, 'string')
  })

  it('resolves configured paths', () => {
    const options = resolveOptions({ harnessRoot: '/tmp/harness', pluginsRoot: '/tmp/plugins', remote: 'upstream' })
    assert.equal(options.harnessRoot, '/tmp/harness')
    assert.equal(options.pluginsRoot, '/tmp/plugins')
    assert.equal(options.remote, 'upstream')
  })

  it('fails loud on a malformed value', () => {
    assert.throws(() => resolveOptions({ harnessRoot: 5 }), /harnessRoot/)
    assert.throws(() => resolveOptions({ remote: '' }), /remote/)
  })
})

describe('planUpdate', () => {
  it('runs pull, install, then build in the target checkout', () => {
    const plan = planUpdate('plugins', { harnessRoot: '/h', pluginsRoot: '/p' }, LIMITS)
    assert.equal(plan.target, 'plugins')
    assert.deepEqual(plan.steps.map(step => step.key), ['pull', 'install', 'build'])
    assert.ok(plan.steps.every(step => step.cwd === '/p'))
    assert.deepEqual(plan.steps[0].argv, ['git', 'pull', '--ff-only'])
    assert.deepEqual(plan.steps[2].argv, ['pnpm', 'run', 'build'])
    // Resolved limits reach the runner unchanged: too short an install limit is
    // what silently stopped a real update before its build step could run.
    assert.deepEqual(plan.steps.map(step => step.timeoutMs), [LIMITS.pullMs, LIMITS.installMs, LIMITS.buildMs])
  })

  it('takes a local series off before the pull and off again after the build', () => {
    const series = ['/plugins/patches/a.patch', '/plugins/patches/b.patch']
    const plan = planUpdate('harness', { harnessRoot: '/h', pluginsRoot: '/p' }, LIMITS, series)
    assert.deepEqual(plan.steps.map(step => step.key), ['clean', 'pull', 'install', 'patch', 'build', 'unpatch'])
    assert.deepEqual(plan.steps[0].argv, ['git', 'apply', '--reverse', ...series])
    assert.deepEqual(plan.steps[3].argv, ['git', 'apply', ...series])
    assert.deepEqual(plan.steps[5].argv, ['git', 'apply', '--reverse', ...series])
    // The three patch steps tolerate failure; the update they wrap does not.
    assert.deepEqual(plan.steps.map(step => step.optional === true), [true, false, false, true, false, true])
  })

  it('adds no patch steps to the plugin repository', () => {
    const plan = planUpdate('plugins', { harnessRoot: '/h', pluginsRoot: '/p' }, LIMITS, ['/plugins/a.patch'])
    assert.deepEqual(plan.steps.map(step => step.key), ['pull', 'install', 'build'])
  })
})

describe('optional steps', () => {
  it('lets a patch step that has nothing to do pass and records why', async () => {
    const runner = new UpdateJobRunner((cwd, argv, options) => {
      if (argv.includes('--reverse')) {
        options.onLine('error: patch does not apply', 'stderr')
        return Promise.resolve({ code: 1, stdout: '', stderr: 'error: patch does not apply\n' })
      }
      return Promise.resolve({ code: 0, stdout: '', stderr: '' })
    })
    runner.start(planUpdate('harness', { harnessRoot: '/h', pluginsRoot: '/p' }, LIMITS, ['/plugins/a.patch']))
    await settle(runner)
    const finished = runner.view()
    assert.equal(finished.status, 'succeeded')
    assert.deepEqual(finished.steps.map(step => step.status), ['skipped', 'ok', 'ok', 'ok', 'ok', 'skipped'])
    assert.deepEqual(finished.steps[0].log, ['error: patch does not apply'])
  })
})

describe('resolveOptions timeouts', () => {
  it('defaults to limits that survive a post-merge install and a full build', () => {
    const { timeouts } = resolveOptions(undefined)
    assert.ok(timeouts.installMs >= 30 * 60_000, 'install limit must tolerate a large merge')
    assert.ok(timeouts.buildMs >= 60 * 60_000, 'build limit must tolerate a full rebuild')
  })

  it('accepts configured limits, including zero for no limit', () => {
    const { timeouts } = resolveOptions({ timeouts: { installMs: 0, buildMs: 7_200_000 } })
    assert.equal(timeouts.installMs, 0)
    assert.equal(timeouts.buildMs, 7_200_000)
    assert.equal(timeouts.pullMs, resolveOptions(undefined).timeouts.pullMs)
  })

  it('rejects a malformed limit', () => {
    assert.throws(() => resolveOptions({ timeouts: { installMs: -1 } }), /installMs/)
    assert.throws(() => resolveOptions({ timeouts: { buildMs: 'soon' } }), /buildMs/)
  })
})

describe('UpdateJobRunner', () => {
  it('records each step, streams its output, and finishes', async () => {
    const commands = []
    const runner = new UpdateJobRunner((cwd, argv, options) => {
      commands.push(`${cwd} ${argv.join(' ')}`)
      options.onLine('hello', 'stdout')
      return Promise.resolve({ code: 0, stdout: 'hello\n', stderr: '' })
    })
    const started = runner.start(planUpdate('harness', { harnessRoot: '/h', pluginsRoot: '/p' }, LIMITS))
    assert.equal(started.status, 'running')
    await settle(runner)
    const finished = runner.view()
    assert.equal(finished.status, 'succeeded')
    assert.deepEqual(finished.steps.map(step => step.status), ['ok', 'ok', 'ok'])
    assert.deepEqual(finished.steps[0].log, ['hello'])
    assert.equal(commands.length, 3)
  })

  it('stops at the first failed step and keeps later steps pending', async () => {
    let calls = 0
    const runner = new UpdateJobRunner(() => {
      calls += 1
      return Promise.resolve({ code: calls === 2 ? 1 : 0, stdout: '', stderr: 'boom' })
    })
    runner.start(planUpdate('plugins', { harnessRoot: '/h', pluginsRoot: '/p' }, LIMITS))
    await settle(runner)
    const finished = runner.view()
    assert.equal(finished.status, 'failed')
    assert.deepEqual(finished.steps.map(step => step.status), ['ok', 'failed', 'pending'])
  })

  it('refuses a second concurrent job', async () => {
    const runner = new UpdateJobRunner(() => new Promise(() => {}))
    runner.start(planUpdate('harness', { harnessRoot: '/h', pluginsRoot: '/p' }, LIMITS))
    assert.throws(() => runner.start(planUpdate('harness', { harnessRoot: '/h', pluginsRoot: '/p' }, LIMITS)), /already running/)
  })
})

describe('inspectRepo against a real checkout', () => {
  it('reads this repository through the real command runner', async (t) => {
    let dir = dirname(fileURLToPath(import.meta.url))
    while (!existsSync(join(dir, '.git'))) {
      const parent = dirname(dir)
      if (parent === dir) {
        t.skip('this test file is not inside a git checkout')
        return
      }
      dir = parent
    }
    const view = await inspectRepo({
      key: 'plugins',
      root: dir,
      run: createCommandRunner(),
      readText: path => readFile(path, 'utf8'),
    })
    assert.equal(view.ok, true, view.error)
    assert.equal(typeof view.branch, 'string')
    assert.ok((view.commit?.sha.length ?? 0) > 0)
    assert.ok(view.modified !== undefined)
    assert.ok(view.dirty !== undefined)
  })
})

describe('inspectRepo build record', () => {
  it('flags browser artifacts built before the current commit', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vae-build-'))
    execFileSync('git', ['init', '-q', dir])
    execFileSync('git', ['-C', dir, 'config', 'user.email', 'test@example.com'])
    execFileSync('git', ['-C', dir, 'config', 'user.name', 'test'])
    writeFileSync(join(dir, 'package.json'), '{"name":"probe","version":"1.0.0"}\n')
    execFileSync('git', ['-C', dir, 'add', '.'])
    execFileSync('git', ['-C', dir, 'commit', '-q', '-m', 'init'])
    const inspect = () => inspectRepo({
      key: 'plugins',
      root: dir,
      run: createCommandRunner(),
      readText: path => readFile(path, 'utf8'),
    })
    const record = (environment) => {
      mkdirSync(join(dir, '.dsh-build'), { recursive: true })
      writeFileSync(join(dir, '.dsh-build', 'client-build-environment.json'), JSON.stringify({ formatVersion: 1, environment }))
    }

    const unbuilt = await inspect()
    assert.equal(unbuilt.ok, true, unbuilt.error)
    assert.equal(unbuilt.builtVersion, undefined)
    assert.equal(unbuilt.buildStale, undefined)

    record({ DSH_CLIENT_VERSION: '0.0.9', DSH_CLIENT_COMMIT_HASH: 'deadbee' })
    const stale = await inspect()
    assert.equal(stale.builtVersion, '0.0.9')
    assert.equal(stale.buildStale, true)

    record({ DSH_CLIENT_VERSION: '1.0.0', DSH_CLIENT_COMMIT_HASH: unbuilt.commit.sha })
    const fresh = await inspect()
    assert.equal(fresh.builtVersion, '1.0.0')
    assert.equal(fresh.buildStale, false)
  })
})

describe('detectRestartTarget', () => {
  it('reports the systemd unit that owns this process', () => {
    const target = detectRestartTarget({
      readCgroup: () => '0::/system.slice/dsh-web.service\n',
      systemdAvailable: () => true,
    })
    assert.deepEqual(target, { available: true, kind: 'systemd', unit: 'dsh-web.service' })
  })

  it('offers no restart outside systemd', () => {
    assert.deepEqual(
      detectRestartTarget({ readCgroup: () => '0::/system.slice/dsh-web.service', systemdAvailable: () => false }),
      { available: false, kind: 'manual' },
    )
    assert.deepEqual(
      detectRestartTarget({ readCgroup: () => '', systemdAvailable: () => true }),
      { available: false, kind: 'manual' },
    )
  })
})

describe('host routes', () => {
  it('registers the five routes under the connection fence', () => {
    const ctx = fakeContext()
    apply(ctx, { harnessRoot: '/tmp', pluginsRoot: '/tmp' })
    assert.deepEqual([...ctx.routes.keys()].sort(), [
      `GET ${JOB_PATH}`,
      `GET ${STATE_PATH}`,
      `POST ${APPLY_PATH}`,
      `POST ${CHECK_PATH}`,
      `POST ${RESTART_PATH}`,
    ].sort())
  })

  it('exposes the restart capability in page state', async () => {
    const ctx = fakeContext()
    apply(ctx, { harnessRoot: '/tmp', pluginsRoot: '/tmp' }, {
      restartTarget: () => ({ available: true, kind: 'systemd', unit: 'dsh-web.service' }),
    })
    const response = await ctx.routes.get(`GET ${STATE_PATH}`).fetch(new Request(`http://127.0.0.1${STATE_PATH}`))
    assert.deepEqual((await response.json()).restart, { available: true, kind: 'systemd', unit: 'dsh-web.service' })
  })

  it('restarts only on a confirmed request from a host that can', async () => {
    const restored = []
    const ctx = fakeContext()
    apply(ctx, { harnessRoot: '/tmp', pluginsRoot: '/tmp' }, {
      restartTarget: () => ({ available: true, kind: 'systemd', unit: 'dsh-web.service' }),
      restart: unit => restored.push(unit),
    })
    const post = body => ctx.routes.get(`POST ${RESTART_PATH}`).fetch(new Request(`http://127.0.0.1${RESTART_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }))

    assert.equal((await post({})).status, 400)
    assert.equal((await post({ confirm: false })).status, 400)
    assert.equal(restored.length, 0)
    const accepted = await post({ confirm: true })
    assert.equal(accepted.status, 202)
    assert.deepEqual(await accepted.json(), { restarting: true, unit: 'dsh-web.service' })
    assert.deepEqual(restored, ['dsh-web.service'])
  })

  it('refuses a restart the host cannot perform', async () => {
    const ctx = fakeContext()
    apply(ctx, { harnessRoot: '/tmp', pluginsRoot: '/tmp' }, {
      restartTarget: () => ({ available: false, kind: 'manual' }),
    })
    const response = await ctx.routes.get(`POST ${RESTART_PATH}`).fetch(new Request(`http://127.0.0.1${RESTART_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirm: true }),
    }))
    assert.equal(response.status, 409)
    assert.deepEqual(await response.json(), { error: 'restart-unavailable' })
  })

  it('reports an unusable checkout instead of failing the request', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'vae-update-'))
    const ctx = fakeContext()
    apply(ctx, { harnessRoot: empty, pluginsRoot: empty })
    const response = await ctx.routes.get(`GET ${STATE_PATH}`).fetch(new Request(`http://127.0.0.1${STATE_PATH}`))
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.job, null)
    assert.equal(body.plugin.name, 'dsh-vae-update')
    assert.equal(body.repos.length, 2)
    assert.ok(body.repos.every(repo => repo.ok === false))
    assert.equal(body.options.harnessRoot, empty)
  })

  it('requires a confirmed, known target before starting a job', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'vae-update-'))
    const ctx = fakeContext()
    apply(ctx, { harnessRoot: empty, pluginsRoot: empty })
    const post = body => ctx.routes.get(`POST ${APPLY_PATH}`).fetch(new Request(`http://127.0.0.1${APPLY_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }))

    assert.equal((await post({ target: 'harness' })).status, 400)
    assert.equal((await post({ target: 'other', confirm: true })).status, 400)
    assert.equal((await post({ target: 'harness', confirm: false })).status, 400)
    // A configured (even unusable) checkout accepts the request; the job itself
    // reports the failing command rather than the route guessing.
    assert.equal((await post({ target: 'harness', confirm: true })).status, 202)
  })

  it('answers the job route with null before any update', async () => {
    const ctx = fakeContext()
    apply(ctx, { harnessRoot: '/tmp', pluginsRoot: '/tmp' })
    const response = await ctx.routes.get(`GET ${JOB_PATH}`).fetch(new Request(`http://127.0.0.1${JOB_PATH}`))
    assert.deepEqual(await response.json(), { job: null })
  })
})
