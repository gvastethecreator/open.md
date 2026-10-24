# Code map: open.md

Generated: 2026-10-24T19:17:21Z | Commit: `e94a2df20c33` | Schema: 2
Generation: `68cd20e175009ef906f361ab526febd4b882c89303a1be8f71c350cd1f9348e2`
Scope: . | Inventory: working-tree
Nodes: 143 | Edges: 477 | Flows: 1

## Coverage

- Analysis: **partial**; 117 analyzed of 122 included files.
- Configuration files: 1; omitted untracked files: 0.
- Unresolved references and analysis limits: 543.
- Static references and call paths do not prove runtime execution or test coverage.

## Modules

- `docs/assets/landing/site.js` | module | Repository | callers: none | callees: none | tests: 0 | entry: none
- `examples/fixtures/write-nfo-fixtures.py` | interface | Repository | callers: none | callees: external:python:pathlib, external:python:pathlib | tests: 0 | entry: examples/fixtures/write-nfo-fixtures.py:main
- `examples/write_bulk.py` | interface | Repository | callers: none | callees: external:python:datetime, external:python:datetime, external:python:pathlib, external:python:pathlib | tests: 0 | entry: examples/write_bulk.py:main
- `external:javascript:@chenglou/pretext` | external | External | callers: src/responsive-typography.js | callees: none | tests: 0 | entry: none
- `external:javascript:@shikijs/langs` | external | External | callers: src/syntax-highlighter.js | callees: none | tests: 0 | entry: none
- `external:javascript:@tauri-apps/api` | external | External | callers: src/application-runtime-adapters.js | callees: none | tests: 0 | entry: none
- `external:javascript:@tauri-apps/plugin-dialog` | external | External | callers: src/application-runtime-adapters.js | callees: none | tests: 0 | entry: none
- `external:javascript:@tauri-apps/plugin-opener` | external | External | callers: src/application-runtime-adapters.js | callees: none | tests: 0 | entry: none
- `external:javascript:jsdom` | external | External | callers: src/application-composition.test.js, src/application-runtime-adapters.test.js, src/context-menu-controller.test.js, src/document-content-actions.test.js | callees: none | tests: 16 | entry: none
- `external:javascript:node:fs` | external | External | callers: scripts/check-bundle.mjs, scripts/check-bundle.mjs, scripts/generate-runtime-themes.mjs, scripts/generate-runtime-themes.mjs | callees: none | tests: 4 | entry: none
- `external:javascript:node:path` | external | External | callers: scripts/check-bundle.mjs, scripts/generate-runtime-themes.mjs, scripts/validate-frontend.mjs, scripts/validate-pages.mjs | callees: none | tests: 1 | entry: none
- `external:javascript:node:url` | external | External | callers: scripts/generate-runtime-themes.mjs, scripts/generate-runtime-themes.mjs, src/application-composition.test.js, src/application-composition.test.js | callees: none | tests: 1 | entry: none
- `external:javascript:node:zlib` | external | External | callers: scripts/check-bundle.mjs, scripts/check-bundle.mjs | callees: none | tests: 0 | entry: none
- `external:javascript:pele` | external | External | callers: src/diagram-renderer.js | callees: none | tests: 0 | entry: none
- `external:javascript:shiki` | external | External | callers: src/syntax-highlighter.js, src/syntax-highlighter.js | callees: none | tests: 0 | entry: none
- `external:javascript:vite` | external | External | callers: vite.config.js, vite.config.js | callees: none | tests: 0 | entry: none
- `external:javascript:vitest` | external | External | callers: src/app-loading-screen.test.js, src/app-loading-screen.test.js, src/application-composition.test.js, src/application-composition.test.js | callees: none | tests: 47 | entry: none
- `external:python:datetime` | external | External | callers: examples/write_bulk.py, examples/write_bulk.py | callees: none | tests: 0 | entry: none
- `external:python:pathlib` | external | External | callers: examples/fixtures/write-nfo-fixtures.py, examples/fixtures/write-nfo-fixtures.py, examples/write_bulk.py, examples/write_bulk.py | callees: none | tests: 0 | entry: none
- `external:python:xml` | external | External | callers: examples/write_bulk.py | callees: none | tests: 0 | entry: none
- Showing 20 of 143 nodes. Query `impact --module <path>` or open the HTML hierarchy for the rest.

## Edges

