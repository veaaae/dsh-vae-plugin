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

Restart `dsh web`, then open Settings → **MCP / Skills**.

## What it does

- Reads this package's `kit/catalog.yml`, `kit/mcp/<id>/server.yml`, and `kit/skills/<id>/SKILL.md` (the repository-root `kit/` path is a symlink here)
- Global switches: `$DSH_HOME/extensions.yml`
- Project switches: `<gitRoot>/.dsh/extensions.yml` (same id: project wins)
- Registers enabled Skills as the `vae-kit` `ctx.skills` provider
- Global MCP: `plugin(@deepseek-ai/dsh-mcp-client)` on the Host
- Project MCP: mounted in that session's agent scope and disposed with the session
- A project that turns a global MCP off masks those tools with `tools.restrict` (the stdio process stays until it is off globally too)

Do not commit secrets. `envFrom` in `server.yml` copies process environment names.

Optional config:

```yaml
- insert:
    - id: vae-kit
      name: dsh-vae-kit
      config:
        kitRoot: /absolute/path/to/kit
        dshHome: /absolute/path/to/.dsh
```
