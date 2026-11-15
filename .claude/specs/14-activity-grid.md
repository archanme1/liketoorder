# Spec 14: Activity Grid

**Branch:** `feature/activity-grid`. Two PRs from this one spec, the same pattern as specs 09 to 13 (Decision 9):
- PR 1, the backend (migration, pgTAP, types, skills and docs): `feature/activity-grid-backend`. This branch, renamed before its first push.
- PR 2, the app (feature code, route, Profile, seed script, jest tests, Simulator run): `feature/activity-grid-app`, created from `main` after PR 1 is merged.

**Product spec:** `docs/product/v1.md`
- section 2: the activity grid with 2 views is in v1
- section 3: out of scope (feed, follows, order activity grids)
- section 11: Profile; Food log uploads; Activity grid, its two views and the shared rules
- section 14, row 14: build the grid component generically
- section 16: the food-log date item (spec 13 Decision 24), "Showing food-log photos to other people", "Request lists are paginated; others are bounded", the test-client note, the image disk cache

**Plan mode:** required. New security-definer functions with a migration and pgTAP, a change to the Profile screen, a new route and a new feature folder, and well over 5 files.

**Status:** Spec written

## Overview
After this ships, any signed-in person with a finished profile, customer or seller, sees their own **activity grid** at the top of Profile:
- Each square is one day, shaded by how many food photos they logged that day: none, 1, 2 to 3, or 4 or more.
- Above the grid are four stats: total this year, current streak, longest streak and cuisines tried.
- Tapping a day opens the **day panel**. It lists that day's uploads (thumbnail, cuisine, a one-line description), or says "Nothing logged on <date>." Each upload opens its existing detail page.
- The grid shows the last 17 weeks (about 4 months). "View full year" shows the last 53 weeks.
- A list view and Previous / Next day buttons give the same actions through large controls.

A day is the stored `local_date`: the author's local day at upload, set by the server in spec 13. It is never derived from `created_at`.

The server works out every count, every streak and "today". The phone sends only its time-zone name, never a date or a time, so the phone clock never decides anything.

Private uploads count on the owner's own grid. Nobody else can see anyone's grid in v1, because there is no route to another person's profile.

The grid component is generic: data and labels are passed in (roadmap row 14). Spec 15's cuisine view and any later grid can reuse it.

**Why now:** spec 13 shipped uploads with `local_date`, `cuisine_code` and `is_public`. Its index `food_logs_author_date_idx (author_id, local_date) where status = 'ready'` was built for this grid.

## Depends on
- 02 auth-and-profiles, shipped (`profiles`, the profile-complete guard)
- 04 cuisine-catalog, shipped (`CuisineLabel`, `CuisineGlyph`, the display rule)
- 13 food-log-uploads, shipped (`food_logs`, `local_date`, `list_my_food_logs`, the detail route `/food-log/[id]`, signed URLs, `phoneTimeZone()`)

## Context to load
- `CLAUDE.md`
- `docs/product/v1.md` sections 3, 11 and 16 (the food-log items)
- This spec
- Spec 13's Database changes and Decisions 4 and 24 (`.claude/specs/13-food-log-uploads.md`)
- `.claude/skills/supabase-patterns/SKILL.md` ("Activity grid query", the pgTAP skeleton)
- `.claude/skills/liketoorder-ui/SKILL.md` ("Activity grid visuals", "Screen states")

**PR 1:**
- `supabase/migrations/20261115040811_food_log_uploads.sql`:
  - the table and indexes, about L17-39;
  - `begin_food_log_upload`, L111-193 (zone check about L177-180, `local_date` about L188);
  - `get_food_log`, L297-316;
  - `list_my_food_logs`, L320-370 (the log object, behaviour with no user id).
- `supabase/tests/13-food-log-uploads.test.sql`: helpers about L21-29, fixtures about L222-231, zone tests about L457-512.
- `supabase/tests/05-seller-onboarding.test.sql`: the function allowlist, about L167-217.
- `supabase/tests/00_rls_enabled.test.sql`

**PR 2:**
- `src/features/food-log/`: `api.ts`, `schema.ts`, `date.ts`, `shared.ts`, `messages.ts`, `uploadFoodLog.ts` (`phoneTimeZone`)
- `src/features/food-log/hooks/`: `keys.ts`, `useMyFoodLogs.ts`, `useFoodLogMutations.ts`
- `src/features/food-log/components/`: `FoodLogRow.tsx` and `FoodLogListScreen.tsx` (row label, the 4 states, the refresh pattern)
- `src/features/food-log/__fixtures__/foodLog.ts` (`testClientOptions`)
- `src/features/cuisines/components/CuisineLabel.tsx`
- `src/features/profile/components/ProfileScreen.tsx`
- `src/components/ui/index.ts`
- `src/theme/tokens.ts` (`grid0` to `grid3`, `size.touch`, `stroke.selected`)
- `src/lib/appFocus.ts`
- `app/food-log/_layout.tsx`, `app/_layout.tsx`
- `jest.setup.ts` (the `getCalendars` fake)
- `scripts/seed/requests.ts` (header and account handling only), `scripts/seed/safety.ts`, `scripts/seed/__tests__/requestsData.test.ts` (pattern only)

