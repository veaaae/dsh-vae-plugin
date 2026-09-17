# dsh-vae-update

中文 | [English](README.en.md)

设置页里的更新面板：检查官方 DeepSeek Harness 源码 checkout 和本插件仓库有没有新提交，并一键执行更新。

```sh
pnpm dsh plugin --profile web add /home/dsh-vae-plugin/packages/vae-update
pnpm dsh plugin --profile web add github:veaaae/dsh-vae-plugin#path:packages/vae-update
```

装完重启 `dsh web`，打开设置 → **更新**。

## 它做什么

一个组合包含两半：

- **宿主半**（`lib/index.js`）：在 `connection` 的认证栅栏后面注册四个 `/api/vae-update.*` 路由。
- **客户端半**（`lib/client.js`）：在 Settings 里注册一个 `settings.section` 页面。

页面按卡片显示每个 checkout：路径、分支、当前提交、版本、构建产物版本、最新发布 tag、与上游的领先/落后提交数、本地改动。顶部「检查更新」对两个仓库执行 `git fetch --prune --tags`。

卡片会区分「看起来没事、其实没生效」的状态：

- **已拉取但未构建**：Harness 的浏览器产物在构建期把版本号写死（`.dsh-build/client-build-environment.json`），所以 `git pull` 之后、`pnpm run build` 之前，界面上的版本号仍是旧的。源码版本与产物版本不一致时，卡片直接显示「已拉取但未构建：产物仍是 …」。
- **本地改动**：已跟踪文件有改动时提示可能失败；只 `--ff-only`，不会覆盖你的改动。
- **需要重启**：构建完成后运行中的进程仍是旧代码。进程由 systemd 托管时（从 `/proc/self/cgroup` 识别自己所属的 unit），更新完成后面板会出现「重启 dsh web」按钮，点击后由脱离本进程的 `systemctl restart` 执行，页面自动等服务回来再重新加载；否则只给出你自己重启的命令提示。

**白屏与自动刷新**：构建会替换正在服务你的前端产物（`apps/web/dist` 和所有 `lib/client.js`），页面在你点「一键更新」的那个标签页上可能短暂白屏。因此**构建成功那一刻本页会自动刷新一次**（2 秒后，定时器在页面已白屏时依然会触发），把页面换到新产物上；自动刷新没成功时手动刷新一次即可。只有构建**成功**才会自动刷新——构建失败时页面保持原样，好让你读到失败原因。随后再点「重启 dsh web」让宿主进程也切到新代码。

「一键更新」按顺序执行，任一步失败即停：

1. `git pull --ff-only`
2. `pnpm install`
3. `pnpm run build`

每步都有超时上限，默认 `pull` 5 分钟、`install` 45 分钟、`build` 90 分钟：一次跨多个版本的大更新，install 跑十几分钟很正常，超时会 SIGKILL 该步并判失败（失败的那一步在页面上自动展开显示原因）。超时可在配置里覆盖，`0` 表示不限制：

```yaml
- insert:
    - id: vae-update
      name: dsh-vae-update
      config:
        timeouts:
          installMs: 0        # 不限制
          buildMs: 7200000    # 2 小时
```

只有 fast-forward 会被接受；有分叉或冲突的本地改动时 `pull` 会失败并原样显示 git 的输出。

## 本地补丁（可选，默认带一个）

如果想改官方源码的某个文件（比如给「更新」导航换个图标），直接在 checkout 里改会留一个**已修改**文件，而 `git pull --ff-only` 只要发现上游也动了这个文件就会拒绝合并——一次编辑会长期挡住更新本身。

所以补丁放在**本仓库**里版本化，更新时当成构建材料使用，顺序是：

1. 撤下补丁（`git apply --reverse`）——保证拉取时工作区干净
2. 拉取 → 安装依赖
3. 应用补丁（`git apply`）
4. 构建（图标等改动被编进产物）
5. 收起补丁——checkout 回到与上游一致的状态

第 1、3、5 步**失败只跳过、不中断**：上游重写了同一段代码时，补丁会打不上，页面把该步标成「已跳过」并展开 git 原文，更新照常完成（代价只是那个图标退回默认）。补丁步骤与拉取共用超时上限。

`patches/` 目录里按文件名顺序应用所有 `*.patch`；目录不存在就是没有补丁，计划退回三步。只作用于官方 checkout——插件仓库是你的工作区，插件不会去动它。目录可用 `patchesDir` 覆盖：

```yaml
- insert:
    - id: vae-update
      name: dsh-vae-update
      config:
        patchesDir: /home/dsh-vae-plugin/packages/vae-update/patches
```

内置 `patches/settings-nav-icon.patch`：给设置导航里的「更新」换成下载图标，避免和「通用设置」共用同一个齿轮（宿主的图标映射是硬编码的，插件注册不了图标，只能这样打）。上游改了 `SettingsRoot.tsx` 的 `navIcon` 时这个补丁会失效，属预期。

## 路径怎么来的

两个 checkout 都自动探测，通常不需要配置：

- 官方源码：从运行中的 CLI 入口和当前工作目录向上找最近的 `.git`，并要求根 `package.json` 的 `name` 是 `@deepseek-ai/dsh-root`。
- 插件仓库：从本插件自己的模块路径向上找最近的 `.git`（本地路径安装是 `link:`，所以能指回本仓库）。

探测不到时（例如插件是以拷贝方式装进 profile），在该 profile 的 patch 层里显式配置：

```yaml
- insert:
    - id: vae-update
      name: dsh-vae-update
      config:
        harnessRoot: /home/deepseek-harness
        pluginsRoot: /home/dsh-vae-plugin
        remote: origin          # 可选，默认 origin
```

## 边界

- 只做 `--ff-only`：不会 rebase、不会丢弃本地提交、不会强推。
- 更新是当前进程的内存状态，不写任何持久化数据；同一时刻只允许一个更新任务。
- 插件卸载时会杀掉正在跑的 `git`/`pnpm` 子进程。
- 路由走 `connection` 的 `/api` 通道，和产品自带接口同一套浏览器会话认证。
- 重启只在 systemd 下提供按钮：`systemctl restart <你自己的 unit>`，需要一次确认，执行的是脱离本进程的 `sh -c 'sleep 1; exec systemctl restart "$1"'`（unit 名只作为位置参数传入，不进入 shell 源码）。不在 systemd 下（例如终端里手跑 `pnpm dsh web`）时只显示手动重启提示，不会去猜怎么重启。

仓库布局和新增插件步骤见[根 README](../../README.md)。
