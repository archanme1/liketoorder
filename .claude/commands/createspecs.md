---
description: Create the spec file and feature branch for the next LikeToOrder roadmap step
argument-hint: "<step number> <feature slug> e.g. 9 pickup-requests"
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(git status:*), Bash(git branch:*), Bash(git checkout:*), Bash(git pull:*), Bash(git switch:*)
---

You are the senior developer on LikeToOrder, preparing the next feature for the
project manager to review. Follow every rule in CLAUDE.md.

User input: $ARGUMENTS

## Step 1 — Working directory must be clean
Run `git status --porcelain`. If anything is listed, STOP and tell the user to
commit or stash first. Do not continue.

## Step 2 — Parse arguments
From $ARGUMENTS extract:
1. `step_number` — zero-padded to 2 digits (9 → 09)
2. `feature_slug` — lowercase kebab-case, a-z 0-9 and -, max 40 chars
3. `feature_title` — Title Case
4. `branch_name` — `feature/<feature_slug>`

Cross-check against the roadmap table in `docs/product/v1.md` §14. If the
number and slug don't match a roadmap row, warn the user and ask whether to
continue. If you can't infer the values, ask.

## Step 3 — Guard against duplicates
- If `.claude/specs/<step_number>-*.md` already exists, STOP and report it.
- In CLAUDE.md's Feature status table, if this row is ✅ Shipped, STOP and warn.
- Check every spec in "Depends on" is ✅ Shipped. If not, warn and ask whether to continue.

## Step 4 — Branch
```
git checkout main
git pull origin main   # skip with a note if no remote exists yet
git checkout -b <branch_name>
```
If the branch exists, append `-01`, `-02`, ...

## Step 5 — Research (keep it lean)
Use the built-in **Explore** subagent to summarise what already exists that this
feature touches (tables in `supabase/migrations/`, feature folders in
`src/features/`, routes in `app/`). Read yourself only:
- `docs/product/v1.md` sections relevant to this feature
- `.claude/specs/_TEMPLATE.md`
- The previous 1–2 specs this one depends on

## Step 6 — Write the spec
Fill in `.claude/specs/_TEMPLATE.md` exactly (same headings, same order).
Requirements:
- **Plan mode:** decide using the policy in CLAUDE.md and give the reason.
- **Context to load:** the minimum set of files a fresh session needs.
- **Database changes:** include RLS policies for every table and the Postgres
  functions that guard status transitions.
- **Definition of done:** every item testable; include at least one
  "outsider cannot …" security item when data is added.
- **Out of scope:** pull from `docs/product/v1.md` §3 where relevant.
- Do not invent product decisions. If the product spec doesn't answer
  something, add it under a final `## Open questions` heading.

## Step 7 — Save and update status
- Save to `.claude/specs/<step_number>-<feature_slug>.md`
- In CLAUDE.md's Feature status table set this row to `📝 Spec written` and the
  Spec column to the file path.

## Step 8 — Report
```
Branch:    <branch_name>
Spec file: .claude/specs/<step_number>-<feature_slug>.md
Plan mode: <required|optional>
Open questions: <count>
```
Then say: "Review the spec. When it's approved, run `/clear` then
`/start-feature <step_number>-<feature_slug>`."

Do not print the full spec unless asked. Do not write any code.
