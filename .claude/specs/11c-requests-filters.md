# Spec 11c: Requests Filters

**Branch:** `feature/requests-filters`
**Product spec:** `docs/product/v1.md` section 4 (Navigation, Requests tab), section 8 (statuses), section 14 row 11c, section 16 (EXPLAIN the list keyset queries)
**Plan mode:** required: changes the signature of a security-definer function (`list_my_requests`) and the filter contract of another (`list_business_requests`), regenerates `database.ts`, and touches well over ~5 files.
**Status:** 📝 Spec written

## Overview
After this ships, both sides of the Requests tab (Sent, and Received for business owners) and the Manage Business requests screen have four filter chips, in this order: **All, Pending, Accepted, Declined**. Pending shows requests still waiting for an answer and not yet expired. Accepted shows accepted, completed and no-show requests. Declined shows declined requests only. Cancelled and expired requests show only under All. Sent opens on All and Received opens on Pending; the choice stays for the session and resets when the app restarts. The filtering is done on the server, so the existing paging (50 per page, `(created_at, id)` text cursor, more loads on scroll) still has no skipped or repeated rows and no empty last page. Pickup and table requests are filtered together, and each row keeps its kind label. It comes now because the lists hold both kinds and every status since spec 11, and Archan's spec 11 run showed they are hard to scan.

### Notes: product spec vs the real code
These are corrected in `docs/product/v1.md` sections 4 and 14 at ship time.
1. Section 14 row 11c says both functions "gain a status filter". `list_business_requests` already has one (`p_status`: `'waiting'` plus the raw statuses, where `'accepted'` means `accepted` only). This spec replaces that contract: only All, Pending (alias `'waiting'`), Accepted (the group) and Declined remain; the raw values are refused.
2. Sections 4 and 14 (rows 10 and 11) describe Received as "Waiting / All". After this spec it is All / Pending / Accepted / Declined, and "Waiting" is no longer shown in the app.
3. The Received list component (`SellerRequestsScreen`) is also the Manage Business requests screen (`app/seller/requests/index.tsx`), so the chips appear there too (decided: same four chips).
4. `pickup_requests` has no `(customer_id, created_at, id)` keyset index (only `pickup_requests_customer_idx (customer_id, created_at desc)`), unlike `table_requests`; the section 16 EXPLAIN item does not mention this. It is added there.
5. `supabase/seed.sql` is empty; request seeding lives in `scripts/seed/` and runs through `/seed`.

## Depends on
09, 10, 10b, 11, 11b (all Shipped).

## Context to load
- `CLAUDE.md`, this spec, `docs/product/v1.md` sections 4, 8, 14 (row 11c), 16 (EXPLAIN item)
- `.claude/specs/11-table-requests.md` (Functions table, cursor, Known pitfalls) and `.claude/specs/11b-request-limits.md` (Rules: non-ASCII rule, break proofs)
- `.claude/skills/supabase-patterns/SKILL.md`, `.claude/skills/liketoorder-ui/SKILL.md`
- `supabase/migrations/20261110012046_table_requests.sql` L485-640 (latest `list_my_requests` L485-550 and `list_business_requests` L554-640, grants L549-550 and L639-640); indexes L57-59; `20261107181009_pickup_requests.sql` L36-38; `20261108225156_seller_request_inbox.sql` L19-20
- `supabase/tests/05-seller-onboarding.test.sql` L168-215, `10-seller-request-inbox.test.sql` (helpers L62-125, L296, L416-418, L649-672), `11-table-requests.test.sql` (helpers L147-170, L336, L772-893), `09-pickup-requests.test.sql` L700-735, `10b-requests-answer-notes.test.sql` L70-85
- `src/features/requests/{api,schema,messages,sellerMessages}.ts` (api L205-254, schema L10, L121, L156, L173)
- `src/features/requests/hooks/{usePagedRequests,useMyRequests,useBusinessRequests,keys,useCustomerUpdates,useCustomerRequest,invalidateSellerRequests}.ts`
- `src/features/requests/components/{RequestsTabScreen,MyRequestsList,SellerRequestsScreen,InboxFilter,RequestsSwitch}.tsx`
- `src/features/requests/__fixtures__/{pagedServer,sellerRequests}.ts`
- Tests: `__tests__/{api,sellerApi,useBusinessRequestsPages,SellerRequestsScreen,InboxFilter,sellerMessages,RequestsTabScreen,MyRequestsPagination,useMyRequestsPages,MixedRequestLists}.test.*`, `src/features/navigation/__tests__/RequestsTab.test.tsx`

