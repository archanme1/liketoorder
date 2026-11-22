# Spec 16: Promotions

**Branch:** `feature/promotions-backend` (PR 1), then `feature/promotions-seller` (PR 2), `feature/promotions-map` (PR 3), `feature/promotions-offers` (PR 4). Each is cut from `main` after the previous PR is merged.
**Product spec:** `docs/product/v1.md` §7 (Ads), §4 (Navigation), §13 (Legal: disclose "Sponsored"), §14 row 16, §3 (out of scope), §15 Q1, Q3 and Q5, §16 (before launch)
**Plan mode:** required: it changes the schema and RLS, touches more than 5 files and changes navigation (a new tab).
**Status:** ✅ Shipped. PR 4 #38 (ec60b31), PR 1 #35 (ad3e19d), PR 2 #36 (3dda392), PR 3 #37 (cc01fa5).

## Overview
A seller asks for a fixed-price, fixed-length promotion from Manage Business. Archan is paid outside the app (invoice) and approves it with one SQL call. While the campaign runs, the place gets three things:
- a **larger flag with an "Ad" badge** on its map, which pops in once and then floats gently (it stays still with Reduce Motion);
- a card in a new **Offers** tab that lists promoted places near the person, with filters, paging and the word "Sponsored";
- the word **"Sponsored"** at the top of its map sheet.

When the campaign ends, everything goes back to normal by itself (the server clock decides, no job). It comes now because every surface it decorates (maps, sheets, Manage, tab bar) has shipped. No payment is built here (Resolved Q10).

### What people see, in plain words

**Seller (Manage Business, seller mode on)**
- A new row, **Promote your business**. It opens the Promote screen.
- **No campaign yet:** an invitation. It says what a promotion does (a larger flag on the map and a card in Offers), its price and length (read from the server), and shows a short form: category (New on the menu, Special offer or Featured), a headline of at most 60 characters, and a preferred start date. Then **Send request**.
- **Requested:** "Waiting for review. We'll contact you about payment." with **Cancel request**.
- **Scheduled** (approved, not started): "Starts on 2 Dec, ends on 9 Dec." with **Cancel promotion**.
- **Active:** "Promoted until 9 Dec." with **Cancel promotion**, which ends it at once (refunds are handled outside the app).
- **Ended:** "Ended on 9 Dec." with **Promote again**.
- **Rejected:** "Not approved: <reason>" with **Promote again**.
- **Cancelled:** "Cancelled on <date>." with **Promote again**.
- Customers never see this invitation. It exists only on the seller's own Manage screen.

**Customer or guest on a map (Restaurants or Homemade tab)**
- A promoted place shows a **larger flag** (about 1.3 times the normal pill) with a highlight ring and a small **"Ad"** text badge.
- When it first appears it pops in once, growing from 0.8 to 1 times its size in 220 ms, eased, with no overshoot. Then it rises and falls 4 pt in a slow loop.
- With **Reduce Motion** on it is the same larger flag with ring and badge, and nothing moves.
- At most 8 larger markers are drawn at once (Resolved Q4). Other promoted places in view are drawn normal size with the ring and the "Ad" badge.
- A screen reader says "<Name>, <Cuisine> cuisine, sponsored" (homemade: "..., homemade, approximate area, sponsored").
- Tapping it opens the usual sheet with **"Sponsored"** written at the top.
- When the campaign ends, the flag goes back to normal on the next map refresh (within about a minute).

**Customer or guest in the Offers tab (seller mode off)**
- A list of promoted places near the person or near a chosen area.
- Each card shows:
  - the cover photo, or the flag when there is none;
  - the name, the flag and the cuisine;
  - the category and the headline;
  - "about 4 km";
  - Restaurant or Home cook;
  - the word **"Sponsored"**.
- Filter chips: category (All, New on the menu, Special offer, Featured), type (All, Restaurants, Home cooks), distance (about 5, 15 or 30 km) and "Takes table requests".
- **Change area** offers "Use my location" or the launch city.
- Tapping a card opens the place on its map tab with its sheet open. If the place is no longer promoted or visible, a friendly message appears instead: "This offer has ended or the place isn't available right now." The list then refreshes.
- **Empty:** "No offers near you right now. Check back later or browse the map." with a **Browse the map** button.
- **Loading:** skeleton cards. **Error:** a message with **Retry**.

## Depends on
05 seller-onboarding, 06 menu-management (cover photo), 07 restaurant-map, 08 homemade-map, 10b requests-tab-and-answers (tab visibility). All ✅ Shipped.

## Context to load
- `CLAUDE.md`, this spec, `docs/product/v1.md` §4 and §7
- `.claude/skills/supabase-patterns/SKILL.md`, `.claude/skills/map-markers/SKILL.md` (PR 3 and PR 4)
- PR 1: `supabase/migrations/20261105040319_restaurant_map.sql`, `20261105043445_restaurant_map_hardening.sql`, `20261107041120_homemade_map.sql` (functions to replace); `supabase/tests/05-seller-onboarding.test.sql`, `07-restaurant-map.test.sql`, `08-homemade-map.test.sql`; `src/features/map/schema.ts`; `supabase/seed.sql`
- PR 2: `src/features/sellers/components/ManageBusinessScreen.tsx`, `app/seller/` routes
- PR 3: `src/features/map/{clustering.ts,businessMapConfig.tsx,homemadeMapConfig.tsx}`, `src/features/map/components/{BusinessMapScreen,FlagMarker,HomemadeMarker,RestaurantSheet}.tsx`, `src/features/map/hooks/useTracksViewChanges.ts`, `src/lib/useReduceMotion.ts`
- PR 4: `app/(tabs)/_layout.tsx`, `src/features/navigation/hooks/useTabVisibility.ts`, `src/features/auth/routeAccess.ts`, `src/features/map/{region.ts,lastRegion.ts,countryViews.ts}`, `src/features/map/hooks/useLocationPermission.ts`, `src/features/map/components/LocationPrompt.tsx`, `app.config.ts`

## User stories
- As a seller, I can request a promotion with a category and a headline, see its state, cancel it, and promote again after it ends.
- As the admin (Archan), I can approve a request with a start time, reject it with a reason, or cancel a campaign, with one documented SQL call.
- As a customer or guest, I see promoted places as larger, clearly labelled flags that respect Reduce Motion.
- As a customer or guest, I can open Offers, see promoted places near me or near the launch city, filter them, page through them, and open one on its map.
- As a screen-reader user, I hear "sponsored" on every promoted marker, card and sheet.

