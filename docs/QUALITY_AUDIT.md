# Quality audit

Audit date: **2026-08-11**.

## Passed gates

- `pnpm install --frozen-lockfile` ✅
- `pnpm run check:frontend` ✅ (static validation, shell checks and Pages references)
- `pnpm run test:frontend` ✅ (49 files, 372 tests)
- `pnpm run build` ✅ (2,145 modules; bundle budget passes)
- `pnpm run fmt:rust` ✅
- `pnpm run check:rust` ✅
- `pnpm run test:rust` ✅ (26 tests)
- `pnpm audit --json` ✅ 0 advisories
- `pnpm outdated --format json` ✅ `{}`

The native checks emit only known Windows linker/incremental-cache diagnostics.
They do not fail compilation or tests.

## Performance result

`@chenglou/pretext` was moved behind a dynamic import in
`src/responsive-typography.js`. The initial boot JavaScript measured **275,650 B
raw / 81,946 B gzip**, down from **317,189 B raw / 97,240 B gzip** before this
pass (13.1% raw reduction). Typography retains a CSS fallback while the deferred
layout module loads. The largest deferred chunk is intentionally not part of the
initial boot path.

## Runtime and release boundaries

- The current local gate uses executable DOM/shell tests; a packaged native
  cross-platform smoke is still a platform-specific release gate.
- The Vite reporter still warns about a deferred chunk above 500 kB. The bundle
  budget explicitly measures initial boot and passes; splitting the deferred
  editor/format graph further needs a runtime measurement before changing it.
- Local bundles are unsigned and are not published by this maintenance pass.

## Residuals

Generated `dist` and `src-tauri/target` outputs remain untracked. Historical
audit logs remain in the ignored `.local/` archive. Authored `.scratch` plans,
source captures, and browser evidence remain for provenance. `node_modules`
remains the pnpm install cache.
