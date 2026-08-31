# DeepSeek Harness Desktop — DSH WAHU版

[English](README.md) | 中文

**DSH WAHU版**（DeepSeek Harness Desktop）是 [DeepSeek Harness](https://github.com/deepseek-harness/deepseek-harness)（`dsh`）的个人/社区 fork，主打**桌面体验**：一个 Electron 桌面壳，内建 `dsh web` 宿主。

本仓库以官方 `dsh` 为上游基线（当前基于 `v0.1.2-alpha.2`），在其上重放了桌面壳与一系列面向桌面用户的改进。官方 deepseek-harness 的架构、插件体系与核心能力全部保留——本 fork 只是把它带进了一个原生桌面窗口，并加上更贴近本地使用的启动、打包与归档体验。

> 感谢并致谢 [DeepSeek AI](https://deepseek.com) 及其开源 [deepseek-harness](https://github.com/deepseek-harness/deepseek-harness)。DeepSeek Harness（`dsh`）是一个**一切皆插件**的 agent harness（智能体框架），由 [Cordis](https://github.com/cordiverse/cordis) 驱动，其设计参见论文 [_A Programming Paradigm for Spatiotemporal Composability_](https://arxiv.org/abs/2608.25512)。

## 本 fork 做了什么

相对官方 `dsh`，本 fork 的主要差异集中在**桌面化的可用性**：

- **桌面壳（Electron）**：一个原生窗口加载 `dsh web` 宿主，并提供安装器（NSIS / 便携版）。
- **窗口先行启动**：宿主在后台并行启动，窗口与启动页立即出现，避免"等待宿主就绪期间无窗口"的漫长空白。
- **启动计时诊断**：主进程把启动时间线写入 `dsh-desktop.log`，便于冷/热启动对比定位瓶颈。
- **会话归档管理**：支持对归档会话执行**取消归档**与**永久删除**（含持久化层的真正删除），并从设置页管理。
- **品牌**：界面文案使用 **DSH WAHU版**。

桌面壳的详细设计与打包方式，见 [`apps/desktop/README.zh.md`](apps/desktop/README.zh.md) 与 [`apps/desktop/PACKAGING-PROMPT.md`](apps/desktop/PACKAGING-PROMPT.md)。官方 CLI 的能力说明见 [`apps/cli/README.zh.md`](apps/cli/README.zh.md)。

## 安全说明

> 本项目基于官方 `dsh`，仍处于**开发者预览**阶段并快速迭代，**未来将出现破坏兼容性的变更**。运行前请阅读[安全说明](SAFETY.zh.md)。

> **安全修复**：本 fork 以官方 `v0.1.2-alpha.2` 为基线，其中包含对 **QVD-2026-57410**（未认证 web 控制面 RCE，CVSS 9.8）的修复（浏览器 Host API 认证）。桌面壳会加载带进程令牌的鉴权 URL，未认证访问会被网关以 401 拒绝。

<a id="run"></a>

## 开始使用

<a id="run-from-source"></a>

### 从源码构建并运行

```sh
git clone https://github.com/wahu2008/DeepSeekHarnessDesktop.git
cd DeepSeekHarnessDesktop
pnpm install
pnpm run build          # 构建 lib + 前端 dist
pnpm dsh web            # 用已构建产物启动 web 宿主
```

- `pnpm run build` 构建仓库产物。
- 默认在 `http://127.0.0.1:3080` 启动 Web UI，本机启动自动打开浏览器；`--no-open` 只运行服务器不打开浏览器。详见 [Web UI 指南](docs/user/guide/index.zh.md)。

### 运行桌面壳（开发）

```sh
pnpm --filter @deepseek-ai/dsh-desktop run build
pnpm --filter @deepseek-ai/dsh-desktop start     # electron .
```

### 打包可安装桌面应用

```sh
pnpm run build                                  # 先构建完整产物
node apps/desktop/scripts/flatten.mjs           # 展平运行时依赖闭包
node apps/desktop/scripts/stage.mjs             # 重组为壳期望的布局
# 放置系统 Node 运行时与已解压的 Electron 发行版（见 apps/desktop/README.md）
cd apps/desktop && npx electron-builder --win nsis
```

产物位于 `apps/desktop/release/`：`win-unpacked/`（便携版）与 NSIS 安装器 `DeepSeek Harness Desktop Setup <version>.exe`。完整步骤见 [`apps/desktop/README.zh.md`](apps/desktop/README.zh.md)。

## 目录结构

| 目录 | 说明 |
|---|---|
| [`apps/desktop`](apps/desktop) | **本 fork 的核心**：Electron 桌面壳、启动优化、打包脚本（`flatten.mjs`/`stage.mjs`）。 |
| [`apps/cli`](apps/cli) | `dsh` 命令行（唯一支持的 Node 应用启动器），`web` 是其一个 profile。 |
| [`apps/web`](apps/web) | Web 前端（vite 构建的 SPA，`dist/` 由 `dsh web` 服务）。 |
| [`packages`](packages) | 官方 `dsh` 插件体系（控制器、Remote、会话、工作区等）。 |
| [`docs`](docs) | 文档。 |
| [`website`](website) | 文档站构建。 |

## 开发

- 从[开发指南](docs/development.zh.md)与[架构文档](docs/architecture.zh.md)开始。
- 面向 agent：遵循 [AGENTS.md](AGENTS.md)。
- 贡献：见 [CONTRIBUTING.zh.md](CONTRIBUTING.zh.md)。

## 许可证

[MIT](LICENSE) 许可。

第三方依赖及其许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。上游官方项目见 [deepseek-harness/deepseek-harness](https://github.com/deepseek-harness/deepseek-harness)。
