# DeepSeek Harness Desktop — DSH WAHU版

[English](README.md) | 中文

**DSH WAHU版**（DeepSeek Harness Desktop）是 [DeepSeek Harness](https://github.com/deepseek-harness/deepseek-harness)（`dsh`）的个人/社区 fork，基于官方 `v0.1.5-alpha.1` 基线，带有官方产品级桌面应用与 fork 定制：**DSH WAHU版** 品牌、含**永久删除**的会话归档管理、设置**关于**页，以及会话持久化删除。

DeepSeek Harness 本身是由 [DeepSeek AI](https://deepseek.com) 开发的开源 **一切皆插件** agent harness（智能体框架），由 [Cordis](https://github.com/cordiverse/cordis) 驱动，其设计参见论文 [_A Programming Paradigm for Spatiotemporal Composability_](https://arxiv.org/abs/2608.25512)。上游文档见 [https://deepseek-harness.github.io/deepseek-harness/](https://deepseek-harness.github.io/deepseek-harness/)。本 fork 保留上游的架构、插件体系与 CLI，只在之上叠加桌面与归档体验。

## 本 fork 增加了什么

- **官方桌面应用**（`apps/desktop` + `apps/desktop-host`，上游）：Electron 壳，带内置 Node.js/pnpm 运行时、`dsh-app://` 传输、自动更新与离线 seed store。桌面应用随上游项目发布；本 fork 在同一发布版本下跟踪它。
- **DSH WAHU版 品牌**：界面文案使用 fork 名称。
- **会话归档管理**：取消归档会话，并从设置页**永久删除**（真正的持久化层删除）。
- **设置关于页**：应用名称/版本/运行时/基础版本/数据目录/项目主页，外加"检查更新"。
- **会话持久化删除**：提供 `SessionPersistence.delete` 接口并带 JSONL 后端实现。

桌面应用的设计见 [`apps/desktop/README.zh.md`](apps/desktop/README.zh.md)。CLI 的能力说明见 [`apps/cli/README.zh.md`](apps/cli/README.zh.md)。

## 安全说明

> 本项目基于官方 `dsh`，仍处于**开发者预览**阶段并快速迭代：**未来将出现破坏兼容性的变更**。运行前请阅读[安全说明](SAFETY.zh.md)。

> **安全修复**：本 fork 使用官方 `v0.1.5-alpha.1` 基线，其中包含对 **QVD-2026-57410**（未认证 web 控制面 RCE，CVSS 9.8）的修复（浏览器 Host API 认证）。Web UI 仅在鉴权 URL 之后提供；未认证访问会被网关以 401 拒绝。

<a id="run"></a>

## 运行

<a id="run-from-source"></a>

### 从源码运行

如需从仓库源码运行（CLI Web UI）：

```sh
git clone https://github.com/wahu2008/DeepSeekHarnessDesktop.git
cd DeepSeekHarnessDesktop
pnpm install
pnpm run build
pnpm dsh web
```

`pnpm run build` 会准备仓库产物；`pnpm dsh web` 会直接使用这些产物，不重新构建。Web UI 默认在 `http://127.0.0.1:3080` 启动并在本机启动时打开默认浏览器；传 `--no-open` 可只运行服务器不打开浏览器。详见 [Web UI 指南](docs/user/guide/index.zh.md)。

### 运行桌面应用（开发）

官方桌面应用由上游发布流水线打包（签名、自动更新）；从 checkout 可以非打包方式构建并启动：

```sh
pnpm --filter @deepseek-ai/dsh-desktop run build
pnpm --filter @deepseek-ai/dsh-desktop run dev      # or: start
```

## 社区与支持

- 上游反馈与 bug 报告见 [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions)。
- 为你的插件仓库添加 [`dsh-plugin`](https://github.com/topics/dsh-plugin) 话题，便于被发现。
- 加入上游 <a href="https://discord.gg/Ycq5dCaS4">DeepSeek Harness Discord community</a>。

## 参与贡献

参见 [CONTRIBUTING.md](CONTRIBUTING.zh.md)。

## 开发

请先阅读[开发指南](docs/development.zh.md)与[架构文档](docs/architecture.zh.md)。

面向 agent：请遵循 [AGENTS.md](AGENTS.md)。

## 许可证

[MIT](LICENSE)

第三方依赖及其许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。上游官方项目见 [deepseek-harness/deepseek-harness](https://github.com/deepseek-harness/deepseek-harness)。
