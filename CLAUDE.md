# mapanytime-api

## Work is tracked on the FORHU GitHub Project

Every piece of work in this repo starts from, and is recorded on, project
[#23](https://github.com/orgs/FORHU/projects/23).

**Picking up work:** start from an item on the board. Before changing code,
find the item for the task (or ask which one it is), and move it to In Progress.
When the change is merged, move it to Done.

**Finding new work along the way** (a bug, an F-flag in
`mapanytime-api/docs/specs/OPEN-FLAGS.md`, a follow-up): create an issue in
this repo and make sure it is on the board, rather than leaving it only in chat
or in a doc. Work that spans repos gets one issue per repo, each linking the
others. Cite the F-id in the issue title or body when there is one. Other repos'
boards:

| Repo                      | Project                                                  |
| :------------------------ | :------------------------------------------------------- |
| `mapanytime-api`          | [#23](https://github.com/orgs/FORHU/projects/23)         |
| `mapanytime-market-app`   | [#24](https://github.com/orgs/FORHU/projects/24)         |
| `mapanytime-market-web`   | [#25](https://github.com/orgs/FORHU/projects/25/views/1) |
| `mapanytime-market-admin` | none yet: ask which board before tracking admin work     |

**Tooling:** the board is private, so this needs the GitHub CLI signed in with
project access (`gh auth login`, then `gh auth refresh -s project`). New issues
in this repo are added to the board automatically with status Todo.

```sh
gh issue create --repo FORHU/mapanytime-api --title "…" --body "…"

# statuses: look up the field and option ids once
gh project field-list 23 --owner FORHU
gh project item-list 23 --owner FORHU
gh project item-edit --project-id <id> --id <item-id> \
  --field-id <status-field-id> --single-select-option-id <option-id>
```

If `gh` is missing or not signed in, say so and give the user the issue title,
body and board to create by hand. Never skip tracking silently.
