# Dependency updates

JavaScript uses pnpm 12.0.0 and `pnpm-lock.yaml`. The lockfile also records `pnpm@12.0.0` under `packageManagerDependencies`. Rust uses Cargo and `src-tauri/Cargo.lock`. Bun is not part of this repository.

Resolved versions live in those lockfiles, not in this page.

## Update JavaScript

1. Change versions in `package.json` when needed.
2. Run `pnpm install`, or `pnpm update <package>` for a named bump.
3. Run `pnpm run verify`.
4. Record user-visible or security-relevant changes in `CHANGELOG.md` under `Unreleased`.

For an advisory in an indirect package, run `pnpm update <package>` first; it refreshes the lockfile inside the existing ranges. Add a `pnpm-workspace.yaml` override only when no allowed range reaches the fix, use a range rather than an exact pin, and remove it once the dependent covers the fix.

## Update Rust

1. From `src-tauri`, run `cargo update` for compatible lockfile refreshes.
2. Run `pnpm run fmt:rust`, `pnpm run check:rust`, and `pnpm run test:rust`.
3. Do not force crate majors owned by Tauri's GTK and system-deps graph.

## Audits

CI runs `pnpm audit` and `cargo audit` against the lockfiles. Reproduce locally with `pnpm audit --json` and `cargo audit --file src-tauri/Cargo.lock` (`cargo-audit` 0.22.2 in CI).