## Screens & routes
- `app/(tabs)/offers.tsx` (PR 4): renders `OffersScreen`. Public, guests included. Hidden with seller mode on. The tab sits between Homemade and Requests.
- `app/seller/promote.tsx` (PR 2): renders `PromoteScreen`. Signed-in business owner only (the existing seller screen gate).
- `app/(tabs)/restaurants.tsx` and `app/(tabs)/homemade.tsx` (PR 4): accept an optional `business` search param from an Offers card, which moves the camera and opens that place's sheet.
- `app/(tabs)/_layout.tsx` (PR 4): adds the Offers tab.

## Database changes
All in one new migration in PR 1 (`npx supabase migration new promotions`).

```sql
create extension if not exists btree_gist with schema extensions;   -- for the overlap constraint

-- One row, edited by Archan in the dashboard. No row = promotions not configured (live until set).
create table public.promotion_settings (
  id            boolean primary key default true check (id),
  price_cents   integer not null check (price_cents > 0),
  currency_code text    not null references public.currencies(code),
  length_days   integer not null check (length_days between 1 and 60)
);

create table public.promotions (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses(id) on delete cascade,
  category        text not null check (category in ('new_dish', 'special_offer', 'featured')),
  headline        text not null check (char_length(headline) between 1 and 60
                                      and headline = btrim(headline)),   -- + the shared hidden-character rule
  preferred_start date,
  status          text not null default 'requested'
                    check (status in ('requested', 'approved', 'rejected', 'cancelled')),
  -- Snapshot of promotion_settings when requested (the price may change later).
  price_cents     integer not null check (price_cents > 0),
  currency_code   text    not null references public.currencies(code),
  length_days     integer not null check (length_days between 1 and 60),
  starts_at       timestamptz,
  ends_at         timestamptz,
  reject_reason   text check (reject_reason in ('headline', 'not_paid', 'not_eligible', 'other')),
  cancelled_by    text check (cancelled_by in ('seller', 'admin')),
  cancelled_at    timestamptz,
  reviewed_at     timestamptz,
  created_at      timestamptz not null default now(),
  constraint promotions_window_pair   check ((starts_at is null) = (ends_at is null)),
  constraint promotions_window_order  check (ends_at is null or ends_at > starts_at),
  constraint promotions_approved_window check (status <> 'approved' or starts_at is not null),
  constraint promotions_rejected_reason check ((status = 'rejected') = (reject_reason is not null)),
  constraint promotions_cancel_fields check ((status = 'cancelled') = (cancelled_by is not null and cancelled_at is not null)),
  -- Two approved campaigns of one business can never overlap in time.
  constraint promotions_no_overlap exclude using gist
    (business_id with =, tstzrange(starts_at, ends_at) with &&) where (status = 'approved')
);
-- At most one waiting request per business (also the backstop for two simultaneous requests).
create unique index promotions_one_request on public.promotions (business_id) where status = 'requested';
create index promotions_approved_ends on public.promotions (ends_at) where status = 'approved';
```

**Derived state** (never stored, computed by the server clock at read time; Decision D5):
| Stored | Condition | State shown |
|---|---|---|
| requested | | requested |
| approved | now() < starts_at | scheduled |
| approved | starts_at <= now() < ends_at | active (shown on maps and in Offers) |
| approved | now() >= ends_at | ended |
| rejected | | rejected |
| cancelled | | cancelled |

**RLS and privileges.** RLS is on for both tables. Neither has a policy, and `anon` and `authenticated` hold no table or column privileges. Every read and write goes through the functions below. This is the same pattern as `map_rate_limits` (spec 07). Settings reach the seller only through `get_my_promotion`. Admin fields (`reviewed_at`, `reject_reason`, `cancelled_by`, status) can never be written by a client.

**Functions.** All are security definer with `set search_path = ''`, created with `revoke execute ... from public, anon, authenticated` and then granted exactly as below. The 05 allowlist test is updated (Decision D11).

| Function | Grant | What it does |
|---|---|---|
| `request_promotion(p_category text, p_headline text, p_preferred_start date) returns jsonb` | authenticated | Locks the caller's business row (`for update`). Errors: `not_eligible` (no business, or not listed / no map point / hidden by the 30-day guard), `not_configured` (no settings row), `already_open` (a requested row, or an approved row with `ends_at > now()`), `invalid_headline`, `invalid_category`, `invalid_start` (a preferred start in the past or more than 90 days ahead). Snapshots the price, currency and length. A unique violation from a race is mapped to `already_open`. Returns the same object as `get_my_promotion`. |
| `cancel_my_promotion(p_promotion_id uuid) returns jsonb` | authenticated | Only for the caller's own business. Allowed for requested, scheduled or active campaigns. Sets `cancelled_by = 'seller'` and `cancelled_at = now()`. Ended, rejected or cancelled campaigns give `not_cancellable`. Someone else's id or an unknown id gives `not_found` (the same answer for both). |
| `get_my_promotion() returns jsonb` | authenticated | `{ promotion: {id, category, headline, preferred_start, state, starts_at, ends_at, reject_reason, price_cents, currency_code, length_days, created_at} or null, settings: {price_cents, currency_code, length_days} or null, eligible: boolean }`. Returns the caller's latest campaign only. |
| `list_offers_near(p_lat double precision, p_lng double precision, p_distance_km integer, p_category text, p_type text, p_tables boolean, p_cursor text) returns jsonb` | anon, authenticated | Rate-limited through `private.consume_map_quota('offers')`. `p_lat` and `p_lng` must sit on the 0.05 degree grid and in range, otherwise `invalid_point`. `p_distance_km` must be 5, 15 or 30. `p_category` and `p_type` must be null or a known value. Returns only **active** campaigns of businesses that are listed, have a map point and are fresh (`private.restaurant_is_fresh` / `private.homemade_is_fresh`). Ordered by band, then daily rotation, then id (Decision D12). 20 per page: `{ offers: [...], next_cursor: text or null }`. Each offer is exactly `{business_id, type, name, cuisine_code, lat, lng, accepts_table_requests, category, headline, ends_at, band, cover}`, where `lat` and `lng` are the public point (shifted for homemade) and `cover` is the same shape as a details photo or null. It never returns the owner, the exact homemade point or address, the price, the status or any admin field. |
| `map_restaurants_in_bounds(...)`, `map_homemade_in_bounds(...)` (replaced, same signatures) | unchanged | Each pin gains `promoted boolean` (an active campaign right now). Rows are ordered `promoted desc, id` before the 500 cap, so the cap never drops a promoted pin. |
| `get_restaurant_details(uuid)`, `get_homemade_details(uuid)` (replaced, same signatures) | unchanged | Gain `sponsored boolean`. |
| `private.consume_map_quota(p_kind text)` (replaced) | none directly | Accepts the new kind `offers`, with the same per-caller limit and guest ceiling as `pins`. |
| `private.promotion_is_active(p_business_id uuid) returns boolean` | none | True when the business has an approved row with `starts_at <= now() < ends_at`. |
| `private.admin_review_promotion(p_promotion_id uuid, p_decision text, p_starts_at timestamptz default null, p_reject_reason text default null) returns jsonb` | none (database owner only: the dashboard SQL editor) | `approve` (requested only): requires `p_starts_at` no more than 1 hour in the past and sets `ends_at = p_starts_at + length_days`. An overlap gives `overlap`. `reject` (requested only): requires a known reason. `cancel` (requested, scheduled or active): `cancelled_by = 'admin'`. Anything else gives `invalid_transition`. Sets `reviewed_at`. Returns the row's id, the new state, `starts_at` and `ends_at`. |

