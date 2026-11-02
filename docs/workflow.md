# How we build LikeToOrder (workflow guide)

This is the guide for **you, the project manager**. `CLAUDE.md` is the guide for Claude.

---

## The pieces, in plain words

| Piece | What it is | Where it lives | Analogy |
|---|---|---|---|
| **CLAUDE.md** | Rules Claude reads at the start of every session | `CLAUDE.md` | The company handbook |
| **Product spec** | Everything we decided about *what* v1 does | `docs/product/v1.md` | The client's brief |
| **Feature spec** | Exactly *how* one feature gets built, with a done checklist | `.claude/specs/NN-slug.md` | A work order |
| **Custom command** | A saved, reusable instruction you trigger with `/name` | `.claude/commands/*.md` | A standard operating procedure |
| **Subagent** | A helper with its own fresh memory and one job (write tests, review security…) | `.claude/agents/*.md` | A specialist you call in |
| **Skill** | Know-how Claude loads only when the task needs it (UI rules, Supabase patterns, map markers) | `.claude/skills/*/SKILL.md` | A reference manual on the shelf |
| **Hook** | A script that runs automatically before/after Claude uses a tool (format code, block risky commands) | `.claude/settings.json` + `.claude/hooks/` | A safety interlock |
| **MCP server** | A connection that lets Claude use an outside service (GitHub, Supabase, docs) | `.mcp.json` | A login to another system |
| **Plugin** | A bundle of commands + agents + skills + hooks you can install into other projects | (later) | A toolkit you carry to the next job |
| **CI** | GitHub runs lint, type-check and tests on every pull request | `.github/workflows/ci.yml` | An inspector who checks every job |
| **CD** | Every merge to `main` publishes a preview build automatically | `.github/workflows/preview.yml` | Delivery truck that leaves on schedule |

---

## One-time setup (do this before feature 01)

1. **Install tools on your Mac**
   - Node LTS (you have nvm) · `npm i -g eas-cli`
   - Docker Desktop (needed for local Supabase)
   - Supabase CLI: installed by `npm install` (pinned devDependency, run as `npx supabase`). A global `brew install supabase/tap/supabase` is optional.
   - GitHub CLI: `brew install gh` then `gh auth login`
   - VS Code + the **Claude Code** extension
2. **Create the GitHub repo** (private): `gh repo create liketoorder --private --source . --push`
3. **Protect `main`** (GitHub → Settings → Branches → Add rule for `main`): require a pull request, require status check **CI / checks** to pass, require branches up to date.
4. **Secrets** (GitHub → Settings → Secrets → Actions): `EXPO_TOKEN` (from expo.dev → Access tokens). Add later when spec 01 sets up EAS.
5. **MCP tokens** in your shell profile (`~/.zshrc`), never in the repo:
   ```bash
   export GITHUB_PERSONAL_ACCESS_TOKEN=ghp_...   # fine-grained, this repo only: contents, pull requests, actions (read)
   export SUPABASE_PROJECT_REF=abcdefghijklmnop   # from Supabase dashboard URL, once the cloud project exists
   ```
   Restart VS Code, then in Claude run `/mcp` to confirm `github`, `supabase` and `context7` connect.
6. Open the folder in VS Code and start Claude Code. Run `/start-feature` once with no argument to see the status board.

---

## The loop for every feature

```
/createspecs 9 pickup-requests      ← Claude writes the spec + branch
   ↓ you read .claude/specs/09-pickup-requests.md, ask for changes
/clear                              ← fresh context
/start-feature 09-pickup-requests   ← loads only this feature's context
   ↓ if "Plan mode: required" → Shift+Tab twice → review plan → approve
   ↓ Claude implements
/test-feature 09-pickup-requests    ← tests from the spec, then run
/code-review-feature 09-pickup-requests
   ↓ you approve the fix list
/ship-feature                       ← PR → CI green → merge → status ✅
```

Helpers any time:
- `/feature-status` — where are we on the roadmap?
- `/db-migration <name>` — create a schema change the safe way
- `/seed <what>` — fill local DB with demo data (restaurants, users, uploads)

---

## When to use plan mode

Plan mode = Claude researches and writes a plan **without changing files** until you approve.

Use it (the spec will say `Plan mode: required`) when the feature:
- changes the database (new table, column, RLS policy)
- touches more than ~5 files
- adds a new library
- changes navigation or login

Skip it for small UI tweaks, copy changes, or bug fixes in one file.

Toggle: **Shift+Tab** cycles normal → auto-accept edits → plan mode.

---

## Context management (keeping Claude sharp)

Think of Claude's context like a workbench: the more junk on it, the harder it is to find the right tool.

- **One feature per session.** `/clear` before starting a new one.
- `/start-feature` loads only: CLAUDE.md, the spec, the product-spec section it cites, and the files listed in the spec's **Context to load**.
- Subagents (Explore, test writer, reviewers) do their reading in their own context and hand back a summary.
- Long session? `/compact <note about where we are>` keeps a summary and frees space.
- `/context` shows how full the workbench is.

---

## Plugins: the plan

v1: no plugin. We tune the commands/agents/hooks on this project first.
After ~5 shipped features, when the workflow is stable, we package `.claude/commands`, `.claude/agents` and the hooks into a **plugin** (e.g. `spec-workflow`) so your next project starts with all of it in one install.

Optional now: browse the official plugin marketplace with `/plugin` for anything useful (e.g. a code-review or frontend-design plugin) — install per project, and tell Claude so it's noted here.

---

## What you approve (your PM checkpoints)

1. Each spec (scope + definition of done)
2. Each plan (when plan mode is required)
3. The review action list
4. The PR is merged only after CI passes (automatic gate)
