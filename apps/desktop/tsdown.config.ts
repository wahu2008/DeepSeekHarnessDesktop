import { defineConfig } from 'tsdown'

export default defineConfig([
  {
    entry: ['lib/types/main.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    deps: { neverBundle: ['electron'] },
  },
  {
    // Sandboxed Electron preloads run as CommonJS even though the application package is ESM.
    // Each preload is built as its own single-entry bundle: a sandboxed preload may
    // only require `electron`, so a shared chunk such as `require("./ipc-<hash>.cjs")`
    // fails with "module not found" and silently disables the whole preload. Building
    // one entry per configuration inlines every local import instead of splitting it.
    entry: { preload: 'lib/types/preload.js' },
    outDir: 'lib',
    format: ['cjs'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    deps: { neverBundle: ['electron'] },
  },
  {
    // See the preload entry above: this second single-entry build keeps
    // preload-app self-contained as well.
    entry: { 'preload-app': 'lib/types/preload-app.js' },
    outDir: 'lib',
    format: ['cjs'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    deps: { neverBundle: ['electron'] },
  },
])