## User stories
- As a signed-in person (customer or seller), I see at the top of my Profile a grid of my last 17 weeks, one square per day, shaded by how many food photos I logged, so I can see my habit at a glance.
- As that person, I see my total this year, current streak, longest streak and number of cuisines tried.
- As that person, I tap a day and see that day's uploads (thumbnail, cuisine, one-line description), or "Nothing logged on <date>.", and I can open any upload's detail page.
- As that person, I can open "View full year" and see the last 53 weeks.
- As that person, my private uploads count on my own grid and in my stats.
- As a person who uploads late at night or travels, each upload stays on the local day it was made, whatever my phone's clock says now.
- As a screen-reader user:
  - every square speaks its date and count ("Nov 12, 3 uploads");
  - the stats are text;
  - a list view shows the days that have uploads;
  - the cuisine name is spoken and the flag is not.
- As a user who needs large targets, every action on the grid is also reachable through 44 pt controls.
- As an outsider, I can't see another person's grid, counts, stats or day list, public or private. As a guest, I see none of it.

## Screens & routes
Access for every screen below: signed-in with a finished profile (the existing root guard).

### `ProfileScreen` (change)
An `ActivitySection` sits between `ProfileHeader` and "Edit profile" (Decision 6). From top to bottom it holds:
- the stats row;
- the 17-week grid, opened at the current week;
- the legend "Less", four sample squares, "More". The squares are hidden from screen readers; the legend speaks "Fewer to more uploads";
- the buttons "View full year" and "Show as list" (or "Show as grid" while the list is shown);
- the day panel, inline, once a day is chosen (Decision 3).

Profile gains pull-to-refresh, which refetches the activity. The 4 states apply to the section only, so the rest of Profile always renders.

### `app/food-log/year.tsx` (new)
A thin route that renders `ActivityYearScreen`, a stack screen titled "Your year" under the existing `app/food-log/` layout. It is pushed, not a modal (Decision 6). It holds:
- the 53-week grid, scrolling sideways and opening at the current week;
- the same stats, legend and list toggle;
- the same day panel.

### Day panel (a component, not a route)
- A header with the date and the buttons "Previous day" and "Next day". Both are 44 pt and limited to the grid's range: disabled at its first and last day, with the state as words.
- That day's uploads, oldest first. Each row has:
  - a 48 pt thumbnail;
  - `CuisineLabel` (name visible, flag hidden from screen readers);
  - the one-line trimmed description;
  - "Private" as a word on private uploads.
- Each row is 44 pt or taller; a tap opens `/food-log/[id]`.
- No time is shown (Decision 12).
- An empty day says "Nothing logged on <date>." (the date by `formatLocalDate`).
- The panel has its own 4 states.

### List view
"Show as list" swaps the grid for the range's days that have uploads, newest first.
- Each row reads "Nov 12, 3 uploads" and is 44 pt or taller.
- A tap selects that day and opens the panel.
- This is the text and large-target alternative to the grid (Decision 11).
- The list is bounded by the range (at most 371 rows), so it does not page.

### The 4 states
These apply to the activity section, the year screen and the day panel:
- **Loading:** `Skeleton`.
- **Empty** (a new user with no uploads in the range and no stats): zero stats, the empty grid so its shape is visible, the line "Your food photos will fill this grid. Add your first one." and an **Add photo** button that goes to `/food-log/new` (Decision 5).
- **Error:** `ErrorState` with Retry.
- **Success.**

A failed background refresh keeps the grid on screen and shows a small `Banner`.

## Database changes
One migration, `npx supabase migration new activity_grid`. The SQL is ASCII-only.

There is no new table, no new column, no change to `food_logs` and no change to any spec 13 function (Decision 7).

### Functions
Both functions follow spec 13's rules:
- `security definer`, `stable`, `set search_path = ''`;
- `revoke execute ... from public, anon, authenticated`, then `grant execute ... to authenticated`;
- added to the 05 allowlist (approved edit, Decision 14);
- the user is always `auth.uid()`, and neither function takes a user id;
- the cheap input checks run first; the zone check, which reads `pg_timezone_names`, runs after them;
- `is distinct from` / `is not distinct from` in every check where a value can be null.

#### `get_my_food_log_activity(p_time_zone text, p_weeks integer) returns jsonb`
Steps:
1. `p_weeks` null or outside 1..53: raise `invalid_input`.
2. `p_time_zone` null or not in `pg_catalog.pg_timezone_names`: raise `invalid_time_zone`. This reads the time-zone list on every call; that cost is accepted (Decision 7).
3. `v_today := (now() at time zone p_time_zone)::date`.
4. `v_from := v_today - extract(dow from v_today)::int - 7 * (p_weeks - 1)`. Weeks run Sunday to Saturday, so the range is at most 371 days.
5. `days`: the caller's `ready` rows with `local_date between v_from and v_today`, grouped by `local_date`, as `[{ "date": "YYYY-MM-DD", "count": n }]`. Only days with a count of 1 or more, in ascending date order.
6. `stats`. All of them count the caller's `ready` rows with `local_date <= v_today`, private ones included (Decision 4):
   - `total_this_year`: rows with `local_date >= make_date(extract(year from v_today)::int, 1, 1)`. Not `date_trunc`: on a `date` it goes through `timestamptz` in the session time zone, while `make_date` is pure date arithmetic. pgTAP pins it (rows on Dec 31 and Jan 1, the same call under two session time zones, and a source check).
   - `current_streak`: the run of consecutive dates with an upload that ends at `v_today`, or at `v_today - 1` when today has none yet. Otherwise 0.
   - `longest_streak`: the longest run of consecutive dates ever (gaps and islands over the distinct dates).
   - `cuisines_tried`: the number of distinct `cuisine_code` values, every code counting, the neutral ones (Street food, Fusion, Other) included.
