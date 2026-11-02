---
description: Load the focused context for one feature spec and say whether plan mode is required. Run right after /clear.
argument-hint: "<spec name> e.g. 09-pickup-requests (empty = show status board)"
allowed-tools: Read, Edit, Glob, Grep, Bash(git status:*), Bash(git branch:*), Bash(git switch:*), Bash(git log:*)
---

Start (or resume) work on a single LikeToOrder feature with a small, focused context.

Spec: $ARGUMENTS

## If no argument
Print the Feature status table from CLAUDE.md, name the first row that is not
✅ Shipped, and suggest the next command (`/createspecs …` or
`/start-feature …`). Stop.

## Step 1 — Validate
- `.claude/specs/$ARGUMENTS.md` must exist, otherwise stop and list available specs.
- Read the spec's **Branch** line. If the current branch differs, run
  `git switch <branch>` (stop if the working tree is dirty and tell the user).

## Step 2 — Load context (and nothing else)
Read, in this order:
1. `.claude/specs/$ARGUMENTS.md`
2. The sections of `docs/product/v1.md` the spec cites
3. Every file under the spec's **Context to load** heading that exists
Do NOT read other source files yet. If deeper research is needed, use the
built-in Explore subagent and keep only its summary.

## Step 3 — Check where we are
Run `git log main..HEAD --oneline` to see work already done on this branch.

## Step 4 — Brief the project manager
Reply with exactly:

```
Feature:    <title>
Branch:     <branch>
Status:     <new | in progress — N commits on branch>
Plan mode:  <REQUIRED | optional> — <reason from spec>
Depends on: <list, with ✅/⬜ from CLAUDE.md>
Open questions: <list or "none">
```

Then:
- If Plan mode is REQUIRED: say "Switch to plan mode (Shift+Tab twice) and
  tell me to plan. I won't edit files until you approve the plan."
- If optional: give a 3–6 bullet implementation outline and ask for a go-ahead.

Also set the spec's row in CLAUDE.md's Feature status table to `🚧 In progress`
only after the user approves starting implementation.

Do not write code in this command.
