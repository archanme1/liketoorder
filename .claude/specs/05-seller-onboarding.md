# Spec 05: Seller Onboarding

**Branch:** two PRs from this one spec (Decision 18)
- PR 1 (Gates A + B: database, Edge Functions, Deno, CI): `feature/seller-onboarding-backend`
- PR 2 (Gates C + D + manual run: the app): `feature/seller-onboarding-app`, created from `main` after PR 1 is merged
**Product spec:** `docs/product/v1.md` §2 (Seller mode + Manage Business tab), §4 (seller mode is a switch on the same account), §5 Onboarding and Homemade specifics, §3 (out of scope), §14 row 05, §16 (function privileges)
**Plan mode:** required — adds tables, RLS, column grants and callable functions; adds the first two Edge Functions; adds dependencies (`expo-crypto`, Deno in CI); changes navigation (new routes, Manage tab content); touches well over ~5 files.
**Status:** 🚧 In progress

## Overview
After this ships, any signed-in user with a complete profile can turn on **seller mode** from the Profile tab. They pick **Restaurant** or **Homemade** and enter a business name. They pick one **cuisine** from the spec 04 list and choose an **address** from Google Places autocomplete. Restaurants also choose whether they **accept table requests**. The listing goes live straight away, with no approval step. The Manage tab replaces the spec 03 placeholder with **Manage Business**, a summary of the listing where the seller can edit the name, cuisine, address and table setting, and switch seller mode off.

**Location rules:**
- A restaurant's public map point is its real location.
- A homemade seller's public map point is shifted once, by the server, by a random distance of up to ~500 m. That shifted point only changes when the address changes.
- The exact address and coordinates are stored in a separate table. Only the owner can read it, through a function. No other user can read it at all yet; specs 09/10 unlock it for accepted requests.

**Places key:** the Places API key lives only in a Supabase Edge Function secret. Both functions accept signed-in users only, limit input length and rate-limit each user.

**Why now:** the maps (07, 08), menus (06) and requests (09+) all need a business to exist first.

## Depends on
- 01 project-setup (✅ Shipped)
- 02 auth-and-profiles (✅ Shipped; `profiles.is_seller` exists and is not client-writable)
- 03 navigation-shell (✅ Shipped; Manage tab gated by `is_seller`, anon allowlist test)
- 04 cuisine-catalog (✅ Shipped; `cuisines.code`, `useCuisines`, display rule, Decision 9: this spec adds the shared cuisine display component)

## Context to load
- `CLAUDE.md`
- `docs/product/v1.md` §2, §4, §5, §16
- This spec
- `.claude/skills/supabase-patterns/SKILL.md`, `.claude/skills/liketoorder-ui/SKILL.md`
- `supabase/migrations/20261102033759_auth_and_profiles.sql` (profiles, `is_seller`, revoke-then-grant, `set_updated_at`)
- `supabase/migrations/20261103040302_cuisine_catalog.sql` (FK target `cuisines.code`)
- `supabase/tests/02-auth-and-profiles.test.sql` (impersonation pattern, `column_privs_are`)
- `supabase/tests/03-navigation-shell.test.sql` (anon ALLOWLIST to extend)
- `src/features/profile/api.ts`, `src/features/profile/hooks/useMyProfile.ts`, `src/features/profile/components/ProfileScreen.tsx`
- `src/features/cuisines/api.ts`, `src/features/cuisines/hooks/useCuisines.ts`, `src/features/cuisines/schema.ts`
- `src/features/navigation/hooks/useIsSeller.ts`, `app/(tabs)/_layout.tsx`, `app/(tabs)/manage.tsx`
- `src/features/auth/routeAccess.ts`, `app/_layout.tsx` (the loading-overlay fix from spec 03 Decision 15)
- `src/features/auth/__tests__/routing.test.tsx` (real-route test pattern for the Stack-stays-mounted test)
- `src/components/ui/index.ts`, `src/theme/tokens.ts`
- `.github/workflows/ci.yml`, `supabase/config.toml` (`[edge_runtime]`)

## User stories
- As a signed-in user, I can switch on seller mode from my Profile, pick Restaurant or Homemade, and fill in my business details, so that I can start receiving customers on the same account.
- As a seller, I pick my address from suggestions as I type, so that my location is a real place and I never have to drop a pin.
- As a seller, I pick exactly one cuisine from the shared list, so that my marker shows the right flag.
- As a restaurant seller, I choose whether I accept table requests (off by default).
- As a homemade seller, I know my exact address is never shown to anyone, and the map shows only an approximate area.
- As a seller, I can open Manage Business at any time to see my listing and change the name, cuisine, address or table setting.
- As a seller, I can switch seller mode off, which hides my listing and the Manage tab. I can switch it back on later without re-entering everything.
- As a guest or non-seller, I can read only the public listing fields (for the maps in 07/08) and never any private data.
- As a screen-reader user, every control in onboarding and Manage Business is labelled, and the cuisine is always announced by name.

## Screens & routes
- `app/(tabs)/profile.tsx` (change) — `ProfileScreen` gains a **Seller mode** row. Its content depends on the state:
  - no business: a "Start selling" button → `/seller/onboarding`
  - business exists: a `Switch` that calls `set_seller_mode` — access: signed-in
- `app/seller/onboarding.tsx` (new) — `SellerOnboardingScreen`, two steps:
  1. **Details:** type (Restaurant / Homemade), business name, cuisine, accepts table requests (restaurant only) → `create_my_business`.
  2. **Address:** `AddressAutocomplete` → `places-resolve` saves the address. On success → `/manage`.

  If the user leaves after step 1, the business exists but has no location, so it is not public. Manage Business then shows "Add your address to go live" (see the 4 states). Access: signed in, profile complete, **no business yet** (a user with a business is redirected to `/manage`).
- `app/(tabs)/manage.tsx` (change) — renders `ManageBusinessScreen` instead of `ComingSoon`. It shows type, name, cuisine (`CuisineLabel`), the address, table setting (restaurants only) and listing status ("Live" / "Hidden — seller mode is off" / "Add your address to go live"). There are "Edit details" and "Change address" buttons. The owner sees their own exact address here. Access: seller (spec 03 `Tabs.Protected`).
- `app/seller/edit.tsx` (new) — `EditBusinessScreen`: name, cuisine, table setting (restaurant only). Type is shown but not editable (Decision 11). Access: signed in, profile complete, has a business.
- `app/seller/address.tsx` (new) — `ChangeAddressScreen`: `AddressAutocomplete` → `places-resolve`. Access: same as edit.

**Access rules (Decision 14):**

| State | `/seller/onboarding` | `/seller/edit`, `/seller/address` |
|---|---|---|
| guest, recovering, profile incomplete | ❌ (existing redirects) | ❌ |
| signed in, complete, no business | ✅ | ❌ → `/seller/onboarding` |
| signed in, complete, has business (seller mode on or off) | ❌ → `/manage` if seller mode on, else `/profile` | ✅ |

