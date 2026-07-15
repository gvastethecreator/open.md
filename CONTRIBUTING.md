# Contributing to open.md

Contributions are welcome through focused issues and pull requests. Please
read the [Code of Conduct](CODE_OF_CONDUCT.md) before participating and use
the [Security policy](SECURITY.md) before sharing vulnerability details.

## Development setup

Install:

- [Rust](https://www.rust-lang.org/) stable (edition 2021)
- [Bun](https://bun.sh/) 1.1 or newer
- The platform dependencies required by
  [Tauri v2](https://v2.tauri.app/start/prerequisites/)

Clone and install dependencies:

```bash
git clone https://github.com/gvastethecreator/open.md.git
cd open.md
bun install
```

Start the app with `bun run tauri dev`. The full command list and repository
layout are in the [development guide](docs/DEVELOPMENT.md).

## Before opening a pull request

- Keep the change focused and explain user-visible behaviour.
- Add or update tests when behaviour changes.
- Run the relevant checks from `docs/DEVELOPMENT.md`; CI runs the full matrix.
- Run `bun run verify` before submitting a broad runtime or dependency change.
- Update `README.md` and the `Unreleased` section of `CHANGELOG.md` for
  user-visible changes.
- For new themes, icons, fonts, or code snippets, record exact provenance and
  license information. Theme data must follow [the bundled-theme policy](docs/THEMES.md)
  and [the third-party notices](THIRD_PARTY_NOTICES.md); regenerate the runtime
  projection with `bun run generate:themes` after catalogue changes.
- Do not include secrets, private audit output, generated bundles, or files from
  `.local/` in a commit.

## Pull requests

Use a clear title, describe the motivation and verification, and call out any
platform-specific behaviour. Keep unrelated formatting or generated-file
changes out of the PR. Maintainers may ask for a focused follow-up when a
change spans multiple concerns.

## Bug reports and feature requests

Use the repository's issue templates. Include the app version, operating
system, reproduction steps, expected behaviour, and actual behaviour when
reporting a bug. Feature requests should explain the user problem and a
proposed outcome rather than prescribing an implementation.
