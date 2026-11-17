# Spec 15: Activity Grid Cuisine View

**Branch:** `feature/activity-grid-cuisine-view-backend`. Two PRs from this one spec, the same pattern as specs 12 to 14 (Decision 8):
- PR 1, the backend (migration, pgTAP, types, skills and docs): `feature/activity-grid-cuisine-view-backend`. This branch, created with its final name.
- PR 2, the app (feature code, jest tests, Simulator run): `feature/activity-grid-cuisine-view-app`, created from `main` after PR 1 is merged.

**Product spec:** `docs/product/v1.md`
- section 2: the activity grid with 2 views is in v1
- section 3: out of scope
- section 11: the Activity grid, its two views (the Cuisine view) and the shared rules
- section 14, row 15: "Flag/globe view toggle"
- section 16: the cuisine flag and icon rendering item, the time-zone list cost item, the activity grid on real devices

**Plan mode:** required. A new security-definer function with a migration and pgTAP, a change to the generic grid component, and well over 5 files.

**Status:** PR 1 merged as #33 (cc38f85); PR 2 in progress.

## Overview
After this ships, the activity grid on Profile and on Your year has a two-way switch, **Activity | Cuisine**:
- **Activity** is the spec 14 view, unchanged, and the default.
- **Cuisine** shows, in the same squares:
  - the cuisine's flag when every upload that day has the same country cuisine;
  - the cuisine's icon when every upload that day has the same neutral cuisine (Street food, Fusion, Other);
  - **🌍** when the day has uploads of two or more different cuisines;
  - nothing when the day has no uploads.