These rules are enforced in two places:
- **The existing profile-based guard.** Row 1 uses the guard already in `app/_layout.tsx` (`getRouteAccess(...).app`: signed in, not recovering, profile complete). `app/seller/` sits under it, so nothing new depends on the business query at the root.
- **The seller screens themselves.** Rows 2 and 3 depend on `useMyBusiness`, which can be loading.
  - The root layout and `app/seller/_layout.tsx` add no guard on business state.
  - No `Stack.Protected` keyed on business data. Nothing swaps or unmounts the Stack while the business query loads (the spec 03 bug, Decision 15 there).
  - Each seller screen renders its own `Skeleton` while loading, then `<Redirect>`s if the loaded state doesn't match the table.
  - The redirect logic is a pure helper, `getSellerRoute(business, isSeller, screen)`, in `src/features/sellers/sellerRoutes.ts`, unit-tested row by row.

Route guards are UX only. Every rule is also enforced in the database.

**4 states** on every new screen:
- **Loading:** `Skeleton`.
- **Error:** `ErrorState` with retry.
- **Empty:** this means "no business" (onboarding entry) or "no location yet" (the go-live prompt).
- **Success.**

## Database changes
One migration, `npx supabase migration new seller_onboarding`.

```sql
-- ── Businesses: one per account, public listing fields ────────────────────────
create table public.businesses (
  id                      uuid primary key default gen_random_uuid(),
  owner_id                uuid not null unique references public.profiles(id) on delete cascade,
  type                    text not null check (type in ('restaurant', 'homemade')),
  name                    text not null check (char_length(name) between 1 and 60 and name = btrim(name)
                                              and name !~ '[[:cntrl:]]'),
  cuisine_code            text not null references public.cuisines(code) on update restrict on delete restrict,
  accepts_table_requests  boolean not null default false,
  -- Public map point. Restaurant: the real location. Homemade: the server-shifted point.
  -- Written only by set_business_location(); null until an address is saved.
  map_lat                 double precision check (map_lat between -90 and 90),
  map_lng                 double precision check (map_lng between -180 and 180),
  -- Restaurant street address shown publicly; always null for homemade.
  public_address          text check (char_length(public_address) <= 200),
  -- Mirrors profiles.is_seller; written only by create_my_business() / set_seller_mode().
  is_listed               boolean not null default true,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint businesses_tables_restaurant_only check (type = 'restaurant' or not accepts_table_requests),
  constraint businesses_homemade_no_public_address check (type = 'restaurant' or public_address is null),
  constraint businesses_map_point_pair check ((map_lat is null) = (map_lng is null))
);
create index businesses_listed_type_idx on public.businesses (type) where is_listed and map_lat is not null;
create trigger businesses_set_updated_at before update on public.businesses
  for each row execute function public.set_updated_at();

-- ── Exact location: private, function access only ─────────────────────────────
create table public.business_locations (
  business_id        uuid primary key references public.businesses(id) on delete cascade,
  place_id           text not null check (char_length(place_id) between 1 and 300),
  formatted_address  text not null check (char_length(formatted_address) between 1 and 200),
  lat                double precision not null check (lat between -90 and 90),
  lng                double precision not null check (lng between -180 and 180),
  resolved_at        timestamptz not null default now()   -- server time; lets the before-launch Places refresh find stale rows (Decision 9)
);

-- ── Per-user rate limit for the Places Edge Functions ─────────────────────────
create table public.places_rate_limits (
  user_id       uuid not null references auth.users(id) on delete cascade,
  kind          text not null check (kind in ('autocomplete', 'resolve')),
  window_start  timestamptz not null,       -- truncated to the minute / day by the function
  window_kind   text not null check (window_kind in ('minute', 'day')),
  count         integer not null default 0,
  primary key (user_id, kind, window_kind, window_start)
);
```

### RLS and grants
All three tables: `enable row level security`, then `revoke all … from anon, authenticated`, in the same migration.

**`businesses`:**
```sql
grant select (id, type, name, cuisine_code, accepts_table_requests, map_lat, map_lng, public_address)
  on public.businesses to anon, authenticated;
grant update (name, cuisine_code, accepts_table_requests) on public.businesses to authenticated;

create policy businesses_select_public on public.businesses for select to anon, authenticated
  using (is_listed and map_lat is not null);
-- Owner must see their own row (even unlisted / no location) so UPDATE … WHERE id = … can match it.
create policy businesses_select_own on public.businesses for select to authenticated
  using (owner_id = (select auth.uid()));
create policy businesses_update_own on public.businesses for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
-- No insert / delete grants or policies: create via create_my_business(); rows go only with the account (cascade).
```

**Field ownership (Decision 2):**

| Column | Seller can set on own listing | How |
|---|---|---|
| `type`, `name`, `cuisine_code`, `accepts_table_requests` | at creation | `create_my_business()` |
| `name`, `cuisine_code`, `accepts_table_requests` | any time | direct `update` (column grant + `businesses_update_own`) |
| address → `business_locations.*`, `map_lat`, `map_lng`, `public_address` | indirectly, by picking a Places result | `places-resolve` Edge Function → `set_business_location()` (service role). The client never sends coordinates. |
| `is_listed` | indirectly | `set_seller_mode()` only |
| `type` | never after creation (Decision 11) | — |
| `id`, `owner_id`, `created_at`, `updated_at` | never | server defaults / triggers |
| Admin-only fields (promotion status: spec 16, `promotions` table; confirmed report count: spec 17; any future suspension flag) | never | not columns a client can write. The exact `column_privs_are` checks below fail if a later migration grants any new column to `anon`/`authenticated` without updating this spec's test. |

`owner_id` and `is_listed` are **not** in the select grant, so no other user can link a listing to an account or see hidden listings. The owner reads their full row through `get_my_business()`.

**`business_locations`:** no grants and no policies for `anon` or `authenticated`. Only the security-definer functions below read or write it. Specs 09/10 add the accepted-request read path as a function.

**`places_rate_limits`:** no grants and no policies for `anon` or `authenticated`. Only `consume_places_quota()` touches it.

**`profiles`:** unchanged. `is_seller` stays non-writable by clients. It is written only by `create_my_business()` and `set_seller_mode()`.

### Functions
All functions are `security definer`, `set search_path = ''`, and run `revoke execute … from public, anon, authenticated` followed by the grant shown.

