# mapanytime-api

## Branching: Continuous Staging and On-Demand Main Synchronization

> This section takes precedence over any other branch or pull-request-target instruction in this file.
> `main` is this repository's production branch.

The development workflow is continuous and is not restricted to a daily schedule, a single task, or a fixed number of tasks.

- Before beginning a new development cycle, inspect the relationship between `main` and `staging` and synchronize them when necessary.
- All task branches must originate from the latest `staging`.
- Completed tasks must be submitted through PRs targeting `staging`.
- Developers may continue starting and completing additional tasks for as long as needed.
- Do not synchronize `staging` into `main` automatically after each task, after a fixed time interval, or simply because the day has ended.
- Synchronize `staging` into `main` only when the team explicitly decides that the accumulated changes are ready for delivery.
- Before synchronization, validate the combined changes and complete all required reviews and checks.
- Never merge unfinished or known-broken changes into `main`.
- After synchronization, verify the resulting branch state before continuing.
- **When a task is done, ask the repository owner / team lead whether it is all good.** They decide whether it merges and when `staging` is synchronized; an agent's or author's own judgment is not approval.
- **Check deploy triggers before merging into `staging`:** some repos deploy on pushes to `staging` (see `.github/workflows/`). Merging is a deployment decision, not just a code review.
- **Project board:** move the item through the product's GitHub Project — Backlog → To-Do → In progress → Done.

**Workflow:** Establish baseline → Develop tasks → Merge completed tasks into staging → Continue working or synchronize to main when ready → Repeat.

`staging` is the continuous integration branch. `main` is updated on demand when the team chooses to deliver the accumulated changes.

```bash
# Start a task
git fetch origin
git log --oneline origin/main..origin/staging   # what staging has that main doesn't
git checkout staging && git pull
git checkout -b <type>/<short-description>      # feat/, fix/, docs/, test/, chore/ ...

# Finish a task: open a PR into staging (never into main)
gh pr create --base staging

# Deliver (only when the owner decides): one PR from staging into main
gh pr create --base main --head staging
```

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