The stats, the day panel (its rows already show each upload's cuisine), "View full year", Previous and Next day and the list view work in both views.

A day's cuisine is worked out by the server from the stored `cuisine_code` and `local_date` of the person's own finished uploads. The phone sends only its time-zone name, as in spec 14.

How it ties to what exists:
- Spec 04's `cuisines` catalog: a country row has a `flag` (emoji text); a neutral row has an Ionicons `icon` and no flag.
- Spec 13 stores one required `cuisine_code` per upload.
- Spec 14 built the grid generically (data and labels passed in; `activity-grid` never imports `food-log` or `cuisines`). The `supabase-patterns` skill already leaves the per-day cuisine to spec 15, "its own field or function".

**Why now:** it is the last missing piece of v1 section 11; specs 13 and 14 are shipped.

## Depends on
- 04 cuisine-catalog, shipped (`cuisines`, `useCuisines`, `CuisineGlyph`, the display rule)
- 13 food-log-uploads, shipped (`food_logs.cuisine_code`, `local_date`, `phoneTimeZone()`)
- 14 activity-grid, shipped (`get_my_food_log_activity`, `ActivityGrid`, `ActivitySection`, `DayPanel`, Your year, the seed script)

## Context to load
- `CLAUDE.md`
- `docs/product/v1.md` sections 3, 11 and 16 (the grid and cuisine items)
- This spec
- Spec 14 (`.claude/specs/14-activity-grid.md`): Database changes, Components & hooks, Decisions 2, 7, 11 and 14
- `.claude/skills/supabase-patterns/SKILL.md` ("Activity grid query", the pgTAP skeleton)
- `.claude/skills/liketoorder-ui/SKILL.md` ("Activity grid visuals")

**PR 1:**
- `supabase/migrations/20261115200520_activity_grid.sql` (the whole file, as the pattern)
- `supabase/migrations/20261103040302_cuisine_catalog.sql`: the table, about L6-23; the neutral rows, about L270-272
- `supabase/tests/14-activity-grid.test.sql`: helpers about L20-40, fixtures, the key-set section about L339-353
- `supabase/tests/05-seller-onboarding.test.sql`: the function allowlist, about L167-217

**PR 2:**
- `src/features/activity-grid/`: `grid.ts`, `components/ActivityGrid.tsx`, `components/ActivityDayList.tsx`, `__tests__/activityGridIsolation.test.ts`
- `src/features/food-log/`: `activity.ts`, `api.ts`, `schema.ts`, `hooks/keys.ts`, `hooks/useFoodLogActivity.ts`, `hooks/useFoodLogMutations.ts`, the activity refresh hook, `components/ActivitySection.tsx`, `components/ActivityYearScreen.tsx`, `components/DayPanelRow.tsx`, `__fixtures__/foodLog.ts`
- `src/features/cuisines/`: `components/CuisineLabel.tsx` (`CuisineGlyph`), `hooks/useCuisines.ts`, `schema.ts`
- `src/features/requests/components/RequestsSwitch.tsx` (the pattern for the switch only)
- `src/theme/tokens.ts`
- `scripts/seed/foodLogsData.ts`

## User stories
- As a signed-in person (customer or seller), I can switch my grid to Cuisine and see, day by day, which country's food I logged; mixed days show a globe.
- As that person, my private uploads count in the Cuisine view too, and nobody else sees it.
- As that person, the switch is on Profile and on Your year, and the day panel, the list view and the stats work the same in both views.
- As a screen-reader user:
  - every square speaks its date, its cuisine (or how many cuisines) and its upload count: "Nov 12, Italy, 2 uploads" or "Nov 12, 3 cuisines, 4 uploads";
  - flags, icons and the globe are never spoken;
  - the switch speaks which view is selected;
  - the legend speaks what a flag, an icon and the globe mean.
- As a user who needs large targets, the switch options are 44 pt or more, and every grid action stays reachable through spec 14's 44 pt controls in both views.
- As an outsider or a guest, I can't see anyone else's cuisine days, public or private.

## Screens & routes
No new route. Access: signed-in with a finished profile (the existing root guard).

### `ActivitySection` (change; used by Profile and Your year)
- **`ActivityViewSwitch`** sits between the stats and the grid: two options, "Activity" and "Cuisine".
  - It follows the `RequestsSwitch` pattern: `radiogroup` / `radio` roles, the selected option said as a word ("Cuisine, selected"), a check mark and bold text, never colour alone; each option at least `size.touch` (44); wraps at large text.
  - It is shown only when the section has data; the empty state stays as in spec 14.
- **Cuisine grid:** the same weeks, today outline, selected border and empty-square outline as spec 14. Each day with uploads shows a glyph centred in the cell (Decision 3).
- **Legend (Cuisine):** reads "One cuisine: its flag or icon", a separator, then the globe and "More than one". In code the separator and the globe are escapes (`'\u00B7'`, `'\u{1F30D}'`). The glyphs are hidden from screen readers; the legend is one accessible element that speaks "A flag or icon shows a day with one cuisine; a globe shows a day with more than one".
- **Summary label (Cuisine):** "Cuisines, last 17 weeks, 23 uploads".
- **List view (Cuisine):** the same rows as spec 14 (days with uploads, newest first), labelled with the cuisine form ("Nov 12, Italy, 2 uploads").
- **Range per view:** each view uses the range (`today`, `from`) of its own query. The Previous / Next day limits, the selected day and the today outline come from the query that drew the grid on screen: the activity query in Activity, the cuisine-days query in Cuisine. If the selected day falls outside the range shown after a switch (midnight passed between the two queries), the selection is cleared and the panel closes.
- **View state (Decision 5):** the view lives in `ActivitySection` state. Nothing is stored on the phone.
  - It may reset to Activity when the person leaves Profile and comes back (the section remounts); this is accepted.
  - "View full year" opens Your year in the view Profile is showing, through a `view` route param.
  - Switching views keeps the selected day and the open panel (within the range rule above).
- **The 4 states (Cuisine, grid area only):** the stats and the switch stay on screen.
  - **Loading:** `Skeleton` while the cuisine days or the cuisine catalog load.
  - **Error:** `ErrorState` with Retry when the cuisine days **or the cuisine catalog** fail to load. Retry reloads both the catalog and the cuisine days.
  - **Empty:** not reachable in Cuisine (the switch is hidden when the section is empty).
  - **Success.**
  - A failed background refresh keeps the cuisine grid on screen and shows the spec 14 `Banner`.

### `app/food-log/year.tsx` / `ActivityYearScreen`
Unchanged route. `ActivityYearScreen` reads an optional `view` param: `'cuisine'` opens on Cuisine; anything else, or none, opens on Activity.

### Day panel
Unchanged. Its rows already show `CuisineLabel` per upload.

## Database changes
One migration, `npx supabase migration new activity_grid_cuisine_view`. The SQL is ASCII-only.

No new table, column or index. No change to `get_my_food_log_activity`, `list_my_food_logs_on` or any spec 13 function (Decision 1).

### `get_my_food_log_cuisine_days(p_time_zone text, p_weeks integer) returns jsonb`
Spec 14's rules:
- `plpgsql`, `stable`, `security definer`, `set search_path = ''`;
- `revoke execute ... from public, anon, authenticated`, then `grant execute ... to authenticated`;
- added to the 05 allowlist (approved edit, Decision 9);
- the user is always `auth.uid()`; the function takes no user id;
- `is distinct from` / `is not distinct from` wherever a value can be null.

Steps:
1. `p_weeks` null or outside 1..53: raise `invalid_input`.
2. `p_time_zone` null or not in `pg_catalog.pg_timezone_names`: raise `invalid_time_zone`. Checked after the weeks.
3. `v_today := (now() at time zone p_time_zone)::date`; `v_from := v_today - extract(dow from v_today)::int - 7 * (p_weeks - 1)`, exactly as in spec 14 (Sunday-start weeks, at most 371 days).
4. `days`: the caller's `ready` rows with `local_date between v_from and v_today`, grouped by `local_date`, ascending, only days with at least one upload. Each item:
   - `date`: `YYYY-MM-DD`;
   - `count`: uploads that day;
   - `cuisines`: `count(distinct cuisine_code)`;
   - `cuisine`: the code when `cuisines = 1`, otherwise `null`. A neutral code counts like any other: Street food plus Italy on one day gives 2 cuisines and `null`.
5. Return `{ "today", "from", "days" }`. No stats; they stay in the activity function.

A caller with no user id gets `{ "today", "from", "days": [] }`. Every key set is fixed and pinned by pgTAP.

Cost: it reads only the caller's rows in the window through `food_logs_author_date_idx`, plus a heap read for `cuisine_code` (at most 371 days of at most 20 starts a day). It reads `pg_timezone_names` once per call, like the activity function, and the app calls it only while the Cuisine view is on screen. The v1 section 16 zone-list item gains this function at gate C.

### RLS and grants
- No new table and no new grant beyond the function.
- `food_logs` keeps RLS on, with no policies and no client grants (spec 13).
- The function is the only new surface. A grid for another person still does not exist in v1.

There are no status transitions in this spec.

## Storage
None. Nothing new is signed or read.

## Edge Functions
None.

## Components & hooks
### `src/features/activity-grid/` (generic; still imports nothing from `food-log` or `cuisines`)
- `components/ActivityGrid.tsx`:
  - `ActivityCell` gains an optional `glyph?: ReactNode`, drawn centred inside the 14 pt square and hidden from screen readers; the cell's label carries the meaning.
  - A cell with a glyph uses the `grid0` background with the `gridOutline` border; no intensity colour behind it (Decision 4).
  - An optional `legend?: ReactNode` replaces the intensity legend when given. Without `glyph` or `legend`, rendering is exactly spec 14's, so spec 14's call sites and tests stay unchanged.
- `components/ActivityDayList.tsx`: unchanged (labels are passed in).

### `src/features/food-log/` (additions)
- `schema.ts`: a strict `foodLogCuisineDaysSchema` (`today`, `from`, `days` of strict `{ date, count, cuisines, cuisine }`). `cuisines` is an integer of 1 or more; a refine requires `cuisine` to be a string exactly when `cuisines` is 1.
- `api.ts`: `getMyFoodLogCuisineDays(timeZone, weeks)`. No new error codes.
- `hooks/keys.ts`: `foodLogCuisineDaysPrefix = ['food-log', 'cuisine-days']`, `foodLogCuisineDaysKey(weeks)`.
- `hooks/useFoodLogCuisineDays.ts`: as `useFoodLogActivity` (zone from `phoneTimeZone()`, `staleTime` 60 s, no polling, refetch on foreground through `appFocus`), with `enabled` only while Cuisine is shown.
- `hooks/useFoodLogMutations.ts` (change): create, update (a cuisine edit changes the day's glyph) and delete also invalidate `['food-log', 'cuisine-days']`.
- The activity refresh hook (change): pull to refresh also refetches the cuisine days when Cuisine is on screen.
- `activity.ts` (additions):
  - `buildCuisineView(cuisineDays, catalog)`: the cells (glyph kind and label) and the list rows;
  - `cuisineCellLabel(date, day, cuisineName, isToday)`: "Nov 12, Italy, 2 uploads", "Nov 12, Italy, 1 upload", "Nov 12, 3 cuisines, 4 uploads", with ", today" added on today; days without uploads keep spec 14's "Nov 12, no uploads";
  - `CUISINE_LEGEND`, `cuisineSummaryLabel(weeks, total)`;
  - a code missing from the catalog speaks "Unknown cuisine" and draws the fallback icon.
- `components/CuisineDayGlyph.tsx`: a country flag as emoji text at `size.gridGlyph` with `allowFontScaling={false}`; a neutral cuisine's Ionicons icon at the same size; the globe `'\u{1F30D}'` written as an escape; all hidden from screen readers. The catalog comes from one `useCuisines()` in `ActivitySection`, not one hook per cell. `CuisineGlyph` is not changed (the maps use it).
- `components/ActivityViewSwitch.tsx`: as described above.
- `components/ActivitySection.tsx` (change): the view state, the per-view range, the Cuisine states, the Retry that reloads the catalog and the cuisine days, and the `view` param on "View full year".
- `components/ActivityYearScreen.tsx` (change): reads and checks the `view` param.

### Tokens
`size.gridGlyph`, about 10, so a flag emoji fits the 14 pt square. Cell sizes do not change (Decision 3).

### Seed
`scripts/seed/foodLogsData.ts` keeps its plan. At gate D, check that the planned data includes single-country days, a single-neutral day and mixed days. If a case is missing, add it with an assertion in `scripts/seed/__tests__/foodLogsData.test.ts` (approved edit only in that case, Decision 9).

## Files to create
- `supabase/migrations/<timestamp>_activity_grid_cuisine_view.sql`
- `supabase/tests/15-activity-grid-cuisine-view.test.sql`
- `src/features/food-log/hooks/useFoodLogCuisineDays.ts`
- `src/features/food-log/components/CuisineDayGlyph.tsx`, `ActivityViewSwitch.tsx`
- New tests in `src/features/food-log/__tests__/` and `src/features/activity-grid/__tests__/`

## Files to change
- `supabase/tests/05-seller-onboarding.test.sql`: the function joins the authenticated allowlist and the title says specs 05 to 15 (approved edit, Decision 9).
- `src/types/database.ts`: regenerate with `npm run db:types`.
- `src/features/activity-grid/components/ActivityGrid.tsx`
- `src/features/food-log/`: `api.ts`, `schema.ts`, `activity.ts`, `hooks/keys.ts`, `hooks/useFoodLogMutations.ts`, the activity refresh hook, `components/ActivitySection.tsx`, `components/ActivityYearScreen.tsx`, `__fixtures__/foodLog.ts` (a `cuisineDaysJson()` fixture)
- `src/theme/tokens.ts`: `size.gridGlyph`
- `.claude/skills/liketoorder-ui/SKILL.md` (gate C), "Activity grid visuals": the flag is emoji text, not an image; no intensity colour behind it; the neutral icon; the label form with the catalog name and the count; the legend text.
- `.claude/skills/supabase-patterns/SKILL.md` (gate C): the per-day cuisine is the built `get_my_food_log_cuisine_days`.
- `docs/product/v1.md` (gate C): section 11 (the Cuisine view rules, the neutral icon, the switch); section 16 (the items under "Before-launch additions"); a changelog line at ship.
- Any other older test: stop and ask first (Decision 9).

## New dependencies
No new dependencies. No native rebuild: no new package and no `app.config.ts` change; emoji flags and Ionicons are already in the build.

## Rules for implementation
Always include:
- RLS on every new table, with a pgTAP test. There is no new table here; the new function gets outsider tests.
- Supabase calls only in `src/features/<x>/api.ts`.
- Theme tokens only, no hardcoded colours or sizes.
- Loading, empty, error and success states on every screen.
- Accessibility labels on every touchable.

Feature-specific rules:
- **Privacy:** own data only (`auth.uid()`, no user-id parameter); private uploads count for their owner; no new data is shown to anyone else (v1 has no route to another person's grid); the phone sends only its zone name, never a date or a time; days come from `local_date` and the server's today.
- **Server aggregation:** the app never loads uploads in order to work out a day's cuisine.
- **Per-view range:** the grid on screen, its today outline, its Previous / Next limits and its selected day use the `today` and `from` of the query that drew it.
- **Generic grid:** `activityGridIsolation.test.ts` passes unedited; glyphs and the legend are passed in from `food-log`.
- **Display rule (spec 04):** the cuisine is spoken as its catalog name; flags, icons and the globe are hidden from screen readers.
- **Not by colour or picture alone:** every cell label says the cuisine or the number of cuisines, and the upload count; the legend speaks.
- **44 pt:** the switch options are at least `size.touch`; spec 14's 44 pt alternatives (list rows, Previous and Next day, panel rows) work in Cuisine, and a test proves it.
- **Cell size:** 14 pt cells stay. If the Simulator shows the glyphs are hard to read, stop and ask Archan; do not change cell sizes.
- **Reduce motion:** nothing animates; switching views is instant.
- **SQL hygiene (specs 13 and 14):** no client table grants; definer function with `search_path = ''`; revoke, then grant to `authenticated`; ASCII-only SQL; `is distinct from` in null checks; every non-ASCII literal in tests and TS written as an escape.
- **Byte checks:** `perl -ne 'print "$ARGV:$.: non-ASCII\n" if /[^\x00-\x7F]/; close ARGV if eof'` over every added or changed SQL and TS file, the list passed through `xargs -0`, proved on a scratch probe file first; the invisible-character check on the markdown this spec changes. In this spec file the only non-ASCII character is the globe, on purpose.
- **Tests:** written by Claude directly (no test-writer or test-runner agents, no `/test-feature`); pure-helper tests in the same gate as the code; an own `QueryClient` per test (`testClientOptions()`); `cleanup()` and `client.clear()` in `afterEach`; every RNTL v14 call awaited; `waitFor`, never fake timers; RPC fakes shaped like the real JSON.
- **Deliberate breaks:** each turns a named test red and is reverted from a backup copy, the revert proven with `cmp`. SQL breaks run in scratch copies, inside the test transaction, and are never committed.
- **Older tests:** only the approved edits (Decision 9). Anything else: stop and ask.
- **Reviews read the SQL and never query the database** unless Archan asks.
- **No `db push`, no `--linked`, no deploy.**
- **Stage gates.** Stop, report and commit (files named, conventional message, no push) after each; no edits before "approved".
  - PR 1: **A** migration + types; **B** pgTAP, the approved 05 edit and the SQL breaks; **C** skills and v1 docs; then review, CI, merge.
  - PR 2: **D** feature code, token, the pure-helper tests and the seed check; **E** screen, hook and api tests and the app breaks; **F** the Simulator run (Archan); then review, ship.

## Known pitfalls (checklist)
- [ ] **Same cuisine twice in one day:** the flag, not the globe (`count(distinct)`, break 2).
- [ ] **Neutral plus country in one day:** the globe, 2 cuisines.
- [ ] **One neutral cuisine:** its icon, not the globe (break 10).
- [ ] **Late-night upload:** it lands on its `local_date`, not its UTC date.
- [ ] **A date after today** (logged in a zone ahead, then the zone moved back): absent until that day comes.
- [ ] **A cuisine edit:** changing an upload's cuisine changes that day's glyph (invalidation, break 9).
- [ ] **The two queries disagree on today** (midnight passes between them): each view uses its own query's `today` and `from` for the grid, the today outline, the Previous / Next limits and the selected day; a selection outside the shown range is cleared.
- [ ] **Catalog not loaded:** `Skeleton` while it loads; `ErrorState` with Retry if it fails, and Retry reloads the catalog and the cuisine days.
- [ ] **Code missing from the catalog:** "Unknown cuisine" and the fallback icon.
- [ ] **Largest text size:** the glyph stays at `gridGlyph` (`allowFontScaling={false}`) inside its 14 pt square; the switch wraps.
- [ ] **Leaving Profile:** the view may reset to Activity when Profile remounts; accepted.
- [ ] **Android flag emoji:** some vendor fonts draw flags as two letters; a real-device item in section 16. The label carries the meaning.

## Out of scope
- Any change to the Activity view, the stats, the day panel, spec 14's functions or spec 14's tests.
- Remembering the view on the phone or across launches (Decision 5).
- Changing cell sizes (Decision 3).
- A cuisine filter, the most frequent cuisine, a per-cuisine legend, cuisine counts beyond the cell labels.
- Anyone else's grid, visitor profiles and public-only grids (section 3; v1 has no route to another profile).
- Order activity grids on customer profiles or business pages (section 3).
- Everything else in v1 section 3.

## Definition of done
**PR 1 (pgTAP unless noted):**
- [ ] The function exists with this signature, `security definer`, `search_path = ''`; anon cannot execute it; the 05 allowlist holds it (approved edit).
- [ ] `p_weeks` null, 0 and 54 give `invalid_input`; 1 and 53 work. A null, empty or `Mars/Olympus` zone gives `invalid_time_zone`. The weeks are checked before the zone.
- [ ] `from` and `today` equal `get_my_food_log_activity`'s for the same zone and weeks.
- [ ] Per day:
  - one country code gives that code and `cuisines` 1;
  - the same code twice gives that code, `cuisines` 1 and `count` 2;
  - two country codes give `null` and 2;
  - a neutral code plus a country code give `null` and 2;
  - one neutral code gives that code and 1;
  - `count` equals the activity function's count on every date.
- [ ] Counts by `local_date` (the late-night fixture); `ready` rows only; private and public alike; ascending; nothing before `from` or after today; a row on `from` is included.
- [ ] Exact key sets: the object `days, from, today`; a day `count, cuisine, cuisines, date`; the same top-level set for a caller with no user id.
- [ ] **An outsider cannot** see another person's cuisine days: user B's call holds none of user A's rows, public or private; anon cannot execute the function; a call with no user id gets `days: []`, never someone else's.
- [ ] `14-activity-grid.test.sql` and every other older pgTAP file pass unedited, except the approved 05 edit.
- [ ] `npx supabase db reset`, `npx supabase test db` and `npm run typecheck` pass. `src/types/database.ts` is regenerated, not hand-edited.

**PR 2 (jest unless noted):**
- [ ] `buildCuisineView` and `cuisineCellLabel`: flag, neutral icon, globe and unknown code; "1 upload" and "N uploads"; ", today".
- [ ] `ActivityGrid`: a passed glyph renders and is hidden from screen readers; the legend override renders; without them, spec 14's tests pass unedited; the isolation test passes unedited.
- [ ] `ActivityViewSwitch`: `radiogroup` / `radio` roles, the selected state as a word, each option at least `size.touch`, Activity by default.
- [ ] `ActivitySection` in Cuisine:
  - loading, error with Retry, and success;
  - the cuisine-days query is not sent while Activity is shown;
  - the zone sent is the phone's (the `getCalendars` fake) and no date is sent;
  - cells speak the cuisine labels; the legend speaks its sentence; the summary label is the Cuisine one;
  - list rows use the cuisine labels;
  - the selected day and the panel survive a switch;
  - a failed refresh keeps the grid and shows the banner;
  - the empty state shows no switch.
- [ ] **Per-view range:** with the activity query and the cuisine-days query giving different `today` values, each view's today outline, Previous / Next limits and selected day follow its own query; a selection outside the shown range is cleared.
- [ ] **Catalog failure:** when the cuisine catalog fails, the grid area shows `ErrorState`; Retry reloads both the catalog and the cuisine days, and the grid then renders.
- [ ] The 44 pt alternatives work in Cuisine without pressing a cell.
- [ ] "View full year" in Cuisine opens Your year in Cuisine; a bad or missing `view` param opens Activity.
- [ ] Create, update (cuisine change) and delete invalidate the cuisine days (stale-glyph test).
- [ ] The api parses strictly: an extra or missing key, `cuisine` set with `cuisines` above 1, and `cuisine` null with `cuisines` 1 each give `unknown`.
- [ ] `useFoodLogCuisineDays`: fresh for 60 s, no `refetchInterval`, refetches on foreground once stale, respects `enabled`.
- [ ] Pull to refresh in Cuisine refetches the cuisine days.
- [ ] `npm run lint`, `npm run typecheck` and `npm test` pass; older tests pass unedited except the approved list; the byte checks pass.
- [ ] The Simulator run (Archan): the switch on Profile and Your year; flags, neutral icons and the globe readable at `gridGlyph` (if not, stop and ask); a cuisine edit updating the glyph; the largest text size; VoiceOver where the Simulator allows.

## Test plan
- **Database tests (pgTAP)** in `supabase/tests/15-activity-grid-cuisine-view.test.sql`:
  - everything under PR 1 above;
  - fixtures with fixed ids `00000000-0000-0000-0015-...` (an owner, a second user, an outsider), plus anon;
  - `food_logs` rows inserted as the superuser with chosen `created_at` and `local_date` inside the UTC +/-1 check, dates relative to `now()` in a fixed zone, no sleeps;
  - `pg_temp.as_user` impersonation as in specs 13 and 14;
  - `begin; ... rollback;`.
- **Unit and component tests (jest):**
  - `src/features/activity-grid/__tests__/ActivityGridGlyph.test.tsx`;
  - `src/features/food-log/__tests__/`: `cuisineView.test.ts`, `cuisineDaysApi.test.ts`, `useFoodLogCuisineDays.test.tsx`, `ActivityViewSwitch.test.tsx`, `ActivitySectionCuisine.test.tsx` (including the per-view range and the catalog-failure Retry), `cuisineInvalidation.test.tsx`, `yearRouteView.test.tsx`.
- **Deliberate breaks.** Each turns a named test red and is then reverted:
  1. SQL: drop the `author_id` filter. The outsider test fails.
  2. SQL: `count(*)` instead of `count(distinct cuisine_code)`. The same-code-twice test fails.
  3. SQL: drop `status = 'ready'`. The pending test fails.
  4. SQL: group by the UTC date of `created_at`. The late-night test fails.
  5. SQL: drop `local_date <= v_today`. The future-date test fails.
  6. SQL: `> v_from` instead of `>= v_from`. The range-edge test fails.
  7. App: render the glyph without hiding it from screen readers. The display-rule test fails.
  8. App: build the cell label without the cuisine name. The label test fails.
  9. App: skip the cuisine-days invalidation on update. The stale-glyph test fails.
  10. App: draw the globe for a single neutral day. The neutral test fails.
  11. App: make a switch option 32 pt. The 44 pt test fails.
  12. App: take the Cuisine grid's today from the activity query. The per-view range test fails.
  13. App: make Retry reload only the cuisine days. The catalog-failure test fails.
- **Manual check, iOS Simulator (Archan).** After a local reset:
  ```
  npx supabase db reset
  SEED_SERVICE_ROLE_KEY=<local service key> npx tsx scripts/seed/foodLogs.ts
  npx expo start --dev-client
  ```
  Sign in as `seed-foodlog@example.com` / `password123` and check the Simulator items in the Definition of done.
- **Real device, before launch (section 16):** flag emoji, neutral icons and the globe readable in 14 pt squares on iPhone and Android (including Android fonts that draw flags as letters); VoiceOver and TalkBack on the switch and the cuisine cells.

## Decisions
All approved by Archan on 2026-11-16.

1. **Backend shape:** a new function, `get_my_food_log_cuisine_days`; `get_my_food_log_activity` is not extended. Spec 14's function, its pgTAP and its strict app schema stay untouched; PR 1 is additive, so the app on `main` keeps working whichever lands first; the cuisine query runs only while Cuisine is open. The cost is a second RPC and a second zone-list read.
2. **What a day shows:** one distinct country code, its flag; one distinct neutral code, its icon; two or more distinct codes (neutral ones included), the globe; none, empty.
3. **The glyph:** the catalog's flag emoji (text) or the neutral cuisine's Ionicons icon, centred in the 14 pt square at `size.gridGlyph`, with no font scaling; the globe is U+1F30D, written as an escape in code. Cell sizes stay 14 pt; if the Simulator shows the glyphs are hard to read, stop and ask Archan.
4. **No colour behind the glyph:** cuisine cells use `grid0` with the `gridOutline` border. The count is in the label and in the Activity view.
5. **View state:** in `ActivitySection` state, nothing stored on the phone. It may reset to Activity when the person leaves Profile and comes back; accepted. Your year inherits the view through a `view` param. The selected day survives a switch within the per-view range rule.
6. **Labels:** "Nov 12, Italy, 2 uploads" and "Nov 12, 3 cuisines, 4 uploads", with ", today" when it applies; names come from the catalog (country names), never the emoji. The legend reads "One cuisine: its flag or icon", a separator, the globe and "More than one", and speaks "A flag or icon shows a day with one cuisine; a globe shows a day with more than one".
7. **The switch** is a new food-log component following `RequestsSwitch`; `ui/` has no segmented control yet, and `RequestsSwitch` stays as it is.
8. **Two PRs:** PR 1, the backend (gates A to C, review, CI, merge); PR 2, the app (gates D to F, review, ship). No native rebuild.
9. **Older tests allowed to change:** `05-seller-onboarding.test.sql` (the allowlist and its title), and `scripts/seed/__tests__/foodLogsData.test.ts` only if the seed lacks a case. Anything else, including `14-activity-grid.test.sql`, `activityApi.test.ts`, `ActivityGrid.test.tsx` and `activityGridIsolation.test.ts`: stop and ask.

### Mismatches between the product spec, the skills and the code (found while writing this spec)
1. `liketoorder-ui` says the "flag image fills the cell". Flags are emoji text (`cuisines.flag`, `CuisineGlyph`); there are no flag images. Fixed in the skill at gate C.
2. `liketoorder-ui` says "faint intensity color behind the flag"; v1 section 11 says nothing. Settled by Decision 4; the skill is fixed at gate C.
3. `liketoorder-ui`'s label is "Nov 12, Italian". The catalog holds country names ("Italy"), and the label has no count. Settled by Decision 6.
4. v1 section 11 says "same country: flag", but the catalog has three neutral cuisines with no flag, and neither v1 nor the skill covers a single-neutral day. Settled by Decision 2; v1 section 11 is updated at gate C.
5. `ActivityCell` has no glyph slot and the legend is fixed to the four intensity squares. The generic grid gains two optional props.
6. `activityApi.test.ts` asserts that a `days` item with a `cuisine` key is refused. It stays true under Decision 1; extending the activity function would have broken it, plus spec 14's pgTAP key sets and its full `days` comparison.
7. `ui/` has no segmented control; `RequestsSwitch` is requests-only. Settled by Decision 7.
8. `type.caption` (12) is the smallest type token and there is no glyph token, so `size.gridGlyph` is added.
9. v1 section 16's time-zone list item names only the activity function. It gains the new one at gate C.

### Before-launch additions (v1 section 16, gate C)
- **Cuisine view on real devices:** flag emoji, neutral icons and the globe readable in 14 pt squares on a real iPhone and Android phone, including Android fonts that draw flags as two letters; VoiceOver and TalkBack on the switch and the cuisine cells. Touch accuracy is already spec 14's item.
- **Time-zone list cost:** the existing item gains `get_my_food_log_cuisine_days`.
- No native rebuild.

## Resolved questions
All answered by Archan on 2026-11-16.
1. **Backend shape:** a new function, `get_my_food_log_cuisine_days` (Decision 1).
2. **A day of one neutral cuisine:** shows that cuisine's icon (Decision 2).
3. **Colour behind the glyph:** none (Decision 4).
4. **Cell size:** keep 14 pt cells with the `size.gridGlyph` token; if the Simulator shows the glyphs are hard to read, stop and ask, do not change cell sizes (Decision 3).
5. **Remembering the view:** screen state; Your year inherits it by param; nothing stored on the phone (Decision 5).
6. **PRs:** two (Decision 8).
7. **Scope:** keep the labels with counts and the legend (Decision 6).

## Open questions
None.
