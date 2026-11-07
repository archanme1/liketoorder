# Spec 09: Pickup Requests

**Branch:** two PRs from this one spec (same pattern as specs 06 to 08)
- PR 1 (backend only: migration, functions, cron, pgTAP, types): `feature/pickup-requests` (this branch, renamed to `feature/pickup-requests-backend` before its first push)
- PR 2 (the app: form, picker, My requests, detail, sheet buttons, seed data, jest tests): `feature/pickup-requests-app`, created from `main` after PR 1 is merged.
**Product spec:** `docs/product/v1.md` §3 (out of scope), §4 (requests need sign-in), §5 (Homemade specifics), §8 (Pickup requests), §12 (notifications, for what is NOT built here), §14 row 09, §16 (Function privileges, Account deletion)
**Plan mode:** required — adds a table, RLS, status-transition and read functions, a cron job and a new route group; touches well over ~5 files; changes the two map sheets and a pgTAP function allowlist.
**Status:** 🚧 In progress

## Overview
After this ships, a signed-in customer can open a restaurant or homemade sheet, tap **Request pickup**, choose items from the menu (or write a free-text order), choose a pickup time, and submit. They then see the request in a **My requests** list with its status. A request is always shown as "Waiting for the seller" until the seller answers; it is **never shown as confirmed while pending**. The customer can cancel while it is pending. If the seller does not answer within the window, the request **expires on its own**. Submitting twice (double tap, retry after a bad connection) creates one request. When a request is `accepted`, a homemade customer can read the cook's **exact address**; nobody else can, at any other status.

The seller side (inbox, accept, decline, completed, no-show) is spec 10, and push notifications are spec 12. This spec builds the table and everything the customer does, plus the one server rule specs 10 and 12 rely on: status only changes through functions.

**Why now:** both maps and their menus exist (06 to 08). Request flows need them, and spec 10 needs this table.

## Depends on
- 02 auth-and-profiles ✅ (signed-in customer, profile name)
- 05 seller-onboarding ✅ (`businesses`, `business_locations`, exact address stays private)
- 06 menu-management ✅ (`menu_items`, `currency_code`, `formatPrice`)
- 07 restaurant-map ✅ and 08 homemade-map ✅ (sheets, 30-day freshness rules, rate-limit pattern, cron pattern)

## Context to load
- `CLAUDE.md`
- `docs/product/v1.md` §3, §5, §8, §12, §16
- This spec
- `.claude/skills/supabase-patterns/SKILL.md` ("Status transitions", "Server-owned values", "Homemade approximate location"), `.claude/skills/liketoorder-ui/SKILL.md` (request status chips), `.claude/skills/map-markers/SKILL.md` (sheet hand-off only)
- `supabase/migrations/20261105040319_restaurant_map.sql` (`restaurant_is_fresh`, `consume_map_quota`, cron pattern), `supabase/migrations/20261107041120_homemade_map.sql` (`homemade_is_fresh`), `supabase/migrations/20261104035153_menu_management.sql` (`menu_items`, `private.owns_business`)
- `supabase/tests/05-seller-onboarding.test.sql` (function allowlists), `supabase/tests/08-homemade-map.test.sql` (privilege-check style)
- `src/features/map/components/{SheetDetails,HomemadeSheetDetails,RestaurantSheet}.tsx`, `src/features/map/api.ts`
- `src/features/menu/price.ts`, `src/features/menu/hooks/useCurrencies.ts`
- `src/features/auth/hooks/useSession.ts`, `src/features/auth/routeAccess.ts`, `app/(tabs)/profile.tsx`
- `src/components/ui/index.ts`

## User stories
- As a customer, I can request pickup from a restaurant or a homemade cook by choosing menu items, or by writing my order in my own words.
- As a customer, I choose the pickup time and see the request is waiting for the seller, never as confirmed.
- As a customer, I can tap Submit twice, or retry after a bad connection, and still send only one request.
- As a customer, I can see all my requests and their statuses, and cancel one that is still pending.
- As a customer, I see a request that nobody answered turn into "Expired", without opening anything special.
- As a customer with an accepted homemade request, I can see the cook's exact address and a note on food safety.
- As a guest, tapping Request pickup asks me to sign in, then takes me straight to the request form for that business.
- As a seller, nobody can send a request to my business unless it is live, and I cannot request from myself.
- As a screen-reader user, every status is spoken as a word, and every action is reachable.

## Screens & routes
- `src/features/map/components/SheetDetails.tsx` and `HomemadeSheetDetails.tsx` (change) — a **Request pickup** button in the sheet body. Public sheet, signed-in action.
  - Guest: opens sign-in, then returns straight to the request form for that business (Decision 6).
  - Own business: button hidden (a seller cannot request from themselves).
  - Business not currently accepting (not fresh/listed): the sheet is already "not available", so no button.
