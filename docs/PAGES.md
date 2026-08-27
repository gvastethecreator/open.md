# GitHub Pages landing

The public landing is a dependency-free static site in `docs/`. Relative asset paths keep the same files working at `https://gvastethecreator.github.io/open.md/`.

## Preview locally

From the repository root:

```bash
python -m http.server 8787 --bind 127.0.0.1 --directory docs
```

Open `http://127.0.0.1:8787/`.

## Deploy

`.github/workflows/pages.yml` uploads `docs/` and deploys it to the `github-pages` environment on pushes to `main` that change the site or workflow. You can also run it from the Actions tab.

In repository settings, choose **GitHub Actions** as the Pages source. The workflow does not build or publish desktop installers.

## Media provenance

- `reader-desktop-dark.png`, `reader-help-light.png`, `source-edit-dark.png`, and `reader-narrow-dark.png` are captures from the real open.md runtime.
- `reader-hero-dark.png` is a smaller derivative of the desktop capture, used only to reduce landing-page startup work.
- `open-md-motion-study.mp4` was generated with Grok Imagine from the original reader, help, and narrow captures. The page labels it as illustrative because generated motion can soften fine interface text.

Keep that distinction when replacing media: screenshots are product evidence; generated media is presentation.
