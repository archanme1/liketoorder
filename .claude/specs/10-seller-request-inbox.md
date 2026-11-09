# Spec 10: Seller Request Inbox

**Branch:** `feature/seller-request-inbox` (two PRs from this one spec, same pattern as specs 06 to 09)
- PR 1 (backend only: migration, functions, pgTAP, types): `feature/seller-request-inbox` (renamed to `feature/seller-request-inbox-backend` before its first push)
- PR 2 (the app: inbox, request detail, actions, Manage row, seed data, jest tests): `feature/seller-request-inbox-app`, created from `main` after PR 1 is merged.
**Product spec:** `docs/product/v1.md` §3 (out of scope), §4 (Manage tab), §5 (Homemade specifics), §8 (Pickup requests), §10 (no-show), §12 (notifications, for what is NOT built here), §14 row 10, §15 (open question 2), §16 (Seller inbox keyset cursor, Function privileges, exact address read/write side)
**Plan mode:** required — adds a column, five seller functions and a shared request-object helper, changes `get_my_pickup_address` and the shared request object, extends the pgTAP function allowlists, adds routes, and touches well over ~5 files.
**Status:** ✅ Shipped (PR 1 database #17, PR 2 app)

## Overview
After this ships, a seller (restaurant or homemade) opens **Manage Business**, taps **Requests**, and sees the pickup requests sent to their business, newest first, with a status chip per row and the customer's display name. They open a request to see what was ordered, the pickup time, and the customer's note, then **Accept** or **Decline** a pending one. After the pickup time they mark an accepted request **Completed** or **No-show**. Accepting a homemade request **snapshots the cook's exact address onto the request**, so the customer's address read (spec 09) returns the snapshot and a later move is never revealed. Every status change goes through a Postgres function that checks the caller owns the business and the transition is valid; a seller can never read or change another business's requests.

Spec 09 built the table, the customer flow and auto-expiry, and left the seller side to this spec. Push notifications for new and answered requests are spec 12, and table requests are spec 11, so this spec only builds the seller's reads and the transitions both later specs rely on. Until spec 12, a seller sees new requests only when they open the app, and the inbox refreshes on focus and on a timer.

**Why now:** the customer can already send requests (09), and a request nobody can answer just expires. This closes the loop.

## Depends on
- 02 auth-and-profiles ✅ (`profiles.display_name`, `username`)
- 05 seller-onboarding ✅ (`businesses`, `business_locations.formatted_address`, seller mode)
- 06 menu-management ✅ (`formatPrice`, currencies)
- 09 pickup-requests ✅ (`pickup_requests`, status model, `StatusChip`, `RequestStatusChip`, `useRefetchAtExpiry`, the infinite-list pattern)

## Context to load
- `CLAUDE.md`
- `docs/product/v1.md` §3, §5, §8, §10, §12, §16
- This spec, and `.claude/specs/09-pickup-requests.md` ("Functions", "Allowed transitions", "Notes for specs 10 and 12", Decisions 5, 9, 10, 11)
- `.claude/skills/supabase-patterns/SKILL.md` ("Status transitions", lists/keyset rule, "Server-owned values"), `.claude/skills/liketoorder-ui/SKILL.md` (request status chips, lists)
- `supabase/migrations/20261107181009_pickup_requests.sql` (table, `cancel_pickup_request` as the transition template, `get_my_pickup_address`, request object, `private.expire_pickup_requests`)
- `supabase/tests/05-seller-onboarding.test.sql` (function allowlists, about lines 167 to 205), `supabase/tests/09-pickup-requests.test.sql` (fixtures `u/b/i/r/k`, `as_user(n)`, the request-key comparison test, function-privilege section)
- `app/(tabs)/manage.tsx`, `app/seller/_layout.tsx`, `src/features/sellers/{sellerRoutes.ts,components/{ManageBusinessScreen,SellerScreenGate}.tsx,hooks/useMyBusiness.ts}`, `src/features/auth/routeAccess.ts`
- `src/features/requests/{api,schema,status,messages,time}.ts`, `src/features/requests/hooks/{keys,useMyRequests,useRefetchAtExpiry}.ts`, `src/features/requests/components/{RequestStatusChip,RequestDetail}.tsx`, `src/features/requests/__fixtures__/pagedServer.ts`
- `src/components/ui/index.ts`
- `scripts/seed/requests.ts`, `scripts/seed/requestsData.ts`

## User stories
- As a seller, I can see all the pickup requests sent to my business, newest first, so that I know what to prepare.
- As a seller, I can open a request and see the items or free-text order, the pickup time, the customer's note and the customer's display name.
- As a seller, I can accept or decline a pending request so that the customer knows where they stand.
- As a seller, I can see at a glance how many requests are waiting for me, without opening each one.
- As a seller, after the pickup time I can mark an accepted request completed or no-show.
- As a homemade seller, I know that accepting a request lets that customer see my exact address until 24 hours after the pickup time, and I am told so before I confirm.
- As a seller, I cannot answer a request that already expired, was cancelled or was already answered, and I am told why in plain words.
- As a customer, I see my request become Accepted or Declined (on the next open or refresh; push is spec 12), and if accepted at a homemade cook, I see the address that was current when the cook accepted.
- As an outsider (another seller, another customer, a guest), I cannot see or answer anybody else's requests.
- As a screen-reader user, every status is spoken as a word and every action is reachable.

## Screens & routes
- `app/seller/requests/index.tsx` — **Requests** inbox for the seller's own business: infinite list (50 per page, newest first), status chip per row, customer display name, pickup time, order summary line. A filter control **Waiting / All** (opens on Waiting, Decision 13). Seller only, behind `SellerScreenGate`.
- `app/seller/requests/[id].tsx` — **Request detail** (seller view): customer display name, status, pickup time (phone time zone), items with quantities and the estimated total (`formatPrice`, "Total excludes items without a price" when relevant), free-text order, customer note, expiry countdown for a pending one, and the actions valid for the current status:
  - `pending`: **Accept** and **Decline**
  - `accepted`, and the pickup time has passed: **Mark completed** and **Mark no-show**
  - anything else: no action, status shown as a word
  Seller only, and only for a request to their own business.
- `app/seller/_layout.tsx` (change) — registers the two screens.
- `app/(tabs)/manage.tsx` / `ManageBusinessScreen` (change) — a **Requests** `NavRow` with a "n waiting" summary (same loading / failed pattern as the Menu and Photos rows).
- `src/features/sellers/sellerRoutes.ts` (change) — new screen keys `requests` and `request`, covered by `sellerRoutes.test.ts`.

Accept and Decline each open a confirm step (a request answered by mistake cannot be undone, Decision 3). For a homemade business the Accept confirm says the exact address will be shown to the customer.

States (4 states on every screen):
- **Loading:** skeleton rows / skeleton detail.
- **Empty:** "No requests yet. Customers who request pickup will show up here." (Waiting filter: "Nothing waiting for you right now.")
- **Error (with retry):** list/detail load errors with Retry; action errors keep the screen and say what happened (see Messages).
- **Success:** list, detail, and after an action the row/detail shows the new status chip as a word.

## Database changes
One migration, `npx supabase migration new seller_request_inbox`. Never edit an existing migration (the pickup requests migration is on `main`). Sketch only; the implementation checks names against the current migrations.

```sql
-- Address snapshot written by respond_to_request when a homemade request is accepted.
alter table public.pickup_requests
  add column accepted_address text
    check (accepted_address is null or char_length(accepted_address) between 1 and 300);
  -- plus a table-level check: accepted_address is null unless status in ('accepted','completed','no_show')

-- Seller inbox index: spec 09 already has (business_id, status, created_at desc).
-- The keyset cursor adds id as the tie-break:
create index pickup_requests_business_keyset_idx
  on public.pickup_requests (business_id, created_at desc, id desc);
```

Whether the snapshot is a single `accepted_address text` column or a small `jsonb` (address plus place) is for the implementation plan; spec 09 Decision 5 says "address (and place)". The migration must stay append-only and add no client grant.

### RLS and grants
- No new table. `pickup_requests` keeps **RLS on, no policies, no client grants**. Seller access is by function only, so a seller still cannot `select` the table directly. pgTAP proves the owner of the business, as well as an outsider and `anon`, cannot `select`, `insert`, `update` or `delete` it directly (this repeats spec 09's check for the new role).
- The new column inherits the table's "no grants" state; pgTAP asserts no role in `anon`/`authenticated` has any privilege on it.
- Customer name: the seller functions return `customer_name` computed in SQL (`coalesce(profiles.display_name, profiles.username)`), nothing else about the customer (no email, no id). Decision 10 of spec 09.

### Functions
| Function | Who may execute | What it does |
|---|---|---|
| `respond_to_request(p_request_id uuid, p_decision text) returns jsonb` | `authenticated` | `p_decision` is `accepted` or `declined` (else `invalid_input`). Resolves the caller's business (`businesses.owner_id = auth.uid()`), **without checking `is_listed`, seller mode or the 30-day freshness** (Decision 11); locks the request `for update`; request must belong to that business (else `not_found`, identical for unknown and someone else's); must be `pending` and `expires_at > now()` (else `invalid_transition`); sets the status and `responded_at = now()`. On `accepted` for a **homemade** business, copies `business_locations.formatted_address` into `accepted_address`. Returns the seller request object. |
| `mark_request_outcome(p_request_id uuid, p_outcome text) returns jsonb` | `authenticated` | `p_outcome` is `completed` or `no_show` (else `invalid_input`). Same owner and `for update` checks; must be `accepted` and `pickup_at <= now()` (else `invalid_transition`); sets the status. `responded_at` is left as it was. Returns the seller request object. |
| `list_business_requests(p_status text default null, p_before text default null) returns jsonb` | `authenticated` | `{ "server_now", "requests": [...], "next_cursor" }`. The caller's own business only (none → empty list). `p_status` null = all, `waiting` = `display_status = 'pending'`, or one status. Ordered `(created_at desc, id desc)`, a page of **50**, keyset cursor `(created_at, id)` returned as **text** and sent back untouched (never parsed into a JS Date). |
| `get_business_request(p_request_id uuid) returns jsonb` | `authenticated` | `{ "server_now", "request" }` for a request to the caller's business, else `request: null` (identical for unknown and someone else's). |
| `count_waiting_requests() returns jsonb` | `authenticated` | `{ "server_now", "waiting": n }` — pending requests of the caller's business not past `expires_at`. Powers the Manage row; bounded by the 5-pending customer limit, but still a count, never a list. |
| `private.pickup_request_json(...)` (private) | none directly | The shared request-object builder (see "Request object"). |

