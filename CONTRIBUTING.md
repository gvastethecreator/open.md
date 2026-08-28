# Contributing to open.md

Contributions are welcome through focused issues and pull requests. Read the
[Code of Conduct](CODE_OF_CONDUCT.md) before you participate. Use the
[Security policy](SECURITY.md) before you share vulnerability details.

## Development setup

Install:

- [Rust](https://www.rust-lang.org/) stable (edition 2021)
- [Node.js](https://nodejs.org/) 24.19.0 and [pnpm](https://pnpm.io/) 12.0.0 (matches `packageManager` and CI)
- The platform dependencies required by [Tauri v2](https://v2.tauri.app/start/prerequisites/)

```bash
git clone https://github.com/gvastethecreator/open.md.git
cd open.md
pnpm install
```

Start the app with `pnpm run tauri dev`. Commands and layout are in the
[development guide](docs/DEVELOPMENT.md).

## Before opening a pull request

- Keep the change focused and explain user-visible behavior.
- Add or update tests when behavior changes.
- Run the matching checks from `docs/DEVELOPMENT.md`. CI runs the full matrix.
- Run `pnpm run verify` before a broad runtime or dependency change.
- Update `README.md` and the `Unreleased` section of `CHANGELOG.md` for user-visible changes.
- For new themes, icons, fonts, or code snippets, record exact provenance and license. Theme data must follow [the bundled-theme policy](docs/THEMES.md) and [the third-party notices](THIRD_PARTY_NOTICES.md). After catalogue changes, run `pnpm run generate:themes`.
- Do not include secrets, private audit output, generated bundles, or files from `.local/` in a commit.

## Pull requests

Use a clear title. Describe motivation and verification. Call out platform-specific behavior. Keep unrelated formatting and generated-file changes out of the PR.

## Bug reports and feature requests

Use the repository's issue templates. For a bug, include app version, operating system, reproduction steps, expected behavior, and actual behavior. Feature requests should explain the user problem and a proposed outcome, not an implementation.