7. Return `{ "today", "from", "days", "stats": { "total_this_year", "current_streak", "longest_streak", "cuisines_tried" } }`.

A caller with no user id gets the same shape, with `days: []` and every stat 0. Every key set is fixed and pinned by pgTAP.

The streaks scan the caller's distinct dates through `food_logs_author_date_idx`. That is at most one row per day of the account's life, so the scan stays bounded.

#### `list_my_food_logs_on(p_date date) returns jsonb`
- `p_date` null: raise `invalid_input`.
- Returns `{ "items": [...] }`: the caller's `ready` rows with `local_date = p_date`, ordered `created_at asc, id asc`.
- Each item is spec 13's **8-key log object**: `id, cuisine_code, description, is_public, local_date, created_at, path, is_mine`. `path` is always the caller's own.
- A caller with no user id gets `{ "items": [] }`.
- **Bounded, no cursor (Decision 13):** `limit 60`, with this SQL comment beside the limit:
  > A local_date is within the UTC date +/-1 of created_at (food_logs_local_date_near), so one date's uploads all started within 72 hours, and begin_food_log_upload allows 20 starts per rolling 24 hours: at most 60. If that cap or that check changes, change this limit.

  A pgTAP test pins it: 60 ready rows on one date are all returned.
- The log object is now built inline in a fifth place. A key-set test pins it.

### RLS and grants
- No new table and no new grant.
- `food_logs` keeps RLS on, with no policies and no client grants (spec 13).
- The two functions are the only new surface.
- A grid for another person does not exist in v1. If a later spec adds one, it gets its own function and counts `is_public` rows only (the supabase-patterns note).

There are no status transitions in this spec.

## Storage
Nothing new. Day-panel thumbnails are the owner's own `food-logs/<uid>/...` files, loaded through the existing `useSignedUrls` (1 hour) under the existing owner-folder select policy. Nobody else's file is ever signed.

## Edge Functions
None.

## Components & hooks
### `src/features/activity-grid/` (new)
This folder is generic. It never imports `food-log` or `cuisines`, and an isolation test checks that.
- `grid.ts` (pure):
  - `buildWeeks(from, today)`: columns of 7 date strings, Sunday to Saturday; the days after today are padding.
  - `intensityLevel(count)`: 0 gives 0, 1 gives 1, 2 to 3 give 2, 4 or more give 3.
  - `monthLabels(weeks)`.
- `components/ActivityGrid.tsx`:
  - Props: `weeks`; `cells` (a record from date to `{ level: 0 | 1 | 2 | 3, label: string }`); `today`; `selectedDate`; `onSelectDate`; `summaryLabel`; `legendLabels`.
  - Squares are 14 pt with a 3 pt gap and radius 3 (Decision 11). Their colours are the tokens `grid0` to `grid3`.
  - Empty squares (level 0) get a thin outline in the new `gridOutline` token (Decision 2).
  - Today is outlined, and the selected day has a 2 pt `text` border.
  - Each cell is a `Pressable` with role `button`, the label passed in and `accessibilityState.selected`.
  - The grid opens scrolled to the end with no animation.
  - It knows nothing about uploads.
- `components/ActivityStats.tsx`: a row of `{ label, value }` items as text. Each item is one accessible element ("Current streak, 4 days").
- `components/ActivityDayList.tsx`: the list view, rows of `{ date, label }`, each 44 pt or taller.

### `src/lib/localDate.ts` (new)
Pure functions on date-only strings. They never build a `Date` in the phone's zone.
- `addDays`, `dayOfWeek`, `compareDates`.
- `formatShortDate("2026-11-12")` gives "Nov 12".
- `formatLocalDate` stays where it is, in `food-log/date.ts`, unchanged.

### `src/features/food-log/` (additions)
- `api.ts`: `getMyFoodLogActivity(timeZone, weeks)` and `listMyFoodLogsOn(date)`, parsed by the strict zod schemas `foodLogActivitySchema` and `foodLogDaySchema` in `schema.ts`. No new error codes: `invalid_input` and `invalid_time_zone` exist already.
- `hooks/keys.ts`: `foodLogActivityKey(weeks) = ['food-log', 'activity', weeks]` and `foodLogDayKey(date) = ['food-log', 'day', date]`.
- `hooks/useFoodLogActivity.ts`:
  - sends the zone from `phoneTimeZone()`;
  - `staleTime` is 60 s, with no polling (Decision 8);
  - it refetches when the app returns to the foreground (`appFocus`) and on pull-to-refresh.
