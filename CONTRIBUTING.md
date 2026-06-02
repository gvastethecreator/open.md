# Contributing to OpenMD

Thanks for your interest in OpenMD. This is a small Tauri + Rust + Vite
project; contributions are welcome via issues and pull requests.

## Development Setup

Prerequisites:

- [Rust](https://www.rust-lang.org/) (stable toolchain, edition 2021)
- [Bun](https://bun.sh/) or [Node.js](https://nodejs.org/) ≥ 18
- Platform dependencies required by [Tauri v2][tauri-prereq]

Clone and install:

```bash
git clone https://github.com/gvastethecreator/open-md.git
cd open-md
bun install
```

## Useful Commands

| Command                  | What it does                                         |
| ------------------------ | ---------------------------------------------------- |
| `bun run dev`            | Start the Vite dev server (frontend only)            |
| `bun run tauri dev`      | Launch the Tauri app in development                  |
| `bun run build`          | Build the frontend production bundle                 |
| `bun run tauri build`    | Build and package the native app                     |
| `bun run check:frontend` | Validate the frontend integration                    |
| `bun run test:frontend`  | Run Vitest frontend tests                            |
| `bun run check:rust`     | `cargo check` the Rust backend                       |
| `bun run test:rust`      | Run Rust unit tests                                  |
| `bun run fmt:rust`       | Verify Rust formatting with `cargo fmt --check`       |
| `bun run verify`         | Run the full pre-package validation pipeline         |

Always run `bun run verify` before opening a pull request that touches
either side of the codebase.

## Pull Requests

- Keep the change focused. One fix or feature per PR.
- Match the existing code style. Rust code is formatted with `cargo fmt`;
  JavaScript follows the conventions already present in `src/main.js`.
- Add or update tests when behaviour changes. Frontend helpers in
  `src/main.js` are unit-tested with Vitest; backend logic in
  `src-tauri/src/lib.rs` has Rust unit tests alongside the code.
- Update the `README.md` and the `CHANGELOG.md` `Unreleased` section when
  the change is user-visible.
- If you add new third-party assets (themes, icons, fonts, code snippets),
  document the source and license in your PR description.

## Reporting Bugs

Open a GitHub issue with:

- Steps to reproduce, including the platform and the app version.
- Expected vs. actual behaviour.
- Relevant logs from the dev console (Tauri devtools) or the terminal
  running `tauri dev`.

## Code of Conduct

This project follows the [Contributor Covenant][cov] Code of Conduct. By
participating, you agree to abide by its terms.

[tauri-prereq]: https://v2.tauri.app/start/prerequisites/
[cov]: https://www.contributor-covenant.org/version/2/1/code_of_conduct/
