# dsh-vae-plugin

[中文](README.md) | English

Independent [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin repository for [`veaaae`](https://github.com/veaaae).

This repository is **not** a fork of `deepseek-ai/deepseek-harness`. Keep the official checkout unmodified on `master`, and put product work here.

The root is a pnpm workspace, **not** an installable bundle. Each plugin is its own bundle under `packages/<name>/`, with its own `package.json`, `cordis.patch.yml`, and source, so you can install and remove them independently.

The repo currently ships `dsh-vae-status`, a canary tool `vae_status` used to prove install and Web visibility.

## Install one plugin

From the harness checkout (after `pnpm install` / `pnpm run build`), add a local path:

```sh
pnpm dsh plugin --profile web add /home/dsh-vae-plugin/packages/vae-status
```

From GitHub, install the subdirectory (the `#path:` suffix is required; do not install the repo root):

```sh
pnpm dsh plugin --profile web add github:veaaae/dsh-vae-plugin#path:packages/vae-status
```

pnpm ≥10 blocks a git dependency's `prepare` script until you allow it. If the first GitHub install fails, add the printed package key to the profile's `pnpm-workspace.yaml`:

```yaml
allowBuilds:
  dsh-vae-status: true
```

Then re-run the `add`. Restart `pnpm dsh web` after bundle membership changes. Ask the agent: `Use vae_status and tell me what it returned.`

Remove one plugin:

```sh
pnpm dsh plugin --profile web remove dsh-vae-status
```

## Add another plugin

Copy `packages/vae-status/`, then change these so they do not collide:

1. Directory name `packages/<name>/`
2. `package.json` `name` (for example `dsh-vae-<name>`)
3. `cordis.patch.yml` `id` and `name`
4. `export const name` and the tool name in `src/index.ts`
5. That package's own `prepare` / `tsdown.config.mjs` (a git install sees only this subdirectory, not the workspace root)

Each package must declare `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`. Without that key, `dsh plugin add` installs a plain dependency and prints a warning.

## Layout

```
packages/
  vae-status/           canary bundle dsh-vae-status
    src/index.ts
    src/greeting.ts
    cordis.patch.yml
    tsdown.config.mjs
    package.json
pnpm-workspace.yaml
README.md               Chinese
README.en.md            English
```

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

From the repository root:

```sh
pnpm install
pnpm test
pnpm run build
```

One package only:

```sh
pnpm --filter dsh-vae-status test
```