- `hooks/useFoodLogDay.ts`.
- `hooks/useFoodLogMutations.ts` (change): create, update and delete also invalidate the prefixes `['food-log', 'activity']` and `['food-log', 'day']`.
- `components/ActivitySection.tsx`:
  - builds the grid input from the server data: the levels, and labels such as "Nov 12, 3 uploads", "Nov 12, 1 upload", "Nov 12, no uploads", with ", today" added to today;
  - the summary label "Activity, last 17 weeks, 23 uploads";
  - the stats labels;
  - it composes `ActivityStats`, `ActivityGrid`, `ActivityDayList` and `DayPanel`.
- `components/ActivityYearScreen.tsx`
- `components/DayPanel.tsx` and `components/DayPanelRow.tsx`. The row's label is "Food photo, <cuisine name>. <one-line description or 'No description'>. Private", with "Private" only when the upload is private. The row's children are hidden from screen readers, as in `FoodLogRow`.

### Profile (change)
`ProfileScreen` renders `ActivitySection` and a `RefreshControl`.

### Seed script (PR 2, Decision 10)
This follows the `scripts/seed/` pattern of specs 09 to 11b. It is not `supabase/seed.sql`.
- `scripts/seed/foodLogsData.ts` (pure): `planFoodLogs(now, timeZone)`. It plans about 6 months of uneven uploads:
  - streaks, gaps, days with 4 or more uploads, mixed-cuisine days and some private uploads;
  - a run ending yesterday, so the current streak shows;
  - every `local_date` computed in the given zone, and every `created_at` inside the table's UTC date +/-1 check and never after `now`;
  - at most 6 uploads on any date.
- `scripts/seed/foodLogs.ts`:
  - local only (`assertLocalUrl` from `safety.ts`), with the key read from `SEED_SERVICE_ROLE_KEY` and never printed;
  - it deletes and re-creates only `seed-foodlog@example.com` (username `seed_foodlog`, with uploads) and `seed-foodlog-empty@example.com` (username `seed_foodlog_empty`, none), checked with `isSeedEmail`; password `password123` as in the other seeds;
  - the zone defaults to the Mac's (`Intl`), or is given with `--tz <IANA name>`;
  - the rows are `ready` with no stored file, so thumbnails show the placeholder;
  - never run by CI.
- `scripts/seed/__tests__/foodLogsData.test.ts`.

Seeded rows belong only to `seed-*` accounts. pgTAP uses its own fixed-id users, counts only their rows and rolls back, and both functions read only `auth.uid()`'s rows, so seeded rows cannot change any pgTAP count.

## Files to create
- `supabase/migrations/<timestamp>_activity_grid.sql`
- `supabase/tests/14-activity-grid.test.sql`
- `src/features/activity-grid/`: `grid.ts`, `components/ActivityGrid.tsx`, `components/ActivityStats.tsx`, `components/ActivityDayList.tsx`, `__tests__/*`
- `src/lib/localDate.ts`, `src/lib/__tests__/localDate.test.ts`
- `src/features/food-log/components/`: `ActivitySection.tsx`, `ActivityYearScreen.tsx`, `DayPanel.tsx`, `DayPanelRow.tsx`
- `src/features/food-log/hooks/`: `useFoodLogActivity.ts`, `useFoodLogDay.ts`
- New tests in `src/features/food-log/__tests__/`
- `app/food-log/year.tsx`
- `scripts/seed/foodLogs.ts`, `scripts/seed/foodLogsData.ts`, `scripts/seed/__tests__/foodLogsData.test.ts`