`respond_to_request` and `mark_request_outcome` must follow the `cancel_pickup_request` template: `security definer`, `set search_path = ''`, row lock first, stable error codes, nothing that reveals why a request is not the caller's.

Neither function trusts the client for time or status. Both take no business id: the business is always derived from `auth.uid()`, so a tampered id cannot point at someone else's business.

### Request object
The four customer builders (`submit`, `list`, `get`, `cancel`) write the object out in full today and a pgTAP test compares their keys (spec 09 note). Move it into one `private.pickup_request_json` helper now, used by the customer functions and the seller functions. The customer object keeps its current keys exactly (no new key reaches the customer app, and `accepted_address` is never in it). The seller object adds `customer_name` and `responded_at` and drops nothing else. Customer functions must be re-created with the helper in the same migration (a new function body, not an edit of the old migration); the existing spec 09 pgTAP tests must pass unchanged.

Nothing returned by any new function contains `place_id`, exact coordinates, `map_lat`/`map_lng`, the customer's id or email, or (outside `get_my_pickup_address`) an address.

### Change to `get_my_pickup_address`
- Returns `accepted_address` (the snapshot) instead of the live `business_locations.formatted_address`.
- Keeps every existing gate: the requesting customer, `status in ('accepted','completed')`, homemade, and `pickup_at > now() - interval '24 hours'`.
- Rows accepted before this migration have no snapshot (`accepted_address` null). For those the function falls back to the current address, so nothing breaks for requests accepted by test data; since the seller side did not exist before this spec, no real data can be in that state (Decision 16).
- Still **not** gated by the 30-day map guard (spec 09 Decision 5), and still returns `null`, identical for every cause, otherwise.
- `no_show` returns `null` (spec 09 allowlist unchanged: only `accepted` and `completed`).

