# Bundled themes

The catalogue shipped in [`src/themes.json`](../src/themes.json) contains 364
terminal colour schemes used by the `open.md` theme picker. The file is not an
original `open.md` work and is not licensed by the `author` values embedded in
the JSON.

## Provenance

`src/themes.json` is a line-ending-normalized copy of the upstream
[`data/themes.json`](https://github.com/Gogh-Co/Gogh/blob/3cb0e02c0a2381053f32e5191599ccb17b9ef868/data/themes.json)
file from [`Gogh-Co/Gogh`](https://github.com/Gogh-Co/Gogh) at commit
`3cb0e02c0a2381053f32e5191599ccb17b9ef868`.

- Upstream repository: `Gogh-Co/Gogh`
- Upstream path: `data/themes.json`
- Upstream commit: `3cb0e02c0a2381053f32e5191599ccb17b9ef868`
- Local path: `src/themes.json`
- Correspondence: the local file preserves the upstream entry order and JSON
  values for all 364 entries; only repository line-ending normalization differs.

The upstream root [`LICENSE`](https://github.com/Gogh-Co/Gogh/blob/3cb0e02c0a2381053f32e5191599ccb17b9ef868/LICENSE)
is the MIT License, copyright `(c) 2024 Gogh`. The applicable notice is
reproduced in [`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md).

## Attribution and rights

An entry's `author` field is attribution metadata supplied by the upstream
dataset. It may be empty, and it is not a license grant or proof that a person
listed there owns every part of a palette. Do not infer redistribution rights
from that field. For redistribution, use the upstream license and provenance
above, and preserve the notice in `THIRD_PARTY_NOTICES.md`.

If you believe a palette is misattributed or should not be bundled, open an
issue with the affected theme name and the relevant upstream source. Do not
replace upstream provenance with a guessed author or license.

## Editing the catalogue

You can update `src/themes.json` during development. The frontend validator
requires every entry to include unique `name`, `background`, and `foreground`
strings. When changing upstream-derived data, record the new source commit and
update the third-party notice in the same change.
