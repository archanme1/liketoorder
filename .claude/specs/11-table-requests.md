# Spec 11: Table Requests

**Branch:** `feature/table-requests` (two PRs from this one spec, same pattern as specs 06 to 10b)
- PR 1 (backend only: migration, pgTAP, types): `feature/table-requests` (renamed to `feature/table-requests-backend` before its first push)
- PR 2 (the app: shared paged hook, Request table, Requests tab integration, I've arrived, jest tests): `feature/table-requests-app`, created from `main` after PR 1 is merged.
**Product spec:** `docs/product/v1.md` §3 (out of scope), §4 (Navigation), §8 (Pickup requests, for the shared rules), §9 (Table requests), §12 (notifications, for what is NOT built here), §14 row 11, §16 (paged-list copy, seller inbox keyset cursor, request row kind label, function privileges, lists rule)
**Plan mode:** required — adds a table with RLS, adds and changes Postgres functions and the shared request objects (a contract change on every request object), adds a route, and touches well over ~5 files.
**Status:** 📝 Spec written

## Overview
After this ships, a signed-in customer opens a restaurant that accepts tables, taps **Request table**, picks a day, a time, a party size and an optional note, and sends it. It appears in **Sent** in the Requests tab with a "Table" label. The restaurant owner sees it in **Received** (seller mode on or off) next to pickup requests, and accepts it (with an optional note), or declines it with a reason. The customer sees the answer as for pickup. On an accepted table request the customer can tap **I've arrived** once, from 2 hours before the table time until 4 hours after it; the seller then sees "Customer has arrived". The push notification for it is spec 12 (not built).

Three hand-offs from spec 10b (§16) are closed here: the two copies of paged-list code become one shared hook; My requests (Sent) moves to the same `(created_at, id)` keyset cursor as the seller inbox, and both lists merge pickup and table rows; and the kind label is spoken at the start of the row label.

**Why now:** pickup requests and the Requests tab are done (09 to 10b). Spec 12 (notifications) needs every request kind to exist first.

**Heads-up (same as 10b):** PR 1 drops `list_my_pickup_requests`, so the app on `main` is out of step with the database until PR 2 merges. Do not apply PR 1 to a shared database before PR 2 is ready.

## Depends on
- 02 auth-and-profiles ✅
- 03 navigation-shell ✅
- 05 seller-onboarding ✅ (`businesses.accepts_table_requests`, restaurant-only check, seller toggle)
- 09 pickup-requests ✅ (customer request object, form, time picker, status chips)
- 10 seller-request-inbox ✅ (`list_business_requests` keyset cursor, `respond_to_request`, `mark_request_outcome`, `count_waiting_requests`)
- 10b requests-tab-and-answers ✅ (Requests tab, switches, badges, decline reasons, accept notes, `statusMemory`)

## Context to load
- `CLAUDE.md`
- `docs/product/v1.md` §3, §4, §8, §9, §12, §16
- This spec, and `.claude/specs/09-pickup-requests.md`, `.claude/specs/10-seller-request-inbox.md`, `.claude/specs/10b-requests-tab-and-answers.md` ("Request object", "Functions", "Function privileges", Decisions, "Known pitfalls")
- `.claude/skills/supabase-patterns/SKILL.md`, `.claude/skills/liketoorder-ui/SKILL.md`, `.claude/skills/map-markers/SKILL.md` ("Lessons from spec 07" only)
- `supabase/migrations/20261107181009_pickup_requests.sql`, `20261108225156_seller_request_inbox.sql`, `20261109021754_requests_answer_notes.sql`, `20261103215641_seller_onboarding.sql` (`accepts_table_requests` only)
- `supabase/tests/05-seller-onboarding.test.sql`, `09-pickup-requests.test.sql`, `10-seller-request-inbox.test.sql`, `10b-requests-answer-notes.test.sql`
- `app/(tabs)/requests.tsx`, `app/requests/{_layout,new,[id]}.tsx`, `app/seller/requests/{index,[id]}.tsx`
- `src/features/requests/{api,schema,status,kind,messages,sellerMessages,declineReasons,statusMemory,summary,time,answerLines}.ts`
- `src/features/requests/hooks/*` (especially `useMyRequests`, `useBusinessRequests`, `useRespondToRequest`, `useMarkRequestOutcome`, `useCancelPickupRequest`, `useWaitingCount`, `useRequestsBadge`, `useCustomerUpdates`, `invalidateSellerRequests`, `keys`)
- `src/features/requests/components/{RequestsTabScreen,MyRequestsList,RequestRow,SellerRequestRow,RequestDetail,RequestDetailScreen,SellerRequestDetailScreen,RequestActions,RespondDialog,DeclineReasonPicker,PickupRequestForm,PickupTimePicker,QuantityStepper,SendBar,RequestKindLabel}.tsx`, `src/features/requests/__fixtures__/*`
- `src/features/map/components/{RestaurantSheet,SheetActions,SheetActionRow}.tsx`
- `scripts/seed/requests.ts`, `scripts/seed/requestsData.ts`

## User stories
- As a customer, I can request a table at a restaurant that accepts them (day, time, party size, optional note), so that I do not have to phone.
- As a customer, I can follow the request in Sent, cancel it while it is pending, and see "Declined: <reason>" and the seller's note.
- As a customer, I can tap **I've arrived** once on an accepted request, from 2 hours before the table time until 4 hours after it, so that the restaurant knows I am here.
- As a restaurant owner, I see table requests in Received next to pickups (Waiting / All), whatever my seller mode, and I can accept (optional note), decline (a reason), and mark Completed or No-show after the table time.
- As a restaurant owner, I can see that the customer has arrived.
- As either side, I see one list per switch, newest first, 50 at a time, with no skipped or repeated rows even when many share a timestamp.
- As an outsider, I cannot read, answer, cancel or mark arrived on anyone else's table request.
- As a screen-reader or large-text user, the form, the party-size stepper, the arrived button and the kind label work with a label, a role and state spoken as words.

## Screens & routes
- `app/requests/table/new.tsx` (new, `?businessId=`) — thin screen rendering `TableRequestForm`. Signed-in; a guest goes through sign-in and returns (spec 09 `returnTo`).
- `app/requests/[id].tsx` (change) — customer detail handles both kinds; shows party size, the arrived button, "Declined: <reason>" and the seller's note.
- `app/seller/requests/[id].tsx` (change) — seller detail handles both kinds; accept / decline / completed / no-show; shows "Customer has arrived".
- `app/(tabs)/requests.tsx` (no change) — `RequestsTabScreen` renders mixed lists.
- Restaurant map sheet action row (change) — **Request table** next to Request pickup, only when the restaurant has `accepts_table_requests`; never for homemade.
- Rows show the kind ("Pickup" / "Table") and speak it **at the start of the row's accessibility label** (e.g. "Table, Luigi's, party of 4, …").
- **Table time is always shown with its zone name** (for example "7:00 pm EDT") on the form (the picked time) and on the customer and seller details, from the phone's zone with an explicit zone (`Intl` with `timeZoneName: 'short'`). Rows may show the shorter form.
- States on every screen: loading, empty, error with retry, success. A pending request is never shown as confirmed.

## Database changes
One migration, `npx supabase migration new table_requests`. Never edit an existing migration. Sketch only; the plan checks names against the current migrations.

**Decision: a separate table.** Table requests have different columns and rules from pickup (party size, no items, a different expiry, arrived). They share the request object builder pattern, the status model, the keyset cursor and the answer fields.

```sql
create table public.table_requests (
  id              uuid primary key default gen_random_uuid(),
  customer_id     uuid not null references public.profiles (id) on delete cascade,
  business_id     uuid not null references public.businesses (id) on delete cascade,
  idempotency_key uuid not null,
  status          text not null default 'pending'
    check (status in ('pending','accepted','declined','expired','cancelled','completed','no_show')),
  table_at        timestamptz not null,                       -- the table time (UTC)
  party_size      smallint not null check (party_size between 1 and 20),
  note            text,                                       -- same text rules as pickup_requests.note (c_ctrl, length)
  decline_reason  text check (decline_reason is null or decline_reason in
                    ('fully_booked','closed_then','too_busy','time_not_possible','other')),
  response_note   text,                                       -- same text rules as 10b
  expires_at      timestamptz not null,                       -- set by the server (see helper)
  responded_at    timestamptz,
  arrived_at      timestamptz,                                -- set once by mark_arrived
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint table_requests_idem unique (customer_id, idempotency_key),
  constraint table_requests_expiry_order check (expires_at <= table_at)
);
-- table-level checks (names in the plan), all the same as 10b except the reason list:
--   decline_reason only on declined rows; response_note only on answered rows;
--   decline_reason = 'other' implies response_note not null; a declined row with a note must be 'other';
--   arrived_at only on accepted / completed / no_show rows.
-- indexes (keyset): (customer_id, created_at desc, id desc), (business_id, created_at desc, id desc);
--   partial (expires_at) where status = 'pending'.
```
The text rules (`c_ctrl` hidden-character class, trimmed, 1 to 300 for `note`, 1 to 200 for `response_note`) are the same as `pickup_requests`, written with escaped code points only.

### RLS and grants
- `table_requests`: **RLS on, no policies, no client grants** (same as `pickup_requests`). All access is by security-definer functions with `set search_path = ''`, revoked from `public`/`anon`/`authenticated`, granted to `authenticated` only where listed below. pgTAP asserts no privilege for `anon` / `authenticated` on the table or any column.
- The business is always derived from `auth.uid()` (owner) for seller functions, never passed by the client. The customer is always `auth.uid()`.

### Server rules (decided)
- **Party size:** 1 to 20 (check and function).
- **Table time window:** earliest 30 minutes ahead, latest 30 days ahead of the server clock; otherwise `invalid_table_time`.
- **Expiry (own helper):** `private.table_request_expiry(p_table_at, p_created_at) = least(p_created_at + interval '24 hours', p_table_at)`. A new helper; the pickup 30-minute helper is **not** reused or changed. The existing cron job (`pickup-requests-expire`) is extended: `private.expire_pickup_requests()` also expires pending table requests (no new job).
- **Pending cap and rate limit:** separate per kind, the numbers pickup uses today: at most 5 pending table requests per customer in total and 1 pending per business (`too_many_pending`), and at most 10 table requests per customer per hour (`rate_limited`). Pickup and table counts do not affect each other. Cancelled and expired rows still count toward the hourly limit.
- **Who can be asked:** a listed `restaurant` with `accepts_table_requests = true`, not the caller's own business, caller has a complete profile; else `business_unavailable`, `own_business` or `profile_incomplete`.
- **Cancel:** only while `pending` (customer). Cancelling after acceptance is not allowed in v1 (§16: "cancel after accept needs a seller notification, spec 12").
- **I've arrived:** `mark_arrived`: the caller is the row's customer, status `accepted`, `arrived_at` null, and the server clock is between `table_at - 2 hours` and `table_at + 4 hours` inclusive. No calendar day, no time zone, no business time-zone column, no location input. Once only (a second call returns `already_arrived`, even after the window has closed; check order in the Functions table).
- **Completed / No-show:** the seller may mark an `accepted` table request `completed` or `no_show` after `table_at` (same rule as pickup, spec 10).

### Functions
All `security definer`, `set search_path = ''`, revoke from `public, anon, authenticated`, grant to `authenticated`.
| Function | What it does |
|---|---|
| `submit_table_request(p_business_id, p_idempotency_key, p_table_at, p_party_size, p_note default null)` (new) | Validates everything above. Same key returns the original row. Error codes: `not_signed_in`, `profile_incomplete`, `invalid_input`, `business_unavailable`, `own_business`, `invalid_table_time`, `invalid_party_size`, `invalid_text`, `too_many_pending`, `rate_limited`. |
| `cancel_table_request(p_request_id)` (new) | Customer, `pending` only, else `invalid_transition`; unknown or someone else's id → `not_found`. |
| `get_my_table_request(p_request_id)` (new) | `{ server_now, request }`; `request` null for unknown or someone else's, identically. |
| `mark_arrived(p_request_id)` (new) | Rules above. **Checks run in this fixed order, the first failure wins:** `not_found` (unknown id or not the caller's row), then `invalid_transition` (not `accepted`), then `already_arrived`, then `arrival_window`. So a second tap after the window has closed returns `already_arrived`, not `arrival_window`. Error codes: `not_signed_in`, `not_found`, `invalid_transition`, `already_arrived`, `arrival_window`. |
| `respond_to_request(p_request_id, p_decision, p_decline_reason default null, p_note default null, p_kind default 'pickup')` (changed) | Old four-argument form **dropped** in the same migration (one overload only). `p_kind = 'table'` uses the table reason list (`fully_booked`, `closed_then`, `too_busy`, `time_not_possible`, `other`), same note rules as 10b (`other` needs 1 to 200 characters of text, a fixed reason takes no note, an accept may carry a note), same `decline_reason_required` / `invalid_input` / `invalid_text` codes. A pickup reason sent with `table` (or the reverse) is `invalid_input`. Old callers (no `p_kind`) still work for pickup. |
| `mark_request_outcome(p_request_id, p_outcome, p_kind default 'pickup')` (changed) | Old two-argument form dropped; table: `accepted` and `table_at` passed. |
| `list_my_requests(p_before text default null)` (new) | Customer's pickup and table requests merged, ordered `(created_at desc, id desc)`, text cursor `YYYY-MM-DDTHH24:MI:SS.US"Z"|<uuid>` (the format of `list_business_requests`), limit 51 → 50 + `next_cursor`. Returns `{ server_now, requests, next_cursor }`. |
| `list_my_pickup_requests(timestamptz)` | **Dropped** (replaced by `list_my_requests`). |
| `list_business_requests(p_status, p_before)` (changed) | Merges both kinds, same cursor and filters. |
| `get_business_request(p_request_id)`, `count_waiting_requests()` (changed) | Cover both kinds (waiting = pending and unexpired). |
| `private.table_request_json(...)` (new), `private.pickup_request_json(...)` (changed) | Both add the `kind` key. |
| `private.table_request_expiry(...)` (new), `private.expire_pickup_requests()` (changed) | See Server rules. |

### Request object (contract change, approved)
**Every request object gains `kind` (`'pickup'` or `'table'`), always present.**
- Pickup objects: the current 15 customer keys / 17 seller keys plus `kind` (16 / 18).
- **Table customer object:** `id`, `kind`, `business_id`, `business_name`, `business_type`, `status`, `display_status`, `table_at`, `party_size`, `note`, `expires_at`, `created_at`, `decline_reason`, `response_note`, `arrived_at` (15 keys).
- **Table seller object:** the customer keys plus `customer_name` and `responded_at` (17 keys).
- Neither contains `accepted_address`, `place_id`, coordinates, the customer's id or email. Objects are built only by the two private builders.

### Allowed transitions
`pending → accepted | declined` (seller, `respond_to_request`); `pending → cancelled` (customer); `pending → expired` (time, cron and `display_status`); `accepted → completed | no_show` (seller, after `table_at`); `arrived_at` set once on an `accepted` row (customer). No undo, no change of an answer.

### Function privileges (CLAUDE.md, §16)
- `supabase/tests/05-seller-onboarding.test.sql`: the `authenticated` allowlist gains `submit_table_request`, `cancel_table_request`, `get_my_table_request`, `mark_arrived`, `list_my_requests` and loses `list_my_pickup_requests`; message "specs 05 to 11"; the test must fail if an old overload is still present.

## Storage
None.

## Edge Functions
None. The "I've arrived" notification is spec 12.

## Components & hooks
All in `src/features/requests/` unless noted. Routes stay thin.
- `hooks/usePagedRequests.ts` (new) — the one shared pager: pull-to-refresh, de-duplication by id, next page by cursor, focus refetch, polling while a pending row is loaded. `useMyRequests` and `useBusinessRequests` become thin wrappers over it. **No third copy.**
- `api.ts` — `submitTableRequest`, `cancelTableRequest`, `getMyTableRequest`, `markArrived`, `listMyRequests(cursor)`; `respondToRequest` and `markRequestOutcome` take `kind`; map the new error codes in `mapRequestError`.
- `schema.ts` — strict `tableRequestSchema` (customer and seller), list/get schemas as a discriminated union on `kind`, `kind` required on pickup schemas, cursors are text on both lists, table form schema (`react-hook-form` + zod).
- `kind.ts` — `RequestKind = 'pickup' | 'table'`; `RequestKindLabel.tsx` shows "Pickup" / "Table".
- `declineReasons.ts` — one reason list per kind (table: Fully booked, Closed at that time, Too busy right now, Time doesn't work, Other); `declineReasonLabel(kind, code, note)`.
- `messages.ts` / `sellerMessages.ts` — table wording ("Table request waiting for the restaurant", "Customer has arrived", arrived errors); a pending request is never worded as accepted or confirmed.
- `components/TableRequestForm.tsx` (day, time, party stepper, note, Send bar), `components/PartySizeStepper.tsx` (reuses `QuantityStepper`), table time picker reusing the `PickupTimePicker` logic with the table window (30 minutes to 30 days), `components/ArrivedButton.tsx` (shown on an accepted request inside the arrival window by the server's `server_now`; one tap; disabled and "Sending…" while running; becomes "You've told the restaurant you arrived").
- `components/RequestRow.tsx`, `SellerRequestRow.tsx`, `RequestDetail.tsx`, `RequestDetailScreen.tsx`, `SellerRequestDetailScreen.tsx`, `RequestActions.tsx`, `RespondDialog.tsx`, `DeclineReasonPicker.tsx`, `MyRequestsList.tsx`, `RequestsTabScreen.tsx` (change) — render by kind, pass kind to reason picker and actions.
- `hooks/useSubmitTableRequest.ts`, `useCancelTableRequest.ts` (records the request as seen at `cancelled` in `statusMemory`: own cancel raises no badge, 10b Decision 18), `useMarkArrived.ts`, `useTableRequest.ts`; `useRespondToRequest` / `useMarkRequestOutcome` pass `kind` and keep invalidation and error-refetch rules; `useWaitingCount` / `useRequestsBadge` / `useCustomerUpdates` need no logic change (the server counts both kinds; status memory keys stay request ids).
- `src/features/map/components/RestaurantSheet.tsx` / `SheetActions.tsx` — Request table button.
- Reused as is: `StatusChip`, `RequestStatusChip`, `RequestsSwitch`, `InboxFilter`, `Screen`, `EmptyState`, `ErrorState`, `Skeleton`, `statusMemory`, `formatDateTime`, `pagedServer` fixtures.

## Files to create
**PR 1**
- `supabase/migrations/<timestamp>_table_requests.sql`
- `supabase/tests/11-table-requests.test.sql`

**PR 2**
- `app/requests/table/new.tsx`
- `src/features/requests/hooks/{usePagedRequests,useSubmitTableRequest,useCancelTableRequest,useMarkArrived,useTableRequest}.ts`
- `src/features/requests/components/{TableRequestForm,PartySizeStepper,ArrivedButton}.tsx`
- `src/features/requests/__tests__/*` (new tests listed in the Test plan)

## Files to change
**PR 1**
- `src/types/database.ts` — regenerate with `npm run db:types`
- `.claude/skills/supabase-patterns/SKILL.md` — table requests, `kind`, merged lists, `mark_arrived`
- `docs/product/v1.md` §14 / §16 — contract note, and the closings in PR 2
- **Forced edits to older pgTAP tests (approved by Archan):**
  - `supabase/tests/05-seller-onboarding.test.sql` — allowlist names and message
  - `supabase/tests/09-pickup-requests.test.sql` — customer key set gains `kind`; calls to `list_my_pickup_requests` move to `list_my_requests`
  - `supabase/tests/10-seller-request-inbox.test.sql` — seller key set gains `kind`; `respond_to_request` / `mark_request_outcome` call sites only if the new signature needs it
  - `supabase/tests/10b-requests-answer-notes.test.sql` — key sets gain `kind`; the single-overload check covers the new signatures

**PR 2**
- `src/features/requests/{api,schema,kind,declineReasons,messages,sellerMessages}.ts`
- `src/features/requests/hooks/{useMyRequests,useBusinessRequests,useRespondToRequest,useMarkRequestOutcome,keys,invalidateSellerRequests}.ts`
- `src/features/requests/components/{RequestsTabScreen,MyRequestsList,RequestRow,SellerRequestRow,RequestDetail,RequestDetailScreen,SellerRequestDetailScreen,RequestActions,RespondDialog,DeclineReasonPicker,RequestKindLabel}.tsx`
- `app/requests/[id].tsx`, `app/seller/requests/[id].tsx`, `app/requests/_layout.tsx` (new route)
- `src/features/map/components/{RestaurantSheet,SheetActions}.tsx`
- `scripts/seed/requests.ts`, `scripts/seed/requestsData.ts` — table requests in each status, one accepted inside the arrival window, one arrived
- `docs/product/v1.md` — §4, §16 (close the three hand-offs), changelog
- `CLAUDE.md` — status table
- **Forced edits to older app tests (approved by Archan):** the shared request fixtures gain `kind: 'pickup'` (prefer editing `__fixtures__` only); `api.test.ts` / `schema.test.ts` / `sellerApi.test.ts` only where they pin the old list call or cursor type; `MyRequestsPagination.test.tsx` only if it pins the timestamp cursor; row-label assertions in `SellerRequestRow.test.tsx` and the customer row tests (the kind now starts the label). **Anything beyond this list: stop and ask.**

## New dependencies
No new dependencies.

## Rules for implementation
- RLS on every new table + pgTAP test
- Supabase calls only in `src/features/requests/api.ts` (map sheet gets the restaurant flag from data it already loads)
- Theme tokens only, no hardcoded colors/sizes
- Loading / empty / error / success states on every screen
- Accessibility labels on every touchable
Feature-specific:
- **Server decides.** Status, expiry, the table-time window, the arrival window, arrived-once, reasons and notes are checked or set in SQL by the server clock; the app only mirrors them. The phone clock may only schedule refetches. A modified client is refused (pgTAP).
- **Migrations are append-only.** Old signatures are dropped in the new migration, never edited in old ones. `npm run db:types` after the migration.
- **Contract change is explicit:** `kind` on every object; the strict zod schemas, fixtures, pgTAP key sets and function allowlists change together.
- **Double tap.** Submit uses the idempotency key and a disabled Send; cancel, accept, decline, completed, no-show and arrived are disabled while running; a second call returns `invalid_transition` / `already_arrived` and the app refetches and shows the real status.
- **Stale lists.** Submit, cancel, answer, outcome and arrived invalidate both lists, the detail, the waiting count and the badge; error paths refetch.
- **Never show a pending request as confirmed**, including row labels, badge wording and screen-reader strings.
- **Time.** Stored UTC, shown in the phone's zone with explicit-zone tests; status words come from `display_status`.
- **No third copy of the paging code;** `usePagedRequests` is extracted first with the existing paging tests green and unedited.
- **Keyboard and large text.** The form and dialogs use `KeyboardAvoidingView` / scroll into view; titles capped (`maxFontSizeMultiplier` 1.6), body text wraps, no fixed heights.
- **Privacy.** Notes are plain text, never logged, not put into notification text before spec 12 reviews it. No location is read or sent for arrival.
- **Faithful fakes.** Use the existing `jest.setup` fakes, `pagedServer` fixtures and the official AsyncStorage mock; own `QueryClient` per test file (`retry: false`, `gcTime: 0`), cleared in `afterEach`; every RNTL v14 call awaited.
- **No raw invisible characters** in the spec or the migration; escaped code points only.
- **Do not edit older tests beyond the approved list.**
- Stage gates with a commit after each (stop and commit after each gate; no edits before "approved").
  - PR 1: **A** migration + types → **B** pgTAP + approved pgTAP edits + deliberate breaks 1 to 8 → **C** docs, review, CI, merge.
  - PR 2: **D** shared pager + keyset cursor on Sent + `kind` in schemas and fixtures, no behaviour change → **E** table api, hooks, form, Request table button, customer detail → **F** Requests tab mixed rows, seller side, arrived button, seed, app breaks → **G** manual run, review, ship.

## Known pitfalls (checklist)
Reused from specs 09, 10, 10b and the "Lessons from spec 07".
- [ ] **Double tap** on Send, Cancel, Accept, Decline, Completed, No-show, I've arrived: one call sent (jest); a second pgTAP call returns the stable error.
- [ ] **Stale lists** after every action, including `not_found` / `invalid_transition` errors (jest).
- [ ] **Wrong phone clock.** Arrival button visibility and "Expired" come from `server_now` / `display_status`; test with a skewed phone clock.
- [ ] **`mark_arrived` check order:** `not_found`, `invalid_transition`, `already_arrived`, `arrival_window` (pgTAP).
- [ ] **Arrival window edges:** exactly -2 hours and +4 hours are allowed, one second outside is `arrival_window` (pgTAP).
- [ ] **Keyset ties:** 123 rows with 120 sharing one timestamp, mixed kinds on the tie, and exactly 100 rows: no skip, repeat or empty last page (pgTAP and jest).
- [ ] **Two overloads.** After the migration exactly one `respond_to_request` and one `mark_request_outcome` exist, and `list_my_pickup_requests` is gone (pgTAP via `pg_proc`).
- [ ] **Leftover seed data breaks pgTAP counts:** the new pgTAP file creates its own users, businesses and requests with fixed ids, counts only its own rows, in a rolled-back transaction.
- [ ] **Large text clipping** on the form, stepper, arrived button, rows (kind first in the label).
- [ ] **Test QueryClient cleanup** and AsyncStorage mock reset per test.
- [ ] **Own cancel raises no badge** for table requests too, including on retry and refetch.
- [ ] **Old tests untouched** except the approved list (`git diff --stat` on test files in the review).

## Out of scope
- Push and email notifications for any request event, including the "I've arrived" notification (spec 12); the client-only customer badge stays until spec 12.
- Cancel after acceptance (needs a seller notification, spec 12; recorded in §16).
- Opening hours, seat or capacity management, table numbers, deposits, auto-accept, per-day caps.
- A business time zone. Table time uses the phone's time zone; a business time zone is needed before launch (a customer abroad could book in the wrong zone). Pickup has the same gap. Recorded in §16.
- Chat between seller and customer, counter-offers, editing or undoing a request or an answer (v1 §3).
- Table requests to homemade sellers (§9: restaurants only).
- Location tracking or any location use for "I've arrived" (§3, §9).
- Payments, delivery (v1 §3).
- Reports, legal text, promotions (17, 18, 16); the Offers tab (16).
- A server-side "seen" flag (spec 12).
- Customer-facing or seller-facing no-show tracking across requests (v1 §15).

## Definition of done
- [ ] `submit_table_request` creates a `pending` row for a valid request; the same idempotency key returns the same row; it refuses (stable codes, nothing written): a homemade business, a restaurant with `accepts_table_requests = false`, an unlisted business, the caller's own business, party size 0 or 21, a time earlier than 30 minutes ahead or later than 30 days ahead, a note over 300 characters or with hidden characters, a 6th pending table request, a 2nd pending to the same business, an 11th in an hour (pgTAP, boundaries 1, 20, 21; 29/30 minutes; 30 days).
- [ ] `expires_at` is `least(created_at + 24 hours, table_at)`; the pickup expiry helper is unchanged; the extended cron function expires table requests and leaves pickup behaviour as before (pgTAP).
- [ ] Pickup and table caps and rate limits are independent: filling one kind's limit does not block the other (pgTAP).
- [ ] **An outsider cannot** read, answer, cancel, mark arrived on, mark completed / no-show, or list another customer's or business's table request; another seller and another customer get `not_found` identical to an unknown id; `anon` and `public` cannot execute any of the functions; no role has any privilege on `table_requests` or its columns (pgTAP).
- [ ] `respond_to_request` for `table`: a decline without a reason → `decline_reason_required`; an unknown or pickup-only code → `invalid_input`; `other` without text → `decline_reason_required`; a fixed reason with a note → `invalid_input`; a 201-character or hidden-character note → `invalid_text`; each of the five reasons stores correctly; accept stores the optional note; the row stays `pending` on each refusal (pgTAP).
- [ ] Transitions: only the legal ones; a second answer → `invalid_transition`; customer cancel only while `pending`; Completed / No-show only on an `accepted` table request after `table_at` (pgTAP, including a respond-versus-cancel race).
- [ ] `mark_arrived` works for the customer on an accepted request from `table_at - 2 hours` to `table_at + 4 hours` inclusive, sets `arrived_at` from the server clock, and the seller object then shows it; it is refused outside the window (`arrival_window`), a second time (`already_arrived`), on a non-accepted request (`invalid_transition`), and for anyone but the customer (`not_found`); the checks run in the order `not_found`, `invalid_transition`, `already_arrived`, `arrival_window`, so a second tap after the window has closed returns `already_arrived`; no location or client time input exists (pgTAP).
- [ ] `list_my_requests` and `list_business_requests` merge both kinds newest first on `(created_at, id)` with a text cursor, 50 per page; 123 rows (120 sharing one timestamp, mixed kinds) and exactly 100 rows paginate with no skip, repeat or empty last page; the Waiting filter and `count_waiting_requests` count table requests (pgTAP).
- [ ] Request objects have exactly the specified keys including `kind` (pickup 16 / 18, table 15 / 17) and none of the forbidden keys; exactly one `respond_to_request`, one `mark_request_outcome`, no `list_my_pickup_requests` (pgTAP key-set and `pg_proc` tests).
- [ ] A pickup call without `p_kind` (old app build) still works (pgTAP).
- [ ] Request table shows only on a restaurant that accepts tables, never on homemade or a non-accepting restaurant; the form validates party size 1 to 20 and the time window, shows the picked time with its zone name (for example 7:00 pm EDT), and sends once on a double tap (jest, with an explicit-zone test).
- [ ] Sent and Received show pickup and table rows mixed; each row shows the kind and speaks it at the start of its label; Waiting / All, 50 per page, loading, empty, error-with-retry and success states keep working (jest).
- [ ] Table detail (customer and seller) shows the table time with its zone name (explicit-zone jest test, for example a fixed UTC instant rendered as 7:00 pm EDT in America/Toronto and as the matching time in another zone), party size, the status as a word, "Declined: <reason>" and the seller's note; a pending request never reads as accepted (jest, including screen-reader labels).
- [ ] The seller can accept (optional note), decline (table reason picker, Other needs text), and mark Completed / No-show after the table time, with confirm steps and double-tap protection (jest).
- [ ] I've arrived: the button shows only on an accepted request inside the window by `server_now`, sends once, then reads as done; the seller sees "Customer has arrived"; a skewed phone clock does not change when it shows (jest).
- [ ] Badges and customer updates work for table rows: owner total = waiting (both kinds) + customer updates; first sight is a baseline; own cancel raises nothing; a seller's answer or an expiry does (jest with the AsyncStorage mock).
- [ ] There is one shared paged hook; `useMyRequests` and `useBusinessRequests` are thin wrappers; no third copy (review of the diff); the existing paging tests pass unedited.
- [ ] Specs 07 to 10b tests pass unedited except the approved forced edits; `git diff --stat` on test files matches the list under "Files to change".
- [ ] Every touchable has a label and role, targets ≥ 44 pt, status always a word (jest + iOS Simulator).
- [ ] `npm run lint`, `npm run typecheck`, `npm test` and `npx supabase test db` pass; `src/types/database.ts` is regenerated, not hand-edited.
- [ ] Neither this spec nor the migration contains a raw invisible character: `perl -CSD -ne 'print "$ARGV:$.: $_" if /[\x{00AD}\x{0080}-\x{009F}\x{200B}-\x{200F}\x{202A}-\x{202E}\x{2060}-\x{2069}\x{FEFF}]/' .claude/specs/11-table-requests.md supabase/migrations/<timestamp>_table_requests.sql` prints nothing (BSD grep on macOS has no `-P`). Before trusting a clean result, prove the command on a scratch file holding one invisible character: it must print that line.

## Test plan
- Database tests (pgTAP) in `supabase/tests/11-table-requests.test.sql`: everything under Definition of done, plus boundaries (party size 1 / 20 / 21; note 1 / 300 / 301 and `response_note` 1 / 200 / 201; each hidden-character class; table time at 29 and 30 minutes and at 30 days; **arrival window at exactly -2 h, -2 h minus one second, +4 h, +4 h plus one second**), one test for the check order (a second tap after the window has closed returns `already_arrived`, not `arrival_window`; a non-accepted row outside the window returns `invalid_transition`; another customer's row returns `not_found`), the respond-versus-cancel race, the `pg_proc` overload and dropped-function checks, no-grant checks, and a rolled-back transaction with its own fixtures.
- Unit/component tests (jest):
  - schemas: strict table and pickup schemas with `kind`, the discriminated list schema, the table form schema.
  - `declineReasons` per kind; `messages` / `sellerMessages`; `api` argument shapes and error mapping (`invalid_table_time`, `invalid_party_size`, `arrival_window`, `already_arrived`).
  - `usePagedRequests` (via the existing wrapper tests, unedited) and mixed-kind lists.
  - explicit-zone test: the same UTC `table_at` renders with the right local time and zone name in two zones on the form and both details.
  - `TableRequestForm`, `PartySizeStepper`, `ArrivedButton`, `RequestActions` / `RespondDialog` / `DeclineReasonPicker` for tables, rows and details for both kinds, the Request table button.
  - `useSubmitTableRequest`, `useCancelTableRequest` (own cancel marks seen), `useMarkArrived`, `useRespondToRequest` / `useMarkRequestOutcome` with `kind`: double tap, invalidation, error refetch.
  - Badges and `statusMemory` with table rows; skewed phone clock for the arrival button and for Expired.
- **Deliberate breaks** (each must turn a named test red, then be reverted):
  1. In SQL, drop the owner filter in `respond_to_request` for `table`: the other-seller test must fail.
  2. In SQL, drop the `accepts_table_requests` check in `submit_table_request`: the non-accepting restaurant test must fail.
  3. In SQL, allow `mark_arrived` a second time: the arrived-once test must fail.
  4. In SQL, allow `mark_arrived` on a non-accepted row: the status test must fail.
  5. In SQL, widen or remove the arrival window (for example allow `table_at - 3 hours` or `table_at + 5 hours`): the window-edge tests must fail.
  6. In SQL, page `list_business_requests` on `created_at` alone: the 120-tied-rows test must fail.
  7. In SQL, leave the old overload of `respond_to_request` or `list_my_pickup_requests` in place: the `pg_proc` test must fail.
  8. In SQL, leave `kind` out of an object: the key-set test must fail.
  9. In the app, enable Send with party size 0: the form test must fail.
  10. In the app, skip "mark seen on own cancel" in `useCancelTableRequest`: the own-cancel badge test must fail.
  11. In the app, base the badge's "changed" test on the phone clock instead of `display_status`: the skewed-clock test must fail.
  12. In the app, show Request table for a homemade or non-accepting restaurant: the button test must fail.
  13. In the app, show the arrived button outside the 2-hours-before to 4-hours-after window (by `server_now`), or by the phone clock: the arrival-window and skewed-clock tests must fail.
- Manual check on device (iOS Simulator first, run by Archan): request a table from an accepting and a non-accepting restaurant; mixed Sent and Received lists; accept with and without a note; decline with each of the five reasons, including Other with and without text; cancel while pending; I've arrived inside and outside the window (move the Simulator clock); Completed and No-show; badges; double tap; keyboard open on the note; largest text size; VoiceOver on the kind label, stepper, arrived button and dialogs; airplane mode then retry; Android later (recorded in §16).

## Decisions
Decisions made by Archan when approving this spec:
1. **A separate `table_requests` table** with RLS on, no policies, no client grants; access by security-definer functions only.
2. **Arrival:** allowed from 2 hours before the table time until 4 hours after it, by the server clock, once only. No calendar day, no time zone, no business time-zone column, no location.
3. **Party size 1 to 20; table time from 30 minutes ahead to 30 days ahead.**
4. **Expiry:** the earlier of (sent time + 24 hours) and the table time, from a new separate helper; the pickup 30-minute helper is untouched; the existing cron job also expires table requests.
5. **Table decline reasons:** `fully_booked` (new), `closed_then`, `too_busy`, `time_not_possible`, `other`; the same note rules as 10b.
6. **Completed and No-show** after the table time, as for pickup.
7. **The kind is spoken at the start of the row label;** the small row-test edits are approved.
8. **Pending cap and rate limit are separate per kind,** with the numbers pickup uses today (5 pending in total, 1 per business, 10 per hour).
9. **Every request object gains `kind`;** all forced test edits listed above are approved; anything beyond that list needs a question first.
10. **Cancel only while pending.** "Cancel after accept needs a seller notification, spec 12" is recorded in §16.
11. **Merged lists on one `(created_at, id)` cursor** for both Sent and Received, and **one shared paged hook** instead of a third copy.
12. **PR 1 drops `list_my_pickup_requests`;** the app on `main` is out of step with the database until PR 2 merges (same as 10b).
13. **`mark_arrived` check order is fixed:** `not_found`, `invalid_transition`, `already_arrived`, `arrival_window`.
14. **Table time is shown with its zone name** (for example 7:00 pm EDT) on the form and details; the phone's zone is used until a business time zone exists (§16, before launch).

## Open questions
None. All nine earlier questions are answered in Decisions 2 to 10; Decisions 13 and 14 came from the spec review.
