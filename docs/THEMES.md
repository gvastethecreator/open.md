# Bundled themes

[`src/themes.json`](../src/themes.json) ships 364 terminal color schemes for the `open.md` theme picker. The file is not original `open.md` work and is not licensed by the `author` values in the JSON.

## Provenance

`src/themes.json` is a line-ending-normalized copy of
[`data/themes.json`](https://github.com/Gogh-Co/Gogh/blob/3cb0e02c0a2381053f32e5191599ccb17b9ef868/data/themes.json)
from [`Gogh-Co/Gogh`](https://github.com/Gogh-Co/Gogh) at commit
`3cb0e02c0a2381053f32e5191599ccb17b9ef868`.

- Upstream repository: `Gogh-Co/Gogh`
- Upstream path: `data/themes.json`
- Upstream commit: `3cb0e02c0a2381053f32e5191599ccb17b9ef868`
- Local path: `src/themes.json`
- Correspondence: local order and JSON values match the 364 upstream entries. Only repository line-ending normalization differs.

The upstream [`LICENSE`](https://github.com/Gogh-Co/Gogh/blob/3cb0e02c0a2381053f32e5191599ccb17b9ef868/LICENSE)
is the MIT License, copyright `(c) 2024 Gogh`. The notice is in [`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md).

## Attribution and rights

An entry's `author` field is attribution metadata from the upstream dataset. It can be empty. It is not a license grant. For redistribution, use the upstream license and provenance above, and keep the notice in `THIRD_PARTY_NOTICES.md`.

If you believe a palette is misattributed or should not be bundled, open an issue with the theme name and the upstream source. Do not replace upstream provenance with a guessed author or license.

## Editing the catalogue

You can update `src/themes.json` during development. The frontend validator requires every entry to include unique `name`, `background`, and `foreground` strings. When changing upstream-derived data, record the new source commit and update the third-party notice in the same change.
