# DeepSeek Harness Desktop — DSH WAHU Edition

English | [中文](README.zh.md)

**DSH WAHU Edition** (DeepSeek Harness Desktop) is a personal/community fork of [DeepSeek Harness](https://github.com/deepseek-harness/deepseek-harness) (`dsh`) focused on the **desktop experience**: an Electron desktop shell that embeds the `dsh web` host.

This repository uses the official `dsh` as its upstream baseline (currently based on `v0.1.2-alpha.2`) and replays the desktop shell plus a set of desktop-facing improvements on top of it. All of the official deepseek-harness architecture, plugin system, and core capabilities are preserved — this fork simply brings it into a native desktop window and adds startup, packaging, and archiving ergonomics closer to local use.

> We thank and credit [DeepSeek AI](https://deepseek.com) and its open-source [deepseek-harness](https://github.com/deepseek-harness/deepseek-harness). DeepSeek Harness (`dsh`) is an **everything-is-a-plugin** agent harness, powered by [Cordis](https://github.com/cordiverse/cordis), whose design is described in the paper [_A Programming Paradigm for Spatiotemporal Composability_](https://arxiv.org/abs/2608.25512).

## What this fork does

Relative to the official `dsh`, this fork's differences are concentrated in **desktop usability**:

- **Desktop shell (Electron)**: a native window loads the `dsh web` host, with an installer (NSIS / portable).
- **Window-first startup**: the host boots in the background while the window and startup page appear immediately, avoiding the long blank period of "no window until the host is ready".
- **Startup timing diagnostics**: the main process writes a boot timeline to `dsh-desktop.log` for cold/warm comparison and bottleneck location.
- **Session archive management**: supports **unarchive** and **permanent delete** (including a real persistence-layer delete) on archived sessions, managed from the settings page.
- **Branding**: the UI copy uses **DSH WAHU Edition**.

For the desktop shell's detailed design and packaging, see [`apps/desktop/README.md`](apps/desktop/README.md) and [`apps/desktop/PACKAGING-PROMPT.md`](apps/desktop/PACKAGING-PROMPT.md). For the official CLI's capabilities, see [`apps/cli/README.md`](apps/cli/README.md).

## Security notice

> This project is based on the official `dsh`, still in **developer preview** and iterating rapidly: **compatibility-breaking changes will arrive**. Read the [safety notice](SAFETY.md) before running.

> **Security fix**: this fork uses the official `v0.1.2-alpha.2` baseline, which includes the fix for **QVD-2026-57410** (unauthenticated web control-plane RCE, CVSS 9.8) via browser Host API authentication. The desktop shell loads the authenticated URL with the process token; unauthenticated access is rejected with 401 by the gateway.

<a id="run"></a>

## Getting started

<a id="run-from-source"></a>

### Build and run from source

```sh
git clone https://github.com/wahu2008/DeepSeekHarnessDesktop.git
cd DeepSeekHarnessDesktop
pnpm install
pnpm run build          # 构建 lib + 前端 dist
pnpm dsh web            # 用已构建产物启动 web 宿主
```

- `pnpm run build` builds the repository artifacts.
- The Web UI starts at `http://127.0.0.1:3080` by default and opens in the default browser for a local launch; `--no-open` runs the server without opening a browser. See the [Web UI guide](docs/user/guide/index.md).

### Run the desktop shell (dev)

```sh
pnpm --filter @deepseek-ai/dsh-desktop run build
pnpm --filter @deepseek-ai/dsh-desktop start     # electron .
```

### Package an installable desktop app

```sh
pnpm run build                                  # 先构建完整产物
node apps/desktop/scripts/flatten.mjs           # 展平运行时依赖闭包
node apps/desktop/scripts/stage.mjs             # 重组为壳期望的布局
# 放置系统 Node 运行时与已解压的 Electron 发行版（见 apps/desktop/README.md）
cd apps/desktop && npx electron-builder --win nsis
```

The artifacts live in `apps/desktop/release/`: `win-unpacked/` (portable) and the NSIS installer `DeepSeek Harness Desktop Setup <version>.exe`. Full steps are in [`apps/desktop/README.md`](apps/desktop/README.md).

## Directory layout

| Directory | Description |
|---|---|
| [`apps/desktop`](apps/desktop) | **This fork's core**: Electron desktop shell, startup improvements, packaging scripts (`flatten.mjs`/`stage.mjs`). |
| [`apps/cli`](apps/cli) | The `dsh` command line (the sole supported Node application launcher); `web` is one of its profiles. |
| [`apps/web`](apps/web) | Web frontend (vite-built SPA; `dist/` served by `dsh web`). |
| [`packages`](packages) | The official `dsh` plugin system (controllers, Remote, sessions, workspaces, etc.). |
| [`docs`](docs) | Documentation. |
| [`website`](website) | The docs-site build. |

## Development

- Start with the [development guide](docs/development.md) and the [architecture documentation](docs/architecture.md).
- For agents, follow [AGENTS.md](AGENTS.md).
- Contributing: see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE).

Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The upstream official project is [deepseek-harness/deepseek-harness](https://github.com/deepseek-harness/deepseek-harness).