| Function | Grant | Behaviour |
|---|---|---|
| `create_my_business(p_type text, p_name text, p_cuisine_code text, p_accepts_table_requests boolean default false) returns uuid` | authenticated | Takes the caller from `auth.uid()`. Errors: `profile_incomplete` (username is null), `already_has_business`, `tables_restaurant_only`. Inserts the business with `is_listed = true` and sets `profiles.is_seller = true` in one transaction. Constraint errors (name, cuisine FK) surface as 23514 / 23503. |
| `set_seller_mode(p_on boolean) returns void` | authenticated | Raises `no_business` if the caller has no business. Sets `profiles.is_seller` and `businesses.is_listed` to `p_on` together. Nothing is deleted. |
| `get_my_business() returns jsonb` | authenticated | Returns the caller's own business. That includes `is_listed`, the business columns and, if a location exists, `formatted_address`, `lat` and `lng`. It returns `null` when there is no business. Never takes a business id. |
| `set_business_location(p_owner_id uuid, p_place_id text, p_formatted_address text, p_lat double precision, p_lng double precision) returns jsonb` | **service_role only** | Raises `no_business` if the owner has none. Upserts `business_locations`, then updates the public point. **Restaurant:** `map_lat/lng` = the exact point and `public_address` = the formatted address. **Homemade:** if this is a new location row or `place_id` changed, it computes a fresh shifted point. If the same `place_id` is saved again, `map_lat/lng` stay as they are. `public_address` stays null. Returns the owner view (same shape as `get_my_business`). |
| `consume_places_quota(p_user_id uuid, p_kind text) returns boolean` | **service_role only** | First checks eligibility, before anything is counted (Decision 19): raises `profile_incomplete` if the user has no username (either kind), and for `resolve` raises `no_business` if the user has no business. Then atomically increments the per-minute and per-day counters (`insert … on conflict do update`). Returns `false` once either limit is exceeded; a refused call still counts toward the day. Deletes the caller's windows older than 2 days as it goes. Unknown `p_kind` raises `invalid_kind`. |

**Homemade shift (Decision 3):**
- Done in SQL inside `set_business_location()`, never in the app or the Edge Function.
- **Bearing:** θ = 2π·random().
- **Distance:** d = sqrt(random()·(R² − r²) + r²) metres, which is uniform over the ring area. R = 500 and r = 200 (Decision 10), so every shift is between 200 m and 500 m.
- **Offset:** Δlat = d·cos θ / 111 320 and Δlng = d·sin θ / (111 320·cos(lat)).
- The shifted point is stored. The offset and the random inputs are not.
- **Edges:** the stored point always satisfies the coordinate checks (lat in [−90, 90], lng in [−180, 180]). Longitude wraps across the date line, so a seller at lng 179.9995 gets a point that is still 200–500 m away by haversine. Within about 0.6° of a pole, `cos(lat)` is floored at 0.01 and lat is clamped, so the shift can be shorter than 200 m there.
- The shift is not re-rolled when the same place is saved again, or when the before-launch refresh (Decision 9) updates `lat/lng` for the same `place_id`. Re-rolling would let an observer average several shifted points back towards the real one.
- **Known limitation (security review, Decision 20):** the re-roll is keyed on the `place_id` string, not the physical spot. Google can return different place IDs for the same building, so an owner who switches between them gets a fresh shifted point each time, and someone watching the public point over time could average those samples. In the other direction, a refresh that moves the coordinates of the same `place_id` never re-rolls. This matches Decision 3, and only the owner can trigger a re-roll. No change in this spec.

**Function privileges (§16, first spec with callable functions):** the pgTAP test keeps an allowlist of `public` functions that `anon` or `authenticated` can execute. That list is exactly `create_my_business`, `set_seller_mode` and `get_my_business`, for authenticated only. Anon executes nothing. Any other function in `public` that is executable by `anon`/`authenticated` fails the test. Close the §16 item.

No request status transitions in this spec.

## Storage
None (business photos are spec 06).

## Edge Functions
Two functions, Deno + TypeScript, in `supabase/functions/`. Each `index.ts` only wires real dependencies into a pure `handler.ts` (`createHandler(deps)`), so tests inject fakes and **never call Google**.

Shared code in `supabase/functions/_shared/`:
- `auth.ts`: `requireUser(req, getUser)` (with `getUser` injected; in production it wraps `supabase.auth.getUser(jwt)`) and rejects when there is no user. The anon key is itself a valid JWT, so platform `verify_jwt` alone would let guests through.
- `rateLimit.ts`: calls `consume_places_quota` with the service role.
- `google.ts`: a thin `fetch` client for **Places API (New)**.
- `http.ts`: JSON responses and error shape.

**`places-autocomplete`**
- Input: `POST { input: string, sessionToken: uuid }`. `input` is trimmed, 3–120 chars, with no control characters. Anything else gets `400 invalid_input`.
- Steps:
  1. Check auth → `401 unauthorized`.
  2. Validate the input.
  3. Consume quota `autocomplete` → `403 profile_incomplete` if the user has no username, `429 rate_limited` over the limit (Decision 19).
  4. `POST https://places.googleapis.com/v1/places:autocomplete` with header `X-Goog-Api-Key: PLACES_API_KEY` and body `{ input, sessionToken, languageCode: 'en' }`. There is no region restriction (Decision 4).
- Output: `{ suggestions: { placeId, primaryText, secondaryText }[] }`, at most 5.
- Errors: Google errors or timeouts (5 s) → `502 upstream_error`. The upstream body is never echoed back.

**`places-resolve`**
- Input: `POST { placeId: string, sessionToken: uuid }`. `placeId` must match `^[A-Za-z0-9_-]{1,300}$`.
- Steps:
  1. Check auth.
  2. Validate the input.
  3. Consume quota `resolve` → `403 profile_incomplete`, `404 no_business` if the user has no business, `429 rate_limited` (Decision 19). All three happen before Google is called.
  4. `GET https://places.googleapis.com/v1/places/{placeId}?sessionToken=…&languageCode=en` with `X-Goog-FieldMask: id,formattedAddress,location`. That field mask keeps the call in the Essentials SKU and ends the billing session.
  5. Require `location` and `formattedAddress` → otherwise `422 not_a_place`.
  6. Call `set_business_location(user.id, …)` with the service role. The owner is **always the verified user**, never a value from the request body.
- Output: the owner view from `set_business_location`.
- Errors: `403 profile_incomplete` and `404 no_business` (both from the quota step, before Google; `set_business_location` also raises `no_business` as a backstop), plus the `401`, `400`, `429`, `422` and `502` cases above.

**Limits:**

| Function | Per minute, per user | Per day, per user |
|---|---|---|
| autocomplete | 30 | 100 |
| resolve | 5 | 5 |

The minute limits are from Decision 12; the day limits were lowered in Decision 19.

**Secrets:**
- `PLACES_API_KEY`: a new key that **Archan creates**. Claude never reads, prints or sets it.
- `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`: injected automatically by Supabase.
- The service-role key exists only inside the functions.

**Logging:** status code, function name and latency only. Never the user's input text, the place ID, coordinates or the key.

