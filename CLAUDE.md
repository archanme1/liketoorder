# CLAUDE.md

## Project overview

**LikeToOrder** is a map-first mobile app for discovering restaurants and homemade food through country-flag markers, sending pickup and table requests, and keeping a personal food-photo log shown as a GitHub-style activity grid.

- Product spec (the *what*): `docs/product/v1.md`. Read the relevant section before any feature work.
- Feature specs (the *how*): `.claude/specs/NN-slug.md`, one per feature.
- Workflow guide for humans: `docs/workflow.md`

**Roles:** Archan is the project manager (approves specs, plans, reviews, merges). Claude is the senior developer (writes specs, plans, code, tests; runs reviews; ships via PR).

---

## Tech stack

| Layer | Choice |
|---|---|
| App | Expo (managed, CNG — no committed `ios/` or `android/`), React Native, TypeScript (strict) |
| Routing | expo-router (file-based, `app/` directory) |
| Backend | Supabase: Postgres, Auth, Storage, Edge Functions (Deno), Row Level Security |
| Server state | @tanstack/react-query wrapping supabase-js |
| Client state | React state first; Zustand only for cross-screen UI state |
| Map | react-native-maps + supercluster for clustering |
| Bottom sheet | @gorhom/bottom-sheet |
| Animation | react-native-reanimated (marker rise-and-fall) |
| Forms | react-hook-form + zod |
| Images | expo-image-picker, expo-image-manipulator (resize/compress), expo-image (display) |
| Push | expo-notifications |
| Tests | jest-expo + @testing-library/react-native; pgTAP via `supabase test db` |
| Build/Release | EAS Build + EAS Update |

---

## Architecture

```
liketoorder/
├── app/                      # expo-router routes ONLY (thin screens)
│   ├── (auth)/               # sign-in, sign-up
│   ├── (tabs)/               # restaurants, homemade, profile, manage (seller only)
│   └── _layout.tsx
├── src/
│   ├── features/<feature>/   # one folder per domain: cuisines, map, sellers, menu, media (shared photo pick/prepare/upload), requests, food-log, activity-grid, promotions, reports, profile
│   │   ├── components/
│   │   ├── hooks/            # react-query hooks (useXQuery / useXMutation)
│   │   ├── api.ts            # ALL supabase calls for this feature
│   │   ├── schema.ts         # zod schemas
│   │   └── __tests__/
│   ├── components/ui/        # shared design-system components
│   ├── lib/                  # supabase client, query client, date utils
│   ├── theme/                # tokens.ts (colors, spacing, radius, type)
│   └── types/database.ts     # GENERATED — never edit by hand
├── supabase/
│   ├── migrations/           # timestamped SQL, append-only
│   ├── functions/            # Edge Functions (Deno/TS)
│   ├── tests/                # pgTAP tests for RLS and constraints
│   └── seed.sql              # local dev seed data
├── docs/
├── .claude/                  # specs, commands, agents, skills, hooks
└── .github/workflows/        # CI + preview deploy
```

**Where things belong:**
- New screen → `app/...` file that renders a component from `src/features/<feature>/components`
- Supabase queries → `src/features/<feature>/api.ts` only, never inside components or screens
- Data fetching in UI → react-query hooks in `src/features/<feature>/hooks/`
- Shared UI → `src/components/ui/`; colors/spacing → `src/theme/tokens.ts`
- Schema change → new migration in `supabase/migrations/` (created with `npx supabase migration new <name>`)
- Secrets or third-party API keys (e.g. Places autocomplete) → Supabase Edge Function, never in the app bundle
- Any map, marker, sheet or location work → read `.claude/skills/map-markers/SKILL.md` first, especially "Lessons from spec 07"

---

## Code style