- `examples/fixtures/write-nfo-fixtures.py` -> `external:python:pathlib` | calls
- `examples/fixtures/write-nfo-fixtures.py` -> `external:python:pathlib` | imports
- `examples/write_bulk.py` -> `external:python:datetime` | calls
- `examples/write_bulk.py` -> `external:python:datetime` | imports
- `examples/write_bulk.py` -> `external:python:pathlib` | calls
- `examples/write_bulk.py` -> `external:python:pathlib` | imports
- `examples/write_bulk.py` -> `external:python:xml` | imports
- `scripts/check-bundle.mjs` -> `external:javascript:node:fs` | calls
- `scripts/check-bundle.mjs` -> `external:javascript:node:fs` | imports
- `scripts/check-bundle.mjs` -> `external:javascript:node:path` | imports
- `scripts/check-bundle.mjs` -> `external:javascript:node:zlib` | calls
- `scripts/check-bundle.mjs` -> `external:javascript:node:zlib` | imports
- `scripts/generate-runtime-themes.mjs` -> `external:javascript:node:fs` | calls
- `scripts/generate-runtime-themes.mjs` -> `external:javascript:node:fs` | imports
- `scripts/generate-runtime-themes.mjs` -> `external:javascript:node:path` | imports
- `scripts/generate-runtime-themes.mjs` -> `external:javascript:node:url` | calls
- `scripts/generate-runtime-themes.mjs` -> `external:javascript:node:url` | imports
- `scripts/validate-frontend.mjs` -> `external:javascript:node:fs` | calls
- `scripts/validate-frontend.mjs` -> `external:javascript:node:fs` | imports
- `scripts/validate-frontend.mjs` -> `external:javascript:node:path` | imports
- `scripts/validate-pages.mjs` -> `external:javascript:node:fs` | calls
- `scripts/validate-pages.mjs` -> `external:javascript:node:fs` | imports
- `scripts/validate-pages.mjs` -> `external:javascript:node:path` | imports
- `src-tauri/src/app_settings.rs` -> `external:rust:serde` | imports
- `src-tauri/src/app_settings.rs` -> `external:rust:std` | calls
- `src-tauri/src/app_settings.rs` -> `external:rust:std` | imports
- `src-tauri/src/app_settings.rs` -> `src-tauri/src/document_access.rs` | calls
- `src-tauri/src/document_access.rs` -> `external:rust:pulldown_cmark` | calls
- `src-tauri/src/document_access.rs` -> `external:rust:pulldown_cmark` | imports
- `src-tauri/src/document_access.rs` -> `external:rust:serde` | imports
- `src-tauri/src/document_access.rs` -> `external:rust:std` | calls
- `src-tauri/src/document_access.rs` -> `external:rust:std` | imports
- `src-tauri/src/document_access.rs` -> `src-tauri/src/cp437.rs` | calls
- `src-tauri/src/file_associations.rs` -> `external:rust:serde` | imports
- `src-tauri/src/file_associations.rs` -> `external:rust:std` | calls
- `src-tauri/src/file_associations.rs` -> `external:rust:std` | imports
- `src-tauri/src/file_associations.rs` -> `src-tauri/src/app_settings.rs` | imports
- `src-tauri/src/images.rs` -> `external:rust:std` | calls
- `src-tauri/src/images.rs` -> `external:rust:std` | imports
- `src-tauri/src/images.rs` -> `external:rust:tauri` | calls
- `src-tauri/src/images.rs` -> `external:rust:tauri` | imports
- `src-tauri/src/images.rs` -> `src-tauri/src/document_access.rs` | calls
- `src-tauri/src/images.rs` -> `src-tauri/src/document_access.rs` | imports
- `src-tauri/src/lib.rs` -> `external:rust:std` | calls
- `src-tauri/src/lib.rs` -> `external:rust:std` | imports
- `src-tauri/src/lib.rs` -> `external:rust:tauri` | imports
- `src-tauri/src/lib.rs` -> `src-tauri/src/app_settings.rs` | calls
- `src-tauri/src/lib.rs` -> `src-tauri/src/app_settings.rs` | imports
- `src-tauri/src/lib.rs` -> `src-tauri/src/cp437.rs` | imports
- `src-tauri/src/lib.rs` -> `src-tauri/src/document_access.rs` | calls
- Showing 50 of 477 edges; JSON contains every edge and its evidence.

## Unknown

- `scripts/check-bundle.mjs:6`: object-member-call-not-resolved (path)
- `scripts/check-bundle.mjs:7`: object-member-call-not-resolved (path)
- `scripts/check-bundle.mjs:14`: object-member-call-not-resolved (path)
- `scripts/check-bundle.mjs:21`: object-member-call-not-resolved (path)
- `scripts/check-bundle.mjs:64`: object-member-call-not-resolved (path)
- `scripts/check-bundle.mjs:77`: object-member-call-not-resolved (path)
- `scripts/generate-runtime-themes.mjs:5`: object-member-call-not-resolved (path)
- `scripts/generate-runtime-themes.mjs:6`: object-member-call-not-resolved (path)
- `scripts/generate-runtime-themes.mjs:7`: object-member-call-not-resolved (path)
- `scripts/generate-runtime-themes.mjs:8`: object-member-call-not-resolved (path)
- `scripts/generate-runtime-themes.mjs:53`: object-member-call-not-resolved (path)
- `scripts/store/Build-StoreInstaller.ps1:1`: unsupported-language (.ps1)

## Flows

- Python __main__: `examples/write_bulk.py` -> `external:python:datetime` | Static call path reaches external:python:datetime:datetime

## Architecture changes

- Nodes: +0 / -0; edges: +0 / -0.
- Boundary changes: 0; new cycles: 0.

## Read next

- Use `status` before relying on this generation.
- Use `impact --changed` for possible impact and related test evidence.
- Use `diff --before <model> --after <model>` for architecture changes.