- `app/requests/new.tsx` — **New pickup request** form (params: `businessId`). Signed-in. Menu items with quantity steppers (available items only), free-text order box, pickup time picker, optional note, order summary, Submit. Opens as a stack screen over the tabs.
- `app/requests/index.tsx` — **My requests** list (newest first), status chip per row. Signed-in. Reached from a new row on the Profile tab.
- `app/requests/[id].tsx` — **Request detail**: status, items/order text, pickup time, seller name, cancel (pending only), and for accepted homemade the exact address. Signed-in, owner of the request only.
- `app/(tabs)/profile.tsx` (change) — a "My requests" row (`NavRow`).
- Routes go through `routeAccess.ts` as signed-in and profile-complete routes.

States (4 states on every screen):
- **Loading:** skeletons for the list and detail; the form shows a loading menu.
- **Empty:** My requests: "No requests yet. Find a place on the map and request pickup." Form with no available items: free-text only, with the note "No menu items available. Describe what you'd like."
- **Error (with retry):** list/detail load errors with Retry; submit errors keep the form filled and say what happened (see Messages).
- **Success:** list, detail, and after submit a confirmation screen state "Request sent. Waiting for <seller>." (never "confirmed").

## Database changes
One migration, `npx supabase migration new pickup_requests`. Never edit an existing migration. Sketch only; the implementation checks names against the current migrations.

```sql
create table public.pickup_requests (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid not null references public.businesses(id) on delete cascade,
  customer_id      uuid not null references public.profiles(id) on delete cascade,
  status           text not null default 'pending'
                   check (status in ('pending','accepted','declined','expired','cancelled','completed','no_show')),
  pickup_at        timestamptz not null,
  -- Snapshot of what was ordered, so later menu edits never rewrite history:
  -- [{ "item_id", "name", "unit_price_minor", "quantity" }]. Null when free-text only.
  items            jsonb check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) between 1 and 30),
  order_text       text check (char_length(order_text) between 1 and 500 and order_text = btrim(order_text)),
  note             text check (char_length(note) between 1 and 300 and note = btrim(note)),
  currency_code    text references public.currencies(code),   -- copied from the business at submit
  idempotency_key  uuid not null,
  expires_at       timestamptz not null,
  responded_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint pickup_requests_has_order check (items is not null or order_text is not null),
  constraint pickup_requests_idem unique (customer_id, idempotency_key)
);
create index pickup_requests_customer_idx on public.pickup_requests (customer_id, created_at desc);
create index pickup_requests_business_idx on public.pickup_requests (business_id, status, created_at desc);
create index pickup_requests_pending_expiry_idx on public.pickup_requests (expires_at) where status = 'pending';
```

Spec 11 reuses the same status model for table requests; whether that is a second table or a `kind` column on this one is decided in spec 11. `supabase-patterns` sketches one `requests` table; this spec's table is pickup-specific and spec 11 decides whether to merge them (Decision 8).

### RLS and grants
- `enable row level security`; `revoke all on public.pickup_requests from anon, authenticated`.
- **No table grants at all for clients, and no policies** (RLS on with no policy denies everything). Customers read their requests only through the read functions below, which filter on `auth.uid()` and return the server's clock (Decision 9). pgTAP proves a customer, an outsider and `anon` cannot `select` the table directly.
- Seller read access (their inbox) is added by spec 10 with its own function. Until then a seller cannot read requests at all.
- Add the table to the generic anon-privileges allowlist test only with its own checks (see pgTAP).

### Functions
| Function | Who may execute | What it does |
|---|---|---|
| `submit_pickup_request(p_business_id uuid, p_idempotency_key uuid, p_pickup_at timestamptz, p_items jsonb, p_order_text text, p_note text) returns jsonb` | `authenticated` | See below. |
| `list_my_pickup_requests(p_before timestamptz default null) returns jsonb` | `authenticated` | `{ "server_now", "requests": [...] }`: the caller's requests, newest first, `created_at < p_before` when given, a page of 50 (Decision 13). |
| `get_my_pickup_request(p_request_id uuid) returns jsonb` | `authenticated` | `{ "server_now", "request" }` for one of the caller's requests, else `request: null` (identical for unknown and someone else's). |
| `cancel_pickup_request(p_request_id uuid) returns jsonb` | `authenticated` | Locks the row (`for update`), checks `customer_id = auth.uid()` (else `not_found`), checks `status = 'pending'` and not past `expires_at` (else `invalid_transition`), sets `cancelled`, `responded_at` is left null. Returns the row. |
| `get_my_pickup_address(p_request_id uuid) returns jsonb` | `authenticated` | Returns `{ formatted_address }` of the business only when the caller is the request's customer **and** `status in ('accepted','completed')`, the business is `homemade`, and the business is still listed. Otherwise returns `null` (identical for every cause). Restaurants never use it (their address is public). **Not** gated by the 30-day map guard: an accepted customer must still find the cook (Decision 5). Only until 24 hours after `pickup_at` (`pickup_at > now() - interval '24 hours'`), so an old completed request stops revealing a home address (PR 1 review). It returns the cook's **current** `formatted_address`; spec 10's accept function must snapshot the address onto the request and this function must then return the snapshot. |
| `expire_pickup_requests() ` (private) | cron only | `update … set status='expired', responded_at=null where status='pending' and expires_at <= now()`. |
| `private.pickup_request_expiry(p_pickup_at, p_created_at)` | none directly | `least(created_at + interval '30 minutes', pickup_at)`. |