### Allowed transitions (this spec)
`pending → accepted | declined` (seller, `respond_to_request`), `accepted → completed | no_show` (seller, `mark_request_outcome`, only once `pickup_at` has passed). Together with spec 09: `pending → cancelled` (customer), `pending → expired` (cron). There is no `accepted → cancelled` and no undo in v1 (Decision 14). `declined`, `expired`, `cancelled`, `completed` and `no_show` are final. **A direct update of `status` stays impossible for clients**, and pgTAP proves it for the business owner as well.

### Auto-expire interaction
- `respond_to_request` refuses a request past `expires_at` even before the cron has swept it (spec 09's check-on-read rule), so a seller can never accept a request that the customer's app already shows as Expired.
- The seller list computes `display_status` in SQL like the customer list (Decision 9 of spec 09): a pending row past `expires_at` is `expired` for the seller too, and the app shows `display_status` as is.

### Function privileges (CLAUDE.md "Function privileges", §16)
- Every function: `revoke execute … from public, anon, authenticated`, then grant exactly as in the table.
- `supabase/tests/05-seller-onboarding.test.sql`: the `authenticated` allowlist gains exactly `respond_to_request`, `mark_request_outcome`, `list_business_requests`, `get_business_request`, `count_waiting_requests` (alphabetical position, message updated to "specs 05 to 10"); the `anon` list is unchanged; the `private` list gains `pickup_request_json`, and the description's helper count is updated. The new private helper must be `security definer` with an empty `search_path`.

## Storage
None.

## Edge Functions
None. Push for these events is spec 12, triggered from the status change; this spec sends no notification.

## Components & hooks
All in `src/features/requests/` unless noted (the seller screens live here too because they share the request model; routes stay in `app/seller/requests/`).
- `api.ts` — add `listBusinessRequests(status, cursor)`, `getBusinessRequest`, `respondToRequest`, `markRequestOutcome`, `countWaitingRequests`. Add the new codes to `RequestAppError` / `mapRequestError` only if the functions raise any not already mapped (`invalid_input`, `invalid_transition`, `not_found`, `not_signed_in` exist already).
- `schema.ts` — a strict zod `sellerRequestSchema` (the customer schema is strict and has no `customer_name`), a page schema with `next_cursor` as a string, and the count schema.
- `sellerMessages.ts` — seller-worded status sentences and error messages in one place (`messages.ts` and `statusSentence` are written for the customer: "Waiting for X to respond", "can't be cancelled"). Pending reads "Waiting for your answer" and never "booked"/"confirmed" until the seller accepted it.
- `hooks/keys.ts` — add `inbox(status)`, `businessDetail(id)`, `waitingCount`.
- `hooks/useBusinessRequests.ts` — `useInfiniteQuery` on the text keyset cursor, `PENDING_POLL_MS` polling while a pending row is loaded, refetch on focus and at the server-corrected `expires_at` (`useRefetchAtExpiry`), a manual `refresh` that replaces the list only after page 1 has loaded (copy `useMyRequests`).
- `hooks/useBusinessRequest.ts`, `hooks/useWaitingCount.ts`.
- `hooks/useRespondToRequest.ts`, `hooks/useMarkRequestOutcome.ts` — mutations; disabled while running (double tap), invalidate the inbox, the detail and the count; a `not_found` / `invalid_transition` error also refetches, so the screen shows the real current status.
- `components/SellerRequestsScreen.tsx`, `components/SellerRequestRow.tsx` (memoized, stable callbacks), `components/SellerRequestDetailScreen.tsx`, `components/RequestActions.tsx` (actions valid for the status, confirm steps).
- Reused as is: `RequestStatusChip`, `StatusChip`, `Screen`, `NavRow`, `EmptyState`, `ErrorState`, `Skeleton`, `formatDateTime`, `formatPrice`.
- `src/features/sellers/components/ManageBusinessScreen.tsx` — the Requests `NavRow` with the waiting count.

## Files to create
**PR 1**
- `supabase/migrations/<timestamp>_seller_request_inbox.sql`
- `supabase/tests/10-seller-request-inbox.test.sql`

**PR 2**
- `app/seller/requests/index.tsx`, `app/seller/requests/[id].tsx`
- `src/features/requests/sellerMessages.ts`
- `src/features/requests/hooks/{useBusinessRequests,useBusinessRequest,useWaitingCount,useRespondToRequest,useMarkRequestOutcome}.ts`
- `src/features/requests/components/{SellerRequestsScreen,SellerRequestRow,SellerRequestDetailScreen,RequestActions}.tsx`
- `src/features/requests/__tests__/*` (seller tests)

## Files to change
**PR 1**
- `supabase/tests/05-seller-onboarding.test.sql` — extend the function allowlists
- `supabase/tests/09-pickup-requests.test.sql` — only where the shared helper or `get_my_pickup_address` changes what it asserts (hard-coded function lists, the address tests); its other checks must pass unchanged
- `src/types/database.ts` — regenerate with `npm run db:types`
- `.claude/skills/supabase-patterns/SKILL.md` — document the new functions, `accepted_address`, and `private.pickup_request_json`
- `docs/product/v1.md` §16 — close "Seller inbox keyset cursor → spec 10" and the write side of "Homemade read function / exact address after accepted request"; add a new entry "Completed / no-show time limit and no-show tracking → revisit together" (no upper limit on marking an outcome in v1, Decision 12; ties to §15 open question 2)

**PR 2**
- `app/seller/_layout.tsx`, `src/features/sellers/sellerRoutes.ts` (+ its test)
- `src/features/sellers/components/ManageBusinessScreen.tsx` (+ test)
- `src/features/requests/{api,schema}.ts`, `src/features/requests/hooks/keys.ts`
- `scripts/seed/requests.ts`, `scripts/seed/requestsData.ts` — set `accepted_address` on the seeded accepted and completed homemade rows; make sure a seed seller has pending, accepted-and-past-pickup and answered requests to try every action (re-run for fresh times)
- `.claude/skills/liketoorder-ui/SKILL.md` — only if the chip or list rules need a correction
- `CLAUDE.md` — status table

## New dependencies
No new dependencies.

## Rules for implementation
- RLS on every new table + pgTAP test (no new table here; `pickup_requests` stays closed, tested for the new roles)
- Supabase calls only in `src/features/requests/api.ts`
- Theme tokens only, no hardcoded colors/sizes
- Loading / empty / error / success states on every screen
- Accessibility: `accessibilityLabel` and `accessibilityRole` on every touchable; targets ≥ 44 pt; status always as a word, never colour alone
Feature-specific:
- **Ownership in the database.** Every seller function derives the business from `auth.uid()`; no function takes a business id from the client. Hiding the Manage tab is UX only.
- **Status only via functions.** `respond_to_request` and `mark_request_outcome` are the only write path; no client update path; no `service_role` in the app.
- **Server decides.** Status, `display_status`, expiry, `responded_at`, the address snapshot and all timestamps come from SQL. The app never sends a status, a time or an address, only the request id and the decision.
- **Never show a pending request as confirmed**, on either side. After `declined` / `accepted` the seller's own wording is allowed ("You accepted this request"), but a pending, expired or declined request never reads as accepted anywhere, including screen-reader labels.
- **Exact address.** It is copied once, in SQL, at accept, from `business_locations.formatted_address`. It never appears in any list, any seller response, or the customer request object; the seller never needs it echoed back. Never logged.
- **Keyset cursor from day one** (§16): `(created_at, id)`, server limit 50, the cursor is the server's text value sent back untouched, the same order in SQL and in the app's dedupe.
- **Customer privacy.** The seller sees the customer's display name only (spec 09 Decision 10). No email, no phone, no id, no username unless `display_name` is empty.
- Never log request contents, notes, customer names or addresses.
- Duplicate taps: Accept / Decline / Completed / No-show disable and show progress while the mutation runs; calling the function twice with the same decision on the same row is safe (the second call returns `invalid_transition`, and the app refetches and shows the real status).
- Times are shown in the phone's time zone and handled in UTC, exactly as in spec 09 (`time.ts`); the "pickup time has passed" check that shows the Completed / No-show buttons is a hint only, the server's `server_now` is the clock (spec 09 Decision 9) and the function re-checks.
- Stage gates with a commit after each (stop and commit after each gate; no edits before "approved").
  - PR 1: **A** migration + pgTAP + types → review.
  - PR 2: **B** api, schema, sellerMessages, hooks + tests → **C** inbox list, detail, actions, Manage row, seed data + tests → manual run.

## Known pitfalls (checklist)
Sources: `.claude/skills/map-markers/SKILL.md` "Lessons from spec 07" (tests, large text, taps) and the spec 09 pitfall list, which this feature reuses.

- [ ] **Double tap on actions.** Accept, Decline, Completed, No-show and the confirm buttons are disabled while the mutation runs; a second call cannot change a row twice (pgTAP + jest).
- [ ] **Stale lists after an action.** An action success, and also a `not_found` / `invalid_transition` error, invalidates the inbox, the detail and the waiting count and refetches; the inbox refetches on focus, at the server-corrected `expires_at` and every 30 s while a pending row is visible (jest).
- [ ] **Race: customer cancels while the seller answers.** The row lock makes exactly one win; the loser gets `invalid_transition` and the screen shows the real status with a plain message (pgTAP with statuses set by the superuser; manual two-session run recorded in the PR for the true race).
- [ ] **Cursor ties.** Rows with the same `created_at` at a page boundary are neither skipped nor repeated (pgTAP with 51+ rows sharing one timestamp; jest with the paged fake server).
- [ ] **Wrong phone clock.** Status text comes from the server's `display_status`; the clock offset only schedules a refetch; the "pickup time has passed" hint never lets a bad clock apply a wrong status because the server re-checks (jest with a skewed clock).
- [ ] **Times shown from UTC** in the phone's time zone, with explicit-zone tests (`Pacific/Auckland`, Kathmandu, Toronto, DST days), as in spec 09.
- [ ] **Large text clipping.** Row titles capped (`maxFontSizeMultiplier` 1.6), body text and chips wrap, no fixed heights, action buttons ≥ 44 pt and reachable at the largest iOS size (manual run).
- [ ] **Test QueryClient cleanup.** Own `QueryClient` per file with `retry: false`, `gcTime: 0`, cleared and `cleanup` in `afterEach`; fake timers restored; every RNTL call awaited (v14).
- [ ] **Leftover seed data breaks pgTAP counts.** The pgTAP file creates its own users and businesses with fixed ids, counts only its own rows, runs in a rolled-back transaction.
- [ ] **Hit targets and labels** on every row, filter, confirm button and the Manage row; "Accept request from <name>, pickup <time>" style labels; the filter's selected state is a word, not colour only.
- [ ] **Faithful fakes.** Tests use the existing `jest.setup` fakes and `__fixtures__/pagedServer.ts`; no ad-hoc fakes.
- [ ] **Customer app unchanged.** The customer request object keeps exactly its current keys after the helper refactor (pgTAP key comparison, jest strict schema still parses).

## Out of scope
- Push notifications for new, answered or cancelled requests (spec 12). Until then, nothing alerts the seller.
- Table requests and "I've arrived" (spec 11); the inbox is pickup requests only.
- Reports (17), legal text (18), promotions (16).
- Chat between seller and customer, a decline reason, editing a request, undoing an answer, counter-offers (v1 §3).
- Customer-facing or seller-facing display of customer no-shows across requests (v1 §15 open question 2); no-show tracking and a time limit for outcomes are revisited together later (§16 entry, Decision 12).
- Seller opening hours, auto-accept, per-business request caps (spec 09 note for specs 10 and 12 suggests considering a per-business hourly cap; it is left to spec 12, Decision 17; not built).
- In-app payments, delivery, live location tracking (v1 §3).
- Order activity grids on customer profiles and business pages (v1 §3).
- Seller-side stats or an export of past requests.

## Definition of done
- [x] A seller sees only the requests sent to their own business, newest first, with the customer's display name, in pages of 50 (pgTAP + jest).
- [x] **A seller can still see and answer already-sent pending and accepted requests when the business is unlisted, stale (30-day guard) or seller mode is off;** `respond_to_request`, `mark_request_outcome`, `list_business_requests` and `get_business_request` check neither `is_listed` nor freshness, while `submit_pickup_request` still refuses new requests to such a business (pgTAP).
- [x] A seller can accept and decline a pending request; the customer's My requests then shows the new status from the server (pgTAP + jest).
- [x] A seller cannot accept or decline a request that is expired (stored or by `expires_at`), cancelled, already answered, or past its expiry before the cron ran; each fails with `invalid_transition` (pgTAP).
- [x] After the pickup time a seller can mark an accepted request completed or no-show; before the pickup time, or on a request that is not accepted, it fails with `invalid_transition` (pgTAP).
- [x] **An outsider cannot read or answer another business's requests:** another seller, a customer who is not the requester, `anon`, and the requester themselves cannot call the seller functions on a request that is not to their business; every such call returns `not_found` / `request: null` / an empty list, identical to an unknown id (pgTAP).
- [x] **A client cannot insert, update (including `status`, `accepted_address`, `expires_at`, `business_id`, `customer_id`) or delete a request directly,** as the business owner, the customer or an outsider (pgTAP).
- [x] Accepting a homemade request stores the cook's address at that moment; changing the cook's address afterwards does not change what `get_my_pickup_address` returns; accepting a restaurant request stores no address (pgTAP).
- [x] `get_my_pickup_address` still returns an address only to the requesting customer at `accepted` / `completed` within 24 hours of `pickup_at`, and `null` for pending, declined, expired, cancelled, no_show, another customer, another seller and restaurants; `anon` gets 42501 (spec 09 tests pass, adjusted only for the snapshot) (pgTAP).
- [x] Rows sharing one `created_at` across a page boundary are neither skipped nor duplicated by `list_business_requests` (pgTAP + jest).
- [x] No response of any new function contains `place_id`, exact coordinates, `map_lat`/`map_lng`, the customer's id or email, or an address; the customer object has the same keys as before (pgTAP).
- [x] The function-privilege allowlists pass with the new functions and fail if one is left executable by `anon`/`public`; `private.pickup_request_json` is not executable by any API role (pgTAP).
- [x] A pending request past `expires_at` shows as Expired to the seller with no answer actions before the cron has run (pgTAP + jest, fake timers).
- [x] A wrong phone clock never changes a displayed status (jest with a skewed clock).
- [x] Double-tapping Accept sends one decision and the second outcome is handled calmly (jest).
- [x] The Manage Business screen shows a Requests row with the number waiting, with loading and failed states (jest).
- [x] A pending request is never described as accepted or confirmed on the seller side, including screen-reader labels (jest).
- [x] The homemade Accept confirm says the exact address will be shown to the customer; the restaurant one does not (jest).
- [x] Loading, empty, error (with retry) and success states exist on the inbox and the detail (jest).
- [x] Every touchable has a label and role, targets ≥ 44 pt, status is always a word, large text does not clip (jest where possible; the rest on the iOS Simulator, see the manual run).
- [x] `npm run lint`, `npm run typecheck`, `npm test` and `npx supabase test db` pass; `src/types/database.ts` is regenerated, not hand-edited.

### Manual run results (iOS Simulator only, run by Archan; not a real iPhone or Android)
All of these passed: the inbox opens on Waiting; the All filter; infinite scroll past 50; pull to refresh; auto-expiry of the seeded "expires in about 2 minutes" request; accept and decline with a double tap; Completed and No-show on the seeded past-pickup requests; the customer accounts seeing the new statuses; a homemade Accept with the address confirm and the address snapshot (a later address change not reaching the customer); the cancel-while-answering race (a calm message and the real status); the largest text size; VoiceOver.
The code review (APPROVED WITH SUGGESTIONS, no security findings) was done after this run; its fixes (empty Waiting polling, the cached server time kept with its fetch time, an error instead of an empty state, a stable `onOpen`, small cleanups) are covered by jest and were not re-run by hand.
Not part of this run, so still listed in section 16 of `docs/product/v1.md` as before-launch items: a real iPhone, Android, VoiceOver and TalkBack on devices, the largest text size on a device, the phone's clock and time zone on a real phone, and the Hermes `Intl` check. No native module was added: no rebuild is needed.

## Test plan
- Unit/component tests (jest): `sellerMessages`, `sellerRequestSchema` (strict, text cursor kept as a string), `useBusinessRequests` (keyset paging with ties, dedupe, polling, focus refetch, refresh), `useRespondToRequest` / `useMarkRequestOutcome` (double tap, invalidation, error refetch), inbox and detail states, filter, confirm steps, homemade vs restaurant Accept confirm, action visibility per status and per `pickup_at`, skewed phone clock, time-zone display, Manage row summary, `sellerRoutes`, `routeAccess` cases pinning that only a seller reaches the screens.
- Database tests (pgTAP) in `supabase/tests/10-seller-request-inbox.test.sql`: everything under Definition of done, plus: the owner's role cannot select the table or its new column directly, `anon` has no privileges, `respond_to_request` / `mark_request_outcome` row-lock-first structure, boundaries (`expires_at = now()` cannot be accepted; `pickup_at = now()` can be marked), a cursor with 120 rows sharing a timestamp, `invalid_input` for an unknown decision / outcome, and that the customer functions return the same keys after the helper refactor.
- **Deliberate breaks** (each must turn a named test red, then be reverted):
  1. In SQL, drop the business-ownership filter from `respond_to_request`: the other-seller pgTAP test must fail.
  2. In SQL, let `respond_to_request` ignore `expires_at`: the accept-expired pgTAP test must fail.
  3. In SQL, make `get_my_pickup_address` read the live address again: the moved-address pgTAP test must fail.
  4. In SQL, drop the `id` tie-break from the list order or cursor: the shared-timestamp paging test must fail.
  5. In SQL, make `respond_to_request` require `is_listed` or a fresh business: the unlisted/stale-business answer pgTAP test must fail.
  6. In the app, show the seller the Completed / No-show buttons from the phone clock without the server re-check being tested, or display a status from the device clock: the skewed-clock test must fail.
- Manual check on device (iOS Simulator first): sign in as a seed seller; see the waiting count on Manage; accept and decline from the inbox; check the customer account sees the result; mark completed and no-show on a seeded past-pickup accepted row; accept a homemade request and confirm the customer sees the address; let a request expire while the inbox is open; double tap; airplane mode then retry; VoiceOver on rows, chips, filter and the confirm dialogs; largest text size; Android later (recorded in §16).

## Decisions
Spec-level decisions made from existing specs (anything not answered by the product spec is under Open questions):
1. **Keep `pickup_requests` separate and extend it** (spec 09 Decision 8 stands; table requests decide in spec 11).
2. **Seller reads and writes by function only**, no table grant, no policy (spec 09 Decision 14).
3. **Accept and Decline have a confirm step**, because the answer is final in v1.
4. **The address is snapshotted in SQL at accept** (spec 09 Decision 5 and the spec 09 notes for spec 10), and `get_my_pickup_address` returns the snapshot.
5. **Keyset cursor `(created_at, id)`**, server limit 50, text cursor (§16, decided by Archan in spec 09 gate E).
6. **One shared request-object builder** (`private.pickup_request_json`) replaces the four copies (spec 09 note for spec 10).
7. **Seller sees the customer's display name only** (spec 09 Decision 10), falling back to the username when no display name is set.
8. **The business is derived from `auth.uid()`**, never passed by the client.
9. **The server's clock decides**, as in spec 09 Decision 9: `display_status`, `server_now`, expiry and the "pickup time has passed" re-check are SQL; the phone's clock only times refetches and shows the buttons as a hint.
10. **Return type is jsonb**, like the map and customer request functions.
11. **A seller can still answer already-sent requests when the business is unlisted, stale or seller mode is off.** Only new submissions are blocked (spec 09). The seller functions check ownership, status and expiry, never `is_listed` or freshness. Tested in pgTAP, with a deliberate break.
12. **No time limit for Completed / No-show in v1.** A §16 entry revisits the limit together with no-show tracking (v1 §15 open question 2).
13. **Inbox opens on Waiting** with an All toggle.
14. **No undo.** Answers and outcomes are final in v1.
15. **Item availability is not shown when accepting.** The detail shows the ordered snapshot only.
16. **`get_my_pickup_address` falls back to the cook's current address when the snapshot is null;** the seed is updated to set the snapshot.
17. **The per-business request cap is left to spec 12;** the spec 09 note stays.
18. **No tab badge.** The waiting count shows only on the Requests row inside Manage Business.

## Open questions
None. All 8 earlier questions are answered in Decisions 11 to 18.