- TypeScript strict, no `any` (use `unknown` + zod). Named exports. Function components only.
- Files: `PascalCase.tsx` for components, `camelCase.ts` for everything else. Feature folders kebab-case.
- Never hardcode colors, spacing or font sizes — use `src/theme/tokens.ts`.
- Every screen handles 4 states: loading, empty, error (with retry), success.
- Accessibility: every touchable has `accessibilityLabel` + `accessibilityRole`; touch targets ≥ 44pt; never convey meaning by color alone.
- Respect reduce-motion (`useReducedMotion` from reanimated) for any looping animation.
- Dates: store `timestamptz` in UTC; activity grid uses the stored `local_date` column.
- Tests use @testing-library/react-native **v14**: `render`, `fireEvent.*`, `userEvent.*`, `renderHook` and `act` are async — always `await` them inside `async` tests.
- Conventional commits: `feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`.

---

## Supabase rules (non-negotiable)

- **RLS is ON for every table.** Every new table ships with its policies and a pgTAP test proving an outsider can't read/write what they shouldn't.
- **Ownership is enforced in the database** (RLS / security-definer functions), never only by hiding UI.
- **Status changes go through Postgres functions** (e.g. `respond_to_request(request_id, decision)`) that check the caller owns the business and the transition is valid.
- **Migrations are append-only.** Never edit a migration that exists on `main`. Fix forward with a new migration.
- After any migration: `npm run db:types` to regenerate `src/types/database.ts`.
- Storage buckets have policies: users write only inside their own folder: `<auth.uid()>/…` or, for business media, `<business_id>/…` of a business they own.
- Homemade exact addresses live in a separate table readable only by the owner and by customers with an **accepted** request.
- Timestamps that matter for rules (upload time, request time) are set by the server (`default now()`), never trusted from the client.
- Never use the `service_role` key in the app. Only Edge Functions may use it.

---

## Tech constraints

- No new dependency without listing it in the spec's **New dependencies** section. Install with `npx expo install` (keeps versions Expo-compatible).
- No Redux, no styled-components, no UI kits (NativeBase, Tamagui, etc.). Build on React Native primitives + our `ui/` components.
- No live/background location tracking. `expo-location` is allowed only for "center map on me" with foreground permission.
- No committed native folders (`ios/`, `android/`); configure through `app.config.ts` and config plugins.

---

## Commands

```bash
# Setup
npm install
npx supabase start            # local Supabase (needs Docker)
cp .env.example .env          # fill in local keys printed by supabase start

# Run
npx expo start --dev-client   # dev server for the development build; press i for the iOS simulator
npx expo run:ios              # build + install the development build (first time, and whenever a native package or native app.config.ts setting changes). Run by Archan, not by Claude.
# Note: the map uses Google Maps on iOS and Android, so Expo Go can no longer run the Restaurants tab.
# Use the development build (iOS Simulator first). Web is not supported for the map.

# Quality
npm run lint
npm run typecheck
npm test                      # jest
npm test -- path/to/file      # single file
npx supabase test db          # pgTAP database tests

# Database
npx supabase migration new <name>
npx supabase db reset         # LOCAL ONLY: re-applies migrations + seed.sql
npm run db:types              # regenerate src/types/database.ts
```

---

## Feature workflow (every feature, in order)

1. `/createspecs <n> <slug>` → spec file + `feature/<slug>` branch. **Archan reviews the spec.**
2. `/clear`, then `/start-feature <NN-slug>` → loads only this feature's context and says whether plan mode is required.
3. **Plan mode** (Shift+Tab twice) when the spec says `Plan mode: required` → Archan approves the plan → implement.
4. `/test-feature <NN-slug>` → tests written from the spec, then run.
5. `/code-review-feature <NN-slug>` → parallel security + quality review → Archan approves fixes.
6. `/ship-feature` → commit, push, PR, **wait for CI green**, squash-merge, update status table below.

## Context management policy

- One feature per session. Start each feature with `/clear` and `/start-feature`.
- Load only: this file, the feature spec, the product-spec section it cites, and files listed under **Context to load** in the spec.
- Use the Explore subagent for codebase searches so file dumps stay out of the main context.
- If the session gets long mid-feature, use `/compact` with a note of the current step, e.g. `/compact implementing step 3 of plan for 09-pickup-requests`.
- Before /code-review-feature, don't /clear; use /compact with a note of the current step, because fixes are made on the same branch. Use /clear only at the start of a new feature.