`submit_pickup_request` rules, all in SQL (the app only mirrors them for fast feedback):
1. Caller signed in and has a completed profile, else `not_signed_in`.
2. **Idempotency:** if a row exists for `(auth.uid(), p_idempotency_key)`, return it unchanged (even if the other arguments differ), before any other check except sign-in.
3. Business exists, `is_listed`, and is fresh (`private.restaurant_is_fresh` or `private.homemade_is_fresh` by `type`), else `business_unavailable` (same error for every cause).
4. Caller does not own the business (`owner_id <> auth.uid()`), else `own_business`.
5. `p_pickup_at`: at least 15 minutes from now and at most 7 days away (Decision 1), else `invalid_pickup_time`.
6. Order: either `p_items` (1 to 30 lines, each item belongs to this business, **is currently available**, `quantity` 1 to 20; name and price are **read from `menu_items` in SQL**, never trusted from the client) or `p_order_text`, or both (items plus extra words). Neither → `empty_order`. Item not found/unavailable → `item_unavailable`. The same item twice (item ids compared as uuids, so upper and lower case count as the same), a non-integer or out-of-range quantity, more than 30 lines or a malformed line → `invalid_items`. Text over 500 / 300 characters or containing a hidden character (below) → `invalid_text`. `p_items`, `p_order_text` and `p_note` default to null.
7. `currency_code` copied from the business. Total is derived, not stored.
8. **Limits:** at most 5 `pending` requests per customer in total, and at most 1 `pending` per customer per business (Decision 3), else `too_many_pending`. A per-customer rate limit of 10 submits per hour, else `rate_limited`. **Built as a row count, not a counter table:** the customer's own `pickup_requests` rows created in the last hour are counted under the per-customer advisory lock (a true sliding window, no cleanup job). Cancelled and expired rows still count; replays never reach the check. Because it counts rows, a cascade delete (a seller deleting their business) removes that request's row and frees one slot. A pending request past its `expires_at` does not count towards the 5 / 1 pending limits even before the job has swept it.
9. `expires_at = private.pickup_request_expiry(now(), p_pickup_at)`; `created_at` and status are server-set. Insert; on a unique conflict from a concurrent duplicate, `select` and return the existing row.
10. Raises use stable codes the app maps to messages. No error text reveals why a business is unavailable.

