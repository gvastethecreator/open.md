# Current architecture

This page is the current maintenance snapshot. Dated review files in this folder
are historical evidence and keep the command names from the revision they tested.

## Runtime boundaries

- `src/main.js` is the assembly root and public `startOpenMdApplication` seam.
- `src/document-session.js` owns document generations, render/enrich state and
  relative image lifecycle.
- `src/application-runtime-adapters.js` is the native/browser adapter boundary;
  syntax highlighting and Mermaid are lazy services.
- `src/responsive-typography.js` owns heading fitting and dynamically imports
  `@chenglou/pretext`, so its dependency graph never blocks first paint.
- `src-tauri/src/document_access.rs` owns bounded local reads/writes and path
  containment; Tauri commands remain thin adapters.

## Package and build contracts

- JavaScript uses pnpm 11.20 and `pnpm-lock.yaml`; Bun is intentionally absent.
- Cargo owns `src-tauri`; `src-tauri/Cargo.lock` is updated with `cargo update`.
- Mermaid, syntax highlighting and rich format readers remain deferred. The bundle
  checker enforces the 380,000-byte initial JavaScript budget.

## Change checklist

1. Update the nearest owner module and its focused test.
2. Run `pnpm run check:frontend`, `pnpm run test:frontend`, `pnpm run build`.
3. Run `pnpm run fmt:rust`, `pnpm run check:rust`, `pnpm run test:rust` for native changes.
4. Re-run the bundle checker and inspect runtime behavior before changing lazy boundaries.
