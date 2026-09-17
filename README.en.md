# dsh-vae-plugin

[中文](README.md) | English

Independent [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin repository for [`veaaae`](https://github.com/veaaae).

This repository is **not** a fork of `deepseek-ai/deepseek-harness`. Keep the official checkout unmodified on `master`, and put product work here.

The root is a pnpm workspace, **not** an installable bundle. Each plugin is its own bundle under `packages/<name>/`, with its own `package.json`, `cordis.patch.yml`, and source, so you can install and remove them independently.

`dsh-vae-update` adds a Settings → **Updates** page that checks the official harness source checkout and this repository for new commits, then runs `git pull --ff-only`, `pnpm install`, and `pnpm run build` on demand.

`dsh-vae-kit` is the personal MCP + Skill catalog and manager. The catalog lives in `packages/vae-kit/kit/`. Settings → **MCP / Skills** enables each id globally (`~/.dsh/extensions.yml`) or per project (`<gitRoot>/.dsh/extensions.yml`).

## Install one plugin

From the harness checkout (after `pnpm install` / `pnpm run build`), add a local path:

```sh
pnpm dsh plugin --profile web add /home/dsh-vae-plugin/packages/vae-kit
```

From GitHub, install the subdirectory (the `#path:` suffix is required; do not install the repo root):

```sh
pnpm dsh plugin --profile web add github:veaaae/dsh-vae-plugin#path:packages/vae-kit
```

pnpm ≥10 blocks a git dependency's `prepare` script until you allow it. If the first GitHub install fails, add the printed package key to the profile's `pnpm-workspace.yaml`:

```yaml
allowBuilds:
  dsh-vae-kit: true
```

Then re-run the `add`. Restart `pnpm dsh web` after bundle membership changes.

Remove one plugin:

```sh
pnpm dsh plugin --profile web remove dsh-vae-kit
```

## Add another plugin

Copy `packages/vae-update/`, then change these so they do not collide:

1. Directory name `packages/<name>/`
2. `package.json` `name` (for example `dsh-vae-<name>`)
3. `cordis.patch.yml` `id` and `name`
4. `export const name` and the tool name in `src/index.ts`
5. That package's own `prepare` / `tsdown.config.mjs` (a git install sees only this subdirectory, not the workspace root)

Each package must declare `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`. Without that key, `dsh plugin add` installs a plain dependency and prints a warning.

For a plugin with a **Web UI**, follow `packages/vae-update/`: declare `"dsh": { "client": { "platform": "web" } }` as well, expose `"./client"` in `exports`, keep the client half in `src/client/index.ts`, and let tsdown emit `lib/client.js` — it must be a `window.__ModuleLoader__.load({ id: "<package name>", factory: (require) => {…} })` wrapper that treats only module-table entries such as `react` as external and inlines everything else.

## Layout

```
packages/
  vae-update/           update panel dsh-vae-update (host half + client half)
    src/index.ts
    src/repo.ts
    src/jobs.ts
    src/exec.ts
    src/client/index.ts
    cordis.patch.yml
    tsdown.config.mjs
    package.json
  vae-kit/              MCP / Skill manager dsh-vae-kit (host + client + kit/)
    src/
    kit/                personal MCP declarations and Skill handbooks
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
pnpm --filter dsh-vae-kit test
```