## Files to change
- `supabase/tests/05-seller-onboarding.test.sql`: the two functions join the authenticated allowlist (approved edit, Decision 14).
- `src/types/database.ts`: regenerate with `npm run db:types`.
- `src/features/food-log/`: `api.ts`, `schema.ts`, `hooks/keys.ts`, `hooks/useFoodLogMutations.ts`.
- `src/theme/tokens.ts`: a new `gridOutline` colour (Decision 2).
- `app/food-log/_layout.tsx`: the `year` screen titled "Your year".
- `src/features/profile/components/ProfileScreen.tsx`.
- `src/features/profile/__tests__/ProfileScreen.test.tsx` (approved edit, Decision 14): mock the activity API.
- `.claude/skills/supabase-patterns/SKILL.md` (gate C): "Activity grid query" becomes the built function (no client `p_from` date, the server's "today", the single cuisine left to spec 15).
- `.claude/skills/liketoorder-ui/SKILL.md` (gate C):
  - the 14 pt cell exception and its 44 pt alternatives (Decision 11);
  - the day-panel row with no time (Decision 12);
  - the label form "Nov 12, 3 uploads";
  - the `gridOutline` on empty squares;
  - the test rule (pure date helpers take `today`, no fake timers).
- `.claude/agents/liketoorder-test-writer.md` (gate C): drop the fake-timers and `process.env.TZ` advice for the grid. Pure helpers take `today`, and screen tests use `waitFor` (Decision 15).
- `docs/product/v1.md` (gate C):
  - section 11: the stat definitions (Decision 4) and "In v1 nobody else sees a person's grid; there is no route to another profile" (Decision 15);
  - section 16: the food-log date item reworded (Decision 7); a new contrast item for `grid1` on `grid0` and the outline (Decision 2); the real-device grid checks (Decision 10);
  - a changelog line at ship.
- Any other older test: stop and ask first (Decision 14).

## New dependencies
No new dependencies. No native rebuild.

## Rules for implementation
Always include:
- RLS on every new table, with a pgTAP test. There is no new table here; both functions get outsider tests.
- Supabase calls only in `src/features/<x>/api.ts`.
- Theme tokens only, no hardcoded colours or sizes.
- Loading, empty, error and success states on every screen.
- Accessibility labels on every touchable.

Feature-specific rules:
- **`local_date` only.** The grid, the panel, the stats and every label come from `local_date` and the server's `today`. Never from `created_at`, and never from `new Date()` on the phone. The app sends only the zone name.
- **Server aggregation, bounded.** At most 371 days per call and at most 60 rows per date. The app never loads every log in order to count.
- **Own data only.** No function takes a user id. Private uploads count for their owner.
- **SQL hygiene (spec 13):**
  - no client table grants;
  - definer functions with `search_path = ''`;
  - revoke, then grant to `authenticated`;
  - ASCII-only SQL;
  - `is distinct from` in null checks;
  - every non-ASCII test literal written as an escaped code point.
- **Generic grid.** `activity-grid` never imports `food-log` or `cuisines`. An isolation test, like `mediaIsolation`, checks this.
- **Spec 04 display rule** wherever a cuisine appears: the name is visible text and the flag is hidden from screen readers (`CuisineLabel`).
- **Not by colour alone.** Every cell has a text label, the legend speaks, and the stats and the day panel are text.
- **44 pt alternatives (Decision 11).** Grid cells are the only targets under 44 pt. Every action a cell offers is also reachable through 44 pt controls (list rows, Previous and Next day, panel rows), and a test proves it.
- **Reduce motion:** nothing animates. Scrolling to the current week is instant.
- **Byte and invisible-character checks.** Each command is first proved on a scratch file holding one such character. They run on every SQL and TS file added and on the markdown this spec changes, this spec included.
- **Deliberate-break proofs** (Test plan). SQL breaks run in scratch copies, inside the test transaction, and are never committed.
- **Tests:**
  - an own `QueryClient` per test (`testClientOptions()`: `gcTime: 0` for queries and mutations, `retry: false`);
  - `cleanup()` and `client.clear()` in `afterEach`;
  - faithful fakes: the `getCalendars` fake as it is, and RPC fakes shaped like the real JSON;
  - every RNTL v14 call awaited;
  - `waitFor`, never fake timers.
- **Stale lists:** creating a log, editing its cuisine or visibility, or deleting it invalidates the activity and the day queries, as well as the list and the detail. After a delete from a detail opened from the day panel, the panel no longer shows the row.
- **Older tests:** only the approved edits (Decision 14). Anything else: stop and ask.
- **Reviews read the SQL and never query the database** unless Archan asks.
- **Stage gates.** Stop and commit after each; no edits before "approved".
  - PR 1: **A** migration + types; **B** pgTAP, the approved 05 edit and the SQL breaks; **C** skills, the agent note and the v1 docs; then review, CI, merge.
  - PR 2: **D** feature code, route, Profile, token, seed script, plus the list of every older test that renders `ProfileScreen` (Decision 14); **E** jest tests, the approved `ProfileScreen.test.tsx` edit and the app breaks; **F** the Simulator run (Archan); then review, ship.

## Known pitfalls (checklist)
- [ ] **Late-night upload:** a log made at 23:30 local time (already the next UTC day) appears on its local day. pgTAP has a fixture whose `local_date` differs from the UTC date of its `created_at`.
- [ ] **Daylight saving:** `local_date` is a date, so 23- and 25-hour days need nothing special. `buildWeeks` and the streak are tested across a change (`America/Toronto` dates).
- [ ] **Travel:** going east or across the date line can skip a calendar day and break the streak; going west repeats a day, and both uploads land on one date. Accepted and documented; the grid shows what was stored.
- [ ] **A date after "today":** a `local_date` later than the server's today in the current zone (logged in a zone ahead, then the phone's zone moved back) is left out of the grid and the stats until that day comes. pgTAP covers it.
- [ ] **Year boundary:** on Jan 1 `total_this_year` restarts while the streak continues across the years.
- [ ] **Week start:** weeks start on Sunday whatever the phone's locale.
- [ ] **Wrong phone clock:** the grid still ends at the server's today. Jest: the server says Nov 12 while the phone clock says Nov 20.
- [ ] **Not counted:** pending uploads and deleted logs never count, and deleting can shorten a streak.
- [ ] **Seed data:** leftover seed rows must not change pgTAP counts. pgTAP uses its own fixtures and ids (`00000000-0000-0000-0014-...`) and rolls back.

## Out of scope
- The cuisine view, flags and the globe icon on the grid (spec 15). The functions return counts only.
- Anyone else's grid, visitor profiles and public-only grids (section 3; v1 has no route to another profile).
- Order activity grids on customer profiles or business pages (section 3).
- Most-frequent cuisine, badges, goals, reminders and notifications (Decision 4).
- Grid history older than the last 53 weeks.
- Changing an upload's date, and a time zone stored on the profile (Decision 7).
- Editing `supabase/seed.sql` (Decision 10).
- Everything else in v1 section 3.

## Definition of done
**PR 1 (pgTAP unless noted):**
- [ ] Signatures and grants:
  - both functions exist with these signatures, `security definer` and `search_path = ''`;
  - anon cannot execute either one;
  - the 05 allowlist holds them (approved edit).
