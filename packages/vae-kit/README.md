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

装完重启 `dsh web`，打开设置 → **MCP / Skills**。页内用下划线 Tab 在 MCP 和 Skills 之间切换；筛选是全部 / 已开启 / 未开启，列表分成「全局」和「项目」两块，项目下拉在「项目」标题旁。点开一行才列出已挂载的工具名。侧栏图标由 `dsh-vae-update` 的 `patches/settings-nav-icon.patch` 写进宿主 `navIcon`（Skill 手册图标）；只装本包、不装更新插件时，这一行仍是默认齿轮。

## 它做什么

- 读本包的 `kit/catalog.yml`、`kit/mcp/<id>/server.yml`、`kit/skills/<id>/SKILL.md`
- 全局开关：`$DSH_HOME/extensions.yml`
- 项目开关：`<gitRoot>/.dsh/extensions.yml`（同名 id 项目赢）
- 把启用的 Skill 注册成 `ctx.skills` 提供方 `vae-kit`
- 全局启用的 MCP：在 Host 上 `plugin(@deepseek-ai/dsh-mcp-client)`；设置页不阻塞这次握手，卡片列出已发布的 `mcp__<serverName>__*` 工具
- 项目启用的 MCP：在该 session 的 agent 作用域里挂；session 结束即拆
- 项目关掉的全局 MCP：对该 agent `tools.restrict` 遮掉工具（stdio 进程仍在，直到全局也关）

## 密钥（本机）

密钥只配在本机，不要写进 git、不要写进 `kit/mcp/*/server.yml`、也不要写进设置页。`server.yml` 的 `envFrom` 只写变量**名**，启动时从 DSH 进程环境拷贝值给 MCP 子进程。

推荐写 `$DSH_HOME/.env`（默认 `~/.dsh/.env`），权限 `chmod 600`：

```
GITHUB_TOKEN=ghp_…
CONTEXT7_API_KEY=…
```

改完必须重启 `dsh web`。也可以启动时临时带上：`GITHUB_TOKEN=… CONTEXT7_API_KEY=… dsh web`。

| 变量 | 谁用 | 从哪拿 |
|---|---|---|
| `GITHUB_TOKEN` | GitHub MCP（会传给子进程的 `GITHUB_PERSONAL_ACCESS_TOKEN`） | GitHub PAT，至少 `repo` |
| `CONTEXT7_API_KEY` | Context7 MCP，可选；没有也能跑，额度更低 | [context7.com/dashboard](https://context7.com/dashboard) |

`$DSH_HOME/.credentials.yaml` 是 DSH 给模型 API 密钥用的，本插件不读那份文件。

可选配置：

```yaml
- insert:
    - id: vae-kit
      name: dsh-vae-kit
      config:
        kitRoot: /absolute/path/to/kit
        dshHome: /absolute/path/to/.dsh
```
