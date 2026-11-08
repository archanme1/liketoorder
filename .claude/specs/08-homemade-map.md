# Spec 08: Homemade Map

**Branch:** two PRs from this one spec (same pattern as specs 06 and 07)
- PR 1 (backend only: migration, homemade read functions, 30-day guard for homemade, owner `map_status` for homemade, pgTAP): `feature/homemade-map-backend` (this branch, `feature/homemade-map`, is renamed before its first push)
- PR 2 (the app: Homemade tab map, circles, sheet, disclaimer, photo viewer, Manage Business status line, seed data, jest tests): `feature/homemade-map-app`, created from `main` after PR 1 is merged.
**Product spec:** `docs/product/v1.md` §3 (out of scope), §4 (guests can browse), §5 (Homemade specifics), §6 (Map), §14 row 08, §16 (Homemade read function, Photo viewer, Places coordinate refresh, Google terms review, Homemade photo note)
**Plan mode:** required — adds a migration (functions, index, rate-limit kinds, a changed owner view), RLS and grants; touches well over ~5 files; changes the Homemade tab and refactors the spec 07 map screen so both tabs share it.
**Status:** ✅ Shipped (2 PRs)

## Overview
After this ships, anyone, signed in or not, can open the **Homemade** tab and see a full-screen Google map of home cooks. Each cook shows as a country flag (or neutral cuisine icon) at the centre of a **translucent 500 m circle** that stands for "somewhere in this area". The circle is drawn only when zoomed in; zoomed out, flags cluster exactly as on the Restaurants tab. No exact point or exact address is ever shown or returned.