## User stories
- As a customer, I can filter Sent to All, Pending, Accepted or Declined, so that I find the requests I care about quickly.
- As a business owner, I can filter Received (in the Requests tab and on Manage Business) the same way, so that I see what still needs an answer, what I took on, and what I turned down.
- As either side, a filtered list still loads 50 at a time with no skipped, repeated or missing rows, pickup and table mixed, each with its kind label.
- As either side, my chosen filter stays while I use the app (switching tabs or Sent and Received does not reset it).
- As a screen-reader or large-text user, the chips have a group label, each chip says whether it is selected in words, and the chips wrap at the largest text size.
- As an outsider, I can never see another customer's or business's requests through any filter.

## Screens & routes
No new routes.
- `app/(tabs)/requests.tsx` (no change): `RequestsTabScreen` shows the chips above the Sent list and above the Received list.
- `app/seller/requests/index.tsx` (no change): renders `SellerRequestsScreen`, which gets the same four chips.
- Defaults: Sent opens on **All**, Received (both places) opens on **Pending**. The choice is component state: it stays for the session because both panes stay mounted, and resets on app restart. Nothing is persisted to storage.
- No counts on the chips.
- States per filter: loading, empty (texts below), error with retry, success. A pending request is never shown as confirmed.

## Database changes
One migration: `npx supabase migration new requests_filters`. No new table, column, policy or index. RLS on `pickup_requests` and `table_requests` stays on, no policies, no client grants. Never edit an existing migration.

### Filter contract (both functions, same rules)
`p_status text default null`:
| value | matches (per row, both tables) |
|---|---|
| `null` (All) | every row |
| `'pending'`, and `'waiting'` (alias kept for the app on `main`) | `status = 'pending' and expires_at > v_now` |
| `'accepted'` | `status in ('accepted','completed','no_show')` |
| `'declined'` | `status = 'declined'` |
| anything else, including the old raw values `'expired'`, `'cancelled'`, `'completed'`, `'no_show'` | `invalid_input` |

Cancelled, expired (swept) and pending-past-`expires_at` (unswept) rows match only All. Values are case-sensitive (`'ACCEPTED'`, `'Pending'`, `''` give `invalid_input`). `v_now` is the server clock read once per call (as today). NULL checks use `is null` / `is distinct from`, never `= null`.

### Functions
- **`list_business_requests(p_status text default null, p_before text default null)`**: same signature `(text, text)`, so `create or replace function`, body copied from `20261110012046_table_requests.sql` L554-640; only the status mapping and validation (L572-576) and the two status where-clauses (L600-605, L611-616) change. Revoke from `public, anon, authenticated`, grant to `authenticated` repeated.
- **`list_my_requests`**: signature changes from `(p_before text)` to **`(p_before text default null, p_status text default null)`** (approved; `p_before` stays first so every positional call `list_my_requests(cur)` keeps working; the app uses named arguments). `drop function public.list_my_requests(text);` then `create function public.list_my_requests(p_before text default null, p_status text default null)`, body copied from L485-550 plus the same mapping, validation and status predicate in both branches. Revoke from `public, anon, authenticated`; grant to `authenticated`. Exactly **one** overload of each function remains (pgTAP via `pg_proc`).
- Both keep `security definer`, `set search_path = ''`, `not_signed_in` when no caller, the customer from `auth.uid()` and the business from `owner_id = auth.uid()` (never from the client), the cursor regex and parse, the per-kind `limit 51` lookahead, the merge order `(created_at desc, id desc)`, 50 per page and `next_cursor` from row 50. The filter is validated before the business lookup, so a bad value is `invalid_input` even for a user without a business.
- **Paging rule:** the cursor does not depend on the filter; the filter is re-applied in each per-kind branch on every page, inside the same `where` as the keyset predicate, so the 51-row lookahead counts only matching rows (exactly 100 matching rows give page 2 with `next_cursor` null; no empty last page).
- The status predicate is written inline in all four branches (no new helper, so the `private` allowlist in pgTAP 05 does not change). A pgTAP test proves both functions give the same ids for the same filter on the same set of rows.
- **Old app compatibility:** the app on `main` calls `list_my_requests({p_before})` and `list_business_requests({p_status: 'waiting' | undefined, p_before})`; both keep working unchanged (pgTAP). It never sends the raw values that are now refused.
- Pure ASCII migration; any special character as an escaped code point.