### Google API key — for Archan to create
Archan creates this key later, and only for the manual device run (Decision 13). Implementation and all tests proceed without it. Create a **new, separate key**. Do not reuse `EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY`, which ships in the app bundle.

1. **APIs:** in Google Cloud, enable **Places API (New)** only. The legacy "Places API" is not needed.
2. **API restrictions:** restrict the key to **Places API (New)** and nothing else.
3. **Application restrictions:** set **None**. This is unavoidable: Supabase Edge Functions have no fixed outbound IP, and Android, iOS and referrer restrictions only apply to client keys. Because of this, the cost limits below are what actually protect the key.
4. **Quotas:** in APIs & Services → Places API (New) → Quotas, cap requests per day. Suggested launch caps: Autocomplete 2,000/day and Place Details 300/day. These sit above the per-user limits times the expected number of sellers.
5. **Budget alert:** add one on the billing account, for example at 50% and 90% of a small monthly amount.
6. **Production secret:** `npx supabase secrets set PLACES_API_KEY=<key>`, run by Archan on the linked project.
7. **Local secret:** put the key in `supabase/functions/.env`, which is already gitignored by the `.env` rule, then run `npx supabase functions serve`.
8. **Not needed for tests:** tests and CI never need the key.

## Components & hooks
New feature folder `src/features/sellers/`:
- `schema.ts`: zod schemas for the following.
  - `BusinessType`.
  - The onboarding form (name trimmed 1–60, `cuisine_code`, and `accepts_table_requests` forced false for homemade).
  - The edit form.
  - `MyBusiness` (the `get_my_business` shape).
  - `PlaceSuggestion`.
- `api.ts` holds all Supabase calls:
  - `getMyBusiness()`, `createMyBusiness(input)`, `updateMyBusiness(patch)` (whitelists name / cuisine_code / accepts_table_requests) and `setSellerMode(on)`.
  - `autocompletePlaces(input, sessionToken)` and `resolvePlace(placeId, sessionToken)`, both via `supabase.functions.invoke`.
  - `SellerAppError` with codes `'already_has_business' | 'no_business' | 'profile_incomplete' | 'rate_limited' | 'not_a_place' | 'invalid_input' | 'network' | 'unknown'`, and `mapSellerError`. These follow the `ProfileAppError` pattern.
- `hooks/useMyBusiness.ts`: key `['business', 'me']`.
- `hooks/useCreateBusiness.ts`, `useUpdateBusiness.ts` and `useSetSellerMode.ts`: on success they invalidate `['business','me']` and `['profile','me']`, so the Manage tab appears or disappears without a restart.
- `hooks/usePlaceAutocomplete.ts`:
  - Debounces 300 ms and needs at least 3 chars.
  - Holds one session token per address-entry session, from `expo-crypto` `randomUUID()`. It renews the token after a resolve or when the screen unmounts.
  - Cancels stale queries.
- `hooks/useResolvePlace.ts`: a mutation that, on success, sets `['business','me']` from the response.
- `components/SellerOnboardingScreen.tsx`, `ManageBusinessScreen.tsx`, `EditBusinessScreen.tsx` and `ChangeAddressScreen.tsx`.
- `components/BusinessTypePicker.tsx`: two large radio cards, `accessibilityRole="radio"` with a checked state, and an icon plus text so the choice isn't shown by color alone.
- `components/AddressAutocomplete.tsx`:
  - A `TextField` with a suggestion list (each row ≥ 44pt, labelled with its full text).
  - States: loading, "No matching addresses", error with retry, and a rate-limited message.
  - Shows the required **"Powered by Google"** attribution.
  - For homemade sellers, explains: "Your exact address stays private. The map shows an approximate area."
- `components/SellerModeRow.tsx`: the Profile row. It shows "Start selling" or a `Switch` with `accessibilityRole="switch"`.

Cuisines (`src/features/cuisines/components/`, from spec 04 Decision 9):
- `CuisineLabel.tsx`: flag or Ionicons icon plus the visible name. The glyph is hidden from screen readers (spec 04 display rule).
- `CuisinePicker.tsx`:
  - A searchable list of the 200 cuisines that filters by name on the client and ignores accents. It uses `useCuisines`.
  - Handles loading, error with retry, and "No cuisines match".
  - Single select. Each row has `accessibilityRole="radio"`, a checked state, and a label set to the name.

## Files to create
- `supabase/migrations/<timestamp>_seller_onboarding.sql`
- `supabase/tests/05-seller-onboarding.test.sql`
- `supabase/functions/_shared/{auth,rateLimit,google,http}.ts`
- `supabase/functions/places-autocomplete/{index,handler}.ts`, `supabase/functions/places-resolve/{index,handler}.ts`
- `supabase/functions/tests/places-autocomplete.test.ts`, `places-resolve.test.ts`
- `supabase/functions/deno.json` (imports, `test` task)
- `src/features/sellers/` (schema, api, `sellerRoutes.ts`, hooks, components above, `__tests__/`)
- `src/features/cuisines/components/CuisineLabel.tsx`, `CuisinePicker.tsx` (+ tests)
- `app/seller/_layout.tsx`, `app/seller/onboarding.tsx`, `app/seller/edit.tsx`, `app/seller/address.tsx`

## Files to change
- `app/(tabs)/manage.tsx`: render `ManageBusinessScreen`.
- `src/features/profile/components/ProfileScreen.tsx`: add `SellerModeRow`.
- `app/_layout.tsx`: register the `seller` stack under the existing `app` guard (signed in, profile complete). Add no business-based guard (Decision 14).
- `src/features/auth/routeAccess.ts` (+ tests): only if registering `seller` under the `app` guard needs it. No business state goes in here.
- `supabase/tests/03-navigation-shell.test.sql`: add `businesses` to the ALLOWLIST.
- `supabase/config.toml`:
  - `[functions.places-autocomplete]` and `[functions.places-resolve]` with `verify_jwt = true`.
  - The functions also call `getUser` themselves.
- `.github/workflows/ci.yml`: add a `denoland/setup-deno` step, then `deno test` and `deno lint`/`deno check` for `supabase/functions/`.
- `package.json`: add the `test:functions` script (`deno test --allow-env supabase/functions/tests`).
- `.env.example`:
  - Document that `PLACES_API_KEY` goes in `supabase/functions/.env` locally and in `supabase secrets` for production.
  - Add no value.
- `eslint` / `tsconfig`: exclude `supabase/functions/`, which Deno checks instead.
- `src/types/database.ts`: regenerate with `npm run db:types`.
- `.claude/skills/supabase-patterns/SKILL.md`:
  - **Core tables:** set the `businesses` and `business_locations` lines to match this spec.
  - **Homemade approximate location:** replace the old "deterministic 200–400 m, seeded by business id, rounded" with Decision 3 (a random shift stored once, re-rolled only on a `place_id` change).
  - **Edge Function pattern:** add `handler.ts` + injected dependencies, `requireUser`, `consume_places_quota`, and "owner from JWT, never the body".
