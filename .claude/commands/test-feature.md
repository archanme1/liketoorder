---
description: Write tests from the spec, then run them. Pass the spec name e.g. /test-feature 09-pickup-requests
argument-hint: "<spec name>"
allowed-tools: Read, Glob, Grep, Bash(npm test:*), Bash(npx jest:*), Bash(npx supabase test db:*), Bash(npx supabase status:*)
---

Run the testing pipeline for the feature in $ARGUMENTS.

If no argument: stop and say
"Usage: /test-feature <spec-name> e.g. /test-feature 09-pickup-requests"

If `.claude/specs/$ARGUMENTS.md` does not exist: stop and say
"Spec file not found at .claude/specs/$ARGUMENTS.md."

---

## Step 1 — Write tests (liketoorder-test-writer)

Invoke the **liketoorder-test-writer** subagent with:
- Spec: `.claude/specs/$ARGUMENTS.md` (Definition of done + Test plan sections are the contract)
- Product spec sections the spec cites in `docs/product/v1.md`
- Structure-only references (names, exports, table/column names — NOT logic):
  - `src/features/<feature>/api.ts` and `schema.ts`
  - `src/types/database.ts`
  - newest relevant files in `supabase/migrations/`
- Output:
  - App tests → `src/features/<feature>/__tests__/$ARGUMENTS.test.tsx` (or `.test.ts`)
  - Database tests → `supabase/tests/$ARGUMENTS.test.sql` when the spec has database changes
- Instruction: write tests for what the spec says SHOULD happen. Cover happy
  paths, validation errors, empty/error states, auth guards, and RLS
  "outsider cannot" cases.

Wait until it confirms the files are written. If it could not write them, stop and report why.

## Step 2 — Run tests (liketoorder-test-runner)

Invoke the **liketoorder-test-runner** subagent with:
- The test files from Step 1
- The spec for context
- Commands:
  - `npm test -- <app test file>`
  - `npx supabase test db` (only if a SQL test file was written; requires `npx supabase status` to show the local stack running — if not running, report that instead of failing)
- Instruction: run ONLY these tests. Classify each failure as **bug in
  implementation**, **missing feature**, or **bad test** (test contradicts spec).

## Rules
- Do NOT start Step 2 before Step 1 finishes.
- Do NOT fix any code in this command, whatever the results.
- Do NOT run the full suite (CI does that).

## Final output

### Testing Report — $ARGUMENTS
**Tests written** — each test, one line, mapped to the Definition-of-done item it checks.
**Results** — the runner's structured report.
**Verdict** — ✅ Ready for `/code-review-feature $ARGUMENTS` | ❌ Needs fixes (list failures + root cause). Ask whether to fix now.
