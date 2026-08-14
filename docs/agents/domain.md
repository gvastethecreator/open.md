# Domain docs

Read the repository domain documents before you explore or change the code.

## Required context

1. Read `CONTEXT.md`.
2. Read each relevant ADR in `docs/adr/`.
3. If `docs/architecture/CURRENT.md` exists, read it.

This repository uses one domain context. `CONTEXT.md` defines the stable boundaries and project vocabulary.

The `docs/adr/` directory records accepted decisions. Historical architecture reviews remain evidence and do not replace the current context.

## File structure

```text
/
├── CONTEXT.md
├── docs/
│   ├── adr/
│   ├── agents/
│   └── architecture/
├── src/
└── src-tauri/
```

## Vocabulary

Use the names from `CONTEXT.md` in issue titles, plans, tests, and code changes. Do not replace a defined term with a synonym.

If a required concept is absent, first make sure that the code does not already use another defined term. Record a real vocabulary gap for domain review.

## ADR conflicts

If proposed work conflicts with an accepted ADR, identify the ADR before implementation. Do not override the decision without an explicit review.