### Query plan
Existing indexes: `pickup_requests_business_keyset_idx (business_id, created_at desc, id desc)`, `table_requests_business_keyset_idx` (same), `table_requests_customer_keyset_idx (customer_id, created_at desc, id desc)`, `pickup_requests_customer_idx (customer_id, created_at desc)` (no `id`), `pickup_requests_business_idx (business_id, status, created_at desc)`. The filter is a post-filter on the keyset index scan, so a rare filter (for example Declined) on a long history walks more rows to find 51. At Gate A: `EXPLAIN (ANALYZE, BUFFERS)` each filter on both functions on a locally generated set (about 10k rows per table for one business and one customer, inside a rolled-back transaction), recorded in the PR body. No new index in this spec; the section 16 "EXPLAIN the list keyset queries" before-launch item is extended to cover the filters at about 100k rows, the generic-plan concern, and whether pickup needs a `(customer_id, created_at desc, id desc)` index.

### Types
`npm run db:types`: `list_my_requests` Args gain `p_status?: string`; nothing else changes.

## Storage
None.

## Edge Functions
None.

## Components & hooks
All in `src/features/requests/`.
- `schema.ts`: `RequestFilter = 'all' | 'pending' | 'accepted' | 'declined'` replaces `InboxFilter` (`'waiting' | 'all'`) on both sides. The app never sends `'waiting'` again.
- `api.ts`: `listMyRequests(before?, filter = 'all')` sends `p_status` (undefined for All); `listBusinessRequests(filter, before?)` sends `p_status` (undefined for All, else the filter value). No Supabase calls anywhere else.
- `hooks/keys.ts`: `mine` stays `['requests','mine']` for All; filtered Sent lists use `['requests','mine', filter]`; `inbox(filter)` keeps its shape with the new values. Prefix invalidation of `mine` and `inboxAll` already covers every filter (stale-list rule).
- `hooks/useMyRequests.ts`: takes an optional filter (default All), still a thin wrapper over `usePagedRequests` (no new paging code). Polling: Pending `'always'` (as Waiting does today), the others `'pending'`.
- `hooks/useBusinessRequests.ts`: takes a `RequestFilter`; Pending polls `'always'`, the others `'pending'`.
- `hooks/useCustomerRequest.ts`: its exact-key `getQueryData(requestKeys.mine)` lookup searches every `mine` query, so a request opened from a filtered list still finds its kind.
- `hooks/useCustomerUpdates.ts` (badge): unchanged logic, always from the unfiltered All list.
- `components/RequestFilterChips.tsx` (new; replaces `InboxFilter.tsx`, which is deleted): one shared radiogroup of four radio pills in the order All, Pending, Accepted, Declined, the existing pill style, `minHeight: size.touch`, wraps, `maxFontSizeMultiplier` as today; props `value`, `onChange`, `groupLabel`.
- `components/MyRequestsList.tsx`: takes `filter`, shows the filter's empty text; `RequestsTabScreen.tsx` holds the Sent filter state (default All) and renders the chips; `SellerRequestsScreen.tsx` holds the Received filter state (default Pending), renders the chips and keeps `FlatList key={filter}`.
- `messages.ts` / `sellerMessages.ts`: chip labels, group labels and the empty texts below.

### Wording (final, Archan's; straight apostrophes only)
- Chip labels: "All", "Pending", "Accepted", "Declined". A selected chip's accessibility label is "<label>, selected" (the existing pattern, for example "Pending, selected"), with `accessibilityState.selected` set too.
- Group labels: Sent "Filter sent requests"; Received (tab and Manage Business) "Filter received requests".
- Empty texts:

| Filter | Sent | Received |
|---|---|---|
| All | "No requests yet. Requests you send will show up here." (unchanged) | "No requests yet. Customers who send you requests will show up here." (changed from "...who request pickup...") |
| Pending | "Nothing waiting for an answer right now." | "Nothing waiting for you right now." (unchanged) |
| Accepted | "No accepted requests yet." | "No accepted requests yet." |
| Declined | "No declined requests." | "No declined requests." |

`EMPTY_LIST` (the unused standalone My requests screen) is unchanged.

## Files to create
- `supabase/migrations/<timestamp>_requests_filters.sql`
- `supabase/tests/11c-requests-filters.test.sql` (own users, businesses, rows with fixed ids, rolled back; counts only its own rows)
- `src/features/requests/components/RequestFilterChips.tsx`
- `src/features/requests/__tests__/RequestFilterChips.test.tsx` (replaces `InboxFilter.test.tsx`) and new jest files for filtered Sent and Received lists and hooks (names fixed in the plan)

