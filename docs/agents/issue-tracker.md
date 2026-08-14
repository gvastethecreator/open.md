# Project tracker: GitHub plus local mirrors

GitHub Issues and the linked GitHub Project hold live work state. Local Markdown files hold task context, decisions, evidence, and handoffs.

## Identity

- Repository: `gvastethecreator/open.md`
- Repository URL: https://github.com/gvastethecreator/open.md
- Project owner: `gvastethecreator`
- Project number: `7`
- Project node ID: `PVT_kwHOAA4Nfc4BgUUv`
- Project title: `open.md`
- Project URL: https://github.com/users/gvastethecreator/projects/7
- Project visibility: public
- Local root: `.scratch/open-md/`

## Authority

- GitHub owns issue state, assignees, comments, dependencies, labels, and Project values.
- Local files own expanded context, decisions, evidence, and offline handoff notes.
- Shared fields must match on both surfaces.
- Do not copy the full GitHub comment history into local files.
- Add durable decisions and proof to `## Sync log`.

## Local layout

- Specification: `.scratch/open-md/spec.md` (`PRD.md` remains compatible).
- Ticket mirrors: `.scratch/open-md/issues/<NN>-<slug>.md`.
- Rejected requests: `.scratch/open-md/out-of-scope/<concept>.md`.
- Execution state: `.scratch/planning/`.
- Wayfinding mirrors: `.scratch/wayfinder/<effort-slug>/`.

Each ticket mirror starts with these fields:

```markdown
# <NN>: <title>

GitHub issue: <url-or-pending>
GitHub project: https://github.com/users/gvastethecreator/projects/7
Sync: pending | synced | conflict
Last synced: <ISO-8601-or-never>
Remote updated: <ISO-8601-or-unknown>
Category: bug | enhancement
Status: needs-triage | needs-info | ready-for-agent | ready-for-human | wontfix
Project status: Todo | In Progress | Done
Execution: queued | active | blocked | finished
Type: AFK | HITL
Source: <spec path, issue URL, or conversation>
Blocked by: <GitHub issue numbers or None>
```

## Sync protocol

1. Read the Issue, Project item, and local mirror before a mutation.
2. If both surfaces changed after `Last synced`, set `Sync: conflict` and stop.
3. Write the local draft with `Sync: pending` before remote creation.
4. Create or update the GitHub Issue.
5. Add the Issue to Project 7 under `gvastethecreator`.
6. Set the Project `Status` field to the configured value.
7. Update the local identifiers, fields, timestamps, and `Sync: synced`.
8. If a step fails, record the failed step under `## Sync log`.
9. Retry from the stored Issue URL.

Never create a second Issue because a later sync step failed. If GitHub is unavailable, keep the local mirror with `Sync: pending`.

Before an update, compare the Issue `updatedAt` value with `Last synced`. If both surfaces changed, resolve the conflict before another write.

## GitHub commands

Use these exact identities:

```powershell
gh issue view <number> -R gvastethecreator/open.md --json number,title,state,body,labels,assignees,comments,updatedAt,url
gh project view 7 --owner gvastethecreator --format json
gh project field-list 7 --owner gvastethecreator --format json
gh project item-list 7 --owner gvastethecreator --limit 200 --format json --field Status
gh project item-add 7 --owner gvastethecreator --url <issue-url>
gh project item-edit 7 --owner gvastethecreator --url <issue-url> --field Status --value <Todo-or-In-Progress-or-Done>
gh issue create -R gvastethecreator/open.md --title <title> --body-file <path> --parent <parent-number> --blocked-by <number,number>
gh issue edit <issue-number> -R gvastethecreator/open.md --parent <parent-number> --add-blocked-by <number>
```

If a relationship does not apply, omit its flag. If the CLI lacks these flags, write the relationships in the body.

## Triage and implementation

- Triage updates one category label, one triage label, and the corresponding local fields.
- Implementation start assigns the Issue and sets Project status to `In Progress`.
- Verified completion posts proof, closes the Issue, and sets Project status to `Done`.
- A blocker keeps the Issue open and sets local `Execution: blocked`.

## Wayfinding operations

- Create the map as a GitHub Issue with `wayfinder:map`.
- Mirror the map at `.scratch/wayfinder/<effort-slug>/map.md`.
- Create decision tickets as native sub-issues.
- Mirror decision tickets under `.scratch/wayfinder/<effort-slug>/tickets/`.
- Use native blocked-by relationships and mirror the same Issue numbers locally.
- Claim a ticket with an assignee, `In Progress`, and local `Execution: active`.
- Resolve a ticket with a GitHub comment, `Done`, and a local `## Answer`.