Tapping a flag opens the same bottom sheet as spec 07, in a homemade version, menu first (Decision 15): name, flag and cuisine, a cover banner, a small safety row, menu, prices and availability, an "approximate area only" note instead of an address (and no Directions), and a clearly labelled **food-safety and allergy note**. Photos can be tapped to open a **photo viewer** (built once, reused in the map sheet for both tabs and on the seller's Photos screen). Homemade sellers see in Manage Business whether they are on the map.

Google's rule applies here too (Decision 1): a homemade point is derived from a Google coordinate, so it is treated like one. Homemade cooks whose address was last confirmed with Google 30 or more days ago are hidden by the same guard restaurants have. The spec 07 refresh job already refreshes homemade rows.

**Why now:** the map, sheet, list and location flow exist (07). Requests (09, 10) and the exact-address reveal need this tab to start from.

## Depends on
- 05 seller-onboarding ✅ (homemade shift, `business_locations`, `set_business_location`)
- 06 menu-management ✅ (menu, photos, signed URLs, the Photos screen)
- 07 restaurant-map ✅ (map screen, sheet, list, location flow, 30-day guard, refresh job, rate limits)

## Context to load
- `CLAUDE.md`
- `docs/product/v1.md` §3, §5, §6, §16
- This spec
- `.claude/skills/map-markers/SKILL.md` (**read "Lessons from spec 07" first**), `.claude/skills/supabase-patterns/SKILL.md`, `.claude/skills/liketoorder-ui/SKILL.md`
- `.claude/specs/07-restaurant-map.md` (Decisions 25–31 and the device-run notes only)
- **PR 1:** `supabase/migrations/20261105040319_restaurant_map.sql`, `supabase/migrations/20261105043445_restaurant_map_hardening.sql`, `supabase/migrations/20261103215641_seller_onboarding.sql` (homemade shift, `business_owner_view`), `supabase/migrations/20261104035153_menu_management.sql` (`private.business_is_public`), `supabase/tests/07-restaurant-map.test.sql`, `supabase/tests/05-seller-onboarding.test.sql` (function allowlist)
- **PR 2:** `app/(tabs)/homemade.tsx`, `app/(tabs)/restaurants.tsx`, everything in `src/features/map/` (components, hooks, `api.ts`, `schema.ts`, `region.ts`, `mapEvents.ts`, `mapStyle.ts`, `messages.ts`, `clustering.ts`), `src/features/map/__tests__/{markerPress,RestaurantMapScreen,RestaurantSheet,sheetScroll,PlacesList}.test.tsx`, `jest.setup.ts` (the `react-native-maps`, `@gorhom/bottom-sheet` and `expo-location` fakes), `src/features/media/components/PhotoTile.tsx`, `src/features/media/hooks/useSignedUrls.ts`, `src/features/menu/components/BusinessPhotosScreen.tsx`, `src/features/sellers/components/{MapStatusLine,ManageBusinessScreen}.tsx`, `src/features/sellers/schema.ts`, `app.config.ts`, `scripts/seed/{restaurants,restaurantData,safety}.ts`

## User stories
- As a guest or signed-in user, I can open the Homemade tab and see home cooks as flags on a map, without signing in.
- As a user, I can see that a cook's location is only an approximate area (a circle), never a pin on a house.
- As a user, I can tap a flag and read a cook's photos, menu, prices and the food-safety note in a bottom sheet, while the map stays where it was.
- As a user, I can tap a photo to see it larger and swipe through the cook's photos.
- As a user, I can open "Places in this area" to choose a cook from a list, which moves the map to them.
- As a user, I can let the app centre the map on me (optional); my exact position never leaves my phone.
- As a screen-reader user, I hear each cook's name, cuisine and "approximate area", and I can reach every action without the map.
- As a homemade seller, my exact address and exact coordinates are never readable by anyone through this map, and I can see in Manage Business whether I am on the map and why not.
- As a homemade seller, I can tap my own photos on the Photos screen to see them larger.

## Screens & routes
- `app/(tabs)/homemade.tsx` (change) — renders `HomemadeMapScreen` instead of the "coming soon" stub. Access: public (guests included).
- No new route for the sheet or the photo viewer: both are components over the map (the viewer is a full-screen `Modal`).
- `app/(tabs)/restaurants.tsx` stays as is.

States (CLAUDE.md "4 states"), same wording rules as spec 07 with "homemade cooks" in place of "restaurants":
- **Loading:** the map shows with a small "Loading homemade cooks" indicator; panning keeps old pins.
- **Empty:** "No homemade cooks here yet" with a "Zoom out" hint.
- **Error (with retry):** non-blocking banner with Retry; old pins stay. `rate_limited`: calm "Try again in a moment", not retried automatically.
- **Success:** flags, circles (zoomed in), clusters, sheet.
- **Zoomed out too far / capped:** "Zoom in to see homemade cooks" / "Zoom in to see more".

## What is shared with spec 07 and what is new
The aim is that the Homemade tab is the Restaurants tab with different data and a different sheet body, not a second map screen.

| Part | Status |
|---|---|
| Map screen logic (`RestaurantMapScreen`: map, markers, clusters, notices, locate me, sheet host, list stack, map-ready camera moves) | **Shared.** Refactored to a generic `BusinessMapScreen` driven by a small config object (`kind`, texts, fetch hooks, marker renderer, sheet body). `RestaurantMapScreen` becomes a thin wrapper, with **no behaviour change**: its existing spec 07 tests must pass unchanged. |
| `useMapRegion`, `useInitialRegion`, `useLocationPermission`, `useReduceMotion`, `useTracksViewChanges`, `region.ts` (`snapBox`, camera-centre maths), `clustering.ts`, `countryViews.ts`, `mapEvents.ts`, `mapStyle.ts`, `mapConfig.ts`, `MapNotices`, `LocationPrompt`, `ClusterMarker` | **Shared as is.** Strings that say "restaurants" become parameters. |
| `lastRegion.ts` | **Shared**, with a storage key per tab (Decision 6). |
| `RestaurantSheet` (snaps, scroll space, back-to-list stack, close/X, large-text cap) | **Shared.** Takes a body component. Renamed `BusinessSheet` only if the rename is trivial; otherwise keep the name and note it. *(Kept the name: `RestaurantSheet` now hosts both tabs, with the details body, labels and list texts passed in as optional props that default to the restaurant ones; a rename would have touched the unchanged spec 07 tests.)* |
| `PlacesList` | **Shared**, with title and empty text as parameters. |
| `SheetMenu`, `SheetPhotos` | **Shared** (menu and photos are identical for both types). `SheetPhotos` gains tap-to-enlarge and is split (Decision 15) into a cover banner and a gallery row that share one viewer. |
| `FlagMarker` | **Shared**, wrapped by the new `HomemadeMarker` (flag plus circle). The wrapper changes only the accessibility label. |
| `SheetDetails` | **Not shared.** Restaurant body stays. New `HomemadeSheetDetails` has its own body (safety row, area note, no address, no Directions). |
| `api.ts`, `schema.ts` | **Extended** with homemade calls and zod schemas. |
| `PhotoViewer` | **New**, in `src/features/media/` (used by both maps and by the seller Photos screen). |
| `HomemadeCircle`, `HomemadeDisclaimer`, homemade hooks | **New.** |

## Database changes
One migration, `npx supabase migration new homemade_map` (PR 1). Never edit an existing migration. Written as a sketch; the implementation checks names against the current migrations.

```sql
-- ── Rate-limit kinds for the new functions (own counters, so one tab can't use the other's) ──
-- The spec 07 check constraint on map_rate_limits.kind is dropped and re-added with four kinds:
--   'pins', 'details', 'homemade_pins', 'homemade_details'
-- (The constraint's real name is looked up in the migration; behaviour of the old kinds is unchanged.)

-- ── Fast bounding-box reads for homemade ───────────────────────────────────────
create index businesses_homemade_map_idx on public.businesses (map_lat, map_lng)
  where is_listed and type = 'homemade' and map_lat is not null;
```

### Freshness rule for homemade (Decision 1)
A homemade business is **fresh** when `is_listed` and `type = 'homemade'` and `map_lat is not null`, and its `business_locations` row has `place_status = 'ok'` and `resolved_at > now() - interval '30 days'`. This is `private.homemade_is_fresh(p_business_id uuid)`, written like `private.restaurant_is_fresh` (security definer, `set search_path = ''`, executable by owner and the definer of the two public functions only).

### Functions
| Function | Who may execute | What it does |
|---|---|---|
| `map_homemade_in_bounds(p_min_lat, p_max_lat, p_min_lng, p_max_lng) returns jsonb` | `anon`, `authenticated` | Same box rules, clamping, 90° limit, date-line handling, 500 cap and statement timeout as `map_restaurants_in_bounds` (spec 07 "Bounding-box rules"), counted under kind `homemade_pins` (120/min per caller; guest ceiling `guest:all` 2,000/min). Returns only fresh homemade businesses: `{ "pins": [{ "id", "name", "cuisine_code", "lat", "lng" }], "capped", "too_large" }` where `lat`/`lng` are the **shifted public point** (`map_lat`/`map_lng`). Never `place_id`, never an address, never the exact coordinates. |
| `get_homemade_details(p_business_id uuid) returns jsonb` | `anon`, `authenticated` | Rate-limited as `homemade_details` (30/min). Returns **`null`** for anything not fresh, or not homemade, or unknown (identical for every cause). Otherwise: `id, name, cuisine_code, currency_code`, `photos` (`ready` only, same shape as spec 07), `items` (same shape). **No** `place_id`, address, `accepts_table_requests`, `resolved_at`, `place_status` or coordinates. (The client already has the shifted point from the pin.) |
| `private.homemade_is_fresh(uuid) returns boolean` | none directly | The rule above. |
| `public.business_owner_view` (changed with `create or replace`) | existing grants unchanged | `map_status` now also filled for **homemade** using the same three-word rule as restaurants (Decision 4): `place_not_found`, `needs_refresh`, otherwise `visible`; null when there is no saved address. |

Box validation is shared with `map_restaurants_in_bounds` through one private helper if that can be extracted **without changing the restaurant function's behaviour** (every spec 07 pgTAP test stays green and unedited); if extraction is risky, the box rules are copied and a pgTAP test proves both functions agree on the same boxes.

`get_restaurant_details` already returns `null` for homemade, and `map_restaurants_in_bounds` already excludes it. Neither is changed.

### RLS and grants
- No new tables. `businesses`, `business_locations` and `map_rate_limits` stay closed exactly as in specs 05 and 07: `anon` and `authenticated` hold no read on `map_lat`, `map_lng`, `public_address`, no access to `business_locations`.
- Every new function: `revoke execute … from public, anon, authenticated`, then grant as in the table. The spec 05 pgTAP allowlist is extended: `anon` and `authenticated` may additionally execute exactly `map_homemade_in_bounds` and `get_homemade_details`; `private.homemade_is_fresh` is owner/definer only.
- Status changes: none (no status columns are written by this spec).

## Storage
None added. Homemade photos use the existing private `business-media` bucket and spec 06's rules (signed URLs, `private.business_is_public`). Verify in pgTAP that a **homemade** photo of a fresh listed business is readable through the existing policy by `anon`, and not when the business is unlisted.

## Edge Functions
None. (`places-refresh` already refreshes homemade rows and leaves their `map_lat/map_lng` untouched, spec 07 Decision 7.)

## Components & hooks (PR 2)
All in `src/features/map/` unless noted.
- `api.ts` (extend) — `fetchHomemadeInBounds(box)` → `map_homemade_in_bounds`, `fetchHomemadeDetails(id)` → `get_homemade_details`. Same `mapMapError`. All Supabase calls stay here.
- `schema.ts` (extend) — `homemadeDetailsSchema` (strict, no address or coordinates allowed), reuse `pinsResponseSchema`.
- `hooks/useHomemadeInBounds.ts`, `hooks/useHomemadeDetails.ts` — same behaviour as `usePinsInBounds` / `useRestaurantDetails` (keys `['map','homemade','pins', box]` and `['map','homemade','details', id]`, keep previous data, `rate_limited` never retried). If the two pairs can be one parameterised hook each, do that instead.
- `components/BusinessMapScreen.tsx` — the shared screen (extracted from `RestaurantMapScreen`). `RestaurantMapScreen.tsx` and new `HomemadeMapScreen.tsx` are thin wrappers.
- `components/HomemadeMarker.tsx` — `FlagMarker` for the point plus, when zoomed in, a `Circle` (`radius` 500 m, translucent fill and outline from tokens, never colour alone: the sheet and label say "approximate area"). The circle is drawn only while `latitudeDelta ≤ CIRCLE_MAX_DELTA` (0.05, tune in the manual run) and is hidden for clustered pins.
- `components/HomemadeSheetDetails.tsx` — homemade sheet body.
- `components/HomemadeDisclaimer.tsx` + `homemadeText.ts` — the disclaimer text constant (Decision 3) and the area-note text.
- `src/features/media/components/PhotoViewer.tsx` — full-screen `Modal`, one photo at a time (`expo-image`, `contentFit="contain"`), swipe left/right between a cook's photos, "Photo n of m" label, an X (≥ 44 pt) labelled "Close photo", Android back and a tap on the backdrop also close. Uses the signed URLs and `onExpired` renewal from `useSignedUrls` (no new URL logic). Photo failing → "Photo unavailable" once. Large text: the counter scales; reduce-motion: no slide/fade animation, an instant switch. `accessibilityViewIsModal`; focus moves to the close button on open and back to the tile on close (the sheet's focus-return gap, Decision 31 of spec 07, does not apply because the viewer is a `Modal` that restores focus; verified in the VoiceOver run).
- `src/features/media/hooks/usePhotoViewer.ts` — open/close state plus index, so the three callers share one pattern.
- `src/features/sellers/components/MapStatusLine.tsx` (change) — also renders for homemade, with homemade wording (Decision 4).

