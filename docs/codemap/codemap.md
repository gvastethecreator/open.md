# Code map · open.md

generated: 2026-08-26T12:00:00Z
commit: 15cec47613d5
scope: .

counts: 8 nodes · 7 edges · 5 flows · 0 overflow · 0 unknown

## Modules

- `external-dependencies` · `src-tauri/src/app_settings.rs` · external · External
  callers: src (imports), src-tauri-src (imports), vite-config (imports)
  callees: (none)
  tests: (none)
  entry: src-tauri/src/app_settings.rs:serde

- `repository` · `package.json` · module · Repository
  callers: (none)
  callees: scripts (calls), src (calls)
  tests: (none)
  entry: package.json:name

- `scripts` · `scripts` · service · Scripts
  callers: repository (calls)
  callees: (none)
  tests: (none)
  entry: scripts/check-bundle.mjs:listFiles

- `src` · `src` · module · Src
  callers: repository (calls), src-core (imports)
  callees: external-dependencies (imports), src-core (imports)
  tests: src/app-loading-screen.test.js, src/application-composition.test.js, src/application-lifecycle.test.js, src/application-runtime-adapters.test.js, src/context-menu-controller.test.js
  entry: src/main.js:cacheElements

- `src-core` · `src/core` · service · Src
  callers: src (imports)
  callees: src (imports)
  tests: src/main.test.js
  entry: src/core/reader.js:isSupportedFilePath

- `src-tauri` · `src-tauri` · module · Src Tauri
  callers: (none)
  callees: (none)
  tests: (none)
  entry: src-tauri/Cargo.toml:package

- `src-tauri-src` · `src-tauri/src` · module · Src Tauri
  callers: (none)
  callees: external-dependencies (imports)
  tests: (none)
  entry: src-tauri/src/lib.rs:get_file_content

- `vite-config` · `vite.config.js` · module · Vite.Config
  callers: (none)
  callees: external-dependencies (imports)
  tests: (none)
  entry: vite.config.js:defineConfig

## Overflow

- none

## Edges

- repository -> scripts · calls
- repository -> src · calls
- src -> external-dependencies · imports
- src -> src-core · imports
- src-core -> src · imports
- src-tauri-src -> external-dependencies · imports
- vite-config -> external-dependencies · imports

## Unknown

- none

## Flows

- src/main.js:cacheElements
  src -> external-dependencies
  reached external-dependencies
- src/core/reader.js:isSupportedFilePath
  src-core -> src -> external-dependencies
  reached external-dependencies
- package.json:name
  repository -> scripts
  reached scripts
- src-tauri/src/lib.rs:get_file_content
  src-tauri-src -> external-dependencies
  reached external-dependencies
- vite.config.js:defineConfig
  vite-config -> external-dependencies
  reached external-dependencies