- [ ] Input checks:
  - `p_weeks` null, 0 and 54 give `invalid_input`; 1 and 53 work;
  - a null, empty or `Mars/Olympus` zone gives `invalid_time_zone`;
  - `p_weeks` is checked before the zone.
- [ ] Range: `from` is a Sunday, `from <= today`, and the range holds `7 * p_weeks - (6 - dow(today))` days.
- [ ] `days`:
  - counts by `local_date`, not `created_at` (the late-night fixture);
  - counts `ready` rows only (a pending row is not counted);
  - counts private and public alike;
  - leaves out days with no uploads;
  - is in ascending order;
  - holds nothing before `from` or after today.
- [ ] `today` follows the zone: `Pacific/Kiritimati` and `Pacific/Pago_Pago` give different values at one instant.
- [ ] Stats:
  - `total_this_year` counts only this calendar year and nothing after today;
  - current streak: today logged gives a run that includes today; today not logged but yesterday logged gives the run ending yesterday; neither gives 0; one missed day resets it;
  - the longest streak is right across a gap and across a year boundary;
  - a run made only of private uploads counts;
  - `cuisines_tried` counts repeats once and counts neutral codes;
  - a log dated after today counts in no stat.
- [ ] `list_my_food_logs_on`:
  - returns the date's `ready` rows oldest first, each with exactly the 8 keys;
  - rows of other dates and pending rows are absent;
  - a null date gives `invalid_input`;
  - an empty date gives `{ items: [] }`;
  - **60 ready rows on one date are all returned** (the pinned limit, Decision 13);
  - the migration carries the limit comment.
- [ ] Exact key sets for the activity object, a `days` item, `stats` and the day object.
- [ ] **An outsider cannot** see another person's uploads, public or private, through either function:
  - user B's activity, stats and day list hold none of user A's rows;
  - A's public log on a date gives B an empty list for that date;
  - anon executes neither function;
  - a call with no user id gets empty data, never someone else's.
- [ ] Every older pgTAP file passes unedited except the approved 05 edit.
- [ ] `npx supabase db reset`, `npx supabase test db` and `npm run typecheck` pass. `src/types/database.ts` is regenerated, not hand-edited.

**PR 2 (jest unless noted):**
- [ ] `grid.ts` and `localDate.ts`:
  - the intensity buckets 0, 1, 2 to 3, 4 or more;
  - `buildWeeks` for each weekday of today, across a month end, a year end and a DST change;
  - the month labels;
  - `formatShortDate`.
- [ ] `ActivityGrid`:
  - every cell has its passed label, role `button` and selected state;
  - today and the selected day are said in the label, not only shown by a border;
  - the legend and the summary are spoken;
  - empty squares use `gridOutline`.
- [ ] `ActivitySection`:
  - the 4 states;
  - the zone sent is the phone's (the `getCalendars` fake) and no date is sent;
  - the grid ends at the server's today even when the phone clock is days off;
  - the stats are text;
  - tapping a day opens the panel;
  - Previous and Next day stay inside the range;
  - "Show as list" lists only the days with uploads;
  - "View full year" goes to `/food-log/year`;
  - a failed refresh keeps the grid and shows a banner;
  - the empty state's Add photo goes to `/food-log/new`.
- [ ] **44 pt alternatives (Decision 11):**
  - a test reaches each grid action without pressing a cell: choose a day from the list view, move with Previous and Next day, open an upload from a panel row;
  - each of those controls has a minimum height and width of at least `size.touch` (44).
- [ ] `DayPanel`:
  - the 4 states and "Nothing logged on <date>.";
  - rows show `CuisineLabel` with the flag hidden from screen readers, the trimmed description and "Private" as a word;
  - no time is shown;
  - a tap opens `/food-log/[id]`.
- [ ] Create, update and delete invalidate the activity and the day queries (stale-list test).
- [ ] The `activity-grid` folder imports nothing from `food-log` or `cuisines` (isolation test).
- [ ] `foodLogsData`:
  - plans streaks, gaps, a day with 4 or more uploads, private rows and a run ending yesterday;
  - every `created_at` is within the UTC date +/-1 of its `local_date` and not after `now`;
  - no date has more than 6 rows;
  - only `seed-*@example.com` accounts are used.
- [ ] Profile shows the section (approved `ProfileScreen.test.tsx` edit). Every other older test that renders `ProfileScreen` passes unedited.
- [ ] `npm run lint`, `npm run typecheck` and `npm test` pass. Older tests pass unedited except the approved list.
- [ ] The byte and invisible-character checks pass, each proved on a scratch file first.
- [ ] The Simulator run passed (Archan, Decision 10), including Archan's judgement of the four shades and the outline.

## Test plan
- **Database tests (pgTAP)** in `supabase/tests/14-activity-grid.test.sql`:
  - everything under PR 1 above;
  - fixtures with fixed ids `00000000-0000-0000-0014-...` (an owner, a second user, an outsider), plus anon;
  - `food_logs` rows inserted as the superuser with chosen `created_at` and `local_date` that satisfy the UTC +/-1 check. No sleeps: dates are set relative to `now()` in a fixed zone;
  - `pg_temp.as_user` impersonation as in spec 13;
  - `begin; ... rollback;`.