### Disclaimer and area note (Decision 3 and 5)
- Safety note (Decisions 3 and 15): a small row near the top of the sheet body, inside the scrolling content, collapsed at every text size: the title **"Food safety and allergies"** with an info icon. The whole row is the button (at least 44 pt tall, grows with text, role button, expanded state exposed); a tap opens the full text inline: **"Homemade food isn't inspected. Ask the cook about ingredients and allergies before you order."** A screen reader hears the whole warning on the collapsed row ("About food safety and allergies. Homemade food isn't …"). **Placeholder wording**; spec 18 owns the final text after a legal read. The title, text and label live in one place, `homemadeText.ts`.
- Area note where a restaurant's address would be: **"Approximate area only. The exact address is shared only if the cook accepts your request."** No Directions button, no map link, no coordinates.
- No Request pickup / Request table / Report buttons or placeholders (specs 09, 11, 17).

### Opening view, location and privacy
Identical to spec 07 "Opening view and location" for the Homemade tab, with these changes only:
- The pre-permission note and the iOS permission string say "restaurants and homemade cooks" (the string is native config, so Archan rebuilds with `npx expo run:ios`). It keeps "Your exact location stays on your phone. We only receive the map area you're looking at."
- The request box is `snapBox`-ed outward to the 0.05° grid, same as spec 07.
- "Not now" is remembered once per phone for both tabs; the last viewed region is stored per tab (Decision 6).
- Homemade uses the same `customMapStyle` (`poi.business` off) and the same `PROVIDER_GOOGLE`.

### Accessibility and large text
- Marker label: "<Name>, <Cuisine> cuisine, homemade, approximate area". Cluster: "<n> places, double tap to zoom in". The circle is decoration, hidden from screen readers (the label already says approximate).
- "Places in this area" button opens the list ("Homemade cooks in this area"); rows read "<Name>, <Cuisine> cuisine".
- Same sheet roles and labels as spec 07; photo tiles "<Name>, photo n of m. Opens photo viewer."; availability written, never colour alone.
- Large-text caps as spec 07 Decision 29 (sheet titles 1.6×, tab labels 1.3×; everything else scales). The disclaimer box grows with text and is never clipped or truncated.

## Files to create
**PR 1**
- `supabase/migrations/<timestamp>_homemade_map.sql`
- `supabase/tests/08-homemade-map.test.sql`

**PR 2**
- `src/features/map/components/{BusinessMapScreen,HomemadeMapScreen,HomemadeMarker,HomemadeSheetDetails,HomemadeDisclaimer}.tsx`
- `src/features/map/homemadeText.ts`
- `src/features/map/hooks/{useHomemadeInBounds,useHomemadeDetails}.ts`
- `src/features/media/components/PhotoViewer.tsx`, `src/features/media/hooks/usePhotoViewer.ts`
- `src/features/map/__tests__/{HomemadeMapScreen,HomemadeMarker,HomemadeSheet,homemadeApi,HomemadeMapPrivacy}.test.tsx` (or `.ts`), `src/features/media/__tests__/PhotoViewer.test.tsx`
- `scripts/seed/homemadeData.ts` and `scripts/seed/photos/*.jpg` (a few small, EXIF-free fictional photos; each under 100 KB)

## Files to change
**PR 1**
- `supabase/tests/05-seller-onboarding.test.sql` — extend the function allowlist
- `src/types/database.ts` — regenerated with `npm run db:types`
- `.claude/skills/supabase-patterns/SKILL.md` — one line: the homemade read functions
- `docs/product/v1.md` §16 — see "Product spec changes"

**PR 2**
- `app/(tabs)/homemade.tsx`
- `src/features/map/components/{RestaurantMapScreen,RestaurantSheet,PlacesList,SheetPhotos,MapNotices,LocationPrompt}.tsx`, `src/features/map/{api,schema,messages,lastRegion}.ts` — parameterise texts and keys, add homemade calls (restaurant behaviour unchanged)
- `src/features/menu/components/BusinessPhotosScreen.tsx` — photo viewer on the seller Photos screen
- `src/features/sellers/components/{MapStatusLine,ManageBusinessScreen}.tsx`, `src/features/sellers/schema.ts` — homemade `map_status`
- `app.config.ts` — location permission string
- `jest.setup.ts` — extend the existing map fake with `Circle` (see "Test fakes")
- `scripts/seed/restaurants.ts` — also seed homemade (see "Seed data")
- `.claude/skills/map-markers/SKILL.md` — **correct the "Homemade markers" section**: it names columns `approx_lat`/`approx_lng` (the real ones are `businesses.map_lat`/`map_lng`, returned only by `map_homemade_in_bounds`) and a 300 m circle (the real radius is 500 m so the real home is always inside); add the circle rules from this spec
- `CLAUDE.md` — status table