## Files to change
- `src/types/database.ts` (regenerated only)
- `src/features/requests/{api,schema,messages,sellerMessages}.ts`, `hooks/{keys,useMyRequests,useBusinessRequests,useCustomerRequest}.ts`, `components/{RequestsTabScreen,MyRequestsList,SellerRequestsScreen}.tsx`; `components/InboxFilter.tsx` deleted
- `src/features/requests/__fixtures__/{pagedServer,sellerRequests}.ts`: faithful fake filters with the same four rules (Pending uses `display_status === 'pending'`; Accepted is accepted, completed, no_show; Declined is declined; All is every row)
- `docs/product/v1.md` section 4 (chips, Waiting wording), section 14 rows 10, 11 and 11c (corrected wording, see Notes), section 16 EXPLAIN item, Changelog at ship; `.claude/skills/supabase-patterns/SKILL.md` (filter contract); `CLAUDE.md` status
- Seed: no change expected (both tables already hold every status on both sides for `seed_rest_001`; `--extra` / `--inbox-extra` give paging depth). Changed only if the manual script finds a filter with too few rows; then listed for approval first.

**Forced edits to older tests (approved by Archan; each listed in the PR body; titles and intent kept; anything beyond this list: stop and ask).** Gate A and Gate B each start by running the unchanged older tests against the new code; only failures named here are edited.
- pgTAP 05: no edit (the allowlist is by name and names are unchanged; the one-overload checks live in the new 11c file).
- pgTAP 09: no edit expected (positional `list_my_requests()` / `list_my_requests(cur)` still bind to `p_before`).
- pgTAP 10: the `page_all('accepted')` case (L666-672) expects accepted plus completed plus no_show; the raw-value filter cases (`'expired'`, `'completed'`, and any `'cancelled'` / `'no_show'` case) become `invalid_input` cases. `regprocedure` `(text, text)` at L296 unchanged.
- pgTAP 10b: no edit expected (no-argument calls).
- pgTAP 11: `'public.list_my_requests(text)'::regprocedure` (L336) becomes `(text, text)`; `biz_list('expired')` (L885-893) becomes an `invalid_input` case (forced by Decision 6); `biz_list('accepted')` only if its fixture holds completed or no_show rows; plan count.
- jest `useBusinessRequestsPages.test.tsx`: the `'waiting'` arguments (L61, L124, L128, L259) and the `setup` parameter type.
- jest `SellerRequestsScreen.test.tsx`: radio labels and the opening filter (L74-89, L335), and the Received All empty text (L119).
- jest `InboxFilter.test.tsx`: deleted, replaced by `RequestFilterChips.test.tsx`.
- jest `sellerMessages.test.ts` (L73-75): the empty-message function takes the new filter values; the Received All text.
- jest `sellerApi.test.ts` (L27-64) and `api.test.ts` (L116-128): only if the call shape check fails.
- Any other test that pins the old Received All text ("Customers who request pickup"): only that assertion.
- Not edited: `RequestsTabScreen.test.tsx` and `navigation/__tests__/RequestsTab.test.tsx` (Sent still opens on All), `MyRequestsPagination`, `useMyRequestsPages`, `MixedRequestLists` (if any of them fails, stop and ask).

## New dependencies
No new dependencies.