- `CLAUDE.md`: set status row 05. The feature-folder list already includes `sellers`.
- `docs/product/v1.md`:
  - Changelog line.
  - Close the §16 function-privileges item.
  - The three Places items from Decision 9 and the lookalike-names item from Decision 16 are already in §16 (added with the spec decisions on 2026-11-03).

## New dependencies
- `expo-crypto` (`npx expo install expo-crypto`): `randomUUID()` for Places session tokens, which group autocomplete and the details call into one billed session. Hermes has no reliable `crypto.randomUUID`.
- **Deno 2 in CI** (`denoland/setup-deno@v2`): to test and type-check the Edge Functions. This is tooling, not an app dependency. Local function tests need Deno installed (`brew install deno`).
- Inside the functions, `npm:@supabase/supabase-js@2` and `npm:zod@4`, pinned in `supabase/functions/deno.json`. Deno-only; not in the app bundle.

No map library or `expo-location` in this spec.

## Rules for implementation
Always include:
- RLS on every new table + pgTAP test
- Supabase calls only in `src/features/<x>/api.ts`
- Theme tokens only, no hardcoded colors/sizes
- Loading / empty / error / success states on every screen
- Accessibility labels on every touchable

Feature-specific rules:
- **Revoke-then-grant** for all three tables, in the same migration. Column-level grants exactly as listed. No table-level `select`/`update` grants on `businesses`.
- **The client never sends coordinates or an address string to the database.** The only write path for location is `places-resolve` → `set_business_location`.
- **Owner identity comes from the server:** `auth.uid()` in SQL, `getUser(jwt)` in Edge Functions. No function takes an owner or business id from the client, except the service-role-only `set_business_location`, which is called with the verified user id.
- **Never show a homemade exact address** to anyone but the owner. On Manage Business, the owner sees their own `formatted_address`. No other screen in this spec shows any address.
- **Homemade shift in SQL only.** Never compute, round or display an offset in the app.
- **No service-role key in the app.** It stays inside the Edge Functions. The app calls functions with the user's session.
- **Edge Function tests inject a fake Google client, a fake `getUser` and a fake quota.** No test or CI step reaches `googleapis.com`; a test asserts the fake `fetch` was the only one used.
- **Places ToS (Decision 9):**
  - Google's terms limit caching Places lat/lng to 30 consecutive days, and require Places content to be shown on a Google map.
  - Store `place_id` and `resolved_at` so the before-launch refresh can find rows to re-fetch. Don't build the refresh here.
  - Show "Powered by Google" with the suggestions.
  - Don't add any other Google data (ratings, photos, names) to the listing.
- **Do not log** address input, place IDs or coordinates in the app or in the functions.
- **Every callable function** ends with `revoke execute … from public, anon, authenticated` and then its grant. The pgTAP allowlist check enforces it.
- The Manage tab and `/seller/*` guards are UX only. Hidden UI is never the protection.
- **Never swap or unmount the Stack while the business query loads** (Decision 14). Business-based redirects happen inside the seller screens, after the data loads.

### Stage gates (Decision 17)
Stop at each gate. Run the gate's checks, report, and commit (conventional commit, files staged by name) before going on. Each gate needs Archan's go-ahead.

| Gate | Contents | Checks before stopping |
|---|---|---|
| **A** | The migration, `05-seller-onboarding.test.sql`, the 03 ALLOWLIST row, regenerated `database.ts`, the supabase-patterns skill update | `npx supabase db reset`, `npx supabase test db` (all files), `npm run typecheck` |
| **B** | `supabase/functions/**`, `deno.json`, Deno tests, `config.toml` `[functions.*]`, the `.github/workflows/ci.yml` Deno steps, the `test:functions` script, `.env.example` note, the eslint/tsconfig excludes | `npm run test:functions`, `deno lint`, `deno check`, `npm run lint`. **Workflow check:** re-read the whole `ci.yml` diff line by line. Pin `denoland/setup-deno@v2` with `deno-version: v2.x`. Run Deno with `working-directory: supabase/functions`. The step needs no secrets and must not reference `PLACES_API_KEY`. It doesn't change the existing jobs' order or `needs`. Check it with `actionlint` if it's already available, without installing it. The first CI run with Deno happens on the PR, so call that out at ship time. |
| **C** | App: `src/features/sellers/**` (no tests), the cuisine `CuisineLabel` / `CuisinePicker`, `app/seller/*`, `manage.tsx`, the `ProfileScreen` row, `expo-crypto` install | `npm run lint`, `npm run typecheck`, the existing `npm test` still green |
| **D** | Jest tests from this spec (`/test-feature`: the writer, then the runner) | `npm test`, plus every check from A–C |
| **Manual** | The device run in the Test plan, with Archan's key | Archan |

**Local Deno:** the function tests need Deno on the machine. Claude asks Archan to run `brew install deno` **at the start of Gate B**, before writing any function code, and confirms with `deno --version`. Claude installs nothing outside the project.

**Google key:** needed only for the manual run after Gate D. Claude never reads, prints or sets it.

## Out of scope
- Menus, menu photos, business photos (spec 06)
- Any map, marker, bottom sheet, or showing listings to guests in the UI (specs 07, 08). This spec only grants the read access those specs will use.
- Requests, and the accepted-request read path for the exact address (specs 09–11)
- The profile's "link to their business" (§11). Deferred to 07/08 when the listing sheet exists (Decision 12).
- Promotions/ad status (spec 16), reports and confirmed-report count (spec 17)
- Admin approval, verification or suspension of listings (Decision 2: instant, no approval)
- Deleting a business, multiple businesses per account, changing business type (Decisions 11, 12)
- Opening hours, phone/contact fields, website
- Manual pin dropping, "use my current location", `expo-location`
- Geographic limits on addresses (Decision 4)
- A scheduled Places lat/lng refresh job (Decision 9; tracked in v1.md §16, before launch)
- Choosing the map provider (spec 07 must use Google Maps on iOS and Android; Decision 9)
- Anything in `docs/product/v1.md` §3

## Definition of done
Each group is tagged with the PR that ticks it (Decision 18). When PR 1 ships, only the PR 1 items are ticked, and the spec status and CLAUDE.md row 05 stay 🚧 In progress. Only PR 2 sets ✅ Shipped.

