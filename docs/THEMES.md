# Bundled Themes

The theme catalogue shipped with OpenMD is curated in
[`src/themes.json`](../src/themes.json). Each entry declares the original
author and, where known, the source repository or homepage. OpenMD does
**not** own these palettes: they are bundled verbatim or with minimal
formatting tweaks to fit the in-app theme switcher.

The full list contains 364 themes drawn from well-known open-source
colour scheme collections (most commonly the
[`iterm2-color-schemes`](https://github.com/mbadolato/iTerm2-Color-Schemes)
and [`nvim-base16`](https://github.com/RRethy/nvim-base16) catalogues
and a handful of standalone projects).

## Author Index

Themes without an `author` field are marked as uncredited. Where the
upstream repository or project URL is known, it is included so you can
verify the licence before redistribution.

| Author / Source                                      | Notes                                                                                  |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `plan9-for-vimspace`                                 | `https://github.com/plan9-for-vimspace/acme-colors`                                    |
| `hesamrad.com`                                       | `https://hesamrad.com`                                                                 |
| `Bram de Haan` (Atelier schemes)                     | `http://atelierbram.github.io/syntax-highlighting/atelier-schemes/`                     |
| `Ruhannn`                                            | `https://github.com/ruhannn`                                                           |
| `kyazdani42` (Blue Moon)                             | `https://github.com/kyazdani42/blue-moon`                                              |
| `Dracula`                                            | `https://draculatheme.com`                                                             |
| `Egor Lem`                                           | `http://egorlem.com`                                                                   |
| `Gabriel Soares`                                     | `https://github.com/Gabrielsoac`                                                       |
| `Protesilaos Stavrou`                                | `https://protesilaos.com` (Modus, Ef, Light & Dark variants)                            |
| `Tim Huber`                                          | `http://www.tiwahu.com`                                                                |
| `Chris Kempson`                                      | `http://chriskempson.com` (Tomorrow family)                                            |
| `Daniel Perez`                                       | `https://www.github.com/sysaloe`                                                       |
| `Henrik Lissner`                                     | Source repository not bundled in the file.                                             |
| `newptcai`                                           | Source repository not bundled in the file.                                             |
| Uncredited entries                                   | Author field is empty; provenance to be re-confirmed.                                  |

## Licence

Each palette is the work of its respective author and is distributed
under the licence chosen by that author — most often MIT, occasionally
another permissive licence. The `author` field of every entry is the
authoritative attribution.

If you are the author of a bundled theme and want it removed, credited
differently, or relicensed differently, please open an issue or pull
request on the OpenMD repository.

## Removing or Replacing a Theme

You can curate the catalogue locally by editing `src/themes.json` (the
file is hot-loaded by Vite during development). The `validate-frontend`
script enforces that every entry has `name`, `background` and
`foreground` strings and that names are unique.
