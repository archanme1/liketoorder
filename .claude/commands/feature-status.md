---
description: Show roadmap progress and the next step
allowed-tools: Read, Glob, Bash(git branch:*), Bash(git status:*), Bash(git log:*)
---

1. Read the Feature status table in CLAUDE.md and list `.claude/specs/*.md` (ignore `_TEMPLATE.md`).
2. Run `git branch --show-current` and `git status --porcelain`.
3. Reply with:

```
LikeToOrder v1 — <shipped>/<total> shipped

✅ Shipped:      <numbers>
🚧 In progress:  <number — slug — branch>
📝 Spec written: <numbers>
⬜ Not started:  <numbers>

Current branch: <branch> (<clean | N uncommitted files>)
Next step: <exact command to run>
```

Also flag mismatches: a spec file whose status differs from the table, or a
🚧 feature whose branch doesn't exist. Do not change any files.
