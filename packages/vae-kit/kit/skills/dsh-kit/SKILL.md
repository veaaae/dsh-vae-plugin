---
name: dsh-kit
description: How this personal MCP and Skill kit is laid out and enabled. Use when the user asks which MCP or skill is on, how to enable one globally or for a project, or where the kit files live.
---

# DSH kit

This skill describes the personal catalog in the `dsh-vae-kit` package (`packages/vae-kit/kit/`) and the manager plugin.

## Two layers

1. **Catalog** (`kit/catalog.yml`, `kit/mcp/<id>/server.yml`, `kit/skills/<id>/SKILL.md` inside this package) — what exists. No secrets. Safe to git.
2. **Enablement** — what is on:
   - Global: `~/.dsh/extensions.yml` (or `$DSH_HOME/extensions.yml`)
   - Project: `<gitRoot>/.dsh/extensions.yml`

Same id: the project file wins. `on` / `off` only.

Catalog `default: global` means “treat as on for every session until a file says otherwise”. `default: project` stays off until that repository turns it on.

## MCP vs Skill

- A Skill is instruction text. Enabling it only changes the skill catalog.
- An MCP server is a process or HTTP endpoint. Enabling it mounts `@deepseek-ai/dsh-mcp-client`. Global servers stay up for the whole Host. Project servers start in that session’s agent scope and stop with the session.

DSH does not scan `.dsh/mcp` by itself. Without `dsh-vae-kit`, MCP still means a `cordis.yml` row.

## Change enablement

Use Settings → **MCP / Skills**, or edit the YAML and call reload.

```yaml
# ~/.dsh/extensions.yml
mcp:
  github: on
  playwright: off
skills:
  dsh-kit: on
  pr-review: off
```

```yaml
# <repo>/.dsh/extensions.yml
mcp:
  playwright: on
  github: off
skills:
  pr-review: on
```

Tokens stay in the environment or `$DSH_HOME/.credentials.yaml`. `server.yml` `envFrom` copies a process env name into the child; it does not store the value.

## Do not

- Put tokens in `kit/` or `extensions.yml`.
- Enable Playwright globally unless every session should own a browser.
- Edit shipped DSH presets to add personal MCP rows.
