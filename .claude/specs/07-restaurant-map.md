# Spec 07: Restaurant Map

**Branch:** two PRs from this one spec (same pattern as spec 06)
- PR 1 (backend only: migration, index, map and details functions, 30-day guard, refresh job and its Edge Function, abuse guard, pgTAP and Deno tests): `feature/restaurant-map-backend` (this branch; renamed from `feature/restaurant-map` before its first push)
- PR 2 (the app: libraries, map, markers, clustering, location flow, sheet, Directions, jest tests): `feature/restaurant-map-app`, created from `main` after PR 1 is merged. **Blocked on Archan's development-build decision (see "Development build").**
**Product spec:** `docs/product/v1.md` §6 Map, §5 (Sellers & listings, Homemade specifics), §4 (guests can browse), §3 (out of scope), §14 row 07, §16 (Google map provider, Places coordinate refresh, Photo viewer, Google terms review)
**Plan mode:** required — adds a migration (functions, index, tables, three cron jobs), RLS and grants; adds an Edge Function; adds several dependencies and native config; adds a route and navigation changes; touches well over ~5 files.
**Status:** 🚧 In progress (PR 1 started; only PR 2 sets ✅ Shipped)

## Overview
After this ships, anyone, signed in or not, can open the **Restaurants** tab and see a full-screen **Google map** of restaurants, each as its country flag (or a neutral cuisine icon). Pins group into clusters when zoomed out. The map loads only the restaurants in the visible area. Tapping a pin opens a draggable bottom sheet (collapsed / half / full) with the restaurant's name, flag, cover photo and gallery, menu (items, prices, availability, menu photos), address and a **Directions** link that opens Google Maps.

The map opens where it is most useful. If the person allows location (optional, while-using-the-app only), it centres on them. If not, it falls back to the last area they viewed, then their phone's country, then a plain world map with a "Zoom in to see restaurants" note.

Google's rules shape the backend. Google lets us cache a Places coordinate for at most 30 consecutive days, so PR 1 adds (a) a **30-day guard** inside every public map query, so a restaurant whose coordinates are older than 30 days simply doesn't appear, and (b) a **scheduled refresh job** that re-fetches coordinates by place ID before they expire. Google also requires Places content to be shown on a Google map, so the map uses the Google provider on both iOS and Android.

**Why now:** menus and photos (06) exist, and everything after this (requests 09/11, ads 16, reports 17) hangs off the map and its sheet.

## Depends on
- 03 navigation-shell ✅ (Restaurants tab stub)
- 04 cuisine-catalog ✅ (flags / icons)
- 05 seller-onboarding ✅ (`businesses.map_lat/map_lng`, `business_locations`, `places-resolve`, Google decisions)
- 06 menu-management ✅ (menu, photos, signed URLs, price formatting)

## Context to load
- `CLAUDE.md`
- `docs/product/v1.md` §3, §5, §6, §16
- This spec
- `.claude/skills/map-markers/SKILL.md`, `.claude/skills/supabase-patterns/SKILL.md`, `.claude/skills/liketoorder-ui/SKILL.md`
- **PR 1:** `supabase/migrations/20261103215641_seller_onboarding.sql` (businesses, `business_locations`, `places_rate_limits`, `consume_places_quota`, `set_business_location`, function style), `supabase/migrations/20261104035153_menu_management.sql` (`private.business_is_public`, menu and photo tables), `supabase/tests/05-seller-onboarding.test.sql` (function allowlist, impersonation pattern), `supabase/tests/00_rls_enabled.test.sql`, `supabase/functions/_shared/{google,http,rateLimit}.ts`, `supabase/functions/places-resolve/{handler,index}.ts`, `supabase/functions/tests/helpers.ts`, `supabase/config.toml`
- **PR 2:** `app/(tabs)/restaurants.tsx`, `app/(tabs)/_layout.tsx`, `app.config.ts`, `.env.example`, `src/lib/env.ts`, `src/lib/queryClient.ts`, `src/features/cuisines/{api.ts,hooks/useCuisines.ts,components/CuisineLabel.tsx}`, `src/features/menu/{api.ts,price.ts,photos.ts}`, `src/features/media/{components/PhotoTile.tsx,hooks/useSignedUrls.ts}`, `src/components/ui/index.ts`, `src/theme/tokens.ts`, `jest.setup.ts`

## User stories
- As a guest or signed-in user, I can open the Restaurants tab and see restaurants on a map as flags, without signing in.
- As a user, I can zoom out and see nearby restaurants grouped into clusters, and tap a cluster to zoom in.
- As a user, I can tap a flag and read the restaurant's photos, menu, prices and address in a bottom sheet, while the map stays where it was.
- As a user, I can tap Directions and get walking or driving directions in Google Maps.
- As a user, I can optionally let the app centre the map on me, and the app works fully if I say no. My location never leaves my phone.
- As a screen-reader user, I hear each place's name and cuisine, and I can reach every action without the map.
- As a restaurant owner, my pin never silently breaks the Google caching rule: it is refreshed before 30 days and hidden if it can't be.
- As a homemade seller, my exact address is never used on this map. (Homemade pins are spec 08. This spec only guarantees they never appear here.)

## Screens & routes
- `app/(tabs)/restaurants.tsx` (change) — renders `RestaurantMapScreen`. Access: public (guests included).
- No new route for the sheet. It is a component over the map; selection is screen state (`selectedId`), per the `map-markers` skill.
- The Homemade tab stays a stub (spec 08).

States the screen must handle (CLAUDE.md "4 states"):
- **Loading:** first load shows the map with a small "Loading restaurants" indicator. Panning keeps the old pins on screen while the new area loads (no flicker).
- **Empty:** no restaurants in the visible area → friendly card "No restaurants here yet" with a "Zoom out" hint. Never a blank map with no explanation.
- **Error (with retry):** the pin query failed → a non-blocking banner with Retry. The old pins stay.
- **Success:** pins, clusters, sheet.
- **Zoomed out too far** (server says `too_large`) or **capped** (500 pins): see below.

## Database changes
One migration, `npx supabase migration new restaurant_map` (PR 1). Never edit an existing migration.

```sql
-- ── 30-day freshness and place status ──────────────────────────────────────────
alter table public.business_locations
  add column place_status text not null default 'ok'
    check (place_status in ('ok', 'not_found')),
  add column refresh_attempted_at timestamptz;      -- server time; set on every refresh try (ok or failed)
-- 'not_found' hides the restaurant from the map and keeps the record (Decision 6). There is no 'closed' status (Decision 11).
-- set_business_location() resets place_status to 'ok' and refresh_attempted_at to null when the owner saves a new address
-- (replaced with create or replace in this migration; behaviour otherwise unchanged).

create index business_locations_refresh_idx on public.business_locations (resolved_at)
  where place_status = 'ok';

-- Fast bounding-box reads for the map (no spatial extension).
create index businesses_restaurant_map_idx on public.businesses (map_lat, map_lng)
  where is_listed and type = 'restaurant' and map_lat is not null;

-- ── Abuse guard for the public map functions (works for guests) ───────────────
create table public.map_rate_limits (
  caller_key    text not null,                  -- 'u:<uid>', 'ip:<address>', or 'guest:all' (global guest ceiling)
  kind          text not null check (kind in ('pins', 'details')),
  window_start  timestamptz not null,           -- start of the 1-minute window (server time)
  calls         integer not null default 0,
  primary key (caller_key, kind, window_start)
);

-- ── Refresh job quota (separate from the user quotas of spec 05) ──────────────
create table public.places_refresh_quota (
  day    date primary key,                      -- UTC day
  calls  integer not null default 0 check (calls >= 0)
);
```

### Freshness rule (the "fresh" test used everywhere)
A restaurant is **fresh** when all of these hold:
`businesses.is_listed` and `businesses.type = 'restaurant'` and `map_lat is not null`, and its `business_locations` row has `place_status = 'ok'` and `resolved_at > now() - interval '30 days'`.
This is one SQL helper, `private.restaurant_is_fresh(p_business_id uuid)`, used by both public functions so the rule cannot drift. It is `security definer`, `set search_path = ''`, executable only by the owner role and the two public functions' definer (revoked from `public`, `anon`, `authenticated`).