- **Unit and component tests (jest):**
  - `src/features/activity-grid/__tests__/`: `grid.test.ts`, `ActivityGrid.test.tsx`, `ActivityStats.test.tsx`, `activityGridIsolation.test.ts`;
  - `src/lib/__tests__/localDate.test.ts`;
  - `src/features/food-log/__tests__/`: `activityApi.test.ts`, `useFoodLogActivity.test.tsx`, `ActivitySection.test.tsx`, `ActivityTargets.test.tsx` (Decision 11), `DayPanel.test.tsx`, `ActivityYearScreen.test.tsx`, `activityInvalidation.test.tsx`;
  - `scripts/seed/__tests__/foodLogsData.test.ts`;
  - the approved `ProfileScreen.test.tsx` edit.
- **Deliberate breaks.** Each one turns a named test red and is then reverted:
  1. SQL: group by `(created_at at time zone 'UTC')::date` instead of `local_date`. The late-night test fails.
  2. SQL: drop the `author_id` filter in `get_my_food_log_activity`. The outsider activity test fails.
  3. SQL: drop `status = 'ready'`. The pending test fails.
  4. SQL: remove the "ending yesterday" rule from the current streak. The yesterday-streak test fails.
  5. SQL: drop `local_date <= today`. The future-date test fails.
  6. SQL: drop the `author_id` filter in `list_my_food_logs_on`. The outsider day test fails.
  7. SQL: change the day limit to 59. The 60-row test fails.
  8. App: build the grid's end from `new Date()` instead of the server's today. The wrong-clock test fails.
  9. App: skip the activity invalidation after delete. The stale-grid test fails.
  10. App: render the flag in a day-panel row without hiding it from screen readers. The display-rule test fails.
  11. App: make the Next day button 32 pt. The 44 pt test fails.
- **Manual check, iOS Simulator (Archan, Decision 10).** After a local reset:
  ```
  npx supabase db reset
  SEED_SERVICE_ROLE_KEY=<local service key> npx tsx scripts/seed/restaurants.ts   # optional; it deletes every seed-* account, so run it first if at all
  SEED_SERVICE_ROLE_KEY=<local service key> npx tsx scripts/seed/foodLogs.ts
  npx expo start --dev-client
  ```
  The local service key is printed by `npx supabase status` (run by Archan). Sign in as `seed-foodlog@example.com` / `password123`. Check:
  - the 17-week grid and stats;
  - the four shades and the empty-square outline (Archan judges the contrast);
  - the day panel, with Previous and Next;
  - the list view;
  - the year screen;
  - a detail opened from the panel; deleting it updates the grid;
  - `seed-foodlog-empty@example.com` for the empty state and Add photo;
  - changing the Mac's time zone and relaunching: today moves and uploads keep their days;
  - the largest text size;
  - VoiceOver where the Simulator allows it.
- **Real device, before launch (section 16):**
  - VoiceOver and TalkBack across the grid (swipe order, sideways scroll, about 119 or 371 cells);
  - touch accuracy on 14 pt squares;
  - Android at font scale 2.0;
  - Hermes `Intl` short dates;
  - speed on an older Android phone.

## Decisions
All approved by Archan on 2026-11-15.

1. **Range:** the last 17 weeks on Profile, and the last 53 weeks (a rolling year) in "View full year". Weeks run Sunday to Saturday whatever the locale, with month labels above. "Total this year" stays the calendar year, as v1 section 11 says.
2. **Colours and intensity:**
   - Intensity is by **count** only: 0 is `grid0`, 1 is `grid1`, 2 to 3 is `grid2`, 4 or more is `grid3` (v1 section 11). Cuisine appears only in spec 15's view.
   - Today is outlined, and the selected day has a 2 pt `text` border. The legend reads "Less ... More".
   - **Changed (mismatch 9):** empty squares get a thin outline in a new token `gridOutline`. The low contrast of `grid1` on `grid0` (about 1.2:1) is noted in v1 section 16.
   - Archan judges the four shades in the Simulator run.
3. **Tapping a day:** an inline day panel under the grid on the same screen, not a bottom sheet. It has Previous and Next day buttons, and rows open the existing `/food-log/[id]`. Back from the detail returns with the same day still selected, kept in screen state.
4. **Stats:** the four in v1 section 11, and no "most frequent cuisine". All count by `local_date`, `ready` uploads only, private included, nothing after the server's today.
   - **Total this year:** uploads dated in today's calendar year.
   - **Current streak:** consecutive days with at least one upload, ending today, or ending yesterday when today has none yet. One missed day resets it to 0, and deleting an upload can shorten it.
   - **Longest streak:** the longest such run ever.
   - **Cuisines tried:** distinct cuisine codes ever logged, the neutral ones (Street food, Fusion, Other) included.
