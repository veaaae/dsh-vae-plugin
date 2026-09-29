# dsh-vae-kit

[中文](README.md) | English

Manager for a personal MCP + Skill catalog: reads this package's `kit/`, filters Skills by global/project switches, and mounts enabled MCP clients.

```sh
pnpm dsh plugin --profile web add /home/dsh-vae-plugin/packages/vae-kit
pnpm dsh plugin --profile web add github:veaaae/dsh-vae-plugin#path:packages/vae-kit
```

pnpm ≥10 blocks a git dependency's `prepare` script. If the first GitHub install fails, add the printed package key to the profile's `pnpm-workspace.yaml`:

```yaml
allowBuilds:
  dsh-vae-kit: true
```

Restart `dsh web`, then open Settings → **MCP / Skills**. The page switches MCP and Skills with underlined tabs. Filters are All / On / Off; the list is split into Global and Project, with the project picker beside the Project heading. Expand a mounted MCP row to list its tools. The sidebar glyph comes from `dsh-vae-update`'s `patches/settings-nav-icon.patch` (the skill handbook icon). Installing this package without the update plugin leaves the row on the default gear.

## What it does

- Reads this package's `kit/catalog.yml`, `kit/mcp/<id>/server.yml`, and `kit/skills/<id>/SKILL.md`
- Global switches: `$DSH_HOME/extensions.yml`
- Project switches: `<gitRoot>/.dsh/extensions.yml` (same id: project wins)
- Registers enabled Skills as the `vae-kit` `ctx.skills` provider
- Global MCP: `plugin(@deepseek-ai/dsh-mcp-client)` on the Host; the Settings page does not wait for that handshake and lists published `mcp__<serverName>__*` tools
- Project MCP: mounted in that session's agent scope and disposed with the session
- A project that turns a global MCP off masks those tools with `tools.restrict` (the stdio process stays until it is off globally too)

## Secrets (this machine only)

Keep tokens on this machine. Do not commit them, do not put them in `kit/mcp/*/server.yml`, and do not put them on the Settings page. `envFrom` in `server.yml` names variables only; at start the plugin copies those values from the DSH process environment into the MCP child.

Write `$DSH_HOME/.env` (default `~/.dsh/.env`) and `chmod 600` it:

```
GITHUB_TOKEN=ghp_…
CONTEXT7_API_KEY=…
```

Restart `dsh web` after editing. A one-shot override also works: `GITHUB_TOKEN=… CONTEXT7_API_KEY=… dsh web`.

| Variable | Used by | Where to get it |
|---|---|---|
| `GITHUB_TOKEN` | GitHub MCP (copied into the child’s `GITHUB_PERSONAL_ACCESS_TOKEN`) | A GitHub PAT with at least `repo` |
| `CONTEXT7_API_KEY` | Context7 MCP, optional; the server still runs at a lower rate limit without it | [context7.com/dashboard](https://context7.com/dashboard) |

`$DSH_HOME/.credentials.yaml` stores model API keys. This plugin does not read that file.

Optional config:

```yaml
- insert:
    - id: vae-kit
      name: dsh-vae-kit
      config:
        kitRoot: /absolute/path/to/kit
        dshHome: /absolute/path/to/.dsh
```