**Onboarding and editing — PR 2**
- [x] A signed-in user with a complete profile and no business sees "Start selling" on Profile, completes both steps, and lands on Manage Business showing "Live". The Manage tab appears without a restart.
- [ ] The table-requests toggle is shown only for Restaurant, defaults to off, and is saved as false for Homemade.
- [ ] Address suggestions appear after 3+ characters (300 ms debounce). Picking one saves it, and Manage Business shows the resolved formatted address.
- [ ] Leaving after step 1 leaves a business with no location. Manage Business shows "Add your address to go live", and the listing is not readable by anon. *(Not manually checked: the third-account device flow; carried to v1.md §16.)*
- [ ] Edit details changes name, cuisine and table setting, and Manage Business updates without a restart. Type is shown read-only.
- [ ] Change address replaces the address. For homemade the public point is re-shifted; re-picking the same place leaves it unchanged.
- [x] Switching seller mode off hides the Manage tab and makes the listing unreadable by anon. Switching it on restores both with the same data. *(Tab and data checked on device; anon read covered by PR 1 pgTAP.)*
- [ ] A user who already has a business and opens `/seller/onboarding` is redirected. A user with no business opening `/seller/edit` is redirected to onboarding.
- [ ] While the business query is loading, the root Stack stays mounted. The previous screen stays in the back stack, nothing remounts, and the seller screen shows its skeleton. The redirect happens only after the data loads (routing test, Decision 14).
- [ ] Every new screen shows loading, error with retry, empty and success states.

**Security (pgTAP) — PR 1**
- [x] RLS is on for `businesses`, `business_locations` and `places_rate_limits`.
- [x] `anon` and `authenticated` hold no table-level privileges on `businesses`. Their column privileges are exactly: select on `id, type, name, cuisine_code, accepts_table_requests, map_lat, map_lng, public_address`, plus update on `name, cuisine_code, accepts_table_requests` for authenticated only (`column_privs_are` for every column).
- [x] `anon` and `authenticated` hold no table or column privileges on `business_locations` or `places_rate_limits`.
- [x] An outsider (anon or another signed-in user) cannot select any row of `business_locations` (42501), cannot select `owner_id` or `is_listed` from `businesses` (42501), and sees no unlisted or location-less business.
- [x] An outsider cannot update another user's business (0 rows affected), even with a matching `id` filter.
- [x] An owner cannot update their own `type`, `owner_id`, `is_listed`, `map_lat`, `map_lng`, `public_address`, `created_at` (42501), or insert/delete any business (42501).
- [x] An owner cannot set `accepts_table_requests = true` on a homemade business (23514).
- [x] `get_my_business()` returns only the caller's business, and returns null for a user with none. A second user can never get the first user's address through it.
- [x] `create_my_business` sets `is_seller = true`. It fails with `already_has_business` on a second call, `profile_incomplete` without a username, and `tables_restaurant_only` for homemade with tables. `anon` cannot execute it.
- [x] `set_seller_mode` fails with `no_business` when there is no business, and keeps `is_seller` and `is_listed` in sync.
- [x] `set_business_location` and `consume_places_quota` are not executable by `anon` or `authenticated` (42501). They are executable by `service_role`.
- [x] The function allowlist check passes: the only `public` functions executable by `authenticated` are the three listed, and `anon` can execute none.
- [x] `authenticated` still cannot update `profiles.is_seller` (spec 02 regression).
- [x] The 03 allowlist includes `businesses`. `00_rls_enabled`, `02`, `03` and `04` still pass.

**Approximate location (pgTAP) — PR 1**
- [x] For 50 homemade businesses, the stored `map_lat/lng` is between 200 m and 500 m (± 1 m) from the exact point by haversine, and never equals it.
- [x] Re-saving the same `place_id` with the same or slightly different `lat/lng` leaves `map_lat/lng` unchanged. Saving a new `place_id` changes it.
- [x] For restaurants, `map_lat/lng` equals the exact point and `public_address` equals `formatted_address`. For homemade, `public_address` is null.

**Edge Functions (Deno, no Google) — PR 1**
- [x] A missing token, an anon-key token or an invalid token gets `401`, and the fake Google client is not called.
- [x] Input under 3 or over 120 chars, control characters, a non-uuid session token or a malformed `placeId` gets `400`, with no Google call.
- [x] When the fake quota returns false, the response is `429 rate_limited` with no Google call. `consume_places_quota` enforces 30/min and 100/day for autocomplete and 5/min and 5/day for resolve (pgTAP: the 31st autocomplete call in a minute returns false).
- [x] Eligibility before Google (Decision 19): autocomplete or resolve for a user without a username gets `403 profile_incomplete`, and resolve for a user without a business gets `404 no_business`, with no Google call. In pgTAP, `consume_places_quota` raises `profile_incomplete` / `no_business` for those users and counts nothing.
- [x] Autocomplete sends the key header and session token, and maps at most 5 suggestions.
- [x] Resolve sends the field mask `id,formattedAddress,location` and the session token.
- [x] A Google error or timeout gets `502`, and the response body contains no upstream text and no key.
- [x] Resolve calls `set_business_location` with the verified user's id even when the body contains a different `owner_id`/`userId`. A missing location gets `422`.
- [x] No test makes a network call (global `fetch` is stubbed to throw).

**Quality — PR 1**
- [x] `src/types/database.ts` is regenerated and includes `businesses`, `business_locations`, `places_rate_limits` and the new functions.
- [x] The supabase-patterns skill is updated (core tables, homemade shift, Edge Function pattern). v1.md §16 has the function-privileges item closed.
- [x] The CI workflow runs the Deno tests, lint and check for `supabase/functions/` and is green on the PR 1 run. No step references `PLACES_API_KEY`.
- [x] `npm run lint`, `npm run typecheck`, `npm test` (existing suites), `npm run test:functions` and `npx supabase test db` all pass, in CI too.
- [x] CLAUDE.md row 05 and this spec's status are 🚧 In progress, with only the PR 1 items ticked.

**Quality — PR 2**
- [ ] `CuisinePicker` and `CuisineLabel` follow the spec 04 display rule: the name is visible and the glyph is hidden from screen readers. The picker search finds "Côte d'Ivoire" when you type "cote". *("cote" search passed on device. Not manually checked: flag and neutral-icon rendering, VoiceOver/TalkBack; carried to v1.md §16.)*
- [ ] Every touchable has `accessibilityLabel` + `accessibilityRole`, is ≥ 44pt, and selected states are shown without relying on color alone. *(Not manually checked: VoiceOver/TalkBack; carried to v1.md §16.)*
- [x] "Powered by Google" is shown with the suggestions.
- [ ] No hardcoded colors or sizes outside tokens.
- [ ] The manual device run is done (Test plan), with Archan's key. *(Partly done 2026-11-03: restaurant and homemade onboarding, cuisine search, autocomplete, seller mode off/on, Studio look at the homemade point. Not manually checked: Google usage after fast typing, flag/icon rendering, VoiceOver/TalkBack, leave-after-step-1 flow; carried to v1.md §16.)*
- [ ] `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:functions` and `npx supabase test db` all pass, in CI too.
- [ ] CLAUDE.md row 05 and this spec's status are ✅ Shipped, and the v1.md changelog has a spec 05 shipped line.

