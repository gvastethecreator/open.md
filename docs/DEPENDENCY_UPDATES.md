# Dependency updates

Audit date: **2026-08-11**. The application uses `pnpm@11.20.0` for JavaScript
and Cargo for the Tauri crate. Bun is not part of the runtime or package
manager contract.

## JavaScript

| Package | Resolved version | Changelog | Relevant change |
| --- | ---: | --- | --- |
| Vite | 8.2.1 | [Vite releases](https://github.com/vitejs/vite/releases) | Rolldown build remains compatible with the existing bundle gate. |
| Vitest | 4.1.10 | [Vitest releases](https://github.com/vitest-dev/vitest/releases) | 49 files / 372 tests remain green. |
| `@tauri-apps/cli` | 2.11.4 | [Tauri releases](https://github.com/tauri-apps/tauri/releases) | Native commands and bundle tasks stay on Tauri v2. |
| `@tauri-apps/api` | 2.11.1 | [Tauri releases](https://github.com/tauri-apps/tauri/releases) | Frontend/native adapter contract unchanged. |
| `@tauri-apps/plugin-dialog` | 2.7.2 | [Tauri releases](https://github.com/tauri-apps/tauri-plugin-dialog/releases) | File picker and save dialogs remain compatible. |
| `@tauri-apps/plugin-opener` | 2.5.4 | [Tauri releases](https://github.com/tauri-apps/tauri-plugin-opener/releases) | External-link adapter stays isolated. |
| Mermaid | 11.16.1 | [Mermaid releases](https://github.com/mermaid-js/mermaid/releases) | Mermaid remains dynamically imported and deferred. |
| highlight.js | 11.11.2 | [highlight.js releases](https://github.com/highlightjs/highlight.js/releases) | Latest patch picked up for syntax rendering. |
| jsdom | 30.0.1 | [jsdom releases](https://github.com/jsdom/jsdom/releases) | Test environment stays on the Node 24-compatible line. |
| `@tabler/icons` | 3.46.0 | [Tabler releases](https://github.com/tabler/tabler-icons/releases) | Existing icon surface unchanged. |
| iconoir | 7.11.1 | [Iconoir releases](https://github.com/iconoir-icons/iconoir/releases) | Existing CSS icon surface unchanged. |
| `@chenglou/pretext` | 0.0.8 | [Pretext package](https://www.npmjs.com/package/@chenglou/pretext) | Kept as the typography engine but moved behind a dynamic import. |

Security overrides:

- `dompurify` **3.4.13** fixes GHSA-55q2-fjhq-7xh7 and removes the previous
  vulnerable 3.4.12 resolution from Mermaid's graph.
- `lodash-es` 4.18.1, `picomatch` 4.0.5 and `uuid` 11.1.1 remain explicit
  overrides because they are the current compatible secure resolutions.
- `pnpm audit --json` reports zero advisories after the update.

## Rust

`cargo update` refreshed the lockfile to the latest compatible graph, including
`html-escape` 0.2.15, `aho-corasick` 1.1.5, `time` 0.3.55, `thiserror` 2.0.20,
`wasm-bindgen` 0.2.127, `zbus` 5.19.0 and their transitive updates.

The four packages still behind a newer compatible-looking release (`generic-array`
0.14.7, `toml` 0.8.2, `toml_datetime` 0.6.3 and `toml_edit` 0.20.2) are owned by
Tauri's GTK/system-deps graph; forcing them would require a native stack migration,
so they remain pinned by upstream compatibility constraints.

Primary release references: [Tauri](https://github.com/tauri-apps/tauri/releases),
[serde](https://github.com/serde-rs/serde/releases),
[pulldown-cmark](https://github.com/raphlinus/pulldown-cmark/releases),
[syntect](https://github.com/trishume/syntect/releases), and
[html-escape](https://github.com/colinmarc/html-escape/releases).
