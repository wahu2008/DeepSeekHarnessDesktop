# DeepSeek Harness Desktop — 社区定制版（0.1.1-rc.2）

> 基于官方 [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) `dsh 0.1.1-rc.2`（Windows x64）
> 构建的桌面定制版。在此版本上**修复了多个已知问题、优化了窗口体验，并补齐了插件生态的免重启/免刷新能力**。

本仓库既包含**可再次构建的源码**，也发布**可直接运行的安装包（exe）**。下面先说明为什么两者并存、为什么要把 exe 单独以 Release 形式发布，再列出这个定制版具体做了什么。

---

## 一、为什么要发布 exe，以及它和源码的关系

一句话：**源码给想自己构建/二次开发的人，exe 给只想直接使用的人。**

| | 源码（本仓库） | 安装包 / 便携版（exe） |
|---|---|---|
| 用途 | 构建、定制、审计、二次开发 | 开箱即用，双击运行 |
| 需要什么 | Node.js + pnpm + 构建工具链 | 不需要，下载即用 |
| 体积 | 源码文本 | 约 162 MB（已打包） |
| 存在形式 | 提交到 GitHub 仓库 | 作为 **GitHub Release 附件**发布 |

**为什么发布 exe，而不是只发源码：**
- 大多数使用者只想**直接用** DeepSeek Harness Desktop 这个桌面应用，并不想折腾 Node.js、pnpm、编译链。exe 就是给这部分人的成品。
- 仓库里如果塞进 162 MB 的安装包，会让仓库臃肿，而且**已超过 GitHub 单文件 100 MB 的硬限制**，无法直接推送进版本历史。
- 所以采用业界常规做法：**源码进仓库（git history），成品 exe 走 GitHub Release（作为附件）。** 两者内容同源，均由本仓库源码构建而来。

**三个文件的选择建议：**

| 你想做什么 | 用哪份 |
|---|---|
| 直接安装到电脑 | `INSTALLER-README.md`（安装版） |
| 免安装、随身带 / U 盘 | `PORTABLE-README.md`（便携版） |
| 从源码重新构建 / 改动 | 本文件 + `PACKAGING-PROMPT.md` |

---

## 二、本定制版相比官方做了什么

相比官方基础版本，这个定制版的重点是：**让桌面窗口体验更像一个正式桌面应用，并解决装插件、看新插件界面时的繁琐操作。**

### 窗口体验

1. **无边框自定义标题栏**：去掉系统默认标题栏，改用 Web UI 主题色渲染的自定义标题栏（跟随皮肤/主题自动变色）。
   - 左上角：DeepSeek 鲸鱼 logo + 「DeepSeek Harness Desktop」标题
   - 右上角：最小化 / 最大化 / 关闭 三个自绘窗口按钮（随主题色）
   - 整条标题栏可拖拽移动窗口
2. **应用图标改为 DeepSeek 鲸鱼**：任务栏、窗口、安装后的桌面快捷方式、开始菜单，全部使用鲸鱼图标（不再用 Electron 默认图标）。
3. **启动不再弹出系统浏览器**：只打开桌面窗口，不额外打开系统默认浏览器（修复「双开」问题）。

### 窗口稳定性

4. **`__DSH_WINDOW__` 窗口控制 API 修复**：修正 preload 脚本模块格式（改为 CJS），让自绘的最小化/最大化/关闭按钮真正可点击。
5. **内容区不再挤压/滚动**：修复标题栏挤压内容的问题，默认页（含设置入口）直接显示在窗口内，无需滚动。

### 插件生态（宿主 / 浏览器两侧）

6. **装插件免重启**：`watchProfileBundles` 让宿主热插新 bundle 的插件层，装完插件**无需重启应用**。
7. **新插件 UI 免刷新**：`reconcileGraph` 让浏览器自动加载新插件的界面，**无需手动刷新页面**。

### 第三方插件兼容

8. **modlens 视觉桥兼容**：为 `@liustack/modlens` 的合成适配器补齐 `prepareCall` 方法，修复使用 `(modlens vision)` 模型时的 `registration.adapter.prepareCall is not a function` 报错。

### 打包工程化（面向开发者）

- 因 DSH 宿主依赖原生 Node ABI 扩展，无法内嵌 Electron 主进程，故壳使用 `spawn` 系统 Node 运行宿主；
- 新增 `apps/desktop/scripts/flatten.mjs` 与 `stage.mjs`，展平运行时依赖闭包（pnpm 默认符号链接与 `pnpm deploy` 都会丢依赖）；
- 配置 `electron-builder.yml`、鲸鱼图标 `build/icon.ico` 与桌面壳源码 `apps/desktop/src/`；
- 修复 Windows 下 `spawnSync('pnpm')` 因 CVE-2024-27980 的 `.cmd` shim 导致的 ENOENT/EINVAL（包装为 `cmd.exe /d /s /c`）。

> 以上窗口体验、稳定性、插件生态属于用户可见特性；「打包工程化」属于构建层面，普通使用者无需关心。

---

## 三、两种交付形态

| 形态 | 文件 | 说明 |
|---|---|---|
| **安装版** | `DeepSeek Harness Desktop Setup 0.1.1-rc.2.exe` | NSIS 安装器，一键安装，创建桌面/开始菜单快捷方式 |
| **便携版** | `win-unpacked/` 目录 | 免安装，解压即用，直接运行 `DeepSeek Harness Desktop.exe` |

> 两个版本**功能完全一致**，只是交付方式不同。安装版会注册系统图标与快捷方式；
> 便携版适合放到任意目录/U 盘，不写入注册表。

---

## 四、使用

安装版：「设置 → 应用 → 已安装的应用」里也可能看到；直接运行 exe 即可。

**安装版详细步骤**见 [INSTALLER-README.md](INSTALLER-README.md)。
**便携版详细步骤**见 [PORTABLE-README.md](PORTABLE-README.md)。

> 两者均未做代码签名（`signExecutable: false`），首次运行 Windows SmartScreen 可能提示
> 「未知发布者」——属预期，点击「更多信息 → 仍要运行」即可正常使用。

---

## 五、常见问题

- **启动时会不会自动打开浏览器？** 不会。本定制已加 `--no-open`，只显示桌面窗口。
- **换肤色时标题栏会变色吗？** 会，标题栏颜色绑定 Web UI 主题变量，切换皮肤/主题自动跟随。
- **装插件需要重启吗？** 大部分不需要（热插），个别 bundle 层插件按其机制处理。
- **首次运行提示「未知发布者」？** 是未签名构建的 Windows 安全提示，放行即可。
- **用户数据放在哪？** `%APPDATA%\@deepseek-ai\dsh-desktop\dsh-home`，升级/重装不会丢失。

---

## 六、从源码构建 / 本地打包

仓库内为可构建源码。若需从源码重新打包（Windows）：

```powershell
# 在仓库根执行
npm run build                        # 构建 lib + 前端 dist
cd apps/desktop
npx electron-builder --win nsis      # 生成安装版 + 便携版
```

> 仓库内 `lib/`、`staging/`、`release/`（除说明文档）、`dist/npm/` 等已由 `.gitignore` 排除，
> 属构建产物，不会进版本历史。更完整的分步流程见 `apps/desktop/PACKAGING-PROMPT.md`。