## Storage
None. The Offers card reuses the business's existing cover photo in `business-media` through the existing public-photo rules and signed URLs (spec 06 and spec 07 details). No new upload, bucket or policy.

## Edge Functions
None. No payment provider, no secrets.

## Components & hooks
**PR 1 (app side, no behaviour change):** `src/features/map/schema.ts`: `pinSchema` gains `promoted: z.boolean()`, and `restaurantDetailsSchema` and `homemadeDetailsSchema` gain `sponsored: z.boolean()`. Nothing reads them yet.

**PR 2 (seller):**
- `src/features/promotions/api.ts`: `fetchMyPromotion`, `requestPromotion`, `cancelMyPromotion`, `mapPromotionError`.
- `src/features/promotions/schema.ts`: zod for every RPC answer and the request form; the category list and labels.
- `src/features/promotions/hooks/{useMyPromotion,useRequestPromotion,useCancelPromotion}.ts`.
- `src/features/promotions/components/PromoteScreen.tsx` (all seven states), `PromoteForm.tsx`, `PromotionStatusCard.tsx`.
- `src/features/promotions/format.ts`: price and date wording (pure, unit-tested).

**PR 3 (map):**
- `src/features/map/components/PromotedMarker.tsx`: larger pill, ring, "Ad" badge, pop-in then float, still with Reduce Motion, `stopPropagation`, memo.
- `src/features/map/hooks/usePromotedFloat.ts`: reanimated values; the random start delay.
- `src/features/map/promotedLayout.ts` (pure): picks at most 8 large markers by daily rank and enforces the minimum on-screen spacing. The rest are drawn normal size with the ring.
- `src/features/promotions/components/SponsoredLabel.tsx`: the "Sponsored" text, shared by the sheet and the card.

**PR 4 (Offers):**
- `src/features/promotions/api.ts`: `fetchOffersNear`.
- `src/features/promotions/hooks/useOffers.ts`: infinite query keyed on grid point and filters.
- `src/features/promotions/components/{OffersScreen,OfferCard,OfferFilters,ChangeArea}.tsx`.
- `src/features/promotions/distance.ts` (pure): on-phone distance and its wording.
- `src/features/promotions/launchArea.ts`: the launch city centre (one constant).
- `src/features/map/region.ts`: `snapPoint()` beside `snapBox`.

## Files to create
- PR 1:
  - `supabase/migrations/<ts>_promotions.sql`
  - `supabase/tests/16-promotions.test.sql`
  - `docs/runbooks/promotions-admin.md`
- PR 2:
  - `app/seller/promote.tsx`
  - `src/features/promotions/**` (seller part)
  - jest tests in `src/features/promotions/__tests__/`
- PR 3:
  - `src/features/map/components/PromotedMarker.tsx`
  - `src/features/map/components/AdBadge.tsx` (the "Ad" badge and the ", sponsored" label helper, shared by the large and the ringed markers, the places list and the sheet; its own file so FlagMarker and PromotedMarker do not import each other)
  - `src/features/map/hooks/usePromotedFloat.ts`
  - `src/features/map/promotedLayout.ts`
  - `src/features/promotions/components/SponsoredLabel.tsx`
  - jest tests
- PR 4:
  - `app/(tabs)/offers.tsx`
  - the Offers components, hooks and helpers listed above
  - `src/features/promotions/offersArea.ts` (the fallback area: last Restaurants view, then last Homemade view, then the launch area)
  - `src/features/promotions/hooks/useOffersOrigin.ts` (decides "near me")
  - `src/features/promotions/components/OfferSkeleton.tsx`
  - `src/features/promotions/__fixtures__/offers.ts` (a faithful fake of `list_offers_near`)
  - `src/features/map/offerTarget.ts` (parses the `business`, `lat`, `lng` route params)
  - `src/features/map/hooks/useOfferTarget.ts` (card to map)
  - jest tests

## Files to change
- PR 1:
  - `src/features/map/schema.ts`
  - `src/types/database.ts` (regenerated)
  - `supabase/seed.sql`
  - the older tests named in Decision D11
  - `docs/product/v1.md` §4, §7, §15 and §16 (Decision D17)
- PR 2:
  - `src/features/sellers/components/ManageBusinessScreen.tsx` (the Promote row)
  - `src/features/sellers/components/SellerScreenFrame.tsx` (an optional pull-to-refresh prop for the Promote screen; other screens unchanged)
  - `src/features/sellers/sellerRoutes.ts` (the `promote` screen in the seller route rule)
  - `app/seller/_layout.tsx` (the Promote screen title)
- PR 3:
  - `BusinessMapScreen.tsx` (the large promoted markers are kept out of clusters: their ids are removed before the cluster index is built, so `clustering.ts` is unchanged)
  - `businessMapConfig.tsx`
  - `homemadeMapConfig.tsx`
  - `HomemadeMarker.tsx`
  - `RestaurantSheet.tsx` and the details headers ("Sponsored")
  - `PlacesList.tsx` (promoted rows show "Sponsored" and say ", sponsored"; one test)
  - `.claude/skills/map-markers/SKILL.md`
