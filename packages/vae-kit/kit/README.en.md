# Personal MCP + Skill kit

[中文](README.md) | English

MCP server declarations and Skill handbooks that `veaaae` actually uses, shipped with the `dsh-vae-kit` package. This is a **catalog**: it names what exists; it does not start processes. The repository-root `kit/` path is a symlink here.

Enablement is owned by the `dsh-vae-kit` plugin:

| Scope | File |
|---|---|
| Global | `$DSH_HOME/extensions.yml` (default `~/.dsh/extensions.yml`) |
| Project | `<gitRoot>/.dsh/extensions.yml` |

The same id: **project wins**. Do not commit secrets.

## Layout

```
catalog.yml                 ids, blurbs, suggested default scope
mcp/<id>/server.yml         one MCP transport / command / envFrom
skills/<id>/SKILL.md        a standard DSH skill bundle
```

## Without the manager

Copy a Skill into `~/.dsh/skills/` or the project's `.dsh/skills/`.
MCP still needs an `@deepseek-ai/dsh-mcp-client` row in a profile patch, or the `dsh-vae-kit` plugin.

Install the manager:

```sh
pnpm dsh plugin --profile web add /home/dsh-vae-plugin/packages/vae-kit
```

Restart `dsh web`, then open Settings → **MCP / Skills**.