## Rules for implementation
- RLS on every new table + pgTAP test (no new table; existing RLS unchanged)
- Supabase calls only in `src/features/requests/api.ts`
- Theme tokens only, no hardcoded colors/sizes
- Loading / empty / error / success states on every screen and every filter
- Accessibility labels on every touchable
Feature-specific:
- **Copy bodies from the latest definitions** (`20261110012046_table_requests.sql` L485-550 and L554-640); a diff against the source shows only the status mapping and predicate, the new parameter, the drop and the repeated grants.
- **One overload of each function** after the migration (pgTAP `pg_proc` count).
- **Do not rebuild paging:** `usePagedRequests` is reused; the filter lives in the query key and `fetchPage`; no third copy.
- **Server decides** what matches a filter; the app never filters rows on the phone. A pending request is never shown as confirmed; the Accepted chip never shows a pending row.
- **Stale lists:** every action that already invalidates `mine` / `inboxAll` covers every filter by prefix (jest proves a row leaves Pending after accept and appears in Accepted).
- **NULL checks** with `is null` / `is distinct from`. **ASCII-only SQL**, escaped code points. Non-ASCII byte check: whole file for the migration, the new pgTAP file and every changed file that is clean today; added lines only (`git diff -U0 <file> | grep '^+' | perl -ne 'print if /[^\x00-\x7F]/'`) for files that already hold non-ASCII; each check proved first on a scratch file. Markdown invisible-character check with the spec 11 perl class, proved on a scratch file.
- **Deliberate-break proofs**, each wrapped in `lives_ok(...)` in a rolled-back transaction, each must turn its named test red: (1) Accepted without `completed`; (2) Accepted without `no_show`; (3) Declined includes `cancelled`; (4) Declined includes `expired`; (5) Pending ignores `expires_at` (unswept overdue rows leak in); (6) the filter applied only on the first page (`v_at is null`); (7) the filter applied in the pickup branch only (table rows leak); (8) the owner predicate dropped (another customer's or business's rows leak); (9) keyset on `created_at` alone under a filter (ties skip or repeat); (10) the old `list_my_requests(text)` left in place (overload count); (11) the `'waiting'` alias removed (old-app test); (12) All excludes cancelled or expired; (13) an old raw value (`'expired'`, `'cancelled'`, `'completed'`, `'no_show'`) accepted again (the refusal tests).
- **App breaks** (reverted after): filter missing from the query key (caches mix); a chip sends the wrong `p_status`; Pending not polled; badge computed from a filtered list; Received opening on All instead of Pending.
- **Tests:** own `QueryClient` per test (`retry: false`, `gcTime: 0`) cleared in `afterEach`; faithful fakes (fixtures apply the same four rules as SQL); every RNTL v14 call awaited; `waitFor`, never timers or sleeps.
- **Large text and VoiceOver:** chips wrap at the largest size, no fixed heights; labels as in "Wording".
- **Old tests** edited only where forced and listed above; `git diff --stat` on test files in the PR matches the list.
- **One PR, two gates**, commit after each, stop for Archan's approval:
  - **Gate A:** migration, `db:types`, `11c-requests-filters.test.sql`, forced pgTAP edits, break proofs 1-13, EXPLAIN output.
  - **Gate B:** chips, hooks, api, messages, fixtures, jest (new + forced edits), app breaks, docs and skill, seed only if needed, manual script for Archan.
  - One PR is enough because both signatures keep the app on `main` working (defaults and the `'waiting'` alias), so there is no out-of-step window.
- No `db push`, no `--linked`, no deploy, no `service_role`, no secrets, no `.env`. CI green before merge.

## Out of scope
- Counts on the chips, a count function, search, sort, date ranges, filtering by kind, a Cancelled or Expired chip.
- Persisting the chosen filter across app restarts.
- New indexes (recorded in section 16 instead), changing expiry, statuses or transitions.
- Server-side seen marker or badge changes (spec 12); notifications (spec 12); theme refresh (11d); Offers tab (16).
- Editing shipped specs 09 to 11b. Out-of-scope v1 items in section 3 (chat, payments, delivery).

