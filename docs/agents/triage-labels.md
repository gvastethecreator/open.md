# Triage fields

GitHub Issues use one category label and one triage label. Local mirrors record the same values.

## Categories

| Canonical category | GitHub label | Meaning |
| --- | --- | --- |
| `bug` | `bug` | Existing behavior is wrong |
| `enhancement` | `enhancement` | New behavior or an improvement |

## Statuses

| Canonical status | GitHub label | Meaning |
| --- | --- | --- |
| `needs-triage` | `needs-triage` | Maintainer evaluation is required |
| `needs-info` | `needs-info` | Reporter information is missing |
| `ready-for-agent` | `ready-for-agent` | The work is specified for an AFK agent |
| `ready-for-human` | `ready-for-human` | Human implementation or judgment is required |
| `wontfix` | `wontfix` | The maintainers will not action the request |

## Project status

- Field: `Status`
- Field ID: `PVTSSF_lAHOAA4Nfc4BgUUvzhag8no`

| Workflow state | Project value | Option ID |
| --- | --- | --- |
| Queued | `Todo` | `f75ad846` |
| Active | `In Progress` | `47fc9ee4` |
| Finished | `Done` | `98236657` |

When triage changes, update the GitHub label and the local `Category:` or `Status:` field together.

When work starts or finishes, update the Project value and the local `Project status:` field together.

Local `Execution:` is separate from triage `Status:`. Use `queued`, `active`, `blocked`, or `finished`.

## Workflow labels

- `spec`: parent specification for executable tickets.
- `wayfinder:map`: decision map for a large effort.

If an enabled workflow requires another label, create it. Do not duplicate an existing repository label.
