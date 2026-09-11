# dsh-vae-plugin

[中文](README.md) | English

Independent [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin repository for [`veaaae`](https://github.com/veaaae).

This repository is **not** a fork of `deepseek-ai/deepseek-harness`. Keep the official checkout unmodified on `master`, and put product work here.

The current scaffold registers one canary tool, `vae_status`, so you can prove install and Web visibility. Replace it with real work, or add more plugins as described below.

## Can this repo hold multiple plugins?

Yes. Pick one approach and stay with it:

| Approach | Use when | How users install |
|---|---|---|
| **Several tools in one bundle** | Features belong together and should always be on | Install `dsh-vae-plugin` once |
| **One bundle per `packages/<name>/`** | Features should install or toggle independently | `add` each package |

Same bundle: keep calling `ctx.tools.register(...)` in `src/`. `cordis.patch.yml` still inserts one row. One install exposes every tool.

Separate bundles: one directory per plugin, each with its own `package.json`, `cordis.patch.yml`, and source:

```
packages/
  vae-status/     # today's canary, can move here later
  your-next/      # the next independent plugin
```

Each package declares `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`. Install a subdirectory with:

```sh
pnpm dsh plugin --profile web add github:veaaae/dsh-vae-plugin#path:packages/your-next
```

For local development:

```sh
pnpm dsh plugin --profile web add /home/dsh-vae-plugin/packages/your-next
```

Until `packages/` exists, add new tools to the root package. Split a directory when you need a separate install.

## Install into the local Web profile

From the harness checkout (after `pnpm install` / `pnpm run build`):

```sh
pnpm dsh plugin --profile web add /home/dsh-vae-plugin
```

From GitHub:

```sh
pnpm dsh plugin --profile web add github:veaaae/dsh-vae-plugin
```

pnpm ≥10 blocks a git dependency's `prepare` script until you allow it. If the first GitHub install fails, add the printed package key to the profile's `pnpm-workspace.yaml`:

```yaml
allowBuilds:
  dsh-vae-plugin: true
```

Then re-run the `add`. Restart `pnpm dsh web` after bundle membership changes. Ask the agent: `Use vae_status and tell me what it returned.`

## Layout

```
src/index.ts          plugin entry: registers vae_status
src/greeting.ts       pure formatter (unit-tested)
cordis.patch.yml      bundle layer inserted into the profile
tsdown.config.mjs     self-contained prepare/build (required for git installs)
README.md             Chinese
README.en.md          English
```

`package.json` must declare `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`. Without that key, `dsh plugin add` installs a plain dependency and prints a warning.

## Harness source edits (optional)

If you later change official source:

```text
upstream  = https://github.com/deepseek-ai/deepseek-harness.git   # fetch only
origin    = your fork, once it exists                            # push mine/ui here
master    = mirror of upstream, no local commits
mine/ui   = your source patches; merge/rebase upstream/master
```

Do not push `mine/ui` to `deepseek-ai/deepseek-harness`. Create a personal fork first.

## Develop

```sh
pnpm install
pnpm test
pnpm run build
```
