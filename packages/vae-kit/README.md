# dsh-vae-kit

中文 | [English](README.en.md)

个人 MCP + Skill 货架的管理插件：读本包的 `kit/` 目录，按全局/项目开关过滤 Skill，并挂载启用的 MCP 客户端。

```sh
pnpm dsh plugin --profile web add /home/dsh-vae-plugin/packages/vae-kit
pnpm dsh plugin --profile web add github:veaaae/dsh-vae-plugin#path:packages/vae-kit
```

从 GitHub 安装时，pnpm ≥10 会拦截 `prepare`。第一次失败后把打印的包名写进该 profile 的 `pnpm-workspace.yaml`：

```yaml
allowBuilds:
  dsh-vae-kit: true
```

装完重启 `dsh web`，打开设置 → **MCP / Skills**。

## 它做什么

- 读本包的 `kit/catalog.yml`、`kit/mcp/<id>/server.yml`、`kit/skills/<id>/SKILL.md`（仓库根的 `kit/` 是指向这里的符号链接）
- 全局开关：`$DSH_HOME/extensions.yml`
- 项目开关：`<gitRoot>/.dsh/extensions.yml`（同名 id 项目赢）
- 把启用的 Skill 注册成 `ctx.skills` 提供方 `vae-kit`
- 全局启用的 MCP：在 Host 上 `plugin(@deepseek-ai/dsh-mcp-client)`
- 项目启用的 MCP：在该 session 的 agent 作用域里挂；session 结束即拆
- 项目关掉的全局 MCP：对该 agent `tools.restrict` 遮掉工具（stdio 进程仍在，直到全局也关）

密钥不要进 git。`server.yml` 的 `envFrom` 从进程环境拷贝变量名。

可选配置：

```yaml
- insert:
    - id: vae-kit
      name: dsh-vae-kit
      config:
        kitRoot: /absolute/path/to/kit
        dshHome: /absolute/path/to/.dsh
```