## Test plan
**Unit and component tests (jest)**: supabase mocked. All RNTL v14 calls are awaited.
- `sellers/__tests__/schema.test.ts`: name trim and length limits, and that tables is forced off for homemade.
- `sellers/__tests__/api.test.ts`:
  - The right RPC names and arguments are used.
  - `updateMyBusiness` whitelists its columns and never sends `type`, `is_listed` or coordinates.
  - `functions.invoke` is called with the right bodies.
  - Each error code maps to the right `SellerAppError`, including 429 to `rate_limited`.
- `sellers/__tests__/usePlaceAutocomplete.test.tsx`:
  - Applies the debounce and the 3-char minimum.
  - Reuses one session token across keystrokes and renews it after a resolve.
  - Discards stale results.
- `sellers/__tests__/SellerOnboardingScreen.test.tsx`:
  - Step 1 validation, the restaurant-only toggle, and step 1 → step 2 → `/manage`.
  - Shows the `already_has_business` error.
  - Shows the privacy note for homemade.
- `sellers/__tests__/AddressAutocomplete.test.tsx`: loading, no results, error with retry, rate-limited message, attribution, and that rows are ≥ 44pt and labelled.
- `sellers/__tests__/ManageBusinessScreen.test.tsx`: all 4 states, "Live" / "Hidden" / "Add your address to go live", and table setting hidden for homemade.
- `sellers/__tests__/EditBusinessScreen.test.tsx`: saves only the editable fields and shows type read-only.
- `sellers/__tests__/SellerModeRow.test.tsx`:
  - Shows "Start selling" with no business, and the switch when a business exists.
  - Toggling invalidates the profile query; with a mocked refetch the tab bar hides Manage.
- `cuisines/__tests__/CuisinePicker.test.tsx` and `CuisineLabel.test.tsx`: accent-insensitive search, single select, a11y role and checked state, glyph hidden, and a neutral icon for `street-food`.
- `sellers/__tests__/sellerRoutes.test.ts`: every row of the access table.
- `sellers/__tests__/sellerRouting.test.tsx`: real routes, supabase mocked (the spec 03 `routing.test.tsx` pattern).
  - Start on the Profile tab and push `/seller/edit` while `getMyBusiness` is a pending promise.
  - **Stack stays mounted:** a mount counter on the Profile screen (and the root Stack) doesn't increase, `router.canGoBack()` is true, and the skeleton is visible.
  - Then resolve with `null` → redirect to `/seller/onboarding`, and Back still returns to Profile.
  - The same for `/seller/onboarding` resolving with a business → `/manage`.

**Database tests (pgTAP)**: `supabase/tests/05-seller-onboarding.test.sql`, using the spec 02 impersonation pattern (fixed-UUID `auth.users` inserts, `set local role` + `request.jwt.claims`).
- The RLS flags.
- Exact `table_privs_are` / `column_privs_are` for anon and authenticated on all three tables.
- Function execute checks plus the `public` function allowlist.
- Owner, outsider and anon cases for select, update, insert and delete, matching the Security DoD.
- The create / seller-mode / location function error codes.
- Shift distance bounds over 50 rows, stability, and re-roll on a new `place_id`.
- Rate-limit counting across minute and day windows, and the eligibility refusals (Decision 19).
- `03-navigation-shell.test.sql`: add the ALLOWLIST row.

**Edge Function tests (Deno)**: `supabase/functions/tests/*.test.ts`. They call `createHandler` with fake `getUser`, `consumeQuota`, `google` and `setLocation`, and stub global `fetch` to throw. The cases are the Edge Functions DoD items. Run with `npm run test:functions`.

**Manual check on device** (the only step that needs a real key: Archan creates it and puts it in `supabase/functions/.env`, then runs `npx supabase functions serve`):
- **Restaurant onboarding:** Profile → Start selling → Restaurant, pick a cuisine, type a real Ontario address, pick it, see "Live" in Manage.
- **Homemade onboarding:** in Studio, `businesses.map_lat/lng` differs from `business_locations.lat/lng` by 200–500 m. Re-pick the same address: unchanged.
- **Seller mode:** switch off, and the Manage tab disappears. Switch on, and it's back.
- **Abuse:** type quickly and check one request per pause. Sign out: the function returns 401 from an anon-key `curl`.
- **Flags:** check rendering in `CuisinePicker` on iOS and Android, including the accepted Taiwan quirk (spec 04).
- **VoiceOver:** the type picker, cuisine picker, suggestions and switch.

## Decisions (from Archan, 2026-11-03)
1. Address autocomplete uses Google Places, called only through Supabase Edge Functions. `PLACES_API_KEY` never ships in the app. Picking a suggestion resolves to a real place with lat/lng filled in by the server. No manual pin. The functions accept signed-in users only, limit input length and rate-limit; they are tested with a mocked Google client.
2. Seller mode is instant: no approval step. The field ownership table above lists what sellers can and can't set, enforced by RLS, column grants and pgTAP.
3. The homemade approximate point is shifted once by the server, by a random distance up to ~500 m, stored, and changed only when the address changes. Other users can't read the exact address or coordinates at all in this spec (pgTAP).
4. No geographic limit on addresses.
5. Exactly one cuisine per seller (`cuisine_code` → `cuisines.code`). Restaurants have `accepts_table_requests`, default off.
6. Scope as listed in Overview; menus, maps and requests excluded.
7. Guests and non-sellers read public listing fields only, via revoke-then-grant and exact privilege checks.
8. Archan creates the Places key with the restrictions above. Claude never reads or prints it.

### Spec review decisions (approved 2026-11-03)
9. **Keep Google Places (Open question 1).** Google's terms limit caching Places lat/lng to 30 consecutive days, and require Places content to be shown on a Google map. This spec stores `place_id` + `resolved_at` so a refresh is possible, but does not build the refresh. Added to `docs/product/v1.md` §16:
   - (a) a scheduled refresh job for Places-derived coordinates, before launch
   - (b) spec 07 must use the Google Maps provider on both iOS and Android
   - (c) re-read Google's current terms, and get a legal read, before launch
10. **Homemade shift (Open question 2):** a random distance between 200 m and 500 m, with a random bearing, saved once.
11. **Business type is fixed after creation** in v1 (Open question 3).
12. **All other choices accepted as proposed**, including no coordinates from the app and the callable-function allowlist. For the remaining open questions that means:
    - Q4: seller mode off hides the listing and keeps the data.
    - Q5: one business per account.
    - Q6: the rate limits and Google quota caps as listed.
    - Q7: a restaurant's address is public; homemade has none.
    - Q8: the profile link to the business is deferred to 07/08.
    - Q9: names are 1–60 chars, trimmed, not unique.
