# Product Quality Audit

Audit date: 2026-07-14
Scope: OpenMD desktop reading journey, frontend states, Markdown rendering,
native file access, dependency health, accessibility, and release gates.

## Verdict

The primary reading journey is now coherent and release-candidate quality for
the audited Windows path. The audit found blocking contrast, keyboard,
responsive, and untrusted-content issues in the original implementation. Those
issues were remediated and covered by focused tests. Cross-platform native
behaviour and a formal assistive-technology pass remain outside this audit.

## Journey health

1. **Start and choose a file — healthy.** The empty state has a real keyboard-
   accessible Open button, concise local-first copy, visible help, and a stable
   toolbar.
2. **Read and navigate — healthy.** Content uses a bounded reading column;
   tables and code scroll safely; headings, links, copy feedback, zoom, and
   back-to-top behaviour have explicit focus and status handling.
3. **Change appearance — healthy.** All 364 bundled themes receive derived
   semantic tokens with automated 4.5:1 contrast checks for core text, links,
   quotes, and surfaces. Mermaid diagrams are re-rendered on theme changes.
4. **Handle loading and failure — healthy.** Loading, stale-request protection,
   unsupported-file errors, image failures, and file-picker recovery are
   visible and actionable.
5. **Open linked content — healthy within policy.** HTTP(S) links use the system
   browser; relative Markdown/TXT links stay in the reading flow; anchors work;
   unsafe schemes and unsupported local targets are blocked with feedback.

## Critical findings resolved

| Severity | Finding | Resolution |
| --- | --- | --- |
| P1 | The main empty-state action was a clickable `div` and could not be used reliably from the keyboard. | Replaced with semantic buttons and visible focus states. |
| P1 | The default theme mapped ANSI colours directly to major surfaces, producing black-on-black cards and unreadable table rows. | Added semantic theme derivation plus catalogue-wide contrast tests. |
| P1 | Raw Markdown HTML could enter the webview unchanged. | Raw and inline HTML are escaped in Rust; Mermaid runs in strict mode. |
| P1 | Relative image handling depended on broad file-system access and lacked a safe document boundary. | Removed the direct file-system integration and added canonicalized directory, type, count, concurrency, and size boundaries. |
| P2 | The shell overflowed narrow viewports and 200% zoom. | Rebuilt the responsive shell and verified DOM bounds at 390 px and 200% zoom. |
| P2 | Help, loading, errors, copy, and theme changes had incomplete focus or feedback. | Added focus restoration, live status/toast messages, recovery actions, and reduced-motion handling. |
| P2 | Tables and highlighted code lost readability across themes. | Added scrolling regions, semantic table surfaces, and a stable dark syntax-highlight surface. |
| P1 | Direct command-line/file-association launches were ignored by frontend initialization. | Added an explicit initial-path command and verified a native launch with a document argument. |
| P2 | Production dependencies contained known high/moderate vulnerabilities. | Updated Mermaid/Vite/Tauri packages and pinned patched transitive packages. |

## Evidence

- `bun run check:frontend`: validates required state/control seams and 364 themes.
- `bun run test:frontend`: covers theme contrast, theme selection, display names,
  and safe link classification.
- `cargo test`: covers Markdown rendering/escaping, extensions, file limits, and
  bounded local-image paths/data.
- `bun run build`: verifies the production frontend bundle.
- Native Windows launch: a direct document argument rendered representative
  headings, task list, table, code, Mermaid, and a relative raster image.
- Browser inspection: empty/help states, keyboard focus restoration, dark theme,
  390 px reflow, and 200% zoom.
- `npm audit --omit=dev` and `npm audit`: zero known vulnerabilities at audit time.

## Residual risks

- Native smoke coverage is Windows-only; Linux and macOS need CI or device
  smoke before a broad release.
- The 364-option native theme selector is functional but not searchable; this is
  a P3 usability improvement rather than a release blocker.
- Automated contrast checks cover the semantic application chrome, not every
  individual syntax-highlight token or generated Mermaid colour.
- The production build is green but reports one optional Mermaid diagram chunk
  above Vite's 500 kB warning threshold; lazy diagram loading is a P3
  performance follow-up.
- Browser screenshot capture under a narrow emulated viewport was unreliable in
  the audit harness; DOM geometry and native/browser wide captures were used as
  the responsive evidence instead.