- PR 4:
  - `app/(tabs)/_layout.tsx`
  - `src/features/auth/routeAccess.ts` and `useTabVisibility.ts`
  - `app/(tabs)/restaurants.tsx` and `homemade.tsx` (the `business` param)
  - `src/features/map/region.ts`
  - `src/features/map/components/LocationPrompt.tsx` (wording)
  - `app.config.ts` (the location permission text, which needs a native rebuild)
  - `src/features/map/components/BusinessMapScreen.tsx`, `RestaurantMapScreen.tsx`, `HomemadeMapScreen.tsx`, `businessMapConfig.tsx`, `homemadeMapConfig.tsx` (card to map: the target, fresh details, the late-fix guard)
  - `src/features/navigation/components/TabIcon.tsx` (the `pricetag` icon)
  - `scripts/seed/promotions.ts`, `scripts/seed/promotionsData.ts` and its test (the `--offers` flag: 25 active campaigns around Oshawa, for paging)

## New dependencies
No new dependencies. `react-native-reanimated` 4.7.1 is already installed (unused until PR 3). `btree_gist` is a Postgres extension that ships with Supabase, not an npm package.

## Decisions
D1 to D9 were approved by Archan on 2026-11-20. D10 to D17 come from his approval notes.

- **D1 Tab, not a mode (approved).**
  - Offers is a new bottom tab between Homemade and Requests: Restaurants, Homemade, Offers, Requests, Profile.
  - Guests get Restaurants, Homemade, Offers, Profile.
  - It is hidden with seller mode on, like the maps, through the existing `Tabs.Protected` visibility (`getTabVisibility`).
