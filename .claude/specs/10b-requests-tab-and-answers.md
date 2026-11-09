# Spec 10b: Requests Tab and Answer Notes

**Branch:** `feature/requests-tab-and-answers` (two PRs from this one spec, same pattern as specs 06 to 10)
- PR 1 (backend only: migration, function change, pgTAP, types): `feature/requests-tab-and-answers` (renamed to `feature/requests-tab-and-answers-backend` before its first push)
- PR 2 (the app: Requests tab, switches, badges, decline reason picker, accept note, jest tests): `feature/requests-tab-and-answers-app`, created from `main` after PR 1 is merged.
**Product spec:** `docs/product/v1.md` §3 (out of scope), §4 (Navigation, Final tab bar plan), §8 (Pickup requests), §9 (Table requests, for what must fit later), §12 (notifications, for what is NOT built here), §14 row 10b, §16 (no in-app way into the inbox, paged-list copy, Function privileges)
**Plan mode:** required — adds columns and changes the signature of `respond_to_request` and the shared request object (customer contract change), extends the pgTAP function allowlists, changes navigation (tab bar rules by seller mode), and touches well over ~5 files.
**Status:** 📝 Spec written

## Overview
After this ships, a signed-in user has a **Requests** tab. A customer sees the pickup requests they sent (today's My requests). Anyone who owns a business sees two switches at the top: **Received** (the seller inbox from spec 10) and **Sent** (their own requests as a customer). It opens on Received when seller mode is on and on Sent when it is off, which closes the §16 gap "no in-app way into the inbox when seller mode is off". The tab bar follows seller mode: off shows Restaurants · Homemade · Requests · Profile; on shows Requests · Manage · Profile (the two map tabs are hidden while a seller is working). Offers is added later by spec 16.

A seller who declines must give one reason from a fixed list ("Sold out", "Closed at that time", "Too busy right now", "Can't prepare this order", "Pickup time doesn't work", or "Other" with a short written reason). A seller who accepts may add a short note ("Please bring a bag"). The customer sees "Declined: <reason>" and the seller's note in the list and in the request detail. Badges show what needs attention: for a business owner, waiting requests plus customer updates; for a customer, how many of their requests changed status since they last opened the list.

**Why now:** the seller loop (09, 10) works but is buried on Manage and reachable only in seller mode, and a declined customer is told nothing. Spec 11 (table requests) and spec 12 (push) build on this tab, so the tab and the answer fields come first.

## Depends on
- 02 auth-and-profiles ✅ (`profiles`, session, profile-complete gate)
- 03 navigation-shell ✅ (tab bar, `useIsSeller`, tab and routing tests)
- 05 seller-onboarding ✅ (`businesses`, seller mode switch in Profile, `useMyBusiness`)
- 09 pickup-requests ✅ (`pickup_requests`, customer request object, My requests list, request detail, status chips)
- 10 seller-request-inbox ✅ (`respond_to_request`, `private.pickup_request_json`, seller inbox and detail, `count_waiting_requests`)

## Context to load
- `CLAUDE.md`
- `docs/product/v1.md` §3, §4, §8, §9, §12, §16
- This spec, and `.claude/specs/10-seller-request-inbox.md` ("Request object", "Functions", "Function privileges", Decisions 3, 9, 11, 13, 14, 18, "Known pitfalls") and `.claude/specs/09-pickup-requests.md` (text rules, "Notes for specs 10 and 12")
- `.claude/skills/supabase-patterns/SKILL.md` ("Status transitions", lists rule, "Server-owned values"), `.claude/skills/liketoorder-ui/SKILL.md` (status chips, lists, forms, keyboard), `.claude/skills/map-markers/SKILL.md` ("Lessons from spec 07" only, for the tests/taps/large-text lessons)
- `supabase/migrations/20261107181009_pickup_requests.sql` (table, text check regex, `c_ctrl`) and `supabase/migrations/20261108225156_seller_request_inbox.sql` (`private.pickup_request_json`, `respond_to_request`, `list_business_requests`, `get_business_request`, customer functions)
- `supabase/tests/05-seller-onboarding.test.sql` (function allowlists), `supabase/tests/09-pickup-requests.test.sql` (request-key comparison, fixtures), `supabase/tests/10-seller-request-inbox.test.sql`
- `app/(tabs)/_layout.tsx`, `app/(tabs)/manage.tsx`, `app/(tabs)/profile.tsx`, `app/requests/{_layout,index,[id],new}.tsx`, `app/seller/_layout.tsx`, `app/seller/requests/{index,[id]}.tsx`
- `src/features/navigation/{hooks/useIsSeller.ts,components/*,__tests__/TabsLayout.test.tsx}`, `src/features/auth/routeAccess.ts` (+ its test), `src/features/sellers/{sellerRoutes.ts,hooks/useMyBusiness.ts,components/ManageBusinessScreen.tsx}`
- `src/features/profile/components/ProfileScreen.tsx`, `src/features/profile/__tests__/MyRequestsRow.test.tsx`
- `src/features/requests/{api,schema,status,messages,sellerMessages,summary,time}.ts`, `src/features/requests/hooks/{keys,useMyRequests,useBusinessRequests,useWaitingCount,useRespondToRequest,invalidateSellerRequests}.ts`, `src/features/requests/components/{MyRequestsScreen,RequestRow,RequestDetail,RequestDetailScreen,SellerRequestsScreen,SellerRequestRow,SellerRequestDetailScreen,RequestActions,InboxFilter,RequestStatusChip}.tsx`, `src/features/requests/__fixtures__/*`
- `src/components/ui/index.ts`
- `scripts/seed/requests.ts`, `scripts/seed/requestsData.ts`

## User stories
- As a signed-in user, I can open a Requests tab and see my requests, so that I do not have to go through Profile.
- As a business owner, I can switch between Received and Sent at the top of Requests, so that I can answer customers and follow my own orders in one place.
- As a business owner with seller mode off, I can still reach the requests waiting for me, so that I never miss an answer I owe.
- As a seller, when I decline I must pick a reason, so that the customer knows why.
- As a seller, when I accept I can add a short note (for example "Please bring a bag").
- As a customer, I see "Declined: Sold out" (or the seller's own words for Other) and the seller's accept note, in the list and in the request detail.
- As a business owner, I see on the Requests tab, on Received and on Sent how many things need me.
- As a customer, I see how many of my requests changed status since I last opened the list.
- As a seller in seller mode, the two map tabs are out of my way.
- As an outsider, I cannot read or write another business's reason or note.
- As a screen-reader or large-text user, the reason picker, the note box and the switches work with a label, a role and a selected state spoken as words.

## Screens & routes
- `app/(tabs)/requests.tsx` (new) — the **Requests** tab. Signed-in only: hidden for guests (Decision 13). Thin screen that renders `RequestsTabScreen`.
  - A customer without a business: the **Sent** list only (today's My requests content, no switches).
  - A business owner (a `businesses` row exists, whatever the seller mode): two switches at the top, **Received** and **Sent**, each with its own number (Decision 8). Default **Received** when seller mode is on, **Sent** when off (Decision 6). The switch is local UI state and resets on a cold start. A switch change never loses the other list's scroll or loaded pages (both lists stay mounted or their queries stay cached).
  - Received = the spec 10 inbox (Waiting / All filter, 50 per page, newest first), embedded in the tab. Sent = the spec 09 My requests list (50 per page).
  - Each row carries a **kind** (today only "Pickup"; spec 11 adds "Table"), shown as a small word label on the row and included in the row accessibility label (Decision 9).
- `app/(tabs)/_layout.tsx` (change) — tab rules, see "Tab bar rules".
- `app/requests/index.tsx` (change) — kept as a route so existing links keep working; it renders the same Sent list as the tab, with no redirect (Decision 10).
- `app/requests/[id].tsx` (change) — customer request detail now shows the seller's answer: "Declined: <reason>" and "Seller's note: <note>".
- `app/seller/requests/[id].tsx` (change) — seller request detail: Decline opens the reason picker, Accept offers the optional note.
- `app/seller/requests/index.tsx` (change) — kept so existing links and the Manage row keep working; renders the same Received list (Decision 10). The Requests row on Manage Business stays (Decision 14).
- `app/(tabs)/profile.tsx` / `ProfileScreen` (change) — the "My requests" row is removed (Decision 14).

### Tab bar rules
| State | Tabs shown |
|---|---|
| Guest (signed out) | Restaurants · Homemade · Profile (Requests hidden; unchanged from today) |
| Signed in, seller mode **off** | Restaurants · Homemade · **Requests** · Profile |
| Signed in, seller mode **on** | **Requests** · **Manage** · Profile (Restaurants and Homemade hidden) |
Hiding is UX only; every request stays protected by the database. The hidden map tabs stay reachable by direct link only until they are protected in the same `Tabs.Protected` way as Manage (`redirectTo` the Requests tab for a seller). The first tab a seller lands on after sign-in or after switching seller mode on is Requests (`routeAccess` redirect target, see "Files to change").
Switching seller mode in Profile changes the tab bar at once (the profile query is already the source, `useIsSeller`).

### Reason picker and note (seller detail)
- **Accept** (confirm step stays): the dialog gains an optional multiline **Note for the customer** box, 0 to 200 characters, with a live counter in words ("12 of 200"). Empty is allowed. Homemade accept still says the exact address will be shown.
- **Decline** (confirm step stays): the dialog becomes a **reason picker** — six radio rows (Sold out / Closed at that time / Too busy right now / Can't prepare this order / Pickup time doesn't work / Other), each ≥ 44 pt, the selected row spoken as "selected" and shown with a check mark, never colour alone. **Other** reveals a required text box, 1 to 200 characters. The Decline confirm button stays disabled with a spoken reason ("Choose a reason first") until a reason is chosen (and the text is filled for Other). Nothing is preselected.
- Both dialogs scroll, handle the keyboard (the focused field scrolls into view, the buttons stay reachable above the keyboard, the dialog does not lose typed text on a rotation or a refetch), and work at the largest text size. Disabled and "Sending…" while the mutation runs (double tap protection stays).

States (4 states on every screen):
- **Loading:** skeleton rows per list; the switches render at once, a switch's number shows a placeholder until loaded.
- **Empty:** Sent: "No requests yet. Requests you send will show up here." Received: as spec 10 (Waiting: "Nothing waiting for you right now."). Each list has its own empty state.
- **Error (with retry):** per list, with Retry, and a failed badge count shows no number (never a wrong number).
- **Success:** lists, chips as words, "Declined: <reason>", the seller's note.

## Database changes
One migration, `npx supabase migration new requests_answer_notes`. Never edit an existing migration (spec 10's is on `main`). Sketch only; the plan checks names against the current migrations.

```sql
-- Why a request was declined, and an optional note on an answer. Server-written by respond_to_request.
alter table public.pickup_requests
  add column decline_reason text
    check (decline_reason is null or decline_reason in
      ('sold_out','closed_then','too_busy','cannot_prepare','time_not_possible','other')),
  add column response_note text
    check (response_note is null or (char_length(response_note) between 1 and 200
           and response_note = btrim(response_note)
           and response_note !~ '[\x00-\x09\x0B-\x1F\u007F-\u009F\u200B-\u200D\u202A-\u202E\u2066-\u2069\uFEFF]'));
  -- table-level checks (names in the plan):
  --   decline_reason is null or status in ('declined')            -- a reason only on declined rows
  --   response_note  is null or status in ('accepted','declined','completed','no_show')
  --                                                                -- a note only on answered rows (see below)
  --   decline_reason = 'other' implies response_note is not null  -- Other always carries its text
  --   status = 'declined' and response_note is not null implies decline_reason is not distinct from 'other'
  --                                                                -- a fixed reason never carries a note
  --   status = 'declined' implies decline_reason is not null, ONLY for rows answered after this migration
  --   (older declined rows have no reason: the check is `status <> 'declined' or decline_reason is not null
  --   or responded_at < <migration time>` or enforced by the function only; the plan decides, Decision 3)
```

How the two fields map: **Other's written reason is stored in `response_note`** and `decline_reason = 'other'`; for the fixed reasons `response_note` must be null (Decision 15: the function refuses a note on a fixed reason, and the table enforces it through two checks: a reason only on a declined row, and a declined row with a note must be `other`; there is no separate fixed-reason check, it would repeat those two). So: declined + fixed reason → no note; declined + other → note required; accepted → note optional. The hidden-character regex is the same `c_ctrl` pattern as `note` and `order_text` (spec 09), written once in a comment and reused.

A note stays on a row after `accepted → completed | no_show`, so `response_note` is allowed on those statuses; `decline_reason` is only on `declined`.

### RLS and grants
- No new table. `pickup_requests` keeps **RLS on, no policies, no client grants**. The new columns inherit "no grants"; pgTAP asserts no role in `anon` / `authenticated` has any privilege on `decline_reason` or `response_note`, and that the business owner, the customer and an outsider cannot `select`, `insert`, `update` or `delete` them directly.
- The reason and the note reach the app only through the request objects below.

### Functions
| Function | Who may execute | What changes |
|---|---|---|
| `respond_to_request(p_request_id uuid, p_decision text, p_decline_reason text default null, p_note text default null) returns jsonb` | `authenticated` | Server validates everything. `accepted`: `p_decline_reason` must be null (else `invalid_input`), `p_note` optional (trimmed with `btrim(…, E' \n')`, empty → null, > 200 characters → `invalid_text`, hidden characters → `invalid_text`). `declined`: `p_decline_reason` required and one of the six codes, else **`decline_reason_required`** (null / empty) or `invalid_input` (unknown code); `other` requires a note of 1 to 200 characters, else `decline_reason_required`; a fixed reason with a note is refused with `invalid_input` (Open question 3). Everything else as spec 10 (owner-derived business, row lock first, `pending` and unexpired, else `invalid_transition`, address snapshot on a homemade accept, no `is_listed` / freshness / seller-mode check). |
| `private.pickup_request_json(...)` | none directly | Adds `decline_reason` and `response_note` (see "Request object"). |
| `list_my_pickup_requests`, `get_my_pickup_request`, `submit_pickup_request`, `cancel_pickup_request`, `list_business_requests`, `get_business_request` | unchanged | Re-created only if the builder call needs it; their logic does not change. |

**The old two-argument `respond_to_request(uuid, text)` must be dropped in the same migration** (`drop function`, then create the four-argument one), because adding parameters with `create or replace` would leave two overloads. Re-run `revoke execute … from public, anon, authenticated` and `grant execute … to authenticated` for the new signature. A call from an old app build that sends only two arguments still works for `accepted` (both new parameters default to null) and gets `decline_reason_required` for `declined`. Old app builds therefore see a stable error on decline; the app message for an unknown code stays generic (Decision 12).

Error codes for `respond_to_request` after this migration: `not_signed_in`, `invalid_input`, `invalid_text`, `decline_reason_required`, `not_found`, `invalid_transition`. The app maps the two new codes in `mapRequestError`.

### Request object
**Contract change (explicit):** both objects gain two keys, `decline_reason` and `response_note`, always present, `null` when not set.
- **Customer object** (`submit_pickup_request`, `list_my_pickup_requests`, `get_my_pickup_request`, `cancel_pickup_request`): was the 13 spec 09 keys exactly (`id`, `business_id`, `business_name`, `business_type`, `status`, `display_status`, `pickup_at`, `items`, `order_text`, `note`, `currency_code`, `expires_at`, `created_at`); now those plus `decline_reason` and `response_note`. The customer sees why a request was declined and the seller's note. This reverses spec 10's "customer object keeps its current keys exactly" on purpose, and only for these two keys.
- **Seller object** (`respond_to_request`, `list_business_requests`, `get_business_request`): the customer keys plus `customer_name` and `responded_at` (spec 10) plus the same two keys.
- Neither object contains `accepted_address`, `place_id`, coordinates, the customer's id or email. The seller's note and reason are the seller's own words about the customer's own request, so they are shown to that customer only (never to another customer, never in a map response).
- Both objects are built by the one `private.pickup_request_json`; the change is made in that helper only, in the new migration (re-create the helper and the functions that wrap it; a new function body, not an edit of an old migration).
- Updated together, in PR 1 and PR 2: the pgTAP key-set tests (spec 09's request-key comparison, spec 10's seller-object test), the strict zod `pickupRequestSchema` and `sellerRequestSchema` (`.strict()`, the two keys required and nullable), the function allowlists, and the hand-written jest fixtures.

### Allowed transitions
Unchanged from spec 10. `pending → accepted | declined` (seller, `respond_to_request`) now also writes the reason / note; everything else as before. A reason or note can never be changed after the answer (no update path, no undo, spec 10 Decision 14).

### Function privileges (CLAUDE.md "Function privileges", §16)
- `supabase/tests/05-seller-onboarding.test.sql`: the `authenticated` list stays the same names (the new signature replaces the old one under the same name); the test must fail if the old two-argument overload is still present. Message updated to "specs 05 to 10b".
- Every re-created function keeps `security definer`, `set search_path = ''`, and the revoke / grant pair.

## Storage
None.

## Edge Functions
None. The customer badge is client-only (Decision 7); push for answers is spec 12.

## Components & hooks
All in `src/features/requests/` unless noted. Routes stay thin.
- `api.ts` — `respondToRequest(requestId, decision, { declineReason, note })`; map `decline_reason_required` and `invalid_text` in `RequestAppError` / `mapRequestError`. No other new call (the badge needs none).
- `schema.ts` — `declineReasonSchema` (enum of the six codes), `.strict()` customer and seller schemas with the two new keys, the respond-input zod schema used by the form (`react-hook-form` + zod: Other requires 1 to 200 characters; note 0 to 200).
- `declineReasons.ts` — one place for codes, labels and the order shown in the picker ("Sold out", "Closed at that time", "Too busy right now", "Can't prepare this order", "Pickup time doesn't work", "Other"); `declineReasonLabel(code, note)` used by both sides.
- `messages.ts` / `sellerMessages.ts` — "Declined: <reason>", "Seller's note: <note>", the picker and note texts, and the new error messages, in one place. A pending request is never worded as accepted or confirmed.
- `components/RequestsTabScreen.tsx` — the tab body: decides customer-only vs switches, owns the local switch state and default.
- `components/RequestsSwitch.tsx` — the Received / Sent control (radio-style, selected state spoken, each target ≥ 44 pt, number shown as text and in the label: "Received, 3 need you, selected").
- `components/DeclineReasonPicker.tsx` — six radio rows, the Other text box, validation messages.
- `components/AcceptNoteField.tsx` — optional note box with counter.
- `components/RequestActions.tsx` (change) — Accept and Decline dialogs use the note field / reason picker; confirm disabled until valid; double tap protection kept.
- `components/RequestKindLabel.tsx` — the small "Pickup" label (spec 11 adds "Table"); row components take the kind from the row.
- `components/SellerRequestRow.tsx`, `RequestRow.tsx`, `RequestDetail.tsx`, `SellerRequestDetailScreen.tsx` (change) — show the reason and note.
- `hooks/useRespondToRequest.ts` (change) — passes reason and note; same invalidation and error-refetch rules; a `decline_reason_required` / `invalid_text` error keeps the dialog open with the typed text.
- `hooks/useRequestsBadge.ts` — the number on the Requests tab (Decision 8): owner = waiting count (`useWaitingCount`, spec 10) + customer updates; customer = customer updates.
- `hooks/useCustomerUpdates.ts` and `statusMemory.ts` — the client-only memory (Decision 7): per request id, the last status the phone saw; `markSeen(list)` on opening Sent; `changedCount(list)`. Persisted with `@react-native-async-storage/async-storage` (already a dependency, per `TabsLayout.test.tsx`), keyed per signed-in user id and cleared on sign-out; capped (for example the most recent 200 ids) so it cannot grow without bound.
- `hooks/keys.ts` (change) — nothing the badge needs beyond existing keys.
- `src/features/navigation/hooks/useTabVisibility.ts` (or inside `useIsSeller`) — the one place that says which tabs show for guest / customer / seller mode.
- `src/features/navigation/components/TabBadge.tsx` — badge on the Requests tab, spoken in the tab's accessibility label ("Requests tab, 3 need your attention"); a count over 99 shows "99+"; a zero or unknown count shows nothing.
- Reused as is: `StatusChip`, `RequestStatusChip`, `Screen`, `NavRow`, `EmptyState`, `ErrorState`, `Skeleton`, `InboxFilter`, `formatDateTime`, `formatPrice`, `pagedServer` fixtures.

## Files to create
**PR 1**
- `supabase/migrations/<timestamp>_requests_answer_notes.sql`
- `supabase/tests/10b-requests-answer-notes.test.sql`

**PR 2**
- `app/(tabs)/requests.tsx`
- `src/features/requests/declineReasons.ts`
- `src/features/requests/statusMemory.ts`
- `src/features/requests/hooks/{useRequestsBadge,useCustomerUpdates}.ts`
- `src/features/requests/components/{RequestsTabScreen,RequestsSwitch,DeclineReasonPicker,AcceptNoteField,RequestKindLabel}.tsx`
- `src/features/navigation/hooks/useTabVisibility.ts`, `src/features/navigation/components/TabBadge.tsx`
- `src/features/requests/__tests__/*` and `src/features/navigation/__tests__/*` (new tests listed in the Test plan)

## Files to change
**PR 1**
- `supabase/tests/05-seller-onboarding.test.sql` — function allowlist message and the "no old overload" assertion
- `supabase/tests/09-pickup-requests.test.sql` — only the customer request-key comparison (two new keys) and any hard-coded key list; its other checks pass unchanged
- `supabase/tests/10-seller-request-inbox.test.sql` — only the seller request-key comparison and the `respond_to_request` call sites that need the new argument list; other checks pass unchanged
- `src/types/database.ts` — regenerate with `npm run db:types`
- `.claude/skills/supabase-patterns/SKILL.md` — document the four-argument `respond_to_request`, the two columns and the object contract
- `docs/product/v1.md` §14 / §16 — see PR 2 for the app-side entries; PR 1 only adds the contract note

**PR 2** (forced edits to older tests are listed here on purpose; no other spec 07 to 10 test may be edited)
- `app/(tabs)/_layout.tsx` — tab rules; `Tabs.Protected` guards for the map tabs
- `src/features/auth/routeAccess.ts` — the landing tab by seller mode (see below) and the new `/requests` tab path in the signed-in-only set
- `src/features/auth/__tests__/routeAccess.test.ts` — **forced**: adds cases for the Requests tab path; existing cases unchanged
- `src/features/navigation/__tests__/TabsLayout.test.tsx` — **forced, only these rules:** (1) seller mode off now shows Requests between Homemade and Profile for a signed-in user; (2) seller mode on now shows Requests · Manage · Profile and hides Restaurants and Homemade; (3) the guest tab bar is unchanged (Decision 13); (4) where a test asserted "Manage is the 4th tab" or the exact tab order / count, it asserts the new order. Nothing else in that file changes.
- `src/features/profile/__tests__/MyRequestsRow.test.tsx` — **deleted** with the Profile row (Decision 14); the Profile screen test keeps passing without it
- `src/features/profile/components/ProfileScreen.tsx` — remove the My requests row (Decision 14)
- `src/features/requests/{api,schema}.ts`, `messages.ts`, `sellerMessages.ts`
- `src/features/requests/__fixtures__/*` and the existing request test files that build a request object by hand (`schema.test.ts`, `api.test.ts`, `MyRequestsScreen.test.tsx`, `SellerRequestDetailScreen.test.tsx`, `requestQueries.test.tsx`, `useSellerActions.test.tsx`) — **forced**: only to add `decline_reason: null, response_note: null` to hand-written request objects (the strict schema now requires the keys), and the `respondToRequest` call shape in `api.test.ts` / `useSellerActions.test.tsx`. Assertions stay as they are. Prefer fixing the shared fixtures so the number of edited test files is smallest.
- `src/features/requests/components/{RequestActions,RequestDetail,RequestRow,SellerRequestRow,SellerRequestDetailScreen,SellerRequestsScreen,MyRequestsScreen}.tsx`, `hooks/useRespondToRequest.ts`
- `app/requests/index.tsx`, `app/requests/[id].tsx`, `app/seller/requests/index.tsx`, `app/seller/_layout.tsx` (+ `sellerRoutes.ts` and its test only if a key changes; none planned)
- `src/features/sellers/components/ManageBusinessScreen.tsx` — the Requests row unchanged (Decision 14), so its test is unchanged
- `scripts/seed/requests.ts`, `scripts/seed/requestsData.ts` — add seeded declined rows with each reason and an accepted row with a note; a business owner who is also a customer with sent requests, to try both switches
- `docs/product/v1.md` — §4 "Current" line and the Final tab bar plan (Requests shipped, Offers still to come), §16 close "No in-app way into the seller inbox when seller mode is off", and add the carried-forward items from "Out of scope" below
- `CLAUDE.md` — status table (and the tab bar plan note)

## New dependencies
No new dependencies. (`@react-native-async-storage/async-storage` is already installed; if the plan finds it is not a direct dependency, that is reported to Archan before any install, per CLAUDE.md.)

## Rules for implementation
- RLS on every new table + pgTAP test (no new table; `pickup_requests` stays closed, tested for the new columns)
- Supabase calls only in `src/features/requests/api.ts`
- Theme tokens only, no hardcoded colors/sizes
- Loading / empty / error / success states on every screen
- Accessibility labels on every touchable
Feature-specific:
- **Server decides and validates.** Reason, note, status, `responded_at` and all times are checked or set in SQL. The app's validation is only a convenience; a modified client sending a decline without a reason, an unknown code, a note on a fixed reason, hidden characters or a 201-character note is refused by the function (pgTAP).
- **Migrations are append-only;** the old two-argument function is dropped in the new migration, never edited in the old one. `npm run db:types` after the migration.
- **Customer object contract change is explicit** (this spec, "Request object"); the strict zod schemas, fixtures, pgTAP key sets and function allowlists change together.
- **Never show a pending request as confirmed**, including the new badge wording, tab label and screen-reader strings.
- **The customer badge is client-only.** First sight of a request is the baseline (no badge). A change is "the status I last saw differs from the status now" (using `display_status`, so a pending request that expires counts as a change). Opening the Sent list marks everything seen, clears the number and writes the memory. No backend column, no function, no cron.
- **Own cancel is not an update.** When the customer cancels a request, `useCancelPickupRequest` records that request's new status (`cancelled`) in the status memory as seen, so the badge does not rise for the user's own action (Decision 18). Expiry and the seller's answer still count.
- **Badges never lie.** A count that is loading or failed shows no number rather than a stale or zero-looking one.
- **Kind-ready lists.** Rows carry a `kind` and the list code does not assume pickup-only (spec 11 adds table rows without a rewrite). Do not add table-request code, columns or routes now.
- **Paging code.** The Received and Sent lists keep their existing paged hooks. Do not merge the two copies of the paging code here (spec 11 does that, §16); do not copy a third.
- **Keyboard and large text.** Dialogs with a text field use `KeyboardAvoidingView` / scroll-into-view; test with the largest text size; titles capped (`maxFontSizeMultiplier` 1.6), body text wraps, no fixed heights.
- **Double tap.** Accept, Decline and both confirm buttons are disabled while the mutation runs; a second call returns `invalid_transition` and the app refetches and shows the real status.
- **Privacy.** The note is free text written by the seller: never logged, never in analytics, not put into notification text before spec 12 reviews it. Display it as plain text (no links, no markup).
- Stage gates with a commit after each (stop and commit after each gate; no edits before "approved").
  - PR 1: **A** migration + pgTAP + types → review.
  - PR 2: **B** api, schema, declineReasons, statusMemory, hooks + tests → **C** tab bar, Requests tab, switches, badges + tests → **D** reason picker, accept note, customer display, seed data + tests → manual run.

## Known pitfalls (checklist)
Sources: `.claude/skills/map-markers/SKILL.md` "Lessons from spec 07" (tests, large text, taps) and the spec 09 and 10 pitfall lists, reused here.
- [ ] **Double tap on actions.** Accept, Decline, both confirm buttons disabled while running; one decision sent (jest); a second pgTAP call returns `invalid_transition`.
- [ ] **Stale lists after an answer.** Success and `not_found` / `invalid_transition` both invalidate the inbox, the detail, the waiting count, the customer's list and the badge; the Sent list refetches on focus so a customer sees the reason; polling while a pending row is loaded (jest).
- [ ] **Stale badge.** The Requests tab number follows the waiting count (30 s poll, refetch on focus) and the Sent updates; answering a request lowers the number at once (jest).
- [ ] **Wrong phone clock.** Status words and the badge's "changed" test come from the server's `display_status`; the phone clock only schedules refetches (jest with a skewed clock, including an expiry that changes a pending row to Expired).
- [ ] **Times shown from UTC** in the phone's time zone with explicit-zone tests as in specs 09 and 10 (unchanged code; keep the existing tests green).
- [ ] **Keyboard.** The note box and the Other text box scroll into view and the Confirm button stays reachable with the keyboard open (jest where possible: layout-independent assertions; the rest in the manual run on the iOS Simulator).
- [ ] **Large text clipping.** Picker rows wrap, are ≥ 44 pt, and the Confirm button is reachable at the largest iOS size; the switches and the tab label do not clip (`TAB_LABEL_MAX_FONT_MULTIPLIER` kept).
- [ ] **Test QueryClient cleanup.** Own `QueryClient` per file, `retry: false`, `gcTime: 0`, cleared and `cleanup` in `afterEach`; fake timers restored; every RNTL v14 call awaited; AsyncStorage mock reset per test.
- [ ] **Leftover seed data breaks pgTAP counts.** The new pgTAP file creates its own users, businesses and requests with fixed ids and counts only its own rows, in a rolled-back transaction.
- [ ] **Two overloads.** After the migration only one `respond_to_request` exists (pgTAP via `pg_proc`), with the revoke / grant pair on that signature.
- [ ] **Hit targets and labels** on the switches, picker rows, note box, tab and badge; selected state in words.
- [ ] **Faithful fakes.** Use the existing `jest.setup` fakes and `__fixtures__/pagedServer.ts`; the AsyncStorage fake is the official jest mock; no ad-hoc fakes.
- [ ] **Own cancel raises no badge.** Cancelling from the detail or the list marks that request seen at `cancelled`; the number stays as it was, including when the cancel call fails and is retried, and when the list refetches afterwards (jest).
- [ ] **No raw invisible characters.** The spec and the migration are written with escaped code points only (`\u200B`, `\uFEFF`, ...), never literal invisible characters (checked by the command in the Test plan).
- [ ] **Badge baseline.** The very first load on a phone (or after sign-in as another user) shows no badge for existing requests (jest).
- [ ] **Old tests untouched.** Specs 07 to 10 tests pass unedited except the files listed under "Files to change" (checked with `git diff --stat` on `__tests__` in the review).

## Out of scope
- Table requests, "I've arrived", and merging the two paged-list copies (spec 11, §16).
- Push notifications for new or answered requests (spec 12); the client-only customer badge is replaced by spec 12 later.
- The Offers tab (spec 16); this spec leaves the tab bar ready for it.
- A server-side "seen" / unread flag, a notification inbox, read receipts.
- Chat between seller and customer, editing or undoing an answer, counter-offers (v1 §3).
- A note on a decline with a fixed reason (Decision 15), a reason on a cancel / expire, a customer reason on cancel.
- Customer-facing or seller-facing display of no-shows across requests (v1 §15 question 2).
- Reports, legal text, promotions (17, 18, 16).
- Seller opening hours, auto-accept, per-business request caps (spec 12).
- In-app payments, delivery, live location tracking (v1 §3).
- Order activity grids on customer profiles and business pages (v1 §3).

## Definition of done
- [ ] `respond_to_request` with `declined` and no reason is refused with `decline_reason_required`; an unknown code with `invalid_input`; `other` without a note with `decline_reason_required`; a 201-character or hidden-character note with `invalid_text`; a reason sent with `accepted` with `invalid_input`; in each case the row stays `pending` (pgTAP).
- [ ] Declining with each of the six valid reasons stores the code (and the note for `other`) and sets `declined` and `responded_at`; accepting stores the optional note, or null when empty (pgTAP).
- [ ] The table checks hold even for a superuser insert: a reason on a non-declined row, a note on a pending / expired / cancelled row, `other` without a note, a 0- or 201-character note and a hidden character are all rejected (pgTAP).
- [ ] **An outsider cannot write or read them:** another seller, another customer, `anon` and the requesting customer cannot answer a request that is not to their business (identical `not_found`), cannot update, insert or delete `decline_reason` / `response_note` directly, and another customer never sees them in any list or detail (pgTAP).
- [ ] The customer object of `submit_pickup_request`, `list_my_pickup_requests`, `get_my_pickup_request` and `cancel_pickup_request` has exactly the spec 09 keys plus `decline_reason` and `response_note`, and the seller object has the customer keys plus `customer_name`, `responded_at` and the same two; neither contains `accepted_address`, `place_id`, coordinates, the customer's id or email (pgTAP key-set tests).
- [ ] After the migration exactly one `respond_to_request` exists, executable by `authenticated` only; `anon` and `public` cannot execute it; the old two-argument form is gone (pgTAP).
- [ ] A two-argument accept (old app build) still works; a two-argument decline is refused with `decline_reason_required` (pgTAP).
- [ ] The Requests tab shows for a signed-in user; seller mode off shows Restaurants · Homemade · Requests · Profile, seller mode on shows Requests · Manage · Profile; the guest tab bar is unchanged and has no Requests tab (jest, `TabsLayout`).
- [ ] A business owner with seller mode **off** can open Requests, switch to Received, and accept or decline a waiting request (jest).
- [ ] A customer without a business sees the Sent list with no switches; a business owner sees Received and Sent; the default is Received with seller mode on and Sent with it off; changing seller mode in Profile changes the tab bar at once (jest).
- [ ] The Received list is the spec 10 inbox (Waiting / All, 50 per page, keyset cursor) and the Sent list is My requests (50 per page); both keep their loading, empty, error-with-retry and success states (jest).
- [ ] Decline opens the picker with six rows ≥ 44 pt; nothing is preselected; Confirm is disabled until a reason is chosen (and the text filled for Other); the selected row is spoken as selected; Other needs 1 to 200 characters (jest).
- [ ] Accept offers an optional note of 0 to 200 characters; a confirm with an empty note sends no note (jest).
- [ ] The confirm steps stay, the homemade Accept still says the exact address will be shown, and double tap sends one decision (jest).
- [ ] With the keyboard open the dialog fields stay reachable; at the largest text size nothing clips (iOS Simulator manual run, plus jest where layout-independent).
- [ ] The customer's list row and request detail show "Declined: <reason>" (the seller's own words for Other) and the seller's note, as words; a pending, expired or cancelled request never reads as accepted (jest, including screen-reader labels).
- [ ] Badges: the Requests tab number for a business owner equals waiting requests plus customer updates; Received and Sent show their own numbers; for a customer the number is the count of their requests whose `display_status` changed since they last opened Sent; first sight is a baseline (no badge); opening Sent clears it; another signed-in user on the same phone does not inherit it; a failed or loading count shows no number (jest, with AsyncStorage mock).
- [ ] Cancelling one's own request does not raise the badge: it is marked seen at `cancelled`; a seller's answer or an expiry still does (jest).
- [ ] Neither this spec nor the migration contains a raw invisible character: `grep -nP '[\x{00AD}\x{0080}-\x{009F}\x{200B}-\x{200F}\x{202A}-\x{202E}\x{2060}-\x{2069}\x{FEFF}]'` on both files prints nothing (the PR 1 gate runs it).
- [ ] The badge is purely client-side: no new function, column or request is added for it (review of the diff).
- [ ] Each list row shows a kind label ("Pickup") and carries it in its accessibility label; the row and list types take a `kind` so a table row can be added without changing the list code (jest, type check).
- [ ] The Profile "My requests" row and `MyRequestsRow.test.tsx` are gone; Profile still renders and its other tests pass; the Manage Business Requests row is unchanged and its test passes unedited (jest).
- [ ] Existing links `/requests`, `/requests/<id>`, `/seller/requests` and `/seller/requests/<id>` still open the right screen (jest, `renderRouter`).
- [ ] Specs 07 to 10 tests pass unedited except the listed forced edits (the tab rules and the two new object keys); `git diff --stat` on test files in the PR matches the list under "Files to change".
- [ ] Every touchable has a label and role, targets ≥ 44 pt, status always a word, never colour alone (jest + iOS Simulator).
- [ ] `npm run lint`, `npm run typecheck`, `npm test` and `npx supabase test db` pass; `src/types/database.ts` is regenerated, not hand-edited.

## Test plan
- Unit/component tests (jest):
  - schemas: strict customer and seller schemas with the two nullable keys; `declineReasonSchema`; the respond-input schema (Other needs text; note length; trimming).
  - `declineReasons` labels and order; `messages` / `sellerMessages` strings; `api.respondToRequest` argument shape and error mapping (`decline_reason_required`, `invalid_text`).
  - `useRespondToRequest`: double tap, invalidation (including the customer list and the badge), error refetch, dialog kept on a validation error.
  - `DeclineReasonPicker`, `AcceptNoteField`, `RequestActions` dialogs: disabled states, selected state, 44 pt targets, counter wording, homemade vs restaurant accept text, keyboard-related props.
  - `RequestsTabScreen`: customer-only vs switches, default switch by seller mode, switch state, per-list states, kind label, retry.
  - `statusMemory` / `useCustomerUpdates` / `useRequestsBadge`: own cancel marks seen (no badge, also on retry and refetch), baseline, change, expire as change, clear on open, per-user keys, cap, sign-out clear, failed count shows nothing, skewed clock.
  - `TabsLayout` + `routeAccess`: the tab rules in the table above, guest unchanged, direct link to a hidden map tab, landing tab by seller mode.
  - Customer list row and detail show reason and note; seller list and detail show them too.
- Non-test check (PR 1 gate A, also run on this spec): `grep -nP '[\x{00AD}\x{0080}-\x{009F}\x{200B}-\x{200F}\x{202A}-\x{202E}\x{2060}-\x{2069}\x{FEFF}]' supabase/migrations/<timestamp>_requests_answer_notes.sql .claude/specs/10b-requests-tab-and-answers.md` must print nothing; the hidden-character class is written as escaped code points, the same text as the spec 09 and 10 migrations.
- Database tests (pgTAP) in `supabase/tests/10b-requests-answer-notes.test.sql`: everything under Definition of done, plus the boundaries (`char_length` 1, 200, 201; whitespace-only note → null; each hidden-character class), a decline race with a customer cancel (statuses set by the superuser; the loser keeps no reason / note), the `pg_proc` single-overload check, and that no grant exists on the new columns for `anon` / `authenticated`.
- **Deliberate breaks** (each must turn a named test red, then be reverted):
  1. In SQL, drop the "reason required" check from `respond_to_request`: the decline-without-reason pgTAP test must fail.
  2. In SQL, drop the table-level "reason only on declined rows" check: the superuser-insert check test must fail.
  3. In SQL, leave the old two-argument `respond_to_request` in place next to the new one: the single-overload / allowlist test must fail.
  4. In SQL, leave `decline_reason` out of the customer object: the customer key-set test must fail.
  5. In SQL, drop the business-ownership filter from `respond_to_request` (as spec 10 break 1): the other-seller test with the new arguments must fail.
  6. In the app, enable the Decline confirm button without a reason: the picker test must fail.
  7. In the app, leave out the "mark seen on own cancel" step in `useCancelPickupRequest`: the own-cancel badge test must fail.
  7b. In the app, count a request's first sight as a change: the baseline badge test must fail.
  8. In the app, base the badge's "changed" test on the phone clock instead of `display_status`: the skewed-clock test must fail.
  9. In the app, show Restaurants and Homemade in seller mode: the `TabsLayout` seller-mode test must fail.
- Manual check on device (iOS Simulator first, run by Archan): sign in as a seed seller with seller mode on → tabs are Requests · Manage · Profile and Requests opens on Received; switch seller mode off in Profile → tabs are Restaurants · Homemade · Requests · Profile and Requests opens on Sent, with Received still reachable; decline with each reason, including Other with and without text; accept with and without a note; the customer account sees "Declined: …" and the note, and a badge on Requests that clears when Sent opens; a first sign-in on a fresh install shows no badge; double tap; keyboard open on the note and Other boxes; largest text size; VoiceOver on the switches, picker rows, tab badge and dialogs; airplane mode then retry; Android later (recorded in §16).

## Decisions
Decisions already made by Archan (from the request for this spec), not open questions:
1. **Decline requires one reason from a fixed list of six** (`sold_out`, `closed_then`, `too_busy`, `cannot_prepare`, `time_not_possible`, `other` with a required 1 to 200 character text). **Accept may carry an optional 1 to 200 character note.**
2. **Stored on `pickup_requests`** with checks (a reason only on declined rows, a note only on answered rows, same hidden-character rules as other text fields), no client grants. `respond_to_request` gets new optional parameters; the server validates all of it; a decline without a reason is refused with a stable error code.
3. **Both the customer and the seller request objects gain the new keys** (the customer must see the reason and the note), through the shared private builder; pgTAP key-set tests, strict zod schemas and function allowlists are updated together. (Implementation detail left to the plan: whether the "declined rows have a reason" rule is a table check or function-only, because rows declined before this migration have none.)
4. **A new Requests tab, signed in only.** Customers see their requests; anyone who owns a business sees **Received** and **Sent** switches.
5. **Tab bar:** seller mode off shows Restaurants, Homemade, Requests, Profile (Offers added by spec 16); seller mode on shows Requests, Manage, Profile (the two map tabs hidden). Seller mode is toggled in Profile as today. This closes the §16 gap "no in-app way into the inbox when seller mode is off".
6. **Default switch:** Received when seller mode is on, Sent when it is off.
7. **The customer badge is client-only:** the phone remembers the last status it saw for each request; first sight is the baseline; opening the list clears it; a customer's own cancel marks that request seen (Decision 18); no backend change. Spec 12 replaces it later. This **reverses spec 10 Decision 18** (no tab badge).
8. **Badge numbers:** for a business owner the Requests tab badge is waiting-for-answer count plus customer updates; the Received switch shows the waiting count, the Sent switch shows customer updates; for a customer the tab badge is the customer updates count.
9. **Kind-ready:** every list row has a kind (today "Pickup") shown as a label and carried by the row type, so table requests (spec 11) fit without a rewrite.
10. **Existing routes keep working** (`/requests`, `/requests/[id]`, `/seller/requests`, `/seller/requests/[id]`) so links, tests and the seller detail stay valid; the tab renders the same list components.
11. (replaced by Decision 14)
12. **Old app builds:** a two-argument accept still works; a two-argument decline gets `decline_reason_required`, shown as a generic "Update the app to decline" style message only if the plan finds old builds can exist (EAS Update normally replaces the bundle); the plan decides the wording.

13. **Guests do not see the Requests tab** (Archan, spec review). The guest tab bar and its test stay unchanged.
14. **Old entry points:** the Profile "My requests" row and `MyRequestsRow.test.tsx` are removed; the Requests row on Manage Business stays unchanged; `/requests` and `/seller/requests` keep rendering the same lists as before (no redirect) and the tab reuses the same components (Archan, spec review).
15. **No note on a fixed decline reason:** the function refuses it and a table check enforces it; only `other` carries text (Archan, spec review).
16. **Badge numbers:** the Received switch shows the waiting count, the Sent switch shows customer updates, the tab badge is their sum; a customer who is not a business owner sees the customer updates count (Archan, spec review).
17. **"99+" cap on the tab only;** no app-icon badge (needs notification permission, spec 12) (Archan, spec review).
18. **A customer's own cancel does not raise their badge:** cancelling a request marks that request as seen at its new status (`cancelled`), so only changes made by someone else (the seller's answer, expiry) count (Archan, spec review).

## Open questions
None. All five earlier questions are answered in Decisions 13 to 18.
