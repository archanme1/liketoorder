---
description: Parallel security + quality review of the current feature branch. Pass the spec name e.g. /code-review-feature 09-pickup-requests
argument-hint: "<spec name>"
allowed-tools: Read, Glob, Grep, Bash(git diff:*), Bash(git log:*), Bash(git status:*)
---

Run the code review pipeline for $ARGUMENTS.

If no argument: stop and say
"Usage: /code-review-feature <spec-name> e.g. /code-review-feature 09-pickup-requests"

If `.claude/specs/$ARGUMENTS.md` does not exist: stop and report it.

## Pre-flight
Collect the full change set for this branch:
- `git diff main...HEAD` (committed on branch)
- `git diff` and `git diff --staged` (not yet committed)
Combine them. If all are empty, stop: "No changes detected. Implement the feature first."

## Step 1 — Parallel review
Launch BOTH subagents in the same turn (parallel, not one after the other):

**liketoorder-security-reviewer** gets:
- The combined diff
- The spec
- Instruction: review only changed code for security: RLS policies, ownership
  checks, status-transition functions, storage policies, secret handling,
  exposure of private data (exact homemade address, private uploads, other
  users' requests), client-trusted timestamps/IDs. No style comments.

**liketoorder-quality-reviewer** gets:
- The combined diff
- The spec
- Instruction: review only changed code for correctness vs. the spec,
  CLAUDE.md conventions (folder placement, api.ts boundary, theme tokens,
  4 screen states, accessibility, reduce-motion), React Native performance
  (re-renders, list virtualization, map marker count), and test quality.
  No security comments.

## Step 2 — Unified report
Merge findings; de-duplicate lines flagged by both (keep both perspectives).

```
Code Review — $ARGUMENTS

Security findings
<security output>

Quality findings
<quality output>

Action plan (fix in this order)
1. Critical/High security
2. Quality: CHANGES REQUESTED
3. Medium/Low security
4. Quality suggestions

Verdict: APPROVED | APPROVED WITH SUGGESTIONS | CHANGES REQUESTED
```

## Step 3 — Ask
"Do you want me to implement the action plan now?" Wait for explicit approval.

## Rules
- Do not edit files before approval.
- If either reviewer fails or returns nothing, say so and do not present a partial review as complete.
- After fixes are made, suggest re-running `/test-feature $ARGUMENTS`.