- **D2 Location privacy (approved; the same rule as spec 07 Decision 30).**
  - The exact position never leaves the phone. Only `snapPoint()` output is sent: the position rounded to the nearest point on a 0.05 degree grid (about 5 km cells).
  - The server neither stores nor logs it. Nothing about it is saved on our side.
  - On the phone, "about N km" comes from the real position (or the chosen area's centre) and the place's public point.
- **D3 Public data only (approved).** Public functions return only the fields listed under `list_offers_near` and `promoted`/`sponsored`. They never return the exact homemade point or address, the owner, the price, the status of other campaigns or any admin field.
- **D4 Map functions (approved).** The four map and details functions are replaced with the same signatures and gain `promoted` or `sponsored`. Promoted pins are ordered first, so the 500 cap never drops them.
- **D5 Expiry without a job (approved).** A campaign is active when it is approved and `starts_at <= now() < ends_at` by the server clock, checked at read time. No cron job.
- **D6 Status changes only through functions (approved).** Stored states: requested, approved, rejected, cancelled. Scheduled, active and ended are derived (see the table above).
- **D7 Marker approach (approved).**
  - Keep react-native-maps 1.29.11 custom-view markers.
  - `PromotedMarker` uses reanimated. `tracksViewChanges` is true only for the markers in the animated set (at most 8) and only while animating. All other markers keep today's behaviour.
  - The fallback is the overlay from the map-markers skill (Decision D14).
- **D8 Rate limit (approved).** `list_offers_near` uses `consume_map_quota('offers')`, with the same limits as `pins`. Guests also fall under the existing guest ceiling.
- **D9 Paging (approved).** 20 per page. The cursor is the text form of (band, rotation key, business id). The limit is enforced in SQL, so the app cannot ask for more.
- **D10 Table design, so that "Promote again" works without a job (change 1).**
  - **In plain words:** the database never has to notice that a campaign ended. An approved campaign keeps its stored state "approved" forever, and the server simply compares its end time with the clock.
  - Three separate rules then keep things safe:
    1. **One waiting request per business**, a unique index on `status = 'requested'` only. A finished campaign does not block anything.
    2. **No two approved campaigns of a business may overlap in time**, an exclusion constraint (`btree_gist`) on the approved time windows. The admin cannot approve overlapping dates by mistake.
    3. **`request_promotion` refuses while an approved campaign has not ended yet** (`ends_at > now()`). A scheduled or active campaign blocks a new request, and an ended one does not.
  - Two requests sent at the same moment: the function locks the business row first, so they run one after the other and the second one is refused. The unique index is the backstop if anything bypasses the lock.
  - *Why not a stored "ended" status:* it would need a job, or a write during a read, to flip it. Rows would also look active until something touched them.
  - *If `btree_gist` were unavailable:* the overlap rule moves into `admin_review_promotion` under the same row lock. Supabase ships `btree_gist`, so this is not expected. The migration fails loudly locally and in CI if it is missing.
- **D11 PR 1 keeps main working (change 2).**
  - The map zod schemas are strict, so the app on main would reject pins with a new key. PR 1 therefore also adds the new keys to `src/features/map/schema.ts` (no behaviour change).
  - The older tests that may change in PR 1 are exactly these:
    - pgTAP `supabase/tests/05-seller-onboarding.test.sql`: the function allowlists for authenticated and anon, and the exact `private` list.
    - pgTAP `supabase/tests/07-restaurant-map.test.sql`: the pin and details key sets, and the quota kinds.
    - pgTAP `supabase/tests/08-homemade-map.test.sql`: the pin and details key sets.
    - jest `src/features/map/__tests__/{schema.test.ts,api.test.ts,homemadeApi.test.ts,RestaurantMapScreen.test.tsx,HomemadePinsLoading.test.tsx,HomemadeMapPrivacy.test.tsx}` and any fixture file in that folder that builds pin or details objects: they gain `promoted: false` / `sponsored: false`.
  - If any other test needs a change, I stop and ask. `10b-requests-answer-notes.test.sql` calls the details functions but is not expected to change.
- **D12 Distance is approximate (change 4).**
  - The server only sees the 5 km grid point, so a band such as "within 5 km" is measured from that point, not from the person. Snapping moves the point by at most about 3.5 km (half a cell diagonal at Ontario's latitude).
  - **Recommended and adopted: a 4 km margin on the server.** It searches up to the chosen distance plus 4 km from the grid point, so no place truly inside the chosen distance is missed. A full one-cell margin (about 5.6 km) would add more far places for no gain.
  - Bands for ordering: band 0 is under 5 km from the grid point, band 1 under 15 km, band 2 the rest up to the limit.
  - The phone words every distance with "about", from the real position (or the chosen area's centre), and never hides a returned row (that would break paging):
    - under 1 km: "less than 1 km away";
    - otherwise: "about N km away", rounded to whole km;
    - home cooks add ", approximate area".
  - The chips read "About 5 km", "About 15 km", "About 30 km".
  - Rotation key: `md5(business_id || current UTC date)`, the same for everyone all day and different the next day.
- **D13 Settings are function-only.** `promotion_settings` has no client grant. The seller sees the price and length through `get_my_promotion`. Locally the seed puts in a placeholder (CAD 25.00, stored as 2500 cents, 7 days). On the live project there is no row until Archan sets the real price before launch (§16 item), and until then `request_promotion` answers `not_configured` ("Promotions aren't available yet.").
- **D14 PR 3 starts with a spike gate (change 3).**
  - Before building the rest of PR 3, a throwaway branch proves on the iOS Simulator (Archan runs the build) that a larger marker can pop in and float inside a react-native-maps custom marker.
  - It also checks that `tracksViewChanges` can stay off for all other markers, with React re-render counts and a frame check while panning, using 8 animated markers and the seeded pins.
  - I stop and report **go** (custom markers) or **no-go**. The no-go fallback is an `Animated.View` overlay positioned with `pointForCoordinate` above the map, re-placed on region change. Nothing else in PR 3 is built until Archan decides.
  - **Result (2026-11-21): go.** Reanimated with react-native-maps custom markers; no overlay fallback. Archan judged the spike by eye on the iOS Simulator only (the 13 active campaigns of the `--many` seed): the pop-in and the float were clearly visible, nothing was clipped, idle and panning were smooth, and a marker tap opened and closed the sheet. No frame-rate numbers were collected (Simulator numbers say little about phones). The frame rate with 8 animated markers and 500 pins on a real iPhone and a real Android phone stays a before-launch item (v1 section 16).
  - The spike lived on a local branch (`spike/promotions-marker`, never pushed) that was deleted after the decision. Nothing from it was copied.
  - Found while probing: the official `react-native-reanimated/mock` fails under jest-expo with Reanimated 4.7.1 (its index runs the native CSS setup), so the global jest fake in `jest.setup.ts` is hand-written (F2).
- **D15 Offer card to map (Resolved Q15).** The card pushes the place's map tab with `business=<id>` and the place's public `lat` and `lng` (the shifted point for home cooks), so the camera can move before that area's pins load. The map loads its details fresh (`staleTime: 0`) when a card opens a place, so a cached answer never still says "sponsored". If the result is `null` or `sponsored = false`, it shows "This offer has ended or the place isn't available right now." and refreshes Offers. A place that is visible but no longer sponsored still opens; the message is shown above its sheet.
- **D16 No cuisine parameter yet (Resolved Q12).** I recommend **not** adding a cuisine parameter to `list_offers_near` now. Every parameter needs validation and pgTAP tests, the UI won't use it, and adding it later is one small replacing migration.
- **D17 Docs timing (change 7).** The decided changes to v1 §4 (Offers tab for guests and customers), §7 (larger marker, pop-in then float, display limit of 8, Sponsored and Ad labels, admin activation, no payment) and the §16 before-launch items are written at PR 1's docs gate. The map-markers skill is updated in PR 3.

- **D18 Filters in one panel (PR 4 gate G2b, Archan's design change on 2026-11-21).** Four always-visible rows of chips were too cluttered. Offers shows one **Filters** button beside the area line instead.
  - The button reads "Filters", or "Filters (N)" where N counts the groups not at their default (Category All, Type All, About 15 km, Any); the default distance never counts. Spoken: "Filters" or "Filters, N applied", hint "Opens the filters".
  - When N > 0, a summary line in words ("Special offer, Restaurants, About 30 km") with **Clear filters**, which resets every group at once. The empty state also offers Clear filters when filters are on.
  - The button opens one bottom panel (`FiltersPanel`, `accessibilityViewIsModal`, no slide with Reduce Motion) with the same four radio groups. Chips change a draft only. **Show offers** applies it; **Clear all** resets the draft without applying; the x ("Close filters"), the back gesture or a tap outside discard it. Applying with no change just closes and sends no request. After applying, the result count is announced and focus returns to the Filters button.
  - The chosen filters are kept in memory while the tab stays mounted (across tab switches and sign-in or sign-out) and reset on the next launch. This explains the "About 5 km" seen on opening Offers in the Simulator run; the default on a fresh open is About 15 km (proven in `OffersTab.test.tsx`).

## Rules for implementation
- RLS on every new table, plus pgTAP proving outsiders are refused.
- Supabase calls only in `src/features/promotions/api.ts` and `src/features/map/api.ts`.
- Theme tokens only, no hardcoded colours, sizes or spacing (a size token for the larger marker is added to `tokens.ts`).
- Loading, empty, error (with Retry) and success on every screen.
- Every touchable has `accessibilityLabel` and `accessibilityRole`, with touch targets of 44 pt or more.
- Feature-specific rules:
  - The exact location is never sent; only `snapPoint()` output reaches the server (a jest test spies on the api).
  - "Sponsored" or "Ad" is always written text and part of the spoken label, never colour alone.
  - Reduce Motion means no movement at all: no pop-in and no float. No repeating grow-and-shrink, ever.
  - At most 8 animated markers. `tracksViewChanges` stays false for every other marker after its first draw.
  - Every new marker sets `stopPropagation` and uses stable callbacks and memo ("Lessons from spec 07").
  - All SQL and TS stay ASCII-only. Every non-ASCII code point is written as an escape and byte-checked after writing.
  - No payment code, provider, account or secret anywhere.
  - Migrations are append-only. Run `npm run db:types` after the migration.

## Out of scope
- In-app payment and any payment provider (a later spec if Archan wants it; Resolved Q10)
- Payment moves to spec 16b (promotion-payment, planned): in-app payment through Stripe after the headline is approved, replacing the manual invoice
- Ad inventory caps (§3); only the display limit exists
- Opening hours and "open now"
- A cuisine filter in Offers
- Push notifications about campaigns (Resolved Q16)
- An admin screen (Resolved Q17)
- A city picker beyond the launch city
- Impression or click analytics
- A promotion image separate from the cover photo
- Editing a headline after the request
- Pausing a campaign
- Everything listed in §3 (feeds, likes, delivery, live location and the rest)

## Definition of done
**PR 1 (backend)**
- [x] RLS is on for `promotions` and `promotion_settings`. `anon` and `authenticated` hold no privileges on them. **An outsider cannot** read, insert, update or delete any promotion or the settings, directly or through another owner's id.
- [x] **An outsider cannot** call `private.admin_review_promotion` or `private.promotion_is_active` (anon and authenticated both refused). The 05 allowlists list exactly the new public functions: the three seller ones for authenticated, `list_offers_near` for anon and authenticated.
- [x] `request_promotion`:
  - eligible owner gets a requested row with the price snapshot;
  - non-owner, unlisted, no map point or hidden business gets `not_eligible`;
  - no settings row gets `not_configured`;
  - a bad headline, category or start gets its error.
- [x] Change 1 checks:
  - (a) a request after an approved campaign has **ended** succeeds;
  - (b) a request while a **scheduled** or an **active** campaign exists gets `already_open`;
  - (c) a second request while one is **requested** gets `already_open`;
  - (d) approving two **overlapping** windows for one business is refused (`overlap`), while back-to-back windows are allowed;
  - (e) the race: a direct second `requested` insert for the same business violates `promotions_one_request` (proving the backstop, since pgTAP runs in one session; the row lock is checked by reading the code at review).
- [x] Every allowed and refused transition of `admin_review_promotion` and `cancel_my_promotion`, including:
  - cancelling an ended campaign (refused);
  - approving without a start or more than 1 hour in the past (refused);
  - another owner's id gives `not_found`.
- [x] `get_my_promotion` returns the derived state correctly for all six states, using fixed times relative to `now()`.
- [x] `list_offers_near`:
  - returns only active campaigns of listed, fresh businesses with a map point; requested, scheduled, ended, rejected, cancelled, unlisted and stale ones never appear;
  - each offer has exactly the documented keys, and a homemade offer has the shifted point, not the exact one;
  - a non-grid, out-of-range or bad-filter call is refused;
  - with 45 active offers, three pages of 20, 20 and 5 come back with no row missing or repeated;
  - the order is the same on two calls within the same UTC day;
  - the 4 km margin includes a place 8 km from the grid point at "About 5 km" and excludes one at 10 km;
  - the `offers` rate limit triggers like `pins`.
- [x] The map functions mark `promoted` correctly, and with 501+ pins a promoted pin is always inside the 500. The details functions return `sponsored`.
- [x] Seed: one campaign of each of active, scheduled, ended and requested (dates relative to reset time), plus the placeholder settings row. `npx supabase db reset` locally gives all four. Script unit-tested, and run for real by Archan in the PR 2 Simulator run.
- [x] `src/types/database.ts` regenerated. The map zod schemas accept the new keys. The full jest suite, lint and typecheck pass with no behaviour change. Only the D11 tests were edited.
- [x] `docs/runbooks/promotions-admin.md` exists with the exact SQL and no secrets. v1 §4, §7 and §16 are updated.

**PR 2 (seller)**
- [x] The Promote row is on Manage Business. The screen shows invite, requested, scheduled, active, ended, rejected and cancelled, each with its action. `not_configured` and `not_eligible` show plain messages. Loading, error and Retry work. Proven by the PR 2 Simulator run (rounds 1 to 7: every state, the admin SQL, no price, not eligible, error and Try again, the account switch, the largest text size, Reduce Motion) and by `PromoteScreen.test.tsx`, `ManagePromoteRow.test.tsx`, `promoteRoute.test.ts` and `a11y.test.tsx`.
- [x] Request and cancel go through the api only. The form uses zod: headline 1 to 60 characters after trimming, the hidden-character rule, a category is required. Proven by `api.test.ts`, `schema.test.ts`, `text.test.ts`, `hooks.test.tsx` and `PromoteForm.test.tsx`, and by the Simulator form checks and the five-requests-per-day limit.
- [ ] VoiceOver, TalkBack and real phones for the Promote screen: before launch (v1 section 16), not checked in PR 2.

**PR 3 (map)**
- [x] The spike gate was reported and Archan chose go or no-go (D14): go, judged by eye on the iOS Simulator (see D14).
- [x] A promoted pin draws a larger marker with the ring and an "Ad" text badge. It pops in once and then floats. With Reduce Motion on, no animation starts (a jest test spies on reanimated). Proven by `PromotedMarker.test.tsx` (look, pop-in and float values, Reduce Motion from both sources, live switch-off) and Archan's Simulator run (Reduce Motion live and after relaunch).
- [x] `promotedLayout`: never more than 8 large markers; none closer than the minimum spacing; extras drawn normal size with the ring and badge. Proven by `promotedLayout.test.ts`, `promotedFlag.test.tsx`, `PromotedMap.test.tsx` (8 large and the rest ringed; large ones kept out of clusters) and the Simulator run with the `--many` seed (at most 8 large, the same set on a slow pan, clusters).
- [x] The marker's spoken label ends with ", sponsored". Both sheets show "Sponsored" for a sponsored place and nothing otherwise. Proven by `PromotedMarker.test.tsx`, `promotedFlag.test.tsx`, `PromotedMap.test.tsx` (both tabs; details say ended; details unavailable), `PlacesListSponsored.test.tsx` and the Simulator run (sheet header, places list row, the runbook cancel turning the place back into a plain flag).
- [x] A marker press does not reach the map's onPress (the bubbling fake). Proven by `PromotedMarker.test.tsx` (stopPropagation) and `PromotedMap.test.tsx` (bubbling, and with stopPropagation ignored).
- [ ] VoiceOver and TalkBack on promoted markers, and the frame rate with 8 animated markers and 500 pins on a real iPhone and a real Android phone: before launch (v1 section 16), not checked in PR 3 (the Simulator run judged motion by eye only).

**PR 4 (Offers)**
- [x] The Offers tab is visible to guests and customers and hidden with seller mode on. Proven by `OffersTab.test.tsx` (order for guest, customer and seller; `/offers` goes to Requests in seller mode), the approved `TabsLayout.test.tsx` and `RequestsTab.test.tsx` edits, and Archan's Simulator run (guest, customer, seller mode).
- [x] `snapPoint` never returns the input position for off-grid input. `OffersScreen` sends only the snapped point (an api spy). Proven by `snapPoint.test.ts` (grid rounding, longitude wrap, latitude clamp, -0, 2000 seeded off-grid points) and `OffersPrivacy.test.tsx` (every call a POST with exactly two arguments, on the grid, no raw digits in the arguments, the query keys, storage writes or logs), plus `offersApi.test.ts`.
- [x] Offers shows loading, empty (message and Browse the map), error and Retry, success, paging, every filter, Change area, the location-denied fallback (last region, then the launch city), and "Sponsored" on every card. Proven by `OffersScreen.test.tsx`, `OffersLocation.test.tsx`, `FiltersPanel.test.tsx`, `OfferFilters.test.tsx`, `OfferCard.test.tsx`, `ChangeArea.test.tsx`, `useOffers.test.tsx` and the Simulator run (including paging 20 then 2 at About 30 km with the `--offers` seed).
- [x] Card to map opens the sheet. A no-longer-sponsored or hidden place shows the friendly message. Proven by `OfferToMap.test.tsx` (both tabs: camera, fresh details, stub pin, null and not-sponsored, late-fix guard, params cleared, repeat taps) and the Simulator run (a restaurant, a home cook, and the message after the runbook cancel).
- [x] Archan's Simulator run (the script below, with the Filters panel steps of G2b) passed on 2026-11-21: tab bars, the primer and the new permission text, filters, distances, paging, pull to refresh, Change area, location denied with the last map view, the empty Ottawa area, card to map, the friendly message, Reduce Motion, the largest text size with five tabs, customer and seller mode.
- [ ] VoiceOver and TalkBack on Offers (cards, the Filters button and panel, Change area), the Android location permission text, real GPS accuracy, and the frame rate on real phones: before launch (v1 section 16), not checked in PR 4 (iOS Simulator only).

## Test plan
- **jest** (written by hand with the code; helper tests in the same gate as the helper):
  - PR 1: the edited map schema and fixture tests.
  - PR 2: `format.ts`, the schemas, `PromoteScreen` states.
  - PR 3: `promotedLayout.ts`, `PromotedMarker` (Reduce Motion, label, badge), the sheet label.
  - PR 4: `snapPoint`, `distance.ts`, `OffersScreen`, `OfferCard`, `OfferFilters`, tab visibility, card to map.
- **pgTAP:** `supabase/tests/16-promotions.test.sql` (everything under PR 1), plus the D11 edits to 05, 07 and 08. Run with `npx supabase test db` locally after `npx supabase db reset` (local only).
- **Manual, iOS Simulator, run by Archan:**
  1. PR 3 spike (D14).
  2. Reset and seed. Open Restaurants: the active seeded place pops in and floats, the scheduled and ended ones are normal flags.
  3. Turn on Reduce Motion: the large marker is still.
  4. Zoom out: the promoted marker stays outside the clusters, at most 8 large.
  5. Tap it: "Sponsored" in the sheet.
  6. Offers as a guest and as a customer: cards, filters, About 5/15/30 km, Change area, empty area, paging (seed or SQL to 25+ offers).
  7. Tap a card: the map opens on it. Cancel that campaign through the runbook SQL and tap again: the friendly message appears.
  8. As the seller, walk every Promote state.
  9. VoiceOver labels on a marker, a card and a chip.

## Delivery: PRs and gates
I stop and commit at every gate (named files, a conventional message, no push) and wait for Archan's "approved".

| PR | Branch | Gates | Migration |
|---|---|---|---|
| 1 backend | `feature/promotions-backend` | **A** spec + CLAUDE.md row (this commit). **B** migration + new pgTAP + D11 pgTAP edits, `test db` green. **C** seed (four states) + `db:types` + zod keys + D11 jest edits, full jest/lint/typecheck green. **D** docs: runbook, v1 §4/§7/§16. Then `/code-review-feature`, then `/ship-feature` after CI is green. | **Yes** (one) |
| 2 seller | `feature/promotions-seller` | **E1** api, schemas, hooks, format + helper tests. **E2** screen, Manage row + screen tests. Review, ship. | No |
| 3 map | `feature/promotions-map` | **F0** spike, then stop for go/no-go. **F1** marker, layout + helper tests. **F2** map wiring, sheet label, screen tests, skill update. Review, ship. | No |
| 4 offers | `feature/promotions-offers` | **G1** `snapPoint`, distance, api, hook + helper tests. **G2** tab, screen, filters, Change area, card to map + tests. **G3** permission text in `app.config.ts`, then Archan rebuilds. **H** Archan's Simulator run, §16 notes. Review, ship. | No |

**Native rebuild:** once, in G3, because the iOS location text changes to "LikeToOrder uses your location while you have the app open, only to show places near you. Your exact location stays on your phone. We only receive a rough area." Archan runs `npx expo run:ios`. No native package is added.

**Before-launch items added to v1 §16 at gate D:**
1. **Paid-placement legal check** (not legal advice): the Competition Act deceptive-marketing rules and Competition Bureau guidance on paid placements, the Ontario Consumer Protection Act, and the rules of any later launch place.
2. **App-store policy check** on buying promotions (whether Apple or Google would require their in-app purchase if promotions are ever bought in the app).
3. **Set the real price** row in the live `promotion_settings` (the local seed has a placeholder).
4. **Confirm `btree_gist`** is enabled on the hosted project.
5. **Animated markers on a real Android phone and a real iPhone** (frame rate with 8 animated markers and 500 pins).
6. **VoiceOver and TalkBack** on Offers and promoted markers.
7. **Terms text** on refunds, claims in headlines and Sponsored disclosure (spec 18).

## Privacy and security position
- Sellers read and change only their own campaigns, and only through checked functions. Admin actions are database-owner SQL that the app can never call.
- Other people see only that a place is sponsored, its category, headline, cover photo and end date, plus public business data they can already see on the map.
- No card data, payment data or secrets exist anywhere in spec 16. No secrets are in the app.
- The exact position stays on the phone. The server receives a 0.05 degree grid point and keeps no copy. Home cooks appear only at their shifted point.

## Resolved questions
All resolved by Archan on 2026-11-20.

- **M1** Larger promoted marker (about 1.3 times). v1 §7 and the map-markers skill are updated.
- **M2** Pop-in once, then the v1 float. No repeating grow-and-shrink. No pop-out.
- **M3** "Sponsored" in the list and the sheet, the "Ad" badge on the marker, "sponsored" in spoken labels.
- **M4** No limit on sales. A display limit of 8 large animated markers.
- **M5** Pulled out of clusters only up to the display limit.
- **M6** Offers is visible to guests.
- **M7** No "open now" (no opening-hours data).
- **M8** No payment in spec 16. Manual invoice and admin activation.
- **Q1** The price is read from `promotion_settings`. The local seed has a placeholder (CAD 25.00, 2500 cents). Archan sets the real price before launch.
- **Q2** Pop in once, then the gentle float. Still with Reduce Motion.
- **Q3** 7 days, stored in settings.
- **Q4** At most 8 large animated markers, a minimum spacing, extras drawn normal size with the ring.
- **Q5** Any listed business with a map point that isn't hidden. One open campaign at a time.
- **Q6** Reuse the cover photo, no new upload. Archan reads the headline before approving.
- **Q7** Three fixed categories: New on the menu, Special offer, Featured.
- **Q8** Expiry by the server clock at read time, no job. Refunds outside the app. The clock keeps running while the place is hidden.
- **Q9** "Sponsored" plus the "Ad" badge. The legal and app-store checks are on the before-launch list.
- **Q10** Payment is a later spec.
- **Q11** Offers is visible to guests.
- **Q12** No cuisine filter in the UI and no server parameter yet (D16).
- **Q13** Distance bands, then a daily rotation seeded by the UTC date (D12).
- **Q14** The area fallback and a Change area button. The launch city centre is one constant.
- **Q15** The card opens the place on its map tab with the sheet open, or shows a friendly message (D15).
- **Q16** No push notifications.
- **Q17** No admin screen. One documented SQL call (the runbook).

## Mismatches
Differences between this spec and what was built, with their follow-ups.

- **Headline hidden-character rule (PR 2):** the PR 1 migration refuses U+200D in a headline (the joiner inside combined emoji such as the woman-cook or family emoji), while the food-log description rule allows U+200D and U+FE0F. PR 2 mirrors the server: the app refuses a joiner before sending, with "This emoji can't be used in a headline. Try a simpler one." **Follow-up:** align the headline rule with food-log (allow U+200D and U+FE0F; U+FE0F is already allowed today) through a small new migration in a later PR, then drop the app's joiner check with it.
- **"Cancelled on <date>" (PR 2):** `get_my_promotion` returns no `cancelled_at`, so the Promote screen shows "Cancelled." with no date (approved for PR 2). Showing the date needs a small replacing migration first.
- **Change area and Reduce Motion (PR 4):** at gate H the Change area panel still slid in with Reduce Motion on (only the Filters panel had the fix). **Fixed in the PR 4 review** (commit `8b8081e`): it now uses `useReduceMotion()` and appears without sliding, with a test in `ChangeArea.test.tsx`.
- **LocationPrompt wording prop (PR 4):** the plan named a "received sentence" prop; what was built is an optional `message` prop that replaces the whole explanation. The maps keep their wording byte for byte; Offers passes its own text ("...We only receive a rough area...").
- **Clear filters and the cache (PR 4):** returning to the default filters within a minute shows the default list already cached, with no new request (React Query `staleTime` of 60 s); an older list is fetched once. The tests prove the second case.
- **Filters and account changes (PR 4): decided: keep** (Archan, 2026-11-21). The filters survive sign-in and sign-out because the tab group stays mounted, and reset on the next launch. Filters are a browsing preference, and Offers is the same list for guests and customers.
- **Filters panel closing (PR 4): accepted.** The panel is mounted only while it is open, so every opening starts a fresh draft from the applied filters. As a result it has no slide-out animation when it closes.
- **The map after an offer card (PR 4): intended.** Once an Offers card has moved a map tab's camera (`cameraTaken`), that map does not recentre on a later "my position" fix, so the camera stays on the offer's place.
- **`--offers` seed (PR 4):** 25 campaigns near Oshawa were asked for, but only 23 demo businesses lie within About 30 km of Oshawa, so the seed has 22 (everything except `seed_rest_001`, kept for the Promote invitation; this mode also promotes `seed_rest_004`, `seed_rest_010` and `seed_cook_1`). About 30 km pages 20 then 2; About 15 km gives exactly 20. The unused `parseMany` was removed in the review; its assertions now check `parseSeedMode`.

## PR 4 review fixes (2026-11-21)
`/code-review-feature 16-promotions`: security found one Low and nothing higher. Quality gave "approved with suggestions". Archan approved the plan; every fix has its own commit and was proven by a deliberate break, red on its named test, then reverted and checked with `cmp`.

1. **Card to map, two cards in a row** (`useOfferTarget.ts`): each target is a run. A slow details answer from an earlier card no longer opens its sheet or shows the ended message. Success and failure use separate handlers. Tests in `OfferToMap.test.tsx`.
2. **Change area and Reduce Motion** (`ChangeArea.tsx`): no slide with Reduce Motion. Test in `ChangeArea.test.tsx`.
3. **Offers paging and refetch rules** (`useOffers.ts`):
   - The quiet restart on a refused cursor starts afresh for a new list and after a pull to refresh.
   - A failed list is not sent again on app focus, reconnect or remount (`unlessFailed`, the security Low).
   - Load more waits while any read runs.
   - Tests in `useOffers.test.tsx`.
4. **`promotedLayout.test.ts`** (a PR 3 test file, changed with Archan's approval): the wall-clock assertion (20 runs under 500 ms, which failed once at 573 ms under a full parallel run) is replaced by structural checks: 500 and 50 places give the same cap of 8, only real ids, and the same set on every call.
5. **`resetModuleMocks` and `PromotedMap.test.tsx`** (the shared food-log fixture and a PR 3 test file, changed with Archan's approval):
   - `'../api'` resolved from the fixture file to the food-log api, so `PromotedMap.test.tsx` never reset the map api mocks. It now passes `'@/features/map/api'`.
   - The helper now throws when a path holds no mock functions, and resets the mocks one level down in an exported object.
   - The throw found one more case: in 8 promotions test files (`OffersLocation`, `OffersPrivacy`, `OffersScreen`, `useOffers`, `PromoteForm`, `PromoteScreen`, `a11y`, `hooks`), `'@/lib/supabase'` (a mocked `{ supabase: { rpc, from } }` client) was never reset. The helper fix covers them with no change to those tests, and the full suite stays green with the real resets.
   - A wrong path to a module that exports functions still resolves to jest's automatic mock and is not caught. A stricter check (refusing relative paths) would touch 17 food-log test files and is left as a follow-up.
   - New test `resetModuleMocks.test.ts`.
6. **`locationPromise.test.ts`** (an older test, approved): the top comment and the first test title now say "a rough area".
7. **Seed** (`promotionsData.ts`): the unused `parseMany` and `KNOWN_ARGS` were removed. Their three assertions now check `parseSeedMode` in `promotionsMany.test.ts` (approved).
8. **Offers screen polish** (`OffersScreen.tsx`):
   - Announcements are numbered requests, announced even when the new list is already loaded with the same count, and never later on an unrelated update.
   - The list separator is its own component.
   - The area line says "Finding offers near you" while the screen works out where to look.
   - Tests in `OffersScreen.test.tsx`.

**Older test files changed in PR 4, all with Archan's approval:**
- `TabsLayout.test.tsx` and `RequestsTab.test.tsx` (G2).
- `scripts/seed/__tests__/promotionsMany.test.ts` (seed, review item 7).
- `locationPromise.test.ts` (G3, review item 6).
- `promotedLayout.test.ts` and `PromotedMap.test.tsx` (PR 3 files, review items 4 and 5).
- The shared `src/features/food-log/__fixtures__/foodLog.ts` helper (review item 5).
