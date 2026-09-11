# dsh-vae-plugin

中文 | [English](README.en.md)

[`veaaae`](https://github.com/veaaae) 的独立 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件仓库。

本仓库**不是** `deepseek-ai/deepseek-harness` 的 fork。官方源码 checkout 保持 `master` 原样，产品改动放在这里。

根目录是 pnpm workspace，**不是**可安装的组合包。每个插件是 `packages/<name>/` 下的独立 bundle：自己的 `package.json`、`cordis.patch.yml` 和源码，分开安装、分开开关。

当前已有 `dsh-vae-status`：探针工具 `vae_status`，用来验证安装和 Web 可见性。

## 安装某一个插件

在 harness 源码目录（已执行过 `pnpm install` / `pnpm run build`）里，装本地路径：

```sh
pnpm dsh plugin --profile web add /home/dsh-vae-plugin/packages/vae-status
```

从 GitHub 装子目录（必须带 `#path:`，不要装仓库根）：

```sh
pnpm dsh plugin --profile web add github:veaaae/dsh-vae-plugin#path:packages/vae-status
```

pnpm ≥10 默认拦截 git 依赖的 `prepare` 脚本，必须显式放行。第一次从 GitHub 安装失败时，把 pnpm 打印的包名写进该 profile 的 `pnpm-workspace.yaml`：

```yaml
allowBuilds:
  dsh-vae-status: true
```

然后重新执行 `add`。组合包成员变化后需要重启 `pnpm dsh web`。对 agent 说：`调用 vae_status，告诉我它返回了什么。`

卸下一个插件：

```sh
pnpm dsh plugin --profile web remove dsh-vae-status
```

## 再加一个插件

复制 `packages/vae-status/`，然后改这些字段，保证互不冲突：

1. 目录名 `packages/<name>/`
2. `package.json` 的 `name`（例如 `dsh-vae-<name>`）
3. `cordis.patch.yml` 的 `id` 和 `name`
4. `src/index.ts` 里的 `export const name` 和工具名
5. 该包自己的 `prepare` / `tsdown.config.mjs`（git 安装只看这个子目录，不能依赖仓库根）

每个包必须声明 `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`。没有这个字段时，`dsh plugin add` 只会装成普通依赖，并打印警告。

## 目录

```
packages/
  vae-status/           探针组合包 dsh-vae-status
    src/index.ts
    src/greeting.ts
    cordis.patch.yml
    tsdown.config.mjs
    package.json
pnpm-workspace.yaml
README.md               中文
README.en.md            English
```

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

在仓库根目录：

```sh
pnpm install
pnpm test
pnpm run build
```

只针对一个包：

```sh
pnpm --filter dsh-vae-status test
```