## Plan mode policy

Plan mode is **required** when a feature: changes the database schema or RLS; touches more than ~5 files; adds a dependency; or changes navigation or auth. Otherwise optional. The spec's `Plan mode:` line is the decision; `/start-feature` repeats it.

## Subagent policy

- Use the built-in **Explore** subagent for codebase exploration before implementing.
- Use the built-in **Plan** subagent for research while in plan mode.
- Tests: `liketoorder-test-writer` (writes from the spec) then `liketoorder-test-runner` (runs + diagnoses). Never let the writer read the implementation.
- Reviews: `liketoorder-security-reviewer` and `liketoorder-quality-reviewer` in parallel.

---

## Feature status

Updated by `/ship-feature`. Do not implement a feature marked ⬜ unless the active spec targets it.

| # | Feature | Status | Spec |
|---|---|---|---|
| 01 | project-setup | ✅ Shipped | .claude/specs/01-project-setup.md |
| 02 | auth-and-profiles | ✅ Shipped | .claude/specs/02-auth-and-profiles.md |
| 03 | navigation-shell | ✅ Shipped | .claude/specs/03-navigation-shell.md |
| 04 | cuisine-catalog | ✅ Shipped | .claude/specs/04-cuisine-catalog.md |
| 05 | seller-onboarding | ✅ Shipped | .claude/specs/05-seller-onboarding.md |
| 06 | menu-management | ✅ Shipped | .claude/specs/06-menu-management.md |
| 07 | restaurant-map | ✅ Shipped | .claude/specs/07-restaurant-map.md |
| 08 | homemade-map | ✅ Shipped | .claude/specs/08-homemade-map.md |
| 09 | pickup-requests | ✅ Shipped | .claude/specs/09-pickup-requests.md |
| 10 | seller-request-inbox | ✅ Shipped | .claude/specs/10-seller-request-inbox.md |
| 10b | requests-tab-and-answers | ⬜ Not started | — |
| 11 | table-requests | ⬜ Not started | — |
| 12 | notifications | ⬜ Not started | — |
| 13 | food-log-uploads | ⬜ Not started | — |
| 14 | activity-grid | ⬜ Not started | — |
| 15 | activity-grid-cuisine-view | ⬜ Not started | — |
| 16 | promotions | ⬜ Not started | — |
| 17 | reports | ⬜ Not started | — |
| 18 | legal-pages | ⬜ Not started | — |

Status values: ⬜ Not started · 📝 Spec written · 🚧 In progress · ✅ Shipped

Roadmap notes (full detail in `docs/product/v1.md` §4 and §14):
- **10b requests-tab-and-answers:** Requests tab (customers: sent requests; business owners: Received / Sent switches), badges, required decline reason and optional accept note, maps hidden in seller mode.
- **11 table-requests:** its requests also appear in the Requests tab, in both Received and Sent.
- **16 promotions:** adds a dedicated Offers tab for customers (seller mode off): active promotion campaigns near the user, filterable by promotion category (for example new food launch, offer), clear Sponsored label, paginated list (server limit plus cursor), in addition to the larger promoted flags on the map. Sellers create campaigns from Manage.
- **Final tab bar plan:** seller mode off shows Restaurants, Homemade, Offers, Requests, Profile; seller mode on shows Requests, Manage, Profile.

---

## Warnings and things to avoid

- **Never push to `main` directly** — always a feature branch + PR (a hook blocks this).
- **Never `git add .` or `git add -A`** — stage files by name; a hook blocks the bulk forms.
- **Never edit or read `.env`** — use `.env.example` for documentation (hooks + permissions block it).
- **Never edit an existing migration** — create a new one (a hook blocks edits to existing migration files).
- **Never run `supabase db reset --linked` or `supabase db push`** from a session — remote DB changes go through CI/release.
- **Never edit `src/types/database.ts` by hand** — regenerate it.
- **Never show a pending request as confirmed** anywhere in the UI.
- **Never show a homemade seller's exact address** before an accepted request.
- **Never build out-of-scope v1 items** listed in `docs/product/v1.md` §3.
