# DeepSeek Harness Desktop — DSH WAHU Edition

English | [中文](README.zh.md)

**DSH WAHU Edition** (DeepSeek Harness Desktop) is a personal/community fork of [DeepSeek Harness](https://github.com/deepseek-harness/deepseek-harness) (`dsh`) on the official `v0.1.5-alpha.1` baseline, carrying the official product-level desktop application plus fork customizations: **DSH WAHU Edition** branding, session archive management with **permanent delete**, a settings **About** page, and session-persistence delete.

DeepSeek Harness itself is an **everything-is-a-plugin** agent harness developed by [DeepSeek AI](https://deepseek.com), powered by [Cordis](https://github.com/cordiverse/cordis), whose design is described in [_A Programming Paradigm for Spatiotemporal Composability_](https://arxiv.org/abs/2608.25512). The upstream documentation lives at [https://deepseek-harness.github.io/deepseek-harness/](https://deepseek-harness.github.io/deepseek-harness/). This fork keeps the upstream architecture, plugin system, and CLI; it only layers desktop and archive ergonomics on top.

## What this fork adds

- **Official desktop application** (`apps/desktop` + `apps/desktop-host`, upstream): an Electron shell with a bundled Node.js/pnpm runtime, `dsh-app://` transport, auto-update, and an offline seed store. The desktop app ships from the upstream project; this fork tracks it at the shared release version.
- **DSH WAHU Edition branding**: UI copy uses the fork name.
- **Session archive management**: unarchive archived sessions and **permanently delete** them (a real persistence-layer delete) from the settings page.
- **Settings About page**: app name / version / runtime / base build / data directory / repository, plus "Check for updates".
- **Session persistence delete**: a `SessionPersistence.delete` seam with a JSONL backend implementation.

For the desktop application's design, see [`apps/desktop/README.md`](apps/desktop/README.md). For the CLI's capabilities, see [`apps/cli/README.md`](apps/cli/README.md).

## Security notice

> This project is based on the official `dsh`, still in **developer preview** and iterating rapidly: **compatibility-breaking changes will arrive**. Read the [safety notice](SAFETY.md) before running.

> **Security fix**: this fork uses the official `v0.1.5-alpha.1` baseline, which includes the fix for **QVD-2026-57410** (unauthenticated web control-plane RCE, CVSS 9.8) via browser Host API authentication. The Web UI is served only behind the authenticated URL; unauthenticated access is rejected with 401 by the gateway.

<a id="run"></a>

## Run

<a id="run-from-source"></a>

### Run from source

To run from a repository checkout (the CLI Web UI):

```sh
git clone https://github.com/wahu2008/DeepSeekHarnessDesktop.git
cd DeepSeekHarnessDesktop
pnpm install
pnpm run build
pnpm dsh web
```

`pnpm run build` prepares the repository artifacts; `pnpm dsh web` uses them without rebuilding. The Web UI starts at `http://127.0.0.1:3080` by default and opens in the default browser for a local launch; pass `--no-open` to run the server without opening a browser. See the [Web UI guide](docs/user/guide/index.md).

### Run the desktop app (development)

The official desktop application is packaged by the upstream release pipeline (signed, auto-updated); from a checkout you can build and launch it unpackaged:

```sh
pnpm --filter @deepseek-ai/dsh-desktop run build
pnpm --filter @deepseek-ai/dsh-desktop run dev      # or: start
```

## Community and support

- Upstream feedback and bug reports go through [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions).
- Add the [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic to your plugin repository for discoverability.
- Join the upstream <a href="https://discord.gg/Ycq5dCaS4">DeepSeek Harness Discord community</a>.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Development

Start with the [development guide](docs/development.md) and [architecture documentation](docs/architecture.md).

For agents, follow [AGENTS.md](AGENTS.md).

## License

[MIT](LICENSE)

Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The upstream official project is [deepseek-harness/deepseek-harness](https://github.com/deepseek-harness/deepseek-harness).