## New dependencies
No new dependencies. (`Circle` is part of `react-native-maps`; the viewer uses React Native's `Modal` and `expo-image`.)

## Rules for implementation
- RLS on every new table + pgTAP test (no new tables here; every new function gets grants and pgTAP)
- Supabase calls only in `src/features/map/api.ts`
- Theme tokens only, no hardcoded colors/sizes
- Loading / empty / error / success states on every screen
- Accessibility labels on every touchable
Feature-specific:
- **Never exact.** The app never receives, stores, logs or draws an exact homemade point or address. Only the server's shifted point is used. The app never computes, rounds or offsets a homemade point.
- **Restaurants never appear on this map and homemade never on the Restaurants map**, enforced in SQL by `type` in both freshness rules.
- **Reuse before rebuilding.** If a part is marked shared above, change the shared part; do not copy it. The refactor of the screen must leave every spec 07 jest test passing unchanged.
- **Read "Known pitfalls" below before writing code, and re-read it before the manual run.**
- Never read, print or set a secret or `.env`. Never log signed URLs, photo paths or positions.
- Stage gates with a commit after each (stop and commit after each gate; no edits before "approved").
  - PR 1: **A** migration + pgTAP + types → review.
  - PR 2: **B** shared-screen refactor with restaurant tests unchanged and green → **C** homemade pins, circle, markers, sheet, disclaimer + tests → **D** photo viewer on all three places + status line + seed data + tests → manual run (script below).

## Known pitfalls (checklist)
Each item points to "Lessons from spec 07" in `.claude/skills/map-markers/SKILL.md` and says how it applies here. The reviewer ticks every line.

- [x] **Marker press bubbling.** `HomemadeMarker` (flag) sets `stopPropagation`, `ClusterMarker` already does, **and** the shared map `onPress` ignores bubbled marker presses (`isMarkerPressEvent`). The new **circle** is an overlay that can also bubble: if made tappable it gets the same two layers (stop propagation if the library supports it, and the map handler ignores overlay-press events — the exact `nativeEvent.action` value is read from the installed `react-native-maps` source, not guessed). If the library cannot do this reliably, the circle is not tappable (only the flag opens the sheet), and that is written into this spec's Decisions. Manual script steps 9 and 10 prove it. *(jest + manual steps 6 and 9.)*
- [x] **Faithful fakes.** Tests use the spec 07 `react-native-maps` fake that bubbles events (with its stop-propagation switch) and the `@gorhom/bottom-sheet` fake in `jest.setup.ts`. The fake gains `Circle`; no new ad-hoc map fake is allowed in any test file. A test must fail if the second layer (the map handler's ignore) is removed. *(second-layer test goes red when the map handler's ignore is removed: deliberate break 1.)*
- [x] **Sheet scrolling.** `HomemadeSheetDetails` renders inside the shared sheet's `BottomSheetScrollView`; long lists (menu, photos) stay virtualised on top of it; bottom space follows the snap (`scrollBottomSpace`). The disclaimer box and area note sit inside that scroll content. Manual step 14 checks the last row is reachable at half and full. *(manual 14, covered by the Gate E run.)*
- [x] **Stacked list → sheet.** A cook opened from "Places in this area" returns to the list on swipe-down and on X ("Back to list"); opened from a flag it just closes; bare-map tap clears the stack. Works through the shared screen, labels from the config. *(jest + manual 19-21.)*
- [x] **Camera rules.** Picking from the list moves the camera (the pin lands in the free part of the map above the half sheet; never zooms out); tapping a flag never moves it. The camera moves only after `onMapReady`. *(jest + manual 20.)*
- [x] **Large text.** Sheet titles capped at 1.6×, tab labels 1.3×, body text scales fully; the new disclaimer box and the viewer counter scale and are not clipped. *(manual 26, covered by the Gate E run; jest pins the 1.6× title cap and uncapped body text.)*
- [x] **Business labels hidden.** Same `MAP_STYLE` on both tabs; Android still unchecked (tracked in §16). *(manual 2.)*
- [x] **Location privacy.** Request box snapped outward to the coarse grid; permission string and note say exactly that and now also say "homemade cooks"; the string change needs a rebuild. Jest asserts that no request argument contains the person's position and that two positions in one grid cell send identical boxes, for the homemade call too. *(jest: HomemadeMapPrivacy.)*
- [x] **Permission re-read.** "Locate me" and returning from Settings re-read the permission (shared hook; not copied). *(manual 25.)*
- [x] **Stable callbacks and memoised markers.** `HomemadeMarker` is `React.memo`; the circle layer does not re-render every marker on a pan; callbacks are `useCallback`. Manual step 8 pans a 100-cook area. *(jest render-count tests at marker and screen level; manual step 8 passed.)*
- [x] **Dev client.** Expo Go cannot run this tab. Archan runs `npx expo run:ios` (the permission string changes).
- [x] **Local seed vs pgTAP.** After seeding, count-based pgTAP tests fail until `npx supabase db reset`. The manual script starts with a reset and seed, and the Definition of done runs pgTAP **before** seeding. *(The manual script starts with a reset and seed; pgTAP runs on a fresh database in CI on this PR.)*
- [x] **Homemade-only traps.** (a) Circle radius 500 m, never smaller than the maximum shift; (b) the circle's centre is the stored public point, never anything computed in the app; (c) no Directions, no address, no `place_id` in any payload, schema, log or accessibility label; (d) the sheet must not look like a restaurant sheet that is missing a field: it states "approximate area" on purpose; (e) the `Circle` must not be drawn for clustered pins. *(jest: radius, centre, no address/Directions/place ID, label, no circle for clusters.)*

## Manual acceptance script (iOS Simulator, Archan runs it once after the build)
Setup, once:
1. `npx supabase db reset`, then the seed command in `scripts/seed/restaurants.ts`'s header (it now seeds restaurants **and** homemade, with photos in local storage). Run `npx expo run:ios` (the location string changed) and start with `npx expo start --dev-client`. Fake the location: `xcrun simctl location booted set 43.8971,-78.8658` (Oshawa).
   **Expected:** the app launches; no red screens.

The map and markers:
2. Open the **Homemade** tab (signed out).
   **Expected:** a Google map with the iOS key; the pre-permission note names "restaurants and homemade cooks"; "Use my location" shows the system prompt; allow it. The map centres on Oshawa. Flags show for homemade cooks only; no restaurant flag appears; Google's own business labels are hidden.
3. Zoom in on one flag until the view is about a neighbourhood.
   **Expected:** a translucent circle appears around each flag; the flag is at the circle's centre. Zoomed far out, the circles disappear and flags group into numbered clusters.
4. Open Studio and compare, for "Nonna Rosa's Table", `business_locations.lat/lng` (exact) with `businesses.map_lat/map_lng` (shown).
   **Expected:** they are 200–500 m apart; the exact point lies inside the 500 m circle; the flag sits at `map_lat/map_lng`, not at the exact point.
5. Tap a cluster.
   **Expected:** the map zooms in; no sheet opens.
6. Tap a flag.
   **Expected:** the sheet opens at half; **the sheet stays open** (the iOS bubbling bug does not return); the map does not move.
7. Swipe the sheet down, then tap the bare map.
   **Expected:** swipe closes it; a tap on empty map with no sheet does nothing odd.
8. Pan and zoom around the dense Toronto group several times, quickly.
   **Expected:** no flicker (old flags stay while new load); no stutter; no "Try again in a moment" (that note is jest-only).
9. With a sheet open, tap the **circle** (not the flag) of a different cook.
   **Expected:** either that cook's sheet opens, or (if the circle is not tappable per Decision 7) the sheet closes like any bare-map tap. In both cases the screen is stable, never an open-and-instantly-closed flash.
10. Tap a flag in a place where two circles overlap.
    **Expected:** the tapped cook's sheet opens, not the neighbour's.

The sheet:
11. Open "Nonna Rosa's Table" (cover, gallery of 3, menu photos, menu items).
    **Expected (menu first, Decision 15):** the fixed header (name, flag, cuisine); under it a short cover banner (88 pt, cropped); the small "Food safety and allergies" row with the info icon (tap it: the full note opens inline; tap again: it closes); "Menu" with the menu-page thumbnails (96 pt) and the item list with prices in CAD and availability words ("Sold out"); then the gallery; and at the very bottom the line "Approximate area only. The exact address is shared only if the cook accepts your request." **No** Directions, address, Request or Report buttons. At the half snap you see the header, banner, safety row, "Menu" and the thumbnails (item rows start at or below the fold; scroll for them).
12. Open a cook with items only and no photos, then one with menu photos only, then one with a cover only, then one with a gallery but no cover.
    **Expected:** each shows only what exists in the menu-first order: no banner and no placeholder without a cover; no gallery row for a cover only; "No photos yet" only when there is neither a cover nor a gallery, where the gallery would be.
13. Drag the sheet between the three snaps.
    **Expected:** content readable at each; the collapsed snap shows name and flag; at half the banner, safety row, "Menu" and the thumbnails are visible; at full about four or five item rows more.
14. Scroll the sheet to the very bottom at half and at full.
    **Expected:** the last row of the sheet (the address and Directions for a restaurant, the area note for a cook) is reachable above the tab bar at both snaps. Also tap the cover banner, a gallery photo and a menu thumbnail: the banner and gallery open one viewer (swipe from the banner to the gallery); the thumbnails open their own; closing returns to the small view.

The photo viewer:
15. Tap the cover photo in the sheet.
    **Expected:** a full-screen viewer opens showing the photo whole ("Photo 1 of 4" or similar); swipe left/right moves between the cook's photos; the counter updates.
16. Close with the X, then reopen and close with a tap on the backdrop; then a third time and swipe/back-gesture (if the simulator supports it).
    **Expected:** each closes the viewer and returns to the same sheet position, nothing else moves.
17. Turn on Reduce Motion (Settings → Accessibility → Motion), reopen the viewer.
    **Expected:** photos change instantly with no slide or fade. Turn it back off.
18. Tap a photo that is intentionally broken (the seed has one cook whose photo file is missing).
    **Expected:** "Photo unavailable" appears once, with no loop and no crash.

The list:
19. Tap "Places in this area".
    **Expected:** the sheet shows "Homemade cooks in this area" with rows (name and cuisine); the list scrolls at half and full; the last row is above the tab bar.
20. Pick a cook from the list.
    **Expected:** the map moves so the flag is in the free map area above the half sheet (it never zooms out); the cook's sheet opens on top of the list.
21. Tap the X ("Back to list" for VoiceOver); then pick another and swipe the sheet down.
    **Expected:** both return to the list with the map and list where they were. From the list itself, X and swipe close everything.

Limits, states and location:
22. Zoom out until the whole world shows.
    **Expected:** "Zoom in to see homemade cooks", no flags, no endless loading.
23. Move to an area with no cooks (pan out to the ocean and zoom in).
    **Expected:** "No homemade cooks here yet" with a zoom-out hint, never a blank map without explanation.
24. Tap "Locate me" after changing the faked location to Cambridge (`xcrun simctl location booted set 43.3616,-80.3144`).
    **Expected:** the map recentres on Cambridge.
25. Settings → Privacy → Location Services → LikeToOrder → Never. Return to the app and tap Locate me; then open Settings from the notice, set "While Using", and come back.
    **Expected:** the notice offers "Open Settings"; after returning, the permission is re-read and Locate me works with no restart.
26. Largest "Larger Accessibility Sizes" (Settings → Accessibility → Display & Text Size → Larger Text).
    **Expected:** sheet title large but capped, the tab bar labels not cut off, the safety row complete (its title wraps, nothing truncated; it stays collapsed until tapped, and open its text is complete), rows readable, the viewer counter visible.

Hidden cooks and the seller view:
27. Look for "Stale Samosas" (its address is 31 days old), "Gone Place" (place not found) and "Unlisted Kitchen" on the map and in the list.
    **Expected:** none of them appears.
28. Sign in as `seed-homemade-1@example.com` (password in the seed header), turn on seller mode if needed, open Manage Business.
    **Expected:** the status line reads "Showing on the map as an approximate area" (homemade wording). A restaurant seed owner still sees the restaurant wording.
29. Sign in as `seed-homemade-stale@example.com` and open Manage Business.
    **Expected:** the hidden-while-we-re-check message with its "Choose your address again" button.
30. As `seed-homemade-1`, open the seller Photos screen and tap a photo.
    **Expected:** the same viewer opens; editing still works the way it did (spec 06 behaviour is not lost).
31. Open the **Restaurants** tab.
    **Expected:** restaurants only, same behaviour as before (flags, sheet, Directions, the stacked list); the sheet photos there also open the viewer.

### Manual acceptance results (iOS Simulator, Archan)
**Gate C run (Homemade map, no photos yet): passed, no failures.** Steps covered by that run:

| Step | Result | Note |
|---|---|---|
| 1 Setup (reset, seed, build, fake location) | Done | Seed at Gate C had no photos |
| 2 Homemade tab, flags only, location note, Oshawa | Pass | |
| 3 Circles in/out by zoom, clusters when zoomed out | Pass | |
| 5 Tap a cluster | Pass | |
| 6 Tap a flag: sheet opens and stays, map does not move | Pass | |
| 9 Tap inside a circle | Pass | Sheet closes like any bare-map tap (Decision 7) |
| 11 Sheet content for Nonna Rosa's Table | Pass, photos part open | Disclaimer visible at half, CAD menu, area note, no address/Directions/Request/Report; cover, gallery and menu photos not yet seeded |
| 19 Places in this area | Pass | |
| 20 Pick from the list | Pass | |
| 21 Back to list (X and swipe) | Pass | |
| 22 World view | Pass | "Zoom in to see homemade cooks" |
| 23 Empty area | Pass | "No homemade cooks here yet" |
| 24 Locate me | Pass | |
| 25 Settings round trip | Pass | |
| 27 Hidden cooks absent (map and list) | Pass | Stale Samosas, Gone Place, Unlisted Kitchen |
| 31 Restaurants tab unchanged | Pass, viewer part open | Flags, sheet, Directions, list as before |

**Gate E run (menu-first sheets; Archan, iOS Simulator): all 7 checks passed.** It covered the new order, the safety row (open and close), the banner, the banner/gallery viewer and the menu-page viewer, the single-content sheets, a restaurant sheet, and the largest text size. Recorded against the script:

| Step | Result | Note |
|---|---|---|
| 11 Sheet content (now menu first) | Pass | Order, safety row, area note, no address/Directions/Request/Report |
| 12 Cooks with fewer photos | Pass | Items only, menu pages only, cover only |
| 13 Drag between the snaps | Pass | Half snap seen in the Gate E run; the full drag in the final run |
| 14 Scroll to the last row | Pass | Last row reachable |
| 15 Open the cover viewer, swipe, counter | Pass | Banner opens at photo 1, swipe reaches the gallery |
| 16 Close methods | Pass | X in the Gate E run; the other methods in the final run |
| 26 Largest text | Pass | Safety row complete, title wraps, nothing cut off |

**Final run (Archan, iOS Simulator, seeded data): the remaining steps all passed.**

| Step | Result | Note |
|---|---|---|
| 4 Exact vs shown point (Studio) | Pass | 200-500 m apart, exact point inside the circle |
| 7 Swipe the sheet down, tap the bare map | Pass | |
| 8 Rapid pan and zoom, Toronto group | Pass | No flicker, stutter or error note |
| 10 Overlapping circles, tap a flag | Pass | The tapped cook's sheet opens |
| 13 Drag through the three snaps | Pass | |
| 16 Close methods (X, beside the photo, back gesture) | Pass | |
| 17 Reduce Motion | Pass | No fade |
| 18 Broken photo (Little Seoul Banchan) | Pass | "Photo unavailable" once, no loop |
| 28 Status line, homemade and restaurant owner | Pass | Homemade wording; restaurant wording unchanged |
| 29 Status line, stale address | Pass | Hidden message with the button |
| 30 Seller Photos screen "View larger" | Pass | Editing unchanged |
| 31 Restaurants tab, viewer part | Pass | |

**All 31 steps of the manual script are recorded as passed, on the iOS Simulator only (run by Archan).** Not run on a real iPhone or on Android, and not run with VoiceOver or TalkBack; those stay in `docs/product/v1.md` §16 as before-launch items.

Not covered by this script (tracked in `docs/product/v1.md` §16): a real iPhone, Android, VoiceOver and TalkBack, Android font scale 2.0, `customMapStyle` on Android, the services-off state.

## Seed data
`scripts/seed/restaurants.ts` is extended so one command seeds restaurants **and** homemade cooks (still local only, still refuses a non-local URL, key from `SEED_SERVICE_ROLE_KEY`, never printed, safe to re-run, only touches `seed-*@example.com`). Homemade data lives in a new `scripts/seed/homemadeData.ts`.
- **Real shift:** homemade businesses are created through the real `set_business_location` path so the 200–500 m shift is real; place IDs are fake (`FAKE_PLACE_…`).
- **Cooks (fictional names):** about 13 visible cooks: Oshawa 5, Cambridge 3, a tight Toronto group of 5 that clusters when zoomed out and whose circles overlap when zoomed in.
- **Photo variety (uploaded to the local `business-media` bucket through the service role, EXIF-free JPEGs from `scripts/seed/photos/`):** "Nonna Rosa's Table" (cover, 3 gallery, 2 menu photos, items); one cook with items only and no photos; one with menu photos only; one with a cover only; one whose photo row exists but whose file is missing (the "Photo unavailable" case).
- **Hidden cases:** "Stale Samosas" (`resolved_at` 31 days old), "Gone Place" (`place_status = 'not_found'`), "Unlisted Kitchen" (`is_listed = false`).
- **Accounts:** `seed-homemade-1@example.com` (owner of Nonna Rosa's Table), `seed-homemade-stale@example.com` (owner of Stale Samosas); existing restaurant seeds are unchanged.
- Re-run deletes and re-creates only seed accounts and their storage objects.

## Test fakes
Tests use the spec 07 fakes in `jest.setup.ts`, extended where needed, never replaced:
- `react-native-maps`: events bubble from `Marker`/`Circle` to `MapView` unless stopped; `__setIgnoreStopPropagation(true)` models a platform where stopping has no effect; `Circle` records `center`, `radius` and `onPress`.
- `@gorhom/bottom-sheet`: the spec 07 fake, including its scroll components.
- `expo-location`: the spec 07 fake.
No test file defines its own map or sheet mock.

## Out of scope
- **Pickup requests, table requests, the exact-address reveal after acceptance, request notifications:** specs 09, 10, 11, 12. The area note names the future reveal only in words.
- **Report seller:** spec 17. **Ads / promoted markers:** spec 16. **Final legal wording and legal pages:** spec 18 (the disclaimer here is placeholder wording).
- Search, filters, cuisine filter, ratings, reviews, saves, delivery, live location (§3).
- Changing the homemade shift, the refresh job, rate-limit numbers or the 100-call quota (spec 05 and 07 decisions).
- Server-side photo metadata check, account deletion, storage monitoring (§16).
- Pinch-to-zoom in the photo viewer (see Open questions).

## Definition of done
**Database (PR 1)** (run pgTAP before seeding any local demo data)
- [x] `anon` and `authenticated` can execute exactly `map_homemade_in_bounds` and `get_homemade_details` among the new functions; `private.homemade_is_fresh` is not executable by them (42501); the allowlist test is updated.
- [x] `map_homemade_in_bounds` returns only fresh homemade businesses: a homemade row with `resolved_at` 29 days old appears, 31 days old does not, and it appears again after `apply_places_refresh('ok', …)`.
- [x] A restaurant, an unlisted homemade, a `not_found` homemade, a homemade with no `map_lat` and a stale homemade never appear in `map_homemade_in_bounds`; `get_homemade_details` returns `null` for each, for a restaurant id and for a random uuid, with the same value.
- [x] `map_restaurants_in_bounds` never returns a homemade business and `get_restaurant_details` returns `null` for a homemade id (unchanged; pinned by a test).
- [x] **Outsider cannot** (as `anon` and as another signed-in user) read a homemade business's exact coordinates, `business_locations` row, `place_id`, address, `resolved_at` or `place_status`: not through either function, not through any table (42501), and the pin and details JSON contain no key for them. A returned pin's `lat/lng` equal `businesses.map_lat/map_lng` and differ from `business_locations.lat/lng` by 200–500 m.
- [x] **Outsider cannot** `select` `businesses.map_lat`, `map_lng` or `public_address` (42501; unchanged from spec 07).
- [x] Box rules for homemade match restaurant: inverted/null/NaN raise `invalid_bounds`; latitude clamped; a box over 90° returns `too_large` with no scan; a box crossing the 180° line returns both sides; 501 rows → 500 pins and `capped = true`, exactly 500 → `capped = false`.
- [x] Rate limits: the 121st `homemade_pins` call in a minute raises `rate_limited` (31st for `homemade_details`); a different caller is unaffected; the guest ceiling applies to the homemade kinds; the counters are separate from `pins`/`details` (using up one does not limit the other).
- [x] `business_owner_view.map_status` for homemade is `visible`, `place_not_found` or `needs_refresh` by the same rule as restaurants, and null with no saved address; restaurant results are unchanged.
- [x] A homemade photo of a fresh listed business is readable by `anon` through the existing storage policy, and not when the business is unlisted.
- [x] `src/types/database.ts` regenerated; existing migrations untouched; every spec 05, 06 and 07 pgTAP test passes unedited (apart from the allowlist). One approved assertion edit in spec 07: the homemade `map_status` assertion now expects `visible` instead of null (Decision 4).

**App (PR 2)**
- [x] The Homemade tab shows a Google map (`PROVIDER_GOOGLE`) for guests, with homemade flags only. *(jest + manual 2.)*
- [x] Circles: 500 m radius around each stored point while zoomed in (`latitudeDelta ≤ 0.05`), none when zoomed out or for clustered pins; no exact or computed point is ever drawn (jest on the fake `Circle` props). *(jest + manual 3.)*
- [x] Pins load by visible area after the person stops moving (400 ms); late answers are dropped; old pins stay (jest, same as spec 07, against the homemade hooks). *(jest: HomemadePinsLoading, with deliberate breaks for the debounce, the old pins and the area key.)*
- [x] `rate_limited` keeps old pins, shows "Try again in a moment", is not retried; 500 pins → "Zoom in to see more"; `too_large` → "Zoom in to see homemade cooks".
- [x] Tapping a flag opens the sheet at half, the sheet is **not** closed by the bubbled map press (fake with stop-propagation ignored: the map handler alone keeps it open), and the map does not move; tapping a cluster zooms in. *(jest + manual 6.)*
- [x] The sheet shows exactly, in this order (Decision 15): the fixed header (name, flag + cuisine name); a short cover banner (88 pt; nothing and no placeholder without a cover); the small safety row; menu-page thumbnails (96 pt); menu items with price and availability in the cook's own currency; the gallery ("No photos yet" only with neither cover nor gallery); the area note. **No** address, Directions, place ID, coordinates, Request or Report buttons or placeholders (jest asserts their absence and the order). *(jest SheetOrder/HomemadeSheet + Gate E manual run.)*
- [x] The safety row's title and info icon are visible at the half snap without scrolling; the full text opens inline in one tap and closes in one; collapsed at every text size; at the largest text size the row and the open text are complete (not truncated); a screen reader hears the whole warning on the collapsed row (jest). *(jest HomemadeSafetyRow + Gate E manual run incl. large text.)*
- [x] Photo viewer: tapping a photo in the map sheet (both tabs) opens it, and on the seller Photos screen the photo options offer "View larger" (Decision 9) which opens it; swipe changes photo; X, backdrop and Android back close it; counter "Photo n of m"; broken photo shows "Photo unavailable" once; Reduce Motion gives no animation; seller editing on the Photos screen is unchanged (jest). *(Manual: sheet viewers covered by the Gate E run; steps 16-18 and 30 still to record.)*
- [x] "Places in this area" lists the visible cooks; picking one moves the camera and stacks the sheet on the list; X and swipe go back; from a flag they close (jest + manual 19–21). *(jest + manual 19-21.)*
- [x] Opening view order, locate me, denied/denied-forever/services-off states and the grid-snapped request box behave exactly as on Restaurants for the Homemade tab; no request argument contains the person's position (jest, homemade call included). *(jest + manual 24-25.)*
- [x] Manage Business shows the status line for homemade in each of its three states with homemade wording, nothing without a saved address; restaurants unchanged. *(jest; manual 28-29 still to record.)*
- [x] Every spec 07 jest test passes unchanged after the shared-screen refactor. *(only jest.setup.ts and the two spec 03 stand-ins differ from main.)*
- [x] All screens handle loading, empty, error (with retry) and success; every touchable has a role and label with ≥ 44 pt target.
- [x] The Known pitfalls checklist is fully ticked, and the manual acceptance script was run on the iOS Simulator with the result of each step recorded in this spec. *(All 31 steps recorded as passed on the iOS Simulator, run by Archan; no real iPhone or Android run.)*
- [x] `npm run lint`, `npm run typecheck`, `npm test`, `npx supabase test db` pass; CI green. *(lint, typecheck and jest run locally: 110 suites, 1786 tests. `supabase test db` and the build run in CI on this PR, which is merged only when green.)*

## Test plan
- **pgTAP (`08-homemade-map.test.sql`):** every PR 1 item above, impersonating `anon`, a signed-in outsider, the owner and `service_role`. Fixtures: homemade at 1, 29 and 31 days; restaurant; unlisted; `not_found`; no `map_lat`; 501 homemade in a box; a box crossing the date line; a homemade photo of a fresh and of an unlisted business. `column_privs_are` and an allowlist check.
- **jest (written from this spec, using the spec 07 fakes):**
  - `homemadeApi`: sends only the box and the id; error codes; zod rejects a payload with an address, `place_id`, coordinates beyond `lat/lng` of the pin, or extra keys.
  - `HomemadeMapScreen`: the four states; notices; circles on/off by zoom and never for clusters; marker labels include "homemade, approximate area".
  - **Bubbling:** flag press with the fake bubbling → sheet stays open; with `__setIgnoreStopPropagation(true)` → sheet still stays open (second layer); circle press follows Decision 7.
  - `HomemadeSheet`: disclaimer and area note present at the half snap; no address, Directions or Request/Report; currency formatting; null → "This cook isn't available right now."; error with Retry; back-to-list stack and labels; bottom space follows the snap.
  - `HomemadeMapPrivacy`: no request argument contains the person's position; two positions in one grid cell send identical boxes; the sent box contains the visible box (also across the date line).
  - `PhotoViewer`: open, swipe, counter, close by X/backdrop/back, failure message once, reduce-motion, labels and roles; the three callers open it.
  - Shared refactor: all spec 07 map, sheet, list and marker tests pass unchanged.
  - Seed script safety tests (`scripts/seed/__tests__`): refuses a non-local URL; only seed accounts are touched. *(Covered by `safety.test.ts`, which pins the local-URL guard and the `isSeedEmail` allow-list the whole seed, homemade included, runs behind, plus `homemadeData.test.ts`, which proves every account the homemade seed creates passes `isSeedEmail`, so a re-run deletes all of them and nothing else.)*
- **Manual (Archan):** the 31-step script above.

## Product spec changes (PR 1 `docs/product/v1.md`)
- §16 "Homemade read function → spec 08" closed with this spec.
- §16 "Photo viewer → spec 08" closed when PR 2 ships.
- §16 "Google terms review → before launch": add "whether a homemade point shifted from a Google coordinate counts as cached Google content (spec 08 treats it as such; the legal read can relax this)".
- §16 "Refresh capacity": the 2,500-business capacity already counts homemade; no change.
- §16 new before-launch items from the manual run: the not-yet-checked list (real iPhone, Android, VoiceOver/TalkBack for homemade, services-off state).
- Product spec §6 says the sheet carries "Request pickup … Report"; those arrive in specs 09, 11, 17 and are deliberately absent here. No change needed.

## Decisions
1. **Same 30-day rule for homemade.** The shifted point is derived from a Google coordinate, so it is treated as Google content; homemade is hidden when the address is 30 days old, and the existing refresh job keeps it fresh. The legal read can relax this later by a one-function migration. (Archan, answer to open question 1)
2. **Flag inside a 500 m circle.** A flag at the stored point inside a translucent circle of radius 500 m (the maximum shift, so the real home is always inside), drawn only when zoomed in; zoomed out, flags cluster like Restaurants. (Archan, answer to open question 2)
3. **Safety note, small, in the sheet (amended after the Gate D run):** a one-line row "Food safety and allergies" with an info icon, collapsed at every text size; the full note opens inline on a tap (no popover: nothing floats over the bottom sheet, it scales with text, and it is a standard disclosure for screen readers). The whole row is the button; a screen reader hears the whole warning on it. Wording in one constant, marked placeholder until spec 18. (Archan; the original version was a labelled box visible at the half snap.)
4. **Homemade status line in Manage Business:** the same three `map_status` words and the existing `MapStatusLine`, with homemade wording. (Archan, answer to open question 4)
5. **No address and no Directions on the homemade sheet;** an "approximate area only" note instead. No area-name lookup. (Archan, answer to open question 5)
6. **One map screen, two configs.** The Restaurants screen is refactored into a shared screen (no behaviour change); the last viewed region is stored per tab; the "Not now" location note is remembered once for both. (Claude's default, from the product spec §6 saying both tabs use the same map; not asked.)
7. **The circle is not tappable.** Checked in the installed react-native-maps 1.29.11: `Circle` has no `onPress`, no `tappable` and no `stopPropagation` on iOS or Android (`stopPropagation` exists only on `Marker`; Android's `overlay-press` belongs to ground overlays). A tap inside a circle is therefore a plain map press (iOS: no `action`; Android: `action: 'press'`) and clears the selection like any bare-map tap; only the flag opens the sheet. The jest `Circle` fake has no press either, and tests assert the real element gets no `onPress`. (Claude's default; confirmed in the Gate C simulator run, step 9.)
8. **Own rate-limit kinds** (`homemade_pins`, `homemade_details`), same numbers as restaurants, so one tab cannot use up the other's quota. (Claude's default.)
9. **"View larger" on the seller Photos screen.** The existing photo options gain a "View larger" action that opens the photo viewer; tiles still open the options as before, so editing is not disturbed. (Archan, answer to open question 1)
10. **No pinch-to-zoom in v1 of the viewer.** Swipe between photos and show each whole on screen. (Archan, answer to open question 2)
11. **Two PRs.** PR 1 on `feature/homemade-map-backend` (this branch, renamed from `feature/homemade-map`), PR 2 on `feature/homemade-map-app` from `main` after PR 1 is merged. (Archan, answer to open question 3)
12. **Seed photos are generated, plain-colour, fictional images,** so no licence or privacy question arises. (Archan, answer to open question 4)
13. **Gate A review answers (Archan).** (a) The spec 07 assertion "map_status is null for homemade" (`07-restaurant-map.test.sql`) is changed to expect `visible`; it is the only edit to that file, forced by the `business_owner_view` change. (b) The box rules are copied into `map_homemade_in_bounds`, not extracted, and pgTAP equivalence tests keep the two functions in step. (c) Photo and menu visibility is left as spec 06 built it (`private.business_is_public` ignores freshness); noted in `docs/product/v1.md` §16.
14. **Also changed by the migration, not named in the sketch above:** `private.consume_map_quota` is replaced to know the two new kinds (it hard-codes them), and the spec 05 pgTAP list of `private` functions gains `homemade_is_fresh`.
15. **Menu first, in both sheets (Archan, after the Gate D run).** The menu is what people open the sheet for, so both sheets (Restaurants and Homemade) now use this order: the fixed header (name, flag, cuisine); a short **cover banner** at the top of the scroll content (88 pt, cropped to fill, tap opens the photo viewer; nothing shown and no placeholder when there is no cover); *homemade only* the small safety row; the **menu-page photos as small 96 pt thumbnails** (a tap opens the viewer, closing returns to the small view); the **menu items**; the **gallery** ("No photos yet" only when there is neither a cover nor a gallery); and at the very bottom the **address and Directions** (restaurant) or the **"approximate area only" note** (homemade). The banner and the gallery page together in one viewer (the banner opens at photo 1, a swipe reaches the gallery); the menu thumbnails have their own. *(Spec 09 Gate F note: a fixed action row, today Request pickup, now sits between the header and the scrolling content in both sheets, hidden at the collapsed snap, so the order below is otherwise unchanged and the scroll area at half is about 56 pt shorter.)* This **supersedes the sheet order of spec 07** (cover and gallery first, address and Directions after the menu); spec 07 carries a note. At the half snap (about 280 pt of scroll area on an 844 pt phone; an estimate, checked in the Simulator) a restaurant shows the banner, "Menu" and the thumbnails with the first item row at the fold; a cook shows the banner, the safety row, "Menu" and most of the thumbnails; item rows come with a scroll or at the full snap. `PhotoTile` gained an optional `width` (default square) for the banner.

## Open questions
All four were answered by Archan and are recorded as Decisions 9–12.
