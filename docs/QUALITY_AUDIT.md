# Quality audit

Audit date: **2026-08-27**.

## Passed gates

- `pnpm install --frozen-lockfile` (not re-run this pass; lockfile updated with
  `pnpm update vite vitest mermaid --latest`)
- `pnpm run check:frontend` — static validation, 5 shell tests, Pages references
- `pnpm run test:frontend` — 47 files, 361 tests
- `pnpm run build` — 2,146 modules; initial boot JS **193,404 B raw / 56,609 B
  gzip** (budget 380,000 B)
- `pnpm run fmt:rust`
- `pnpm run check:rust`
- `pnpm run test:rust` — 33 tests
- `pnpm audit --json` — 0 advisories

The native checks emit only known Windows linker/incremental-cache diagnostics.
They do not fail compilation or tests.

## Performance result

Initial boot JavaScript is **193,404 B raw / 56,609 B gzip**, down from the
2026-08-11 snapshot of **275,650 B raw / 81,946 B gzip**. The editor session
and Mermaid adapter are deferred chunks. Syntax highlighting, the image viewer,
and rich format readers stay deferred. The Vite reporter still warns about a
deferred chunk above 500 kB (662 kB minified in this build). That warning is
not the initial-boot budget.

## Runtime and release boundaries

- The current local gate uses executable DOM/shell tests. A packaged native
  cross-platform smoke is still a platform-specific release gate.
- Splitting the deferred Mermaid/editor graph further needs a runtime
  measurement before changing it.
- Local bundles are unsigned and are not published by this maintenance pass.

## Residuals

Generated `dist` and `src-tauri/target` outputs remain untracked. Historical
audit logs remain in the ignored `.local/` archive. Authored `.scratch` plans,
source captures, and unique notes remain for provenance. Leftover scratch
screenshots and logs from closed tasks were pruned on 2026-08-27. `node_modules`
remains the pnpm install cache.