5. **Empty state:** zero stats, the empty grid (its shape stays visible), "Your food photos will fill this grid. Add your first one." and an Add photo button that goes to `/food-log/new`.
6. **Where it lives:** at the top of Profile, under the header. "View full year" is its own pushed stack screen, `app/food-log/year.tsx`, titled "Your year".
7. **Time zone (spec 13 review S2): option B.** Accept the one-day limit for now. No profile time-zone column, and no change to `begin_food_log_upload` or to spec 13's tests.
   - The activity function takes the zone per call, as begin does. Changing the phone's zone can shift "today" by at most a day, on one's own screen only.
   - At gate C, v1 section 16's food-log date item is reworded to "revisit when grids or streaks are shown to other people".
   - The activity function reads `pg_timezone_names` on every call (a read of the whole zone list). Accepted.
8. **Caching:** no polling. `staleTime` 60 s, a refetch when the app returns to the foreground (`appFocus`, which also covers midnight passing while the app is open) and on pull-to-refresh, and invalidation after create, update and delete.
9. **Two PRs:**
   - PR 1, the backend: gates A to C, then review, CI, merge.
   - PR 2, the app: gates D to F, then review, ship.
   - No native rebuild.
10. **Simulator and device; seed (changed):**
    - The Simulator covers every screen and state, seeded data, a zone change through the Mac's zone, the largest text size and basic VoiceOver.
    - A real device is needed for touch accuracy, VoiceOver and TalkBack across many cells, Android and Hermes `Intl`. Those go to v1 section 16 before launch.
    - **`supabase/seed.sql` is not edited.** Demo data follows the `scripts/seed/` pattern of specs 09 to 11b: a pure, tested `foodLogsData.ts` and a local-only `foodLogs.ts` that re-creates only its own `seed-*` accounts. Seeded rows cannot change pgTAP counts.
    - The Simulator checklist gives the exact commands after a db reset.
11. **Small squares (changed):** grid cells are 14 pt with a 3 pt gap. This is a **documented exception to the CLAUDE.md 44 pt rule, for grid cells only**, written into the `liketoorder-ui` skill at gate C.
    - Every action a cell gives is also reachable through 44 pt controls: the list view rows, Previous and Next day, and the day panel rows.
    - A jest test proves this without pressing any cell, and checks the minimum sizes.
    - The grid also has a summary label.
12. **No time in the day-panel row:** v1 section 11 lists the thumbnail, flag and description only. A time taken from `created_at` in the phone's zone can contradict the local date after travel. The skill is fixed at gate C.
13. **Day list limit (added):** `list_my_food_logs_on` returns at most 60 rows, with no cursor. The SQL comment beside the limit says it depends on the 20-starts-per-24-hours cap and on the UTC +/-1 table check. A pgTAP test pins 60 rows, and break 7 proves the test.
14. **Older tests (added):** the only approved edits are `05-seller-onboarding.test.sql` (the allowlist) and `ProfileScreen.test.tsx`. At gate D, list every older test that renders `ProfileScreen`. If any of them other than `ProfileScreen.test.tsx` breaks, or any other older test needs a change, stop and ask.
15. **Mismatch fixes:**
    - Mismatches 1 to 4 and 8 are fixed at gate C, in the two skills and the test-writer agent note.
    - Mismatch 5 and the stat definitions (Decision 4) go into v1 section 11 at gate C.
    - Mismatch 6 is settled by Decision 1, mismatch 9 by Decision 2 and mismatch 10 by `src/lib/localDate.ts`.
    - Mismatch 7 is left as is (cosmetic).

### Mismatches between the product spec, the skills and the code (found while writing this spec)
1. **44 pt targets:** `liketoorder-ui` gives grid squares of 12 to 14 pt with role `button`, while CLAUDE.md requires touch targets of at least 44 pt. 17 weeks of 44 pt squares do not fit a phone. Settled by Decision 11.
2. **A time in the panel row:** the skill's day-panel row shows a time, while v1 section 11 does not. Settled by Decision 12.
3. **The skill's grid query:** `supabase-patterns` "Activity grid query" sketches `activity_grid(p_from date)`, with a date sent by the client, and returns `single_cuisine`. That breaks "the phone clock never decides", and the single cuisine belongs to spec 15.
4. **Label punctuation:** v1 gives the cell label with an en dash (U+2013), "Oct 12 - 3 uploads"; the skill gives "Oct 12, 3 uploads". This spec uses the comma.
5. **"Visitors don't see them":** v1 section 11 says visitors don't see private uploads, but there is no visitor route. Nobody else can open a person's profile in the app (spec 13, mismatch 3). In v1 nobody else sees a grid at all.
6. **"Total this year" against "View full year":** the stat is the calendar year, while the full-year view is the last 53 weeks.
7. **The grid index in spec 13's text:** the text shows `food_logs_author_date_idx` without `where status = 'ready'`; the migration has it. The migration is right, and both functions filter on `ready`, so they use the index.
8. **Fake timers:** `liketoorder-test-writer` suggests fake timers and `process.env.TZ` for grid tests. Archan's rule is `waitFor`, not timers; the pure helpers take `today` as an argument instead.
9. **Contrast:** `grid1` on `grid0` is about 1.2:1, below the 3:1 non-text contrast guideline. Meaning never relies on colour alone. Settled by Decision 2.
10. **`src/lib` has no date helpers**, although CLAUDE.md says it holds date utils; `formatLocalDate` lives in `food-log/date.ts`. This spec adds `src/lib/localDate.ts` and leaves `formatLocalDate` where it is.

## Open questions
None. All were resolved on 2026-11-15; see Decisions.