13. **API key:** Archan creates the key later, only for the manual device run. All tests use the fake Google client. Claude never reads, prints or sets the key.
14. **Seller route guards:** no business-based guard in the root layout or `app/seller/_layout.tsx`, and no `Stack.Protected` keyed on business data. Each seller screen shows its skeleton while `useMyBusiness` loads, then redirects via `getSellerRoute`. The Stack is never swapped or unmounted while the query loads (the spec 03 bug). A routing test proves the Stack stays mounted. Chosen over the loading-overlay pattern because it keeps the loading state local to the one screen that needs the data.
15. **Q3–Q9 confirmed** as in Decisions 11–12.
16. **Lookalike names:** official-sounding or lookalike business names (e.g. "LikeToOrder Official", "Support") are handled in spec 17 together with usernames. Added to `docs/product/v1.md` §16. This spec keeps only the length and control-character rules.
17. **Stage gates:** A (DB) → B (Edge Functions + CI) → C (app) → D (jest) → manual run. Stop and commit at each gate (see Rules for implementation).

### Split decision (approved 2026-11-03)
18. **One spec, two PRs (Open question 10).**
    - **PR 1** = Gates A + B (database, Edge Functions, Deno, CI change) on `feature/seller-onboarding-backend`. The unpushed `feature/seller-onboarding` branch was renamed to it.
    - **PR 2** = Gates C + D plus the manual run (the app) on `feature/seller-onboarding-app`, created from `main` after PR 1 is merged.
    - The Definition of done tags each group with its PR.
    - **When PR 1 ships:** `/ship-feature` ticks only the PR 1 items, sets this spec's status and CLAUDE.md row 05 to 🚧 In progress (never ✅), and adds no "shipped" changelog line.
    - **When PR 2 ships:** `/ship-feature` ticks the rest and sets ✅ Shipped.

### PR 1 code review decisions (approved 2026-11-03)
19. **Places quota eligibility and lower day limits.** The security review found that any signed-in account could use up the shared Google daily caps. `consume_places_quota` now refuses ineligible users before anything is counted or Google is called, with a distinct signal (not the rate-limit `false`):
    - no username (either kind) → raises `profile_incomplete` → `403 profile_incomplete`;
    - `resolve` with no business → raises `no_business` → `404 no_business`.
    Day limits per user are lowered to autocomplete 100/day and resolve 5/day; minute limits are unchanged (30 and 5). No app-wide limit: Google's own daily caps stay the backstop. Added to `docs/product/v1.md` §16: sign-up captcha also protects the Places quota; pin or vendor Edge Function dependencies before launch; pin all GitHub Actions by SHA in a separate chore.
20. **Shift re-roll key:** no code change. The re-roll stays keyed on the `place_id` string, recorded as a known limitation under Homemade shift.

## Open questions
None. All resolved on 2026-11-03 (Decisions 9–18), kept for the record:

1. ~~**⚠ Google Places terms vs. storing coordinates (flagging Decision 1).**~~ → Decision 9.
   - **The problem:** Google's Maps Platform Service Specific Terms let us cache Places **lat/lng for at most 30 consecutive days**. After that the values must be deleted or refreshed. Place IDs may be stored indefinitely.
   - **What this spec does:** it stores `place_id` and `resolved_at` but has no refresh.
   - **Map attribution:** the terms have also required either a Google map or Google attribution when Places content is shown off a Google map. `react-native-maps` uses Apple Maps on iOS unless spec 07 picks `PROVIDER_GOOGLE`.
   - **Options:**
     - (a) Keep Google. Add a scheduled refresh: a `pg_cron` job plus an Edge Function that re-fetches `location` by `place_id` before 30 days. Add it to §16 as "before launch", and decide the map provider in spec 07.
     - (b) Switch to a provider whose terms allow permanent storage (for example Mapbox permanent geocoding, Geoapify, LocationIQ). The Edge Function design stays the same.
     - (c) Get a legal read of the current terms first.
   - **Also unclear:** whether the derived homemade shifted point counts as "cached Google content".
   - **Recommendation:** (a), with the refresh tracked in §16. **Please decide before planning.**
2. ~~**Minimum shift distance (flagging Decision 3).**~~ → Decision 10. "Random distance up to ~500 m" can produce a shift of a few metres, which would put the marker on the seller's house. The proposal is a ring of 200–500 m, uniform over the area, with a random bearing. Approve 200 m, pick another minimum, or keep 0.
3. ~~**Changing business type.**~~ → Decision 11. The proposal is that type is fixed after creation in v1. Switching restaurant → homemade would hide an address that was already public. Switching homemade → restaurant would publish the exact address. Later specs also tie menus and requests to type. If a change is needed, a future spec would clear the address and re-onboard. OK?
4. ~~**Seller mode off.**~~ → Decision 12. The proposal is that the listing is hidden and the data kept, and switching back on restores it unchanged. It is not deleted. Specs 09/10 will need to decide what happens to open requests when a seller switches off. OK?
5. ~~**One business per account.**~~ → Decision 12. `owner_id` is unique. The product spec implies this but doesn't say it. Confirm.
6. ~~**Rate-limit numbers and Google quota caps.**~~ → Decision 12. The proposals are 30/min and 300/day for autocomplete, 5/min and 20/day for resolve, plus daily caps of 2,000 autocomplete and 300 details in Google Cloud. Adjust if you expect bulk onboarding.
7. ~~**Restaurant public address.**~~ → Decision 12. The proposal is that a restaurant's formatted street address is a public listing field (`public_address`), for pickup and table requests. Homemade has none. Confirm restaurants are fine being public.
8. ~~**Profile "link to their business" (§11).**~~ → Decision 12. The proposal is to defer it to 07/08, when the listing sheet exists to link to. OK?
9. ~~**Business name rules.**~~ → Decision 12. The proposal is 1–60 chars, trimmed, no control characters, and not unique. Two "Joe's Pizza" listings are allowed. OK?
10. ~~**PR size: split into two PRs?**~~ → Decision 18. This is the largest spec so far: a migration with 5 functions and 3 tables, 2 Edge Functions with a new Deno CI job, 4 screens and 2 shared cuisine components, plus 3 test suites. One PR is reviewable but long, and the new CI job makes a red first run more likely to hold up the app work.
    - **Proposal:** keep this one spec, but ship two PRs from it.
    - **PR 1, Gates A + B:** database and Edge Functions. Safe to merge alone: nothing in the app calls them yet, `businesses` is empty, and it proves the Deno CI job.
    - **PR 2, Gates C + D + manual:** the app.
    - **Status:** CLAUDE.md row 05 stays 🚧 after PR 1 and goes ✅ after PR 2.
    - **Your choice:** approve the split, or say "one PR". (Split approved.)
