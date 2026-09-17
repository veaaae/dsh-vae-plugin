# dsh-vae-update

[中文](README.md) | English

An update panel inside Settings: check the official DeepSeek Harness source checkout and this plugin repository for new commits, then apply the update in one click.

```sh
pnpm dsh plugin --profile web add /home/dsh-vae-plugin/packages/vae-update
pnpm dsh plugin --profile web add github:veaaae/dsh-vae-plugin#path:packages/vae-update
```

Restart `dsh web`, then open Settings → **Updates**.

## What it does

One bundle, two halves:

- **Host half** (`lib/index.js`): registers five `/api/vae-update.*` routes behind Connection's authenticated `/api` fence.
- **Client half** (`lib/client.js`): registers one `settings.section` page in Settings.

The page shows one card per checkout: path, branch, current commit, version, build-artifact version, newest release tag, ahead/behind counts against the upstream, and local changes. The **Check for updates** button runs `git fetch --prune --tags` in both repositories.

A card distinguishes the states that look finished but are not:

- **Pulled but not built**: the harness browser artifacts embed their version at build time (`.dsh-build/client-build-environment.json`), so between `git pull` and `pnpm run build` the UI still reports the old version. When the checkout version and the artifact version disagree, the card says so directly.
- **Local changes**: tracked modifications are reported as a possible failure; the pull is `--ff-only` and never overwrites them.
- **Restart pending**: after a build the running process still executes old code. When systemd supervises the process (the plugin reads its own unit from `/proc/self/cgroup`), the finished job offers a **Restart dsh web** button; the restart runs as a detached `systemctl restart` outside this process, and the page waits for the service to answer and then reloads itself. Otherwise the page only prints the command for you to run.

**A blank page, then an automatic refresh**: the build replaces the frontend artifacts being served (`apps/web/dist` and every `lib/client.js`), so the tab that started the update can go blank for a moment. When the **build succeeds**, that page therefore refreshes itself two seconds later — the timer still fires while the page is blank — moving it onto the new artifacts; refresh manually if it somehow does not. Only a successful build reloads: a failed one leaves the page intact so its error stays readable. A restart then moves the host process onto the new code too.

**Update now** runs, stopping at the first failure:

1. `git pull --ff-only`
2. `pnpm install`
3. `pnpm run build`

Each step has a time limit — 5 minutes for the pull, 45 for the install, 90 for the build. A checkout that jumps many releases can legitimately spend a quarter-hour installing, so a step that exceeds its limit is SIGKILLed and fails the job (the failed step opens itself and shows why). Override the limits in config; `0` disables one:

```yaml
- insert:
    - id: vae-update
      name: dsh-vae-update
      config:
        timeouts:
          installMs: 0        # no limit
          buildMs: 7200000    # two hours
```

Only fast-forward pulls are accepted; a diverged branch or a conflicting local change fails the pull and shows git's own output.

## Local patches (optional; one ships here)

Editing a file in the official checkout by hand leaves a **modified** tracked file, and `git pull --ff-only` refuses to merge into a file upstream also changed — so one local edit eventually blocks the update it was making possible.

A patch therefore lives in **this repository** and is treated as build input, in this order:

1. Take the series off (`git apply --reverse`), so the pull sees a clean checkout.
2. Pull, then install.
3. Apply the series (`git apply`).
4. Build, baking the change into the artifacts.
5. Take the series off again, leaving the checkout matching upstream.

Steps 1, 3, and 5 **skip instead of stopping** when they fail: if upstream rewrote the same code, the patch no longer applies, the page marks that step skipped and expands git's own message, and the update finishes anyway (the cost is that the patch's effect disappears). Patch steps share the pull step's time limit.

Every `*.patch` in the series directory is applied in filename order; an absent directory means no patches and the plan falls back to three steps. The series applies to the official checkout only — the plugin repository is your working tree and the plugin leaves it alone. Override the directory with `patchesDir`:

```yaml
- insert:
    - id: vae-update
      name: dsh-vae-update
      config:
        patchesDir: /home/dsh-vae-plugin/packages/vae-update/patches
```

The shipped `patches/settings-nav-icon.patch` gives the **Update** settings row a download glyph instead of sharing the gear with **General**: the host hardcodes its nav icons, so a section registered by an outside package cannot declare one. That patch goes stale, by design, if upstream rewrites `navIcon` in `SettingsRoot.tsx`.

## Where the paths come from

Both checkouts are detected, so config is normally unnecessary:

- Official source: the nearest `.git` above the running CLI entry and the current directory, accepted only when the root `package.json` `name` is `@deepseek-ai/dsh-root`.
- Plugin repository: the nearest `.git` above this plugin's own module path (a local install is a `link:`, which points back at this repository).

When detection cannot find one — a plugin copied into a profile instead of linked — configure it in that profile's patch layer:

```yaml
- insert:
    - id: vae-update
      name: dsh-vae-update
      config:
        harnessRoot: /home/deepseek-harness
        pluginsRoot: /home/dsh-vae-plugin
        remote: origin          # optional, defaults to origin
```

## Limits

- `--ff-only` only: no rebase, no discarding local commits, no force push.
- Job progress is in-memory state of the running process; nothing is persisted, and one update runs at a time.
- Unloading the plugin kills any `git`/`pnpm` child process it started.
- The routes ride the same `/api` browser-session authentication as the product's own endpoints.
- The restart button exists only under systemd: it asks once for confirmation, then runs a detached `sh -c 'sleep 1; exec systemctl restart "$1"'` for your own unit (the name travels as a positional parameter, never as shell source). Outside systemd — a `pnpm dsh web` you started in a terminal — the page prints the manual command instead of guessing how to restart.

See the [root README](../../README.en.md) for the workspace layout and how to add another plugin.