Return shape of every request object: `{ id, business_id, business_name, business_type, status, display_status, pickup_at, items, order_text, note, currency_code, expires_at, created_at }`. `display_status` is `status`, except a `pending` row with `expires_at <= now()` is `expired`, computed in SQL. `business_name` is read inside the function from `businesses` (the table's public columns), not stored.

### Allowed transitions (this spec)
`pending → cancelled` (customer, `cancel_pickup_request`), `pending → expired` (cron). Spec 10 adds `pending → accepted | declined` and `accepted → completed | no_show` through `respond_to_request` and `mark_request_outcome`. **A direct `update` of `status` is impossible for clients** (no grant, no policy), and a pgTAP test proves it.

### Auto-expire
- A `pg_cron` job `pickup-requests-expire` runs **every minute** and calls `private.expire_pickup_requests()`.
- **Check-on-read as well, decided by the server's clock, not the phone's** (Decision 9). The read functions compute `display_status` in SQL, so a request just past `expires_at` is already `expired` for the customer before the cron has run. `cancel_pickup_request` and the spec 10 respond function both refuse a request past `expires_at`. The cron sets the stored value.
- Also revoke execute on the private function from everyone, including `service_role`.

### Function privileges (CLAUDE.md "Function privileges", §16)
- Every function: `revoke execute … from public, anon, authenticated`, then grant exactly as in the table.
- `supabase/tests/05-seller-onboarding.test.sql` allowlists are extended: `authenticated` may additionally execute exactly `submit_pickup_request`, `cancel_pickup_request`, `list_my_pickup_requests`, `get_my_pickup_request`, `get_my_pickup_address`; `anon` list is unchanged; the `private` list gains `expire_pickup_requests`, `pickup_request_expiry` (and the rate-limit helper if one is added).

## Storage
None.

## Edge Functions
None. (Push for these events is spec 12, triggered from the status change; this spec does not send any.)

## Components & hooks
All in `src/features/requests/` unless noted.
- `api.ts` — all Supabase calls: `submitPickupRequest`, `cancelPickupRequest`, `listMyPickupRequests(before?)` → `list_my_pickup_requests`, `getPickupRequest` → `get_my_pickup_request`, `getMyPickupAddress`. Maps database error codes to a `RequestAppError`.
- `schema.ts` — zod: form schema (`orderText` ≤ 500, `note` ≤ 300, quantities 1 to 20, pickup time rules mirrored), and strict response schemas for the request and the address.
- `messages.ts` — error and status wording in one place.
- `status.ts` — labels and wording for each status, and `clockOffset(serverNow, deviceNow)` used only to time the refetch at `expires_at` (Decision 9). The app never decides a status itself; it shows `display_status` from the server.
- `hooks/useSubmitPickupRequest.ts` — mutation. Generates the idempotency key **once per form session** (`useRef`, `randomUUID()` from `expo-crypto`, already installed), re-uses it on every retry, resets it after a success or when the user edits the order.
- `hooks/useMyRequests.ts`, `hooks/usePickupRequest.ts`, `hooks/useCancelPickupRequest.ts`, `hooks/usePickupAddress.ts` — react-query (keys `['requests','mine']`, `['requests','detail',id]`, `['requests','address',id]`). Mutations invalidate the list and detail. Refetch on app focus, at the server-corrected `expires_at` of a visible pending request, and every 30 s while one is visible.
- `components/PickupRequestForm.tsx` — items with steppers, free-text, time picker, note, summary and total (`formatPrice`), Submit.
- `components/PickupTimePicker.tsx` — the platform's calendar and time picker (`@react-native-community/datetimepicker`, see New dependencies): iOS one inline `mode="datetime"` control, 15-minute step; Android the date dialog then the time dialog. Window: earliest = now + 15 minutes (rounded up), latest = now + 7 days; results are snapped to a quarter hour and clamped in JS (`time.ts`: `snapToQuarter`, `clampToWindow`, `combineDateAndTime`). Times are shown in the phone's time zone and sent as UTC.
- `components/RequestRow.tsx`, `components/RequestDetail.tsx`, `components/MyRequestsScreen.tsx`.
- `components/RequestAddressCard.tsx` — accepted homemade only: exact address and "Food safety and allergies" note (reuses `homemadeText.ts`).
- `src/components/ui/StatusChip.tsx` — new shared chip (text + icon + colour from tokens; the word is always present, never colour alone). Used here and by spec 10.
- `src/features/map/components/RequestPickupButton.tsx` — the sheet entry point (session check, own-business hide, sign-in redirect with return).

## Files to create
**PR 1**
- `supabase/migrations/<timestamp>_pickup_requests.sql`
- `supabase/tests/09-pickup-requests.test.sql`

**PR 2**
- `app/requests/{new,index,[id]}.tsx` and `app/requests/_layout.tsx` if needed
- `src/features/requests/{api,schema,messages,status}.ts`
- `src/features/requests/hooks/{useSubmitPickupRequest,useMyRequests,usePickupRequest,useCancelPickupRequest,usePickupAddress}.ts`
- `src/features/requests/components/{PickupRequestForm,PickupTimePicker,RequestRow,RequestDetail,MyRequestsScreen,RequestAddressCard}.tsx`
- `src/features/requests/__tests__/*`
- `src/components/ui/StatusChip.tsx` (+ test)
- `src/features/map/components/RequestPickupButton.tsx`
- `scripts/seed/requests.ts` (+ `requestsData.ts`, pure and unit-tested) — demo requests at each status for `seed-customer@example.com`: one pending row that expires about 2 minutes after the seed runs, a fresh pending row for trying Cancel, an ACCEPTED homemade request with the pickup 30 minutes from now (address visible), a completed homemade one inside the 24-hour window, and a declined one. Local-only, key from `SEED_SERVICE_ROLE_KEY` (never printed), touches only `seed-*` accounts; re-run for fresh times

## Files to change
**PR 1**
- `supabase/tests/05-seller-onboarding.test.sql` — extend the function allowlists
- `src/types/database.ts` — regenerate with `npm run db:types`
- `.claude/skills/supabase-patterns/SKILL.md` — note `pickup_requests` and its functions (replace the generic `requests` line with the real one)
- `docs/product/v1.md` §16 — close "exact address after accepted request" for the read side; leave write side open for spec 10

**PR 2**
- `src/features/map/components/{SheetDetails,HomemadeSheetDetails}.tsx` — add the button; update the comment saying 09 is pending
- `app/(tabs)/profile.tsx` and its component — "My requests" row
- `src/features/auth/routeAccess.ts` — **test only, no code change** (decided in the PR 2 plan): `/requests/*` sits in the root layout's existing `access.app` guard, so `routeAccess.test.ts` gets cases pinning who gets through; the guest return is `src/features/auth/returnTo.ts` + `app/_layout.tsx`
- `src/components/ui/index.ts` — export `StatusChip`
- `.claude/skills/liketoorder-ui/SKILL.md` — only if the chip rules need a correction
- `CLAUDE.md` — status table

## New dependencies
- **`@react-native-community/datetimepicker` `9.2.1`** (the version in Expo SDK 58's `bundledNativeModules.json`; added by Archan with `npx expo install`; approved by Archan in the gate E plan, replacing the original day-button-and-slot-grid picker). A native module: needs one rebuild (`npx expo run:ios`, run by Archan) and an Android rebuild. `app.config.ts` lists the package's config plugin, `'@react-native-community/datetimepicker'`, with no options.
- `expo-crypto` is already in `package.json` (`~58.0.7`), so the idempotency key uses its `randomUUID()`. If it were ever missing, stop and ask Archan before adding anything.

## Rules for implementation
- RLS on every new table + pgTAP test
- Supabase calls only in `src/features/requests/api.ts` (and the existing `map/api.ts`)
- Theme tokens only, no hardcoded colors/sizes
- Loading / empty / error / success states on every screen
- Accessibility labels and roles on every touchable; touch targets ≥ 44 pt; status always as a word
Feature-specific:
- **Never show a pending request as confirmed.** Copy for `pending` says "Waiting for <seller> to respond" and nothing like "booked", "confirmed" or "on its way". A pending request past `expires_at` shows as Expired, as decided by the server (`display_status`).
- **Server decides.** Item names, prices, availability, expiry, status, `display_status` and timestamps come from SQL. The app never sends a price, a status or a created time.
- **Status only via functions.** No client update path; no `service_role` in the app.
- **Read "Known pitfalls" below before writing code, and re-read it before the manual run.**
- **Idempotency:** one key per form session, reused on retry; a changed order gets a new key; a double tap while submitting is also blocked in the UI (button disabled while the mutation runs).
- **Exact address:** only `get_my_pickup_address`, only for the requesting customer at `accepted` or `completed`. Never in a list, never cached after the request leaves those statuses (the query is disabled and its cache removed for other statuses), never logged.
- Never log request contents, notes or addresses.
- Free text (`order_text`, `note`): hidden characters are stripped in the app and refused by the database (both the function, as `invalid_text`, and a table-level check): ASCII controls except newline, DEL, C1 controls (U+0080 to U+009F), zero-width characters (U+200B to U+200D, U+FEFF) and bidi overrides/isolates (U+202A to U+202E, U+2066 to U+2069). Length limits only; no profanity filter (Decision 12). Newlines are allowed. Note: this also refuses U+200D, so emoji built with a zero-width joiner (family or profession emoji) are refused.
- No payment UI, no totals presented as a charge: the summary says "Estimated total. Pay the seller directly." (placeholder wording; spec 18 owns the terms).
- **PR 2 notes from the PR 1 plan (Archan):**
  - The order summary says "Total excludes items without a price" whenever any ordered item has no price (`menu_items.price_minor` is nullable, so the snapshot `unit_price_minor` can be null). A business with no currency (`currency_code` null) shows no currency symbol.
  - `invalid_pickup_time` is shown as "Pick a later time": a slot at the 15-minute edge can become invalid while the person types.
  - The form must merge duplicate menu lines into one line with a summed quantity before submitting (the server refuses the same item twice as `invalid_items`).
  - Mirror the extended hidden-character strip (list above) in the app's free-text step; do not reuse a control-character-only strip.
  - PR 1 error codes the app maps: `not_signed_in`, `profile_incomplete`, `invalid_input`, `business_unavailable`, `own_business`, `invalid_pickup_time`, `invalid_items`, `invalid_text`, `item_unavailable`, `empty_order`, `too_many_pending`, `rate_limited`, `invalid_transition`, `not_found`.
- Stage gates with a commit after each (stop and commit after each gate; no edits before "approved").
  - PR 1: **A** migration + pgTAP + types → review.
  - PR 2: **B** api, schema, status, hooks + tests → **C** form, picker, StatusChip, sheet button → **D** My requests, detail, address card, profile row, seed data + tests → manual run.

## Known pitfalls (checklist)
Each item says how it applies here. The reviewer ticks every line. Sources: `.claude/skills/map-markers/SKILL.md` "Lessons from spec 07" (sheet, taps, large text, setup and tests) and the specs 07 and 08 pitfall lists.

- [ ] **Keyboard covering fields.** The form uses `KeyboardAvoidingView` (iOS `padding`) around a `ScrollView` with `keyboardShouldPersistTaps="handled"`; focusing the order or note box scrolls it into view above the keyboard and above the Submit button. Checked on the iOS Simulator at the largest text size. *(manual run; jest asserts the props.)*
- [ ] **Double tap.** Submit is disabled and shows progress while the mutation runs, and the same idempotency key is reused on retry; Cancel is also disabled while running. Stepper and time taps are cheap and idempotent. *(jest + pgTAP.)*
- [ ] **Large text clipping.** Titles capped like the sheet (`maxFontSizeMultiplier` 1.6); body text, chips, rows, steppers and the summary keep scaling and wrap; no fixed heights on rows, chips or buttons (min height only, ≥ 44 pt). Check at the largest iOS "Larger Accessibility Sizes". *(manual run.)*
- [ ] **Stale lists after cancel or expire.** Cancel success invalidates `['requests','mine']` and the detail key and refetches; submit success does the same; the list refetches on focus, at the server-corrected `expires_at` and every 30 s while a pending row is visible; the address query is removed from the cache when the status is not accepted/completed. *(jest.)*
- [ ] **Times shown from UTC.** `pickup_at`, `created_at` and `expires_at` arrive as UTC; they are shown in the phone's time zone (`Intl.DateTimeFormat`, device locale), and the picker builds its quarter-hour slots in the phone's time zone then converts to UTC (`toISOString`). Tests run with a non-UTC `TZ` (e.g. `Pacific/Auckland`, which crosses a date) so a UTC-only implementation fails. Day-boundary and DST edges are covered. *(jest.)*
- [ ] **Wrong phone clock.** Decision 9: status text always comes from the server's `display_status`; the clock offset only schedules a refetch. *(jest with a skewed clock + deliberate break 1.)*
- [ ] **Test QueryClient cleanup.** Every test file creates its own `QueryClient` with `retry: false` and `gcTime: 0`, and `afterEach` clears it (`queryClient.clear()`) and calls RNTL `cleanup`, so no timers or cached requests leak into the next test; fake timers are restored in `afterEach`. All `render`, `userEvent`, `renderHook` and `act` calls are awaited (RNTL v14). *(jest.)*
- [ ] **Leftover seed data breaks pgTAP counts.** The local demo seed (`scripts/seed/requests.ts`, restaurants, homemade) adds rows; pgTAP tests that count rows must run after `npx supabase db reset`. The pgTAP file creates its own users and businesses with fixed ids, counts only its own rows, and runs in a transaction that rolls back. *(pgTAP; CI always starts clean.)*
- [ ] **Hit targets and labels.** Every touchable (steppers, the pickup-time button, Submit, Cancel, Retry, list rows, the sheet button, the profile row; the native calendar and time controls carry their own accessibility) has `accessibilityLabel` and `accessibilityRole`; targets ≥ 44 pt; the chosen pickup time is shown as text ("Pickup: …"), not by colour alone; stepper labels say "Increase <item> quantity, now n". *(jest + VoiceOver run.)*
- [ ] **Sheet to form hand-off.** Opening the form from a map sheet closes nothing on the map behind it, and back returns to the same map and sheet state. The button is inside the sheet's scroll content (`BottomSheetScrollView`), reachable at half and full snap (`scrollBottomSpace`). *(manual run, spec 07 sheet lessons.)*
- [ ] **Guest return.** Sign-in from the button passes the destination (`/requests/new?businessId=…`) and lands on the form after sign-in, and after a profile-complete check; a business that became unavailable meanwhile shows the calm "not available" state. *(jest + manual.)*
- [ ] **Faithful fakes.** Tests that need the session, router and `expo-crypto` use the existing jest.setup fakes; no new ad-hoc fake in a test file. *(review.)*

## Also built in PR 2 (not in the lists above)
- `src/features/requests/{time,summary}.ts`, `hooks/{keys,useRefetchAtExpiry,useRequestMenu}.ts`, `components/{NewRequestScreen,QuantityStepper,RequestStatusChip,RequestDetailScreen}.tsx`, `__fixtures__/`; `src/features/auth/returnTo.ts` (+ test); `app/requests/_layout.tsx`.
- `src/components/ui/StatusChip.tsx` is generic (word, icon, tone); `RequestStatusChip` maps the server's `display_status` onto it.
- The form finds the business through the map sheet's public details (restaurant first, then homemade), so the route stays `?businessId=…`.
- `jest.setup.ts` gains one `expo-crypto` fake (counter-based uuids); the sellers tests still mock it per file.
- Time zone: picker and formatters take an explicit `timeZone` (default: the phone's); tests pass `Pacific/Auckland`. No jest config change.

## Gate E decisions (after the PR 2 simulator run)
- **Fixed Send bar:** Send request and the estimated total sit in a bar under the title, outside the scrolling form; the title and Back step aside while the keyboard is up. Errors show in the bar.
- **My requests is an infinite list** (50 per page, `useInfiniteQuery`) on the existing `p_before` cursor. No keyset cursor now (Archan): rows only tie through bulk or admin inserts.
- **Seed:** `scripts/seed/requests.ts --extra 120` adds older requests for testing pagination.
- **Native calendar and time picker (gate E3):** replaces the day buttons and slot grid; see Decision 7 (amended) and New dependencies.

## Notes for specs 10 and 12 (from the PR 1 review)
- **Spec 10 (seller inbox) must be built with a `(created_at, id)` keyset cursor from day one** (server limit 50, text cursor sent back untouched; see the lists rule in `supabase-patterns`). Many customers can create rows at the same instant, so created_at alone would skip rows at a page boundary. `list_my_pickup_requests` keeps `created_at` alone: a single customer's rows cannot tie through the app (each submit is its own transaction), only through bulk or admin inserts; give it the same cursor when spec 10 touches this function if wanted.
- **Spec 10:** the accept function must snapshot the address (and place) onto the request, and `get_my_pickup_address` must return the snapshot (see Decision 5).
- **Spec 10:** the four request-object builders (`submit`, `list`, `get`, `cancel`) are written out in full today, and a pgTAP test compares their keys and values. Spec 10 adds seller reads of the same object: move it into one private helper (`private.pickup_request_json`, added to the private-function allowlist in `05-seller-onboarding.test.sql`) then.
- **Specs 10 and 12:** one customer can send up to 10 requests an hour to the same cook (the 1-pending limit stops counting once a request is cancelled, and the hourly limit is per customer, not per customer and business). Once spec 12 sends a push per new request this is a harassment risk. Consider a per-business hourly cap (for example 3 submits to one business in 24 hours, counted from the same rows under the same lock) or a cool-down / merged notifications for requests cancelled within seconds.

## Out of scope
- Seller inbox, accept/decline, completed/no-show buttons (spec 10); the `respond_to_request` function (spec 10)
- Table requests and "I've arrived" (spec 11)
- Push notifications and Expo push tokens (spec 12). Until then the customer sees status changes only when they open the app.
- Reports (17), legal text (18), promotions (16)
- In-app payments and delivery (v1 §3); live location tracking
- Editing a submitted request (cancel and re-send instead)
- Reorder, favourites, saved addresses, chat between customer and seller
- Seller-side visibility of customer no-shows (v1 §15 open question 2)

## Definition of done
- [ ] A signed-in customer can submit a pickup request from a restaurant sheet and a homemade sheet with menu items, with free text only, and with both; it appears in My requests as "Waiting for the seller".
- [ ] A pending request is never shown with confirmed wording anywhere (list, detail, success state), including the screen-reader labels.
- [ ] Submitting the same `idempotency_key` twice creates exactly one row and returns the same request, including when the replay would now fail a check (pending limit, pickup time, empty order, rate limit) (pgTAP + jest). The concurrent path (two sessions, same key, and two sessions with different keys for one business) is proven by the manual two-session psql run recorded in the PR description, not by pgTAP; pgTAP only asserts that `submit_pickup_request` takes the per-customer advisory lock first.
- [ ] Tapping Submit twice quickly sends one request (jest).
- [ ] The server reads item names and prices itself: a tampered price or name in `p_items` is ignored (pgTAP).
- [ ] An unavailable item, an item of another business, quantity 0 or 21, more than 30 lines, an empty order, a pickup time less than 15 minutes ahead or more than 7 days ahead are each rejected with a stable error code (pgTAP).
- [ ] A request to an unlisted, stale (30-day guard), unknown or own business is rejected, and the error does not reveal which of the unlisted, stale or unknown causes it was (pgTAP). `own_business` has its own code: only the owner can reach it.
- [ ] A 6th pending request, a 2nd pending request for the same business, and the 11th submit within an hour are refused (pgTAP).
- [ ] `expires_at` is the earlier of created + 30 minutes and the pickup time; the cron function expires exactly the due pending rows, leaves other statuses alone, and the job is registered (`cron.job`) (pgTAP).
- [ ] The customer can cancel a pending request; cancelling an expired, cancelled or accepted one fails with `invalid_transition`; cancelling someone else's request fails as `not_found` (pgTAP).
- [ ] **An outsider cannot read another customer's request** by direct table select, by id, or through any function, and `anon` cannot read, insert, update or call anything here (pgTAP).
- [ ] **A client cannot insert, update (including `status`, `expires_at`, `customer_id`) or delete a request directly,** as customer, as the business owner, or as an outsider (pgTAP).
- [ ] **The exact address of a homemade seller is returned only to the requesting customer at `accepted`/`completed`;** `null` for pending, declined, expired, cancelled, no_show, for another customer, for the owner of another business, and for restaurants; **anon cannot call the function at all (42501)**; and nothing is returned more than 24 hours after `pickup_at` (an accepted or completed request 25 hours past its pickup gets `null`, one inside 24 hours gets the address; inside the window the address is the cook's current one) (pgTAP, with statuses set by the superuser since spec 10 is not built).
- [ ] No response of any new function contains `place_id`, exact coordinates or `map_lat`/`map_lng`.
- [ ] The function-privilege allowlists in `05-seller-onboarding.test.sql` pass with the new functions and fail if a function is left executable by `anon`/`public`.
- [ ] A pending request whose `expires_at` has passed is returned with `display_status = 'expired'` before the cron has run (pgTAP), and the app shows it as Expired (jest, fake timers).
- [ ] A wrong phone clock (hours ahead or behind) never makes a request show the wrong status: the app shows the server's `display_status` and uses the clock offset only to time the refetch (jest with a skewed device clock; deliberate break 1).
- [ ] Times are shown in the phone's time zone and sent as UTC (jest under a non-UTC `TZ`).
- [ ] Guest: Request pickup leads to sign-in and then straight to the request form for that business. A seller does not see the button on their own business (jest).
- [ ] Loading, empty, error (with retry) and success states exist on My requests, the detail and the form (jest).
- [ ] Every touchable has a label and role, targets ≥ 44 pt, `StatusChip` shows a word plus icon, large text does not clip the form (jest where possible, device run for the rest).
- [ ] `npm run lint`, `npm run typecheck`, `npm test` and `npx supabase test db` pass; `src/types/database.ts` is regenerated, not hand-edited.

## Test plan
- Unit/component tests (jest): `status.ts` (labels, `clockOffset`), the skewed phone clock (device clock +5 h and −5 h: status and timing still follow the server), time-zone display and the picker's time helpers with an explicit zone (`Pacific/Auckland`, Kathmandu, Toronto, daylight-saving days; the native control is faked in `jest.setup.ts`), keyboard props on the form, schema (limits mirror SQL), `useSubmitPickupRequest` (key reuse on retry, new key after edit, double tap), form (steppers, unavailable items hidden, free-text only, total with `formatPrice`, error messages, sign-in gate, own-business hide), `PickupTimePicker` (earliest time, 7-day limit), My requests / detail states, cancel, address card shown only when the api returns an address and never for other statuses, `StatusChip` accessibility, `routeAccess`.
- Database tests (pgTAP) in `supabase/tests/09-pickup-requests.test.sql`: everything under Definition of done, plus RLS enabled, column grants for `authenticated`, zero grants for `anon`, idempotency replays that the `on conflict` fallback cannot mask (replay at the pending limit, with a past pickup time or an empty order, and at the rate limit), a structural check that the advisory lock is taken first (a real race cannot run inside one pgTAP transaction; the two-session run is manual), expiry function boundaries (`expires_at = now()` expires; one second later does not), and that `private.*` functions are not executable by any API role.
- **Deliberate breaks** (each must turn a named test red, then be reverted):
  1. In the app, make the displayed status come from the device clock instead of the server's `display_status` (or drop the offset when scheduling the refetch): the skewed-clock test must fail.
  2. Remove the idempotency-key reuse on retry (generate a new key per attempt): the retry test must fail.
  3. In SQL, drop the `customer_id = auth.uid()` filter from `get_my_pickup_request`: the outsider-read pgTAP test must fail.
  4. In SQL, let `get_my_pickup_address` ignore `status`: the pending/declined address pgTAP test must fail.
  5. Build the picker's slots in UTC: the non-UTC `TZ` test must fail.
- Manual check on device (iOS Simulator first): submit from both tabs; double tap; airplane mode then retry; cancel; wait for expiry (shorten with a seeded row); sign-in round trip from the sheet; VoiceOver on the form, the chips and the list; largest text size; Android later (recorded in §16).

## Decisions
Answered by Archan (open questions 1 to 12), plus the spec's own decisions.
1. **Pickup time:** at least 15 minutes ahead, at most 7 days, quarter-hour steps. No opening hours.
2. **Expiry window is fixed:** 30 minutes, or the pickup time if that is earlier. Not seller-configurable.
3. **Limits:** 1 pending request per customer per business, 5 pending in total, 10 submits per hour.
4. **Item unavailable after ordering:** nothing happens automatically; the seller decides when accepting (spec 10).
5. **Homemade exact address after acceptance** is shown to the accepting customer even when the cook's address data is older than 30 days. The 30-day guard exists because Google limits caching coordinates for map display; a customer with an accepted request must still find the cook. The address comes from `business_locations.formatted_address`, already stored. The legal read of Google's terms in §16 may overrule this; if it does, change only `get_my_pickup_address`. **Amended after the PR 1 review (Archan):** the address is returned only until 24 hours after `pickup_at`, for both `accepted` and `completed`. It is still the cook's current address, not the one at acceptance: **spec 10's accept function must snapshot the address (and place) onto the request**, and `get_my_pickup_address` must then return the snapshot, so a later move is never revealed.
6. **Guest sign-in** returns straight to the request form for that business (`/requests/new?businessId=…`).
7. **Pickup time picker** (amended in gate E, Archan): the platform's native calendar and time picker, `@react-native-community/datetimepicker` 9.2.1, instead of the original React Native day buttons and slot grid (which Archan found clumsy in the simulator run). It is a new native dependency and needs a rebuild. iOS uses one inline `datetime` control; Android uses the date dialog then the time dialog, whose limits it ignores, so the result is snapped and clamped in JS. The idempotency key uses `randomUUID()` from `expo-crypto`, which is already installed; if it were not, stop and ask before adding anything.
8. **Keep `pickup_requests` separate.** Spec 11 decides whether table requests get their own table or share one.
9. **Server decides what "expired" looks like (wrong phone clock).** Risk: showing "Expired on read" by comparing `expires_at` with the phone's clock would show a live request as expired, or an expired one as pending, on a phone with a wrong clock. Smallest safe fix: the read functions compute `display_status` in SQL (`pending` and `expires_at <= now()` → `expired`) and return `server_now`; the app displays `display_status` as is and uses `server_now − device now` only to time the next refetch at `expires_at`. A wrong clock can then at worst make a refetch early or late, never a wrong status; the 30 s refetch covers the rest. Tested with a skewed clock and a deliberate break (Test plan).
10. **Seller sees the customer's display name only** (spec 10). No phone number; none is added here.
11. **Cancel is pending-only in v1.**
12. **Free text:** no profanity filter; control characters are stripped and refused; length limits only; newlines allowed.
13. **History:** My requests loads a page of 50 (newest first); "Load more" is added later if needed (the function already takes `p_before`). The cursor is `created_at` alone while the order is `(created_at desc, id desc)`, so rows sharing one timestamp at a page boundary can be skipped (rare: `created_at` is the transaction start). A keyset cursor `(created_at, id)` can replace it when "Load more" is built.
14. **Own table, server-owned status.** `pickup_requests` has no client write path and no client read grant; every change and read is a function, matching CLAUDE.md.
15. **Snapshot of items.** Names and unit prices are copied into `items` at submit, so later menu edits cannot rewrite what was asked.
16. **Prices are read by the server.** The client sends item ids and quantities only.
17. **Return type is jsonb** like the map functions, so generated types stay simple and nothing is returned that was not written into the function.

## Open questions
None. All 12 earlier questions are answered above.