### RLS and grants
- `map_rate_limits` and `places_refresh_quota`: `enable row level security`, `revoke all … from anon, authenticated`, no policies. Only security-definer functions touch them.
- `business_locations` stays closed (no grants, no policies). The new columns are not readable by anyone but functions.
- `businesses`: a second migration (`restaurant_map_hardening`) **revokes `select` on `map_lat`, `map_lng` and `public_address` from `anon` and `authenticated`**. These come from Google Places (a restaurant's exact point and formatted address; a homemade point is derived from one), and a direct read skipped both the 30-day guard and the rate limit (Decision 2, Decision 20). They are read only through `map_restaurants_in_bounds` and `get_restaurant_details` (security definer) and, for the owner, through `get_my_business`. The other readable columns (`id`, `type`, `name`, `cuisine_code`, `accepts_table_requests`, `currency_code`) are chosen by the owner or by us and stay as in spec 05/06. **For spec 08:** homemade needs its own read function; it can no longer read homemade map points straight from `businesses`.

### Functions
| Function | Who may execute | What it does |
|---|---|---|
| `map_restaurants_in_bounds(p_min_lat double precision, p_max_lat double precision, p_min_lng double precision, p_max_lng double precision) returns jsonb` | `anon`, `authenticated` | Validates the box (rules below), applies the rate limit (Decision 4), then returns only fresh restaurants. `security definer`, `set search_path = ''`, `set statement_timeout = '3s'`. Result: `{ "pins": [{ "id", "name", "cuisine_code", "lat", "lng" }], "capped": boolean, "too_large": boolean }`. Pins hold only the public `map_lat/map_lng` of spec 05 (for restaurants, the real location), never `place_id`, address or `resolved_at`. |
| `get_restaurant_details(p_business_id uuid) returns jsonb` | `anon`, `authenticated` | Rate-limited. If the business is not fresh (hidden place, unlisted, homemade, stale, or no such id) it returns **`null`**, identical for every cause, so nothing leaks about why. Otherwise returns one object: `id, name, cuisine_code, accepts_table_requests` (kept for later specs, not shown here), `public_address, place_id, currency_code`, `photos` (`[{id, kind, path, position, menu_item_id}]`, `status = 'ready'` only), `items` (`[{id, name, description, price_minor, is_available, position}]` ordered by `position`). Exact coordinates, `resolved_at` and `place_status` are never included. |
| `private.restaurant_is_fresh(uuid) returns boolean` | none directly | The freshness rule above. |
| `private.consume_map_quota(p_kind text) returns void` | none directly (called by the two public functions) | Rate limit: a per-caller limit plus a global ceiling for guests (Decision 4). Raises `rate_limited` (SQLSTATE `P0001`, message `rate_limited`) once over either. |
| `claim_places_refresh_batch(p_batch integer) returns table(business_id uuid, place_id text, type text)` | **service_role only** | Takes up to `least(p_batch, 25, remaining daily allowance)` rows (see Decision 5), returns the oldest due rows and charges the daily quota for the rows **actually returned**, not for the allowance. Due = `place_status = 'ok'` and `resolved_at < now() - interval '25 days'` and (`refresh_attempted_at is null` or `refresh_attempted_at < now() - interval '1 day'`), ordered by `resolved_at` ascending, `for update skip locked`. Stamps `refresh_attempted_at = now()` on the rows it returns, so a repeatedly failing row can't hold up the queue. |
| `apply_places_refresh(p_business_id uuid, p_outcome text, p_lat double precision, p_lng double precision) returns void` | **service_role only** | Outcomes: `'ok'` (needs lat/lng), `'not_found'`. `ok`: updates `business_locations.lat/lng`, sets `resolved_at = now()`, `place_status = 'ok'`; **restaurants** also get `businesses.map_lat/map_lng` set to the new point; **homemade** rows leave `map_lat/map_lng` untouched (Decision 7). `not_found`: sets `place_status` and leaves everything else; the record is kept. A transient Google failure calls nothing (the row is retried after a day). Unknown outcome raises `invalid_outcome`; `ok` without lat/lng raises `invalid_coordinates`. **Apply guard:** a result is applied only to a row with an outstanding claim, i.e. `refresh_attempted_at is not null` (set by the claim). `set_business_location` clears `refresh_attempted_at`, so a refresh claimed for the owner's old address can never overwrite the address they have just saved. A result for a row without a claim, or for a missing row, is a quiet no-op. |
| `public.business_owner_view` (changed with `create or replace`; `get_my_business` just returns it) | existing grants unchanged (still callable by nobody directly) | Adds one key to the owner's own view: `map_status`, for **restaurants only**. Rule, in order: `'place_not_found'` when `place_status = 'not_found'`; `'needs_refresh'` when `resolved_at` is 30 days old or older (the pin is hidden); otherwise `'visible'`. It is **null** for homemade (spec 08 decides theirs) and **null for a restaurant with no saved address** (no location row yet). `place_not_found` wins when both it and `needs_refresh` are true. Nothing else about coordinates or `resolved_at` is exposed; the owner sees only the three words. |
| `private.cleanup_map_rate_limits() returns void` | cron job owner only | Deletes `map_rate_limits` rows with `window_start` older than 1 hour. Run **hourly** by `pg_cron`. |
| `private.cleanup_places_refresh_quota() returns void` | cron job owner only | Deletes `places_refresh_quota` rows older than 30 days. Run **daily** by `pg_cron`. |
| `private.invoke_places_refresh() returns void` | cron job owner only | Calls the Edge Function with `pg_net` (see "Refresh job"). No-ops silently when the vault secrets don't exist (CI, tests, local). |

**Privileges:** every new function is created with `revoke execute … from public, anon, authenticated` then granted explicitly as in the table. The spec 05 pgTAP function allowlist is updated: `anon` and `authenticated` may execute exactly `map_restaurants_in_bounds` and `get_restaurant_details` in addition to spec 05/06's list; `claim_places_refresh_batch`, `apply_places_refresh` and the `private.*` functions are executable by `service_role`/owner only.

### Bounding-box rules (`map_restaurants_in_bounds`)
| Case | What happens |
|---|---|
| Any argument null, NaN or infinite | Raises `invalid_bounds`. |
| `p_min_lat > p_max_lat` (inverted) | Raises `invalid_bounds`. |
| Latitude outside ±90 | Clamped to ±90 (a tilted or zoomed-out map can report it). |
| Longitude outside ±180 | Normalised into [−180, 180) (wraps). |
| Latitude span > 90° **or** longitude span > 90° (before normalising) | Returns `{ "pins": [], "capped": false, "too_large": true }` with no database scan. This covers the whole world and continent-size views. The app shows "Zoom in to see restaurants". This is a normal answer, not an error. |
| After normalising, `p_min_lng > p_max_lng` (the box crosses the 180° line) | Reads as two ranges: `lng >= p_min_lng OR lng <= p_max_lng`. |
| Spans of exactly 0 (a point) | Allowed; returns what sits exactly there (practically empty). |

**Cap:** the function reads `limit 501`. If 501 rows come back it returns the first 500 with `"capped": true`. Which 500 is stable but arbitrary (ordered by `id`); the cap exists to bound cost and payload, and zooming in shows the rest. The cap is enforced in SQL; the app cannot ask for more.

### Refresh job
**Extensions:** the migration runs `create extension if not exists pg_cron`, `pg_net` and `supabase_vault` (the Vault extension). I expect all three to be available on the local Supabase stack and in CI's database start, but this is not yet verified; Gate A starts with `npx supabase start` plus `select * from pg_available_extensions where name in ('pg_cron','pg_net','supabase_vault')` and reports back before the migration is relied on. If one is missing, the migration fails loudly rather than skipping, and the spec is updated before going on. The pgTAP file starts with a check that all three are installed and the three cron jobs exist: if an extension is missing that check fails with a clear message (it does not silently skip), while the tests that don't need them still run.

**What runs:** three `pg_cron` jobs (UTC): `places-refresh` runs `private.invoke_places_refresh()` every 6 hours (`0 */6 * * *`); `map-rate-limits-cleanup` runs `private.cleanup_map_rate_limits()` every hour (`0 * * * *`); `places-refresh-quota-cleanup` runs `private.cleanup_places_refresh_quota()` once a day (`30 3 * * *`). Cleanup never happens inside a pin query (Decision 4). The refresh job sends an HTTPS POST with `pg_net` (60-second timeout) to the Edge Function `places-refresh`.

**How it is authenticated (the function must not be callable by app users):**
- A random secret `REFRESH_CRON_SECRET` exists in two places only: the Edge Function's secrets (`supabase secrets set`) and the Supabase Vault (names `places_refresh_secret` and `places_refresh_url`). `invoke_places_refresh()` reads both from `vault.decrypted_secrets` and sends the secret in the header `x-cron-secret`.
- `places-refresh` is configured `verify_jwt = false` (cron has no user JWT) and rejects any request whose `x-cron-secret` doesn't match, using a constant-time comparison, with `401` and no body. The Google key and the secret are never logged. Without `REFRESH_CRON_SECRET` set, the function returns `500 not_configured` and does no work.
- The function talks to the database with the service role (provided by the Edge runtime) and calls only `claim_places_refresh_batch` and `apply_places_refresh`, which `anon` and `authenticated` cannot execute (pgTAP).
- A caller who somehow reached the function without the secret, or an app user calling the database RPCs, gets nothing.

**What it does per run (Decision 5):**
0. Before anything else: no `REFRESH_CRON_SECRET` or no `PLACES_API_KEY` → `500 not_configured` with no claim, so a missing key can't use up the day's quota or delay rows.
1. `claim_places_refresh_batch(25)`. The daily allowance is checked inside the claim.
2. For each row, `GET places/{place_id}` with field mask `id,location` (the same Essentials fields as spec 05; no business-status field is requested).
3. Result → outcome: location returned → `ok`; Google answers `NOT_FOUND` (the place ID is obsolete) → `not_found`; any other error, timeout or a response without a location → no change, retried after a day. A closed business is not detected (Decision 11).
4. `apply_places_refresh` for each, **one row at a time**: the next Google call starts only after the previous result is saved, and every Google call has its own **5-second** timeout. A run that stops partway loses nothing: finished rows are saved, unfinished ones were stamped by the claim and come back after a day. A row whose save fails counts as `failed` and the run goes on. Google's body is never returned or logged.
5. The response is only counts: `{ claimed, ok, not_found, failed }`.

**Numbers (all enforced in SQL, not just the function):**
- Run schedule: every 6 hours (4 runs/day).
- Batch: at most **25 rows per run**.
- Daily cap: at most **100 Google calls per UTC day**, stored in `places_refresh_quota`, separate from `places_rate_limits` (spec 05). The cap holds even if the job is triggered extra times by hand.
- Refresh starts at **25 days** old, so there are 5 days of margin before the 30-day guard hides a pin. Oldest first.
- **Homemade businesses use the same refresh quota** (their `business_locations` coordinates are Google-cached too). So at 100 calls/day the job keeps up with about **2,500 businesses in total, restaurants and homemade together** (100/day × 25 days). Beyond that the 30-day guard hides the oldest restaurants (homemade guard: spec 08). Raising the cap is a one-line migration (Decision 14).

**Local stack:** the cron jobs exist but `invoke_places_refresh()` does nothing until the two vault secrets are set. To run it locally: put `REFRESH_CRON_SECRET=<any random string>` and `PLACES_API_KEY=<key>` in `supabase/functions/.env` (gitignored; you set these, Claude never reads or prints them), run `npx supabase functions serve places-refresh --env-file supabase/functions/.env`, then trigger one run by hand with curl and the `x-cron-secret` header, or set the two vault secrets locally (url `http://host.docker.internal:54321/functions/v1/places-refresh`) and run `select private.invoke_places_refresh();`. Tests and CI need neither.

**Production steps for Archan (at launch; Claude never runs these):**
1. Generate a secret locally, e.g. `openssl rand -hex 32`. Don't paste it anywhere else.
2. `npx supabase secrets set REFRESH_CRON_SECRET=<secret>` against the linked project (the `PLACES_API_KEY` secret from spec 05 is already used).
3. Deploy the function: `npx supabase functions deploy places-refresh --no-verify-jwt` (through the release process, not a session).
4. In the dashboard SQL editor: `select vault.create_secret('<secret>', 'places_refresh_secret');` and `select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/places-refresh', 'places_refresh_url');`
5. Check `select * from cron.job;` shows the job, wait for (or run) `select private.invoke_places_refresh();`, then check `select * from cron.job_run_details order by start_time desc limit 5;` and `select * from net._http_response order by created desc limit 5;`.
6. Rotating the secret: repeat steps 1, 2 and `vault.update_secret(...)`.

## Storage
None added. Photos in the sheet use the existing private `business-media` bucket and spec 06's rules: signed URLs through `useSignedUrls` (1-hour URLs, stale after 50 minutes, renew once per path per mount, `PhotoTile` with a `cacheKey` of the stored path). The details function returns the storage paths; signing still needs the spec 06 read policy (`private.business_is_public`).

## Edge Functions
**`places-refresh`** (PR 1)
- Input: POST, no body used. Header `x-cron-secret`.
- Output: `200 { claimed, ok, not_found, failed }`, `401` bad/missing secret (no body), `405` for anything but POST, `500 not_configured` (no secret, or no Google key; both checked before any work). `NOT_FOUND` means HTTP 404 **and** a body whose `error.status` is `NOT_FOUND`; any other 404 counts as `failed`.
- Secrets: `REFRESH_CRON_SECRET`, `PLACES_API_KEY` (spec 05's), service role (provided by the runtime). Never read, printed or set by Claude.
- Files: `supabase/functions/places-refresh/{index,handler}.ts` (injected `fetch`, DB client and clock, same pattern as `places-resolve`); extends `_shared/google.ts` with `getPlaceLocation(placeId)` (field mask `id,location`; distinguishes `NOT_FOUND` from other failures).

## Components & hooks (PR 2)
- `src/features/map/api.ts` — **all** map Supabase calls: `fetchPinsInBounds(box)` → `map_restaurants_in_bounds`, `fetchRestaurantDetails(id)` → `get_restaurant_details`. Sends only the map box and the id. `mapMapError` with codes `'invalid_bounds' | 'rate_limited' | 'network' | 'unknown'`.
- `src/features/map/schema.ts` — zod schemas for both responses.
- `src/features/map/hooks/usePinsInBounds.ts` — react-query, key `['map','pins', roundedBox]`, `placeholderData: keepPreviousData` (old pins stay while loading), `staleTime` 60 s. The box is rounded to ~3 decimals so tiny pans share a cache entry. **`rate_limited` is never retried:** the query's `retry` returns false for that error (and `invalid_bounds`), other errors retry at most once; the screen keeps the old pins, shows a calm note "Try again in a moment" (no error styling, no Retry loop), and sends no new request until the person moves the map again or taps the note's "Try again" button.
- `src/features/map/hooks/useRestaurantDetails.ts` — key `['map','details', id]`, `staleTime` 5 min; `null` → "not found" state.
- `src/features/map/hooks/useMapRegion.ts` — debounces `onRegionChangeComplete` (400 ms after the person stops moving), turns the region into a box, and drops answers for an old box (the query key changes with the box and only the latest key is rendered).
- `src/features/map/hooks/useInitialRegion.ts` — the opening-view order (Decision 3).
- `src/features/map/hooks/useLocationPermission.ts` — wraps `expo-location` foreground permission and a single position request with a timeout.
- `src/features/map/lastRegion.ts` — read/write the last viewed region in AsyncStorage (try/catch; never blocks).
- `src/features/map/clustering.ts` — supercluster wrapper, pure and unit-tested.
- `src/features/map/directions.ts` — `buildDirectionsUrl(name, placeId)`.
- `src/features/map/components/RestaurantMapScreen.tsx` — map, markers, banners, "locate me", sheet.
- `src/features/map/components/FlagMarker.tsx`, `ClusterMarker.tsx` — per the `map-markers` skill (flag pill; neutral icon when `cuisines.kind = 'neutral'`; no Ad badge or animation, those are spec 16).
- `src/features/map/components/RestaurantSheet.tsx`, `SheetMenu.tsx`, `SheetPhotos.tsx` — sheet content.
- `src/features/map/components/LocationPrompt.tsx` — the plain-language note before the system permission request.
- `src/features/sellers/components/MapStatusLine.tsx` — **Manage Business status line** (restaurants only), shown from `map_status`: `visible` → "Showing on the map"; `place_not_found` → "Hidden from the map: Google can't find your address any more. Choose your address again to put it back." (button to the change-address screen); `needs_refresh` → "Hidden from the map for now while we re-check your address. Choosing your address again puts it back at once." Text, never colour alone; role and label on the button. When `map_status` is null (no saved address yet) no line is shown; the existing "Add your address to go live" state covers it. Wired into `ManageBusinessScreen` (small change); reads `map_status` from the existing `useMyBusiness`.
- `src/features/map/components/MapNotices.tsx` — "Zoom in to see restaurants", "Zoom in to see more", empty and error banners.

### Opening view and location (Decision 3)
When the Restaurants tab first opens:
1. If location permission is **undetermined** and the person hasn't tapped "Not now" before: show `LocationPrompt` ("LikeToOrder can centre the map on you to show restaurants nearby. Your location stays on your phone and is never sent to us. You can say no."). Buttons "Use my location" (→ system prompt) and "Not now" (remembered on the phone; the note is not shown again, but "locate me" still works).
2. **Allowed:** open centred on the person at neighbourhood zoom (latitudeDelta ≈ 0.02). Request one position with a **5 s timeout**; the map is shown immediately using the fallback below and moves to the person if the position arrives in time. A slow or failing GPS never blocks the map.
3. **Denied, not asked, services off or position failed**, use the first that exists:
   1. the last viewed region (saved on the phone only, saved when the person stops moving the map);
   2. the phone's region from `expo-localization` (`getLocales()[0].regionCode`) → that country's view from the bundled table `countryViews.ts`: a centre plus `latDelta` and `lngDelta`, **each at most 40°** (well under the server's 90° limit, so a country view never opens on "Zoom in"). A very large country (Russia, Canada, the US, China, Australia, Brazil) gets a 40° view on its main population area rather than the whole country. A region code that is missing from the table or not a country (null, `001`) falls through to the world map;
   3. a plain world map with the note "Zoom in to see restaurants" (no flags, no pin request: the app knows this view is over the limit, and the server would answer `too_large` anyway).
4. **"Locate me" button** (always visible, 44 pt): asks for permission if undetermined, otherwise recentres.
5. **Denied forever:** the button opens a small notice "Location is off for LikeToOrder. You can turn it on in Settings." with an "Open Settings" button (`Linking.openSettings()`).
6. **Location services off:** same notice wording adapted ("Turn on Location Services in Settings").
7. **A region with no restaurants:** the empty-state card, not a blank map.
8. **The person's location is never sent anywhere.** It is used only to set the map's camera. The server receives only the map box. No analytics, no storage of the position, no logging. The only thing stored is the last viewed *region*, on the phone.

### Pins, clustering and markers
- Markers: flag emoji (from `cuisines.flag`) in a rounded pill, 32×24 flag, 40 pt hit area (touch target ≥ 44 via `hitSlop`); neutral cuisines show their Ionicons icon. Colour comes from tokens. The Taiwan flag quirk is accepted (spec 04).
- Cluster: circle with count; sizes 36–48 by count. Tap → zoom to the cluster's bounds.
- Supercluster runs on the client, in a `useMemo` keyed on pins and rounded zoom, over at most 500 pins. Clusters recompute on `onRegionChangeComplete`, never per frame.
- `tracksViewChanges={false}` after the flag has rendered, `React.memo` markers, stable callbacks.
- The selected marker gets a darker ring (not bigger). Tap → set `selectedId`, snap the sheet to half, **don't move the map**.
- When `capped` is true: banner "Zoom in to see more". When `too_large`: "Zoom in to see restaurants".

### Bottom sheet
- `@gorhom/bottom-sheet`, snap points `['15%', '50%', '92%']`, swipe down closes and clears selection.
- Shows only what exists today: name, cuisine flag + name (`CuisineLabel`), cover photo and gallery (horizontal list), menu (items with price, availability, description; menu photos), address, **Directions**.
- **No** Request pickup, Request table or Report buttons, and no greyed-out placeholders (specs 09, 11, 17).
- Loading: skeleton rows. Not found (`null`): "This restaurant isn't available right now." with a Close button. Error: message with Retry.
- **Photos:** signed URLs via `useSignedUrls('business-media', paths)`, spec 06 renewal rules, `PhotoTile` (placeholder while loading; calm "Photo unavailable" fallback on failure).
- **Prices:** each item is formatted with the **business's own `currency_code`** using spec 06's `formatPrice` with the `currencies` table's `minor_units`. No default currency is ever assumed. If an item has a price but the currency is unknown to the app, the price is hidden rather than guessed.
- **Disclaimer:** none (restaurant sheet; the homemade disclaimer is spec 08).

### Directions and Google's terms
- `buildDirectionsUrl(name, placeId)` returns `https://www.google.com/maps/search/?api=1&query=<url-encoded name>&query_place_id=<placeId>`. This is the documented Google Maps URL format; `query` is required, `query_place_id` is optional and is the most reliable way to target the place. It opens the Google Maps app if installed, otherwise Google Maps in the browser (confirmed from Google's Maps URLs documentation while writing this spec).
- It is opened with `Linking.openURL`. We **never** construct an Apple Maps (`maps.apple.com` / `maps:`) link, a `geo:` link, or any link containing our stored coordinates. No coordinates are sent to a non-Google service.
- **Terms check, result:** Google's Place ID documentation says place IDs are exempt from the caching restrictions and can be stored; an obsolete ID returns `NOT_FOUND`. I could not load the full Service Specific Terms text during this step (the page came back truncated), so these remain **my reading, not verified against the current wording**: (1) Places content must be shown on a Google map, so the map must use `PROVIDER_GOOGLE`; (2) lat/lng cache limit is 30 consecutive days; (3) linking out with a Place ID URL is the intended use. This stays on the §16 "Google terms review → before launch" item, and Archan should confirm it with a legal read.

### Accessibility and large text
- Every marker: `accessibilityRole="button"`, `accessibilityLabel` "<Name>, <Cuisine> cuisine". Cluster: "<n> places, double tap to zoom in". The flag is never the only way the cuisine is shown (the label always names it).
- **Map alternative:** a "Places in this area" button (≥ 44 pt) opens the sheet in list mode with the current pins as rows (name + cuisine), so a screen-reader user never has to find a pin on the map. Selecting a row opens its details. (See Decision 15.)
- Sheet: `accessibilityViewIsModal` while expanded, focus moves to the sheet title on open and back to the marker on close. Every touchable has a label and role: Close, Directions ("Directions to <name> in Google Maps"), Locate me, Retry, photo tiles ("<Name>, photo n of m"), list rows. Availability is written ("Available" / "Sold out"), never colour alone.
- Large text: all sheet text uses `Text` from `ui/` (scales with the system size); the sheet content is in a scroll view so nothing is clipped at the largest sizes; rows grow instead of truncating names (up to 3 lines, then ellipsis); the 15% collapsed snap shows at least name + flag at large sizes by increasing the snap height from font scale. Verified in the manual run at the largest iOS "Larger Accessibility Sizes" and Android font scale 2.0.
- Reduce motion: no looping animation exists in this spec; sheet and camera animations follow the system setting (`useReducedMotion`).

## Files to create
**PR 1**
- `supabase/migrations/<timestamp>_restaurant_map.sql`
- `supabase/tests/07-restaurant-map.test.sql`
- `supabase/functions/places-refresh/{index,handler}.ts`
- `supabase/functions/places-refresh/rpc.ts` (the two database calls, so tests can check function and argument names)
- `supabase/functions/tests/places-refresh.test.ts`
- `supabase/functions/tests/places-refresh-rpc.test.ts`
- `supabase/migrations/<timestamp>_restaurant_map_hardening.sql` (code-review fixes: column revoke, `private.caller_ip()`, apply clears its claim)

**PR 2**
- `src/features/map/{api,schema,clustering,directions,lastRegion,countryViews}.ts` (`countryViews.ts` is the bundled table: ISO region code → centre + `latDelta`/`lngDelta`, each at most 40°)
- `src/features/map/hooks/{usePinsInBounds,useRestaurantDetails,useMapRegion,useInitialRegion,useLocationPermission}.ts`
- `src/features/map/components/{RestaurantMapScreen,FlagMarker,ClusterMarker,RestaurantSheet,SheetDetails,SheetMenu,SheetPhotos,PlacesList,LocationPrompt,MapNotices}.tsx` (`SheetDetails` = the sheet body for one restaurant; `PlacesList` = the "Places in this area" rows; both added at Gate E), `src/features/map/{region,messages}.ts`, `src/features/map/hooks/{useReduceMotion,useTracksViewChanges}.ts`
- `src/features/map/__tests__/*` (see Test plan)

## Files to change
**PR 1**
- `supabase/functions/_shared/google.ts` — add `getPlaceLocation`
- `supabase/config.toml` — `[functions.places-refresh] verify_jwt = false`
- `supabase/tests/05-seller-onboarding.test.sql` — extend the function allowlist (and `supabase/tests/00_rls_enabled.test.sql` picks up the two new tables)
- `src/types/database.ts` — regenerated (`npm run db:types`)
- `docs/product/v1.md` §16 — closes "Places coordinate refresh" and "Google map provider" at the right PR (see below); adds the new before-launch items
- `.claude/skills/supabase-patterns/SKILL.md` — public read functions, guest rate limit, cron + vault pattern
- `.env.example` — document `REFRESH_CRON_SECRET` (server-side only) in the server-secrets block

**PR 2**
- `app/(tabs)/restaurants.tsx`
- `src/features/sellers/{schema.ts,components/ManageBusinessScreen.tsx}` — add `map_status` to the owner schema and show `MapStatusLine`
- `app.config.ts` — Google Maps keys, location permission text (see below)
- `.env.example` — `EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY`, reword the Android line (iOS no longer uses Apple Maps)
- `package.json` / lockfile — new dependencies
- `.claude/skills/map-markers/SKILL.md` — "Apple Maps iOS" line becomes Google on both
- `CLAUDE.md` — Commands note about Expo Go vs development build; status table
- `jest.setup.ts` — mocks for the new native modules

### App config (PR 2)
- `ios.config.googleMapsApiKey` ← `process.env.EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY`; `android.config.googleMaps.apiKey` ← `process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY`. Exact plugin/key names are checked against the current `react-native-maps` and Expo docs at implementation time.
- `expo-location` plugin: `locationWhenInUsePermission: "LikeToOrder uses your location while you have the app open, only to show restaurants near you on the map. Your location stays on your phone."`, `isIosBackgroundLocationEnabled: false`, `isAndroidBackgroundLocationEnabled: false`. No background modes, no `NSLocationAlways…` strings.
- **Keys read from `EXPO_PUBLIC_*` variables listed in `.env.example`. Claude never reads or edits `.env`. No real keys are needed for code, jest or pgTAP.** Missing keys must not crash the app: the map screen shows a clear "Map isn't configured" error state in development.

## New dependencies
All with `npx expo install` (PR 2). None in PR 1.
| Package | Why |
|---|---|
| `react-native-maps` | The map (Google provider on iOS and Android). |
| `supercluster` 7.1.5 (+ `@types/supercluster`) | Clustering. Pinned to 7.1.x: 8.x and 9.x are ES-module-only and need a jest `transformIgnorePatterns` change; 7.1.5 works under jest with no special config (checked at Gate C). |
| `expo-dev-client` | The development-build launcher; `npx expo start --dev-client` needs it (added at Gate C, Decision 23). |
| `@gorhom/bottom-sheet` | The sheet. |
| `react-native-reanimated` (+ `react-native-worklets` if the installed Expo SDK requires it) | Required by the bottom sheet; also used for spec 16 later. |
| `react-native-gesture-handler` | Required by the bottom sheet. |
| `expo-location` | Foreground "centre on me" only. No background location (CLAUDE.md). |
Already present and reused: `@react-native-async-storage/async-storage` (last region), `expo-localization`, `expo-image`, `expo-linking`/RN `Linking`.
Native modules change, so PR 2 needs a **development build**; Expo Go is no longer enough.

## Rules for implementation
- RLS on every new table + pgTAP test
- Supabase calls only in `src/features/map/api.ts`
- Theme tokens only, no hardcoded colors/sizes
- Loading / empty / error / success states on every screen
- Accessibility labels on every touchable
Feature-specific:
- **Homemade never appears.** `type = 'restaurant'` is part of the freshness rule used by both functions.
- **Hide, don't delete.** Not-found places keep every row.
- **The 30-day guard is the real protection;** the refresh job is the normal path. The guard works even if the job never runs.
- The map functions return only public fields. No `place_id` in the *pin* list; `place_id` appears only in the single-restaurant details (needed for Directions; place IDs may be kept).
- The client never sends coordinates other than the map box, never the user's position.
- Never read, print, log or set any secret. No Google key in the app other than the two Maps SDK keys.
- Never log signed URLs, photo paths, request bodies from Google, or the person's position.
- Google provider (`PROVIDER_GOOGLE`) on both platforms, no Apple Maps fallback.
- No `any`; named exports; function components.
- Stage gates with a commit after each (per memory: stop and commit after each gate, no edits before "approved").
  - PR 1: **A** migration + pgTAP + types → **B** Edge Function + Deno tests + config → review.
  - PR 2: **C** libraries, config, map shell, location flow + tests → **D** pins, clustering, markers + tests → **E** sheet, photos, menu, Directions + tests → manual run.

## Out of scope
- **Ads / promoted markers** (rise-and-fall, Ad badge, cluster pull-out, "Sponsored"): spec 16.
- **Pickup requests, table requests, Report:** specs 09, 11, 17 (no buttons or placeholders here).
- **Homemade map, approximate-area circles, disclaimer, homemade details:** spec 08. Homemade businesses never appear in these functions.
- **Photo viewer (tap a photo to see it larger):** **moved to spec 08**, built once and reused in the map sheet and the seller Photos screen. Photos in this sheet show at normal size only. Added to `docs/product/v1.md` §16.
- Notifications (12), food log (13), activity grid (14, 15), legal pages (18).
- Search, filters, cuisine filter, "open now", ratings, reviews, saves.
- Live or background location, routes drawn in the app, Apple Maps, delivery (§3).
- Changing how addresses are picked (spec 05) or the homemade shift.
- Server-side metadata check of photos, account deletion, storage monitoring (§16).

## Definition of done
**Database (PR 1)**
- [x] RLS is on for `map_rate_limits` and `places_refresh_quota`; `anon` and `authenticated` hold no table or column privileges on them or on the new `business_locations` columns.
- [x] `anon` and `authenticated` can execute exactly `map_restaurants_in_bounds` and `get_restaurant_details` among the new functions; everything else new is `service_role`/owner only (allowlist test updated).
- [x] 30-day guard: a restaurant with `resolved_at` 29 days old appears; 31 days old does not; the same row appears again after `apply_places_refresh('ok', …)`.
- [x] Hidden place: `place_status = 'not_found'` removes the restaurant from pins and details, and its `businesses`, `business_locations`, menu and photo rows still exist.
- [x] An unlisted, homemade, location-less or stale business never appears in `map_restaurants_in_bounds`, and `get_restaurant_details` returns `null` for each (same value for all causes, and for a random uuid).
- [x] Outsider (anon and another signed-in user) cannot read the exact address, exact coordinates, `resolved_at` or `place_status` from either function or from any table; the details JSON has no `lat`/`lng` of the exact point, no `resolved_at`, no `place_status`; the pins JSON has no `place_id` and no address.
- [x] Bounds: inverted box, null and NaN raise `invalid_bounds`; lat beyond ±90 is clamped; a box crossing the 180° line returns pins on both sides; a span over 90° returns `too_large` with no pins; a whole-world box returns `too_large`.
- [x] Cap: with 501+ fresh restaurants in the box, 500 pins and `capped = true` are returned; with exactly 500, `capped = false`.
- [x] Global ceiling: once all guests together exceed 2,000 `pins` calls in a minute, any guest gets `rate_limited` even from a fresh IP or with no readable IP; a signed-in user is unaffected at the same moment.
- [x] Rate limit: a guest (anon, no uid) is limited by IP key; the 121st `pins` call in a minute raises `rate_limited` (31st for `details`); a different key is unaffected; the public functions delete no rows (no cleanup on a pin query).
- [x] Cleanup: `private.cleanup_map_rate_limits()` (hourly, `0 * * * *` UTC) deletes `map_rate_limits` rows older than 1 hour; `private.cleanup_places_refresh_quota()` (daily, `30 3 * * *` UTC) deletes `places_refresh_quota` rows older than 30 days. pgTAP inserts old and new rows, runs each function, sees only the old ones removed, and that each leaves the other table alone; `anon`/`authenticated` cannot execute either.
- [x] `claim_places_refresh_batch` returns at most 25 rows, oldest first, skips rows tried within a day, stops at the 100-calls/day quota, and the quota table is separate from `places_rate_limits`.
- [x] `apply_places_refresh` for a restaurant moves `map_lat/map_lng`; for a homemade business `map_lat/map_lng` stay exactly the same while `business_locations.lat/lng` and `resolved_at` update. Saving a new address through `set_business_location` resets `place_status` to `ok` and clears `refresh_attempted_at`. Apply guard: a result for a row with no outstanding claim (or a missing row) changes nothing, and a result claimed for the old address cannot overwrite a newly saved one. Every applied outcome (`ok` and `not_found`) clears `refresh_attempted_at`, so a second apply for the same claim does nothing.
- [x] `anon`, another signed-in user and the owner cannot `select` `businesses.map_lat`, `map_lng` or `public_address` (42501); the owner still gets them from `get_my_business`.
- [x] Neither `anon` nor `authenticated` can execute `claim_places_refresh_batch`, `apply_places_refresh` or any `private.*` function (42501).
- [x] `pg_cron`, `pg_net` and `supabase_vault` are installed by the migration (pgTAP fails clearly if any is missing); all three cron jobs exist; `private.invoke_places_refresh()` does nothing (no error) when the vault secrets are absent.
- [x] `src/types/database.ts` regenerated; existing migrations untouched.

**Edge Function (PR 1)**
- [x] Missing or wrong `x-cron-secret` → 401, no database or Google call; no `REFRESH_CRON_SECRET` configured → 500 `not_configured`.
- [x] With a fake Google: a normal place updates coordinates; `NOT_FOUND` → `not_found`; a response with no location, a 500 and a timeout → no change and counted as `failed`; the record is never deleted.
- [x] The response and logs contain no Google body, key or secret.

**App (PR 2)**
- [ ] The Restaurants tab shows a Google map with `PROVIDER_GOOGLE` on iOS and Android; guests see it without signing in. *(Manual run: iOS tiles with the iOS key ✓. Not manually checked: Android and the Android Maps key; browsing as a guest.)*
- [ ] Pins load only for the visible area, after the person stops moving the map (400 ms); a late answer for an old area is ignored; old pins stay while new ones load (no flicker). *(Manual run: pins load on pan ✓. The ordering and no-flicker parts are jest-only: not manually checked.)*
- [ ] A `rate_limited` answer keeps the old pins, shows "Try again in a moment", and is never retried automatically.
- [ ] 500 pins → "Zoom in to see more"; `too_large` → "Zoom in to see restaurants" with no pin request loop.
- [x] Tap a flag → the sheet opens at half, the map doesn't move; swipe down closes it; tapping a cluster zooms in. *(Manual run, iOS Simulator, 2026-11-06.)*
- [ ] The sheet shows exactly: name, flag + cuisine name, cover and gallery, menu items with price and availability in the business's currency, menu photos, address, Directions. No Request or Report buttons or placeholders. *(Manual run: name, flag, cuisine, menu items, prices and currency formatting, "Sold out", "Price not listed", address and Directions ✓. Not manually checked: photos (cover, gallery, menu pages, item photos): none are seeded.)*
- [x] Directions opens a `google.com/maps/search/?api=1&query=…&query_place_id=…` URL, with no coordinates and no Apple Maps link. *(Manual run, iOS Simulator, 2026-11-06: opens a Google Maps search; the seeded place IDs are fake, so a real place was not checked. The URL itself is asserted in jest.)*
- [ ] A photo that fails shows "Photo unavailable" once (no loop); expired signed URLs renew once per path per mount. *(Not manually checked: no photos are seeded.)*
- [ ] Every entry of the bundled country table has a valid centre and `latDelta`, `lngDelta` of at most 40° (and more than 0), so none can reach the 90° limit; an unmapped region falls through to the world map.
- [ ] Opening view order: allowed → centred on me; otherwise last region → phone country → plain world map with "Zoom in to see restaurants". Slow GPS (no fix in 5 s) doesn't block the map. *(Manual run: allowed → centred on a faked location ✓. Not manually checked: the last-region and phone-country fallbacks, the world map, slow GPS.)*
- [ ] Denied-forever, services-off and empty-region states each show their message; "Open Settings" works. *(Not manually checked: the denied, denied-forever and services-off states.)*
- [ ] No request to Supabase (or anywhere) ever contains the person's latitude/longitude: only the map box (jest asserts the exact request arguments).
- [ ] Manage Business shows the status line for a restaurant: "Showing on the map" when fresh, the two hidden messages otherwise, nothing for a restaurant with no saved address (pgTAP: `get_my_business` returns `visible` / `place_not_found` / `needs_refresh` for each fixture and null for homemade and for a restaurant with no saved address; jest: each message and the button to the address screen). *(Manual run: "Showing on the map" and the needs_refresh message with its button ✓. Not manually checked: the place_not_found message.)*
- [ ] All screens handle loading, empty, error (with retry) and success; every touchable has a role and label with ≥ 44 pt target; the "Places in this area" list works; large text isn't clipped. *(Manual run: the Places list ✓ (map centres on a picked place; stacked back with the X and by swiping); large text at the largest iOS size for the sheet, list and tab bar ✓. Not manually checked: the empty and error states on a device, VoiceOver, TalkBack, Android font scale 2.0.)*
- [ ] `npm run lint`, `npm run typecheck`, `npm test`, `npx supabase test db` and the Deno tests pass; CI green.

## Test plan
- **pgTAP (`07-restaurant-map.test.sql`):** every PR 1 item above, with impersonation as `anon`, a signed-in outsider, the owner and `service_role`. Fixtures: restaurants at 1, 29, 31 days; homemade; unlisted; hidden place; 501 rows in a box; a box crossing the date line. Privilege allowlist and `column_privs_are` for the new columns.
- **Deno (`places-refresh.test.ts`):** secret check (missing, wrong, right), each Google outcome including `NOT_FOUND` (the "place not found" case) and a timeout, quota exhausted → no Google call, no logging of the key or secret, response is counts only.
- **jest (PR 2), written from this spec:**
  - `api`: sends only the box and the id; maps error codes; zod rejects extra/malformed shapes.
  - `useMapRegion`: debounce, late-answer drop, keep-previous-data.
  - `useInitialRegion`: the fallback order in each permission state, slow GPS, services off, no country in locale.
  - `countryViews`: **every entry** in the table has lat in ±90, lng in ±180, and `latDelta` and `lngDelta` each > 0 and ≤ 40; every country code in the cuisine catalog seed has an entry; an unknown or null region returns nothing.
  - `rate_limited`: the query is not retried (react-query `retry` check and a call count of 1), the previous pins stay on screen, the "Try again in a moment" note shows with no error styling, and no further request is sent until the box changes or "Try again" is tapped.
  - "Location never sent": with permission granted and a known position, no request argument contains it.
  - `clustering`: grouping, zoom-to-cluster bounds, 500-pin performance bound.
  - `directions`: exact URL, encoding, no coordinates, no `maps.apple.com`.
  - Components: marker labels and roles, cluster label, sheet states (loading, null, error, success), price per business currency, no Request/Report buttons, photo fallback, list-mode, 4 screen states.
- **Manual on a development build (Archan):** Google tiles on iOS and Android; pan/zoom with a real network; permission flows (allow, deny, deny forever, services off); large text; VoiceOver/TalkBack on markers, cluster, sheet and list; Directions opens Google Maps; a region with no restaurants; the date-line and world views.

## Development build (decision for Archan: needed BEFORE PR 2 starts)
**PR 1 is not blocked by this.** Do not assume the answer; Claude will not start PR 2 until this is decided.

**Plain-language background.** *Expo Go* is a ready-made app from the App Store that can run many Expo projects without building anything. It can't show Google Maps on an iPhone (on iPhone it only has Apple Maps), and it can't hold our own map keys. A *development build* is your own copy of LikeToOrder, built once with the native map code inside. It works like Expo Go for daily use: you start `npx expo start --dev-client` and your code changes appear live. You only rebuild when a native package or app config changes. After this spec, Expo Go can no longer run the Restaurants tab on iPhone, and it stops being the way to test the app.

**Options** (Apple/Expo prices change; check the current figures before paying)
1. **iOS Simulator on your Mac (recommended to start).** `npx expo run:ios` builds locally with Xcode (free) and runs in the iPhone simulator. No Apple Developer account, no cost, no cloud build. Limits: it's a simulated phone (you can fake a location, but you can't feel GPS, camera or real-network behaviour), and you need Xcode installed (large download) on your Mac.
2. **Development build on your real iPhone.** Either (a) build locally with Xcode and install over a cable with a free Apple ID (works, but the install expires after about 7 days and must be reinstalled), or (b) an EAS cloud development build, which needs the paid **Apple Developer Program (about US$99/year)** to install on a phone, plus EAS build minutes (Expo has a limited free monthly allowance; paid plans start around US$19/month, check expo.dev/pricing). Best for real GPS, VoiceOver and large-text checks, which this spec's manual run needs.
3. **Android first.** A development build for Android costs nothing: no developer account is needed to install a build on your own phone or an emulator (Android Studio is free), and EAS or a local build can make it. Android already works with Google Maps. Downside: you'd test the iPhone behaviour later, and you said you use an iPhone today.

**Recommendation:** start with option 1 (free, fastest to set up, enough for map, clustering, sheet and location-fallback work), and move to option 2(b) for the final manual run (real GPS, VoiceOver, large text) when you're ready to pay for the Apple account, which you'll need for TestFlight and the App Store anyway. Option 3 is a good free second check on the Android side.

**What you'd do differently:** install Xcode (option 1/2) or Android Studio (option 3); run one build command the first time (about 10–20 minutes); then start the app with `npx expo start --dev-client` instead of scanning the Expo Go QR code; rebuild whenever Claude tells you a native package was added. The two Google Maps SDK keys (below) are needed on whichever build shows real map tiles.

**Decided (Decision 23): option 1, the iOS Simulator on Archan's Mac first; a real iPhone later.** Archan runs every build command himself; Claude only changes project files.

## Device-run notes
Manual checks on a real build, kept here so the final manual run knows what is still open.

**Gate C: partial manual run, 2026-11-05 (Archan).** iOS Simulator only (iPhone 18 Pro, iOS 27.2).
- Passed: the app builds and launches; Google map tiles show with the iOS key; the location note and the system permission prompt work; with a faked location (`xcrun simctl location`: Oshawa, then Cambridge, Ontario) the map centres on it.
- **Not yet checked:** a real iPhone; Android; VoiceOver / TalkBack; large text; the denied, denied-forever and services-off states; the slow-GPS and phone-country fallbacks.

**Gate D: partial manual run, 2026-11-05 (Archan).** iOS Simulator only, with the local demo seed (`scripts/seed/restaurants.ts`).
- Passed: pins load on pan; flags and clusters render; tapping a flag does **not** move the map (correct per this spec; no workaround to be built).
- **Not yet checked:** a real iPhone; Android (including `moveOnMarkerPress={false}`, which is an Android-only prop); VoiceOver / TalkBack on markers and clusters; large text; clustering and pan performance with the 500-pin cap; the rate-limited, error and empty-area notices on a device.

**Large text on the iOS Simulator, 2026-11-06 (Archan).** Largest "Larger Accessibility Sizes" setting, checked for the **sheet and the list** only.
- Passed: the sheet works and nothing in it is clipped.
- Found and fixed: the sheet's big titles grew so large that one list row fit (the titles are now capped at 1.6×; rows, prices and addresses still scale fully, Decision 29), and the tab bar labels were cut off ("Rest", "Hom"). The tab bar belongs to spec 03; its labels are now capped at 1.3× in a separate commit.
- **Not yet checked:** VoiceOver and TalkBack on markers, clusters, the sheet and the list; Android font scale 2.0; the map notices and the location screens at the largest size.

**Manual run, iOS Simulator (iPhone 18 Pro, iOS 27.2), 2026-11-06 (Archan): complete for the iOS Simulator, with the local demo seed.**
- **Passed:**
  - Map tiles with the iOS Maps key; the faked location (centres on it) and the permission note.
  - Pins load on pan; flags and clusters render; a cluster tap zooms in.
  - Tapping a flag opens the sheet without moving the map.
  - The sheet's three snaps, swipe down, and scrolling (Directions reachable at half and full).
  - "Places in this area": the map centres on a picked place; the list and the restaurant stack (the X and a swipe go back to the list).
  - Google's business labels are hidden (`customMapStyle`).
  - Large text at the largest iOS size, for the sheet, the list and the tab bar.
  - Menus, "Sold out", "Price not listed" and currency formatting; Directions opens a Google Maps search.
  - The Manage Business status line for "visible" and "needs_refresh".
- **Not manually checked:**
  - A real iPhone (GPS, touch).
  - An Android build and the Android Maps key.
  - VoiceOver and TalkBack.
  - Android font scale 2.0.
  - The denied, denied-forever and services-off location states.
  - The slow-GPS and phone-country fallbacks.
  - The place_not_found status line.
  - Photos (none are seeded).
  - Directions to a real place (the seeded place IDs are fake).
  - `customMapStyle` on Android.

## Decisions
1. **Two PRs** as above; PR 1 keeps the status 🚧, only PR 2 marks ✅ Shipped. (Archan, 2026-11-04)
2. **Option A for the 30-day rule:** this spec builds the refresh job and the 30-day hide guard. The guard is the real protection; the job is the normal path. For the guard to hold, nothing else may hand out the coordinates, so direct reads of `businesses.map_lat`, `map_lng` and `public_address` are revoked from `anon` and `authenticated` (Decision 20). (Archan, 2026-11-04; extended 2026-11-05)
3. **Opening view and location** as specced: optional while-using-the-app permission after a plain note; fallbacks last region → phone country → plain world map; location stays on the phone and is never sent. (Archan, 2026-11-04)
4. **Guest abuse guard:** a per-minute rate limit in the database, keyed by `u:<uid>` for signed-in callers and by the client IP for guests (read from the request headers PostgREST exposes inside the function). Limits per key: `pins` **120/minute**, `details` **30/minute**. **Global ceiling for guests as the backstop:** all guest calls together share one extra key `guest:all`, at 2,000 `pins` and 600 `details` per minute (tunable numbers; signed-in users are not counted, so a guest flood can't lock them out). Guests whose IP can't be read are still counted against the ceiling. Alongside it, cost bounds that don't depend on any key: bounding-box size limit, 500 cap, a partial index, `statement_timeout = 3s`, and small public-only payloads. Old `map_rate_limits` rows are removed by an hourly cron job (rows older than 1 hour), never by a pin query. Because a forged IP header can create a new per-IP row on each call, up to the guest ceiling, hourly cleanup keeps the table small (accepted for v1; Archan, 2026-11-05). In the app, `rate_limited` keeps the old pins, shows a calm "Try again in a moment" note and is never retried automatically (Decision 12). The IP header is verified before launch (§16).
5. **Refresh numbers:** every 6 hours, 25 rows per run, 100 Google calls per UTC day, start at 25 days, oldest first, own quota table, retry a failed row after a day.
6. **Not-found places** are hidden from the map by `place_status = 'not_found'` and the record is kept. Saving a new address resets it to `ok`.
7. **Homemade points** keep their shifted public location while the place ID is unchanged; only `business_locations` coordinates and `resolved_at` are refreshed. A new place ID re-shifts through the existing `set_business_location`. Homemade businesses are not shown by this spec.
8. **Pins by visible area**, 500-pin server cap, `too_large` above a 90° span (kept for v1, tune after real data); which 500 pins a capped answer returns is stable but arbitrary (ordered by `id`). The app debounces, drops late answers and keeps old pins.
9. **Sheet shows only what exists today;** no request/report buttons or placeholders. Photo viewer moved to spec 08.
10. **Maps keys:** two Maps SDK keys (iOS and Android) read from `EXPO_PUBLIC_*`, distinct from the server-side Places key. Before launch, each must be restricted to our bundle ID / package name, restricted to the Maps SDK for its platform only, and have a daily budget cap in Google Cloud. Added to `docs/product/v1.md` §16.

11. **No closed-place field.** The refresh asks only for `id,location` (the same fields as spec 05). Only "not found" hides a place; there is no `closed` status and no `CLOSED_TEMPORARILY` handling. This keeps the Places cost at the lower tier and the code simple. (Archan, 2026-11-04)
12. **Rate limits and the app's behaviour:** `pins` 120/minute, `details` 30/minute, plus the global guest ceiling (Decision 4). A `rate_limited` answer keeps the old pins, shows "Try again in a moment", is never retried automatically, and react-query is set not to retry it. (Archan, 2026-11-04)
13. **Manage Business status line (PR 2):** an owner sees whether their restaurant is on the map; if it is hidden, a plain message and a button to choose the address again. Needs `map_status` on the owner's own view in PR 1. (Archan, 2026-11-04)
14. **Defaults accepted from the open questions (Archan, 2026-11-04):**
   - Span limit 90° and the arbitrary-but-stable 500 pins: kept (Decision 8).
   - Homemade shifted point vs Google's cache rule: decided in spec 08 with the Google terms review.
   - Menus and photos of a stale restaurant stay readable by id (spec 06's public read policy is unchanged; the data is already public and has no coordinates).
   - Flag emoji may render differently per Android device: covered by the existing §16 device check, no change.
   - Refresh cap stays at 100 calls/day for launch; raise with a one-line migration as listings approach 2,500 businesses (restaurants and homemade together).
   - Pre-permission note wording and the shown-once "Not now" behaviour are accepted as written in "Opening view and location".
15. **"Places in this area" list for screen readers:** kept in this spec. (Confirmed by Archan, 2026-11-05.)
16. **Extensions:** `pg_cron`, `pg_net` and `supabase_vault` are enabled in the migration; availability on the local stack is checked at Gate A (see "Refresh job").

17. **Hourly rate-limit cleanup:** `map_rate_limits` rows are deleted hourly (older than 1 hour); `places_refresh_quota` stays on the daily job. (Archan, 2026-11-05)
18. **Refresh run:** rows are refreshed one at a time, 5 seconds per Google call, each result saved as it finishes; `pg_net` waits up to 60 seconds. (Archan, 2026-11-05)
19. **Apply guard and `map_status`:** a refresh result is applied only to a row with an outstanding claim; `map_status` follows the rule in the functions table, including null when there is no saved address. A claim charges the quota for the rows actually returned; a place is `not_found` only on a 404 with status `NOT_FOUND`; a forged-header row-growth risk is accepted for v1. (Archan, 2026-11-05)
20. **No direct reads of the Google columns:** `select` on `businesses.map_lat`, `map_lng` and `public_address` is revoked from `anon` and `authenticated` in a new migration, so the 30-day guard and the rate limit cannot be skipped. Spec 08 adds its own homemade read function. (Archan, 2026-11-05)
21. **Guest address in one function:** the `x-forwarded-for` reading lives in `private.caller_ip()` only. The key logic is unchanged; once the trustworthy header is chosen at launch (§16, before-launch blocker), the fix is a one-function migration. Until then guests are protected only by the guest ceiling, which a forger can fill to block other guests. (Archan, 2026-11-05)
22. **What bounds the call time:** `statement_timeout = '3s'` on the two public functions applies to the statements inside them; the timer for the call itself starts before the function runs. The role-level timeouts (Supabase defaults: anon 3 s, authenticated 8 s) bound the call today. Role settings are not changed. `apply_places_refresh` clears the claim after any applied outcome, so a result applies once. (Archan, 2026-11-05)

23. **Development build:** the iOS Simulator on Archan's Mac first (Xcode 27.2, iOS 27.2 simulator), a real iPhone later (needs the paid Apple account for an EAS build). Archan runs `npx expo run:ios` and any `brew install` himself; Claude never runs `expo run:ios`, `expo prebuild` or a global install. `expo-dev-client` is added to the dependencies so the app starts with `npx expo start --dev-client`. (Archan, 2026-11-05)
24. **Maps config via the `react-native-maps` plugin:** the Google keys go in through that plugin's props (`iosGoogleMapsApiKey`, `androidGoogleMapsApiKey`, read from `EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY` / `…_ANDROID_KEY`), not `ios.config.googleMapsApiKey`, because the plugin also links the Google Maps pod only when the iOS key is set. With no key the map screen renders "Map isn't configured" and never mounts a Google map (an empty key can crash the native SDK); the variable name is shown only in development. (Gate C, 2026-11-05)
25. **List picks centre the map; flag taps never do; the sheet behaves like stacked screens:** picking a restaurant from the "Places in this area" list makes one short camera move that puts the pin in the middle of the part of the map the half-open sheet leaves free, at neighbourhood zoom (a view already closer than 0.05° keeps its zoom, so picking never zooms out). Tapping a flag on the map never moves the map. A restaurant opened **from the list** sits on top of the list: swiping the sheet down past the lowest snap and tapping its X both go **back to the list**, with the map and the list where they were; that X is labelled "Back to list" for screen readers (and the "Close" button beside a "not available" message is relabelled the same way). From the list itself, the X and a swipe down close everything. A restaurant opened **from a flag** just closes. There is no separate "Back to list" button. Tapping the bare map clears the whole stack. (Archan, 2026-11-06)
26. **A marker press must not reach the map's press:** on iOS a marker's `onPress` and the MapView's `onPress` are both bubbling events, so a flag tap also fired "tap the bare map" and closed the sheet at once (found in the Gate E simulator run; jest's fake map did not bubble). Fixed twice over: both marker types set `stopPropagation`, and the map's `onPress` ignores events whose `nativeEvent.action` is `marker-press`. The jest fake now bubbles like the real library, and a switch makes it ignore `stopPropagation` to test the second layer alone. (Archan, 2026-11-06)
27. **Sheet scroll space:** the library makes the sheet as tall as its highest snap, so at a lower snap the bottom of its scroll view is off screen and the last rows (Directions) could not be scrolled into view. The scrolling content gets bottom space equal to (highest snap − current snap) plus a gap, and the snap heights are computed from the measured screen area rather than the window. The content already scrolls in the library's own `BottomSheetScrollView`. jest checks the arithmetic only; the real layout is checked in the simulator. (Archan, 2026-11-06)
28. **Hide Google's business labels:** `customMapStyle` with the single rule `{ featureType: 'poi.business', stylers: [{ visibility: 'off' }] }` on both platforms, so our flags are the only restaurant pins. Roads, place names, parks and transit are untouched. Legal read and an Android device check are added to `docs/product/v1.md` §16. (Archan, 2026-11-06)
29. **Large text:** at the largest system size only the sheet's big title (restaurant name, "Places in this area") is capped, at `maxFontSizeMultiplier` 1.6; everything else in the sheet keeps scaling fully. The collapsed snap height still grows with the font scale. (Archan, 2026-11-06)

## Open questions
1. **Google Maps terms text** could not be loaded in full here. Please have the §16 "Google terms review" item cover: Places content only on a Google map, the 30-day lat/lng cache limit, and linking out by place ID.
