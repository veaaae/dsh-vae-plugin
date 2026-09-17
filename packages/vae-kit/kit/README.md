# Personal MCP + Skill kit

中文 | [English](README.en.md)

`veaaae` 常用的 MCP 服务器声明和 Skill 手册，随 `dsh-vae-kit` 包发布。这是**货架**：只描述有什么，不启动进程。仓库根目录的 `kit/` 是指向本目录的符号链接。

启用由 `dsh-vae-kit` 插件读取：

| 作用域 | 文件 |
|---|---|
| 全局 | `$DSH_HOME/extensions.yml`（默认 `~/.dsh/extensions.yml`） |
| 项目 | `<gitRoot>/.dsh/extensions.yml` |

同名 id **项目赢**。密钥不要进 git。

## 目录

```
catalog.yml                 id、简介、建议默认作用域
mcp/<id>/server.yml         一台 MCP 的 transport / command / envFrom
skills/<id>/SKILL.md        标准 DSH skill bundle
```

## 现在没有管理器时

Skill 可以拷到 `~/.dsh/skills/` 或项目的 `.dsh/skills/`。
MCP 仍需把 `@deepseek-ai/dsh-mcp-client` 行写进 profile patch，或安装 `dsh-vae-kit`。

安装管理器：

```sh
pnpm dsh plugin --profile web add /home/dsh-vae-plugin/packages/vae-kit
```

装完重启 `dsh web`，打开设置 → **MCP / Skills**。