## Definition of done
- [ ] pgTAP: for each filter on each function, the returned ids equal the expected set in `(created_at desc, id desc)` order, both kinds mixed, `kind` kept on every object.
- [ ] pgTAP: Accepted includes `accepted`, `completed`, `no_show`; Declined includes `declined` only (never `cancelled`, `expired`, unswept overdue); Pending includes only `pending` with `expires_at > now` (never an unswept overdue row); All includes every status; cancelled and expired appear only under All.
- [ ] pgTAP paging: under each filter, a set of 123 matching rows (120 sharing one timestamp, mixed kinds, interleaved with non-matching rows on the same timestamp) and a set of exactly 100 matching rows walk with no skip, no repeat, and no empty last page; the cursor continues correctly under the same filter on every page.
- [ ] pgTAP: `'waiting'` gives the same rows as `'pending'`; `list_my_requests` with only `p_before` and `list_business_requests` with `'waiting'` or no status (the app on `main`) still work; `'expired'`, `'cancelled'`, `'completed'`, `'no_show'`, `'bogus'`, `'ACCEPTED'`, `''` give `invalid_input` on both functions.
- [ ] pgTAP **outsider cannot**: another customer's sent rows and another business's received rows never appear under any filter; a user without a business gets an empty Received list; `anon` cannot execute either function; `public` has no execute.
- [ ] pgTAP: exactly one `list_my_requests` (`(text, text)`) and one `list_business_requests` (`(text, text)`) exist; both `security definer` with `search_path=""`.
- [ ] Deliberate-break proofs 1-13 each turn their named test red (lives_ok, rolled back).
- [ ] EXPLAIN output for every filter on both functions recorded in the PR; section 16 item extended.
- [ ] `src/types/database.ts` regenerated, not hand-edited.
- [ ] jest: Sent (opens on All) and Received (opens on Pending, in the tab and on Manage Business) show four chips in the order All, Pending, Accepted, Declined, with no counts; choosing one sends the right `p_status`, shows only server rows, keeps the kind label, loads more on scroll with the cursor, and shows its empty text from "Wording"; the choice stays when switching Sent and Received and when leaving and returning to the tab; switching back to a filter shows its cached list; a row leaves Pending and appears in Accepted after accept; the badge still uses the All list.
- [ ] jest a11y: group labels "Filter sent requests" / "Filter received requests"; each chip a radio with its label, "<label>, selected" when chosen and `accessibilityState.selected`; touch target at least 44 pt; wraps at large text.
- [ ] `InboxFilter` and the `'waiting'` value are gone from the app (grep).
- [ ] Older tests unchanged except the approved forced list.
- [ ] `npm run lint`, `npm run typecheck`, `npm test`, `npx supabase test db` pass; CI green.
- [ ] Non-ASCII and invisible-character checks clean as in the Rules, each proved on a scratch file first.

## Test plan
- Database tests (pgTAP) `supabase/tests/11c-requests-filters.test.sql`: everything in the DoD for both functions, a user who is both a customer and an owner (Sent and Received kept apart), the old-app calls, the refused raw values, overload and privilege checks, break proofs 1-13.
- Unit/component tests (jest): `RequestFilterChips` (order, labels, roles, state, onChange, wrap), filtered Sent and Received lists with the fake server (each filter, defaults, paging with cursor, empty text, error with retry, choice kept across switches), query-key separation, invalidation after accept / decline / cancel, Pending polling, the badge from the All list, `useCustomerRequest` from a filtered list, api argument shapes, the empty texts.
- Manual check (iOS Simulator, run by Archan, seed accounts, password `password123`): as `seed-customer-sam@example.com` see Sent open on All and walk each chip; as the `seed_rest_001` owner see Received open on Pending (tab and Manage Business) and walk each chip; accept a pending request and see it move from Pending to Accepted, decline one and see it under Declined; switch Sent and Received and leave the tab, and see each choice kept; restart the app and see the defaults again; scroll a filtered list past 50 rows (seed with `--extra` / `--inbox-extra`); cancelled and expired only under All; largest text size; VoiceOver on the chips ("Filter received requests", "Pending, selected").

## Decisions
Made by Archan when approving the plan:
1. **Defaults:** Sent opens on All, Received opens on Pending; the choice stays for the session (both panes stay mounted) and resets on app restart; chip order All, Pending, Accepted, Declined.
2. **Pending everywhere:** both sides say "Pending"; `InboxFilter` is replaced by one four-value `RequestFilter` type and one shared `RequestFilterChips` component; Manage Business gets the same four chips; the server keeps `'waiting'` as an alias of `'pending'` for the app on `main`. Forced seller-test edits are approved only where the rename or the chips force them (list above).
3. **No counts** on the chips.
4. **Empty texts** as in "Wording"; Received All changes to "No requests yet. Customers who send you requests will show up here." (only the tests that pin the old text are edited).
5. **Accessibility wording:** group labels "Filter sent requests" and "Filter received requests"; a selected chip reads "Pending, selected" (existing pattern, straight apostrophes).
6. **Old raw values refused:** `'expired'`, `'cancelled'`, `'completed'`, `'no_show'` give `invalid_input`; the contract is only null (All), `'pending'` (alias `'waiting'`), `'accepted'`, `'declined'`. The pgTAP 10 cases for those values become `invalid_input` cases (forced, approved, intent kept, listed in the PR body); break proof 13 shows the old values stay refused.
7. **`list_my_requests(p_before text default null, p_status text default null)`** approved.
8. **Product spec corrections** (Notes 1 to 5) go into `docs/product/v1.md` sections 4 and 14 (and 16 for the index note) at ship time.

## Open questions
None. All seven earlier questions are answered in Decisions 1 to 7.
