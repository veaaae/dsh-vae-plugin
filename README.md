# dsh-vae-plugin

中文 | [English](README.en.md)

[`veaaae`](https://github.com/veaaae) 的独立 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件仓库。

本仓库**不是** `deepseek-ai/deepseek-harness` 的 fork。官方源码 checkout 保持 `master` 原样，产品改动放在这里。

当前脚手架注册一个探针工具 `vae_status`，用来验证安装和 Web 可见性；真正功能替换它，或按下面的方式继续加插件。

## 多个插件可以放在这里吗？

可以。按耦合程度选一种，不要混用：

| 做法 | 适合 | 用户怎么装 |
|---|---|---|
| **同一个 bundle 里加多个工具** | 功能属于同一产品、总是一起启用 | 装一次 `dsh-vae-plugin` |
| **`packages/<name>/` 各做一个 bundle** | 功能独立、想分开安装/开关 | 每个包单独 `add` |

同一 bundle：在 `src/` 里继续 `ctx.tools.register(...)`，`cordis.patch.yml` 仍只插入这一行。装一次，所有工具一起出现。

独立 bundle：每个插件一个目录，自带 `package.json`、`cordis.patch.yml` 和源码：

```
packages/
  vae-status/     # 现在的探针，可迁到这里
  your-next/      # 下一个独立插件
```

每个包声明自己的 `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`。安装子目录：

```sh
pnpm dsh plugin --profile web add github:veaaae/dsh-vae-plugin#path:packages/your-next
```

本地开发用路径：

```sh
pnpm dsh plugin --profile web add /home/dsh-vae-plugin/packages/your-next
```

还没拆 `packages/` 之前，新工具先写进当前根包。需要分开安装时再拆。

## 安装到本机 Web profile

在 harness 源码目录（已执行过 `pnpm install` / `pnpm run build`）里：

```sh
pnpm dsh plugin --profile web add /home/dsh-vae-plugin
```

从 GitHub 安装：

```sh
pnpm dsh plugin --profile web add github:veaaae/dsh-vae-plugin
```

pnpm ≥10 默认拦截 git 依赖的 `prepare` 脚本，必须显式放行。第一次从 GitHub 安装失败时，把 pnpm 打印的包名写进该 profile 的 `pnpm-workspace.yaml`：

```yaml
allowBuilds:
  dsh-vae-plugin: true
```

然后重新执行 `add`。组合包成员变化后需要重启 `pnpm dsh web`。对 agent 说：`调用 vae_status，告诉我它返回了什么。`

## 目录

```
src/index.ts          插件入口：注册 vae_status
src/greeting.ts       纯格式化函数（有单测）
cordis.patch.yml      写入 profile 的组合包层
tsdown.config.mjs     自包含的 prepare/build（git 安装必须）
README.md             中文
README.en.md          English
```

`package.json` 必须声明 `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`。没有这个字段时，`dsh plugin add` 只会装成普通依赖，并打印警告。

## 改 harness 源码（可选）

以后如果必须改官方源码：

```text
upstream  = https://github.com/deepseek-ai/deepseek-harness.git   # 只 fetch
origin    = 你自己的 fork（有了再配）                            # 把 mine/ui 推到这里
master    = 镜像官方，不要在上面提交
mine/ui   = 你的源码补丁；定期 merge/rebase upstream/master
```

不要把 `mine/ui` 推到 `deepseek-ai/deepseek-harness`。先建自己的 fork。

## 开发

```sh
pnpm install
pnpm test
pnpm run build
```
