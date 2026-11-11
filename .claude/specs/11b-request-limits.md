# Spec 11b: Request Limits

**Branch:** `feature/request-limits`
**Product spec:** `docs/product/v1.md` §8, §9, §14
**Plan mode:** required — changes two Postgres functions that guard request creation, and touches more than 5 files (migration, two pgTAP files, messages and their tests, docs, skill)
**Status:** ✅ Shipped

## Overview
A customer can send as many requests to the same restaurant as they like over time (for example 100 visits a month), as long as the earlier request has been answered, cancelled or has expired. The hourly limit is gone. At any moment a customer can have at most 3 waiting pickup requests and 3 waiting table requests, and 1 waiting request per restaurant per kind. One generous backstop stops a script that creates and cancels in a loop: at most 10 submits per customer per restaurant per kind in a rolling 24 hours, counting every status. A normal person never reaches it; a script cannot flood one restaurant's inbox (or, after spec 12, its notifications). It comes now because Archan's run of spec 11 showed the old numbers (a higher pending cap and an hourly limit) did not fit real use.

## Depends on
Specs 09, 10, 10b and 11 (all ✅ Shipped).

## Context to load
- `docs/product/v1.md` §8, §9, §14
- `supabase/migrations/20261108225156_seller_request_inbox.sql` lines 55-197 (latest `submit_pickup_request`; the original is `20261107181009_pickup_requests.sql`, which a later migration replaced)
- `supabase/migrations/20261110012046_table_requests.sql` lines 136-231 (`submit_table_request`, created here, never redefined since)
- `supabase/tests/09-pickup-requests.test.sql` (limits section, lines 573-649, helpers `pg_temp.sub_biz` and `pg_temp.cycle`)
- `supabase/tests/11-table-requests.test.sql` (limits section, lines 432-485)
- `src/features/requests/messages.ts`, `src/features/requests/api.ts` (lines 52-110, read only)
- `src/features/requests/__tests__/PickupRequestForm.test.tsx` (lines 410-420 and 549-557), `messages.test.ts`
- `.claude/skills/supabase-patterns/SKILL.md` lines 37 and 91

## User stories
- As a customer, I can send a new request to a restaurant I have used before as soon as the earlier one is answered, cancelled or expired, so that regular visits are never blocked.
- As a customer, I can have up to 3 pickup requests and 3 table requests waiting at once, so that I can ask a few places.
- As a customer who hits a limit, I see a plain message saying which limit it is and what to do.
- As a restaurant owner, I am protected from one customer flooding my inbox by sending and cancelling requests in a loop.

## Screens & routes
No new screens or routes. The existing pickup form, table form and cancel/arrived error bars show new wording (`src/features/requests/messages.ts`).

## Database changes
No new table, column, index or policy. RLS is already on `pickup_requests` and `table_requests` and does not change. One new migration (`npx supabase migration new request_limits`) that re-creates the two functions with `create or replace function`, **same signature, same return type, same security settings**, so the app on `main` keeps working and the existing revoke/grant stay in force (the migration repeats the revoke from public/anon/authenticated and the grant to authenticated, as the earlier migrations do):

- `public.submit_pickup_request(p_business_id uuid, p_idempotency_key uuid, p_pickup_at timestamptz, p_items jsonb default null, p_order_text text default null, p_note text default null) returns jsonb`
- `public.submit_table_request(p_business_id uuid, p_idempotency_key uuid, p_table_at timestamptz, p_party_size integer, p_note text default null) returns jsonb`

Bodies are copied from the **latest** definitions (pickup: `20261108225156_seller_request_inbox.sql` L55-197; table: `20261110012046_table_requests.sql` L136-227) and only these things change:
1. The pending cap constant: `v_pending >= 5` becomes `v_pending >= 3`. The per-business test `v_pending_b >= 1` stays. Both still count only `status = 'pending' and expires_at > v_now` rows of this customer in this table (pickup and table are separate tables, so kinds never mix) and still raise `too_many_pending`.
2. The old hourly block is deleted: the `v_recent` variable, its count over `created_at > v_now - interval '1 hour'`, and its `rate_limited` raise.
3. A new backstop block replaces it, in the same place (after the pending checks, before the insert), inside the existing advisory lock: count this customer's rows in this table for this business with `created_at > v_now - interval '24 hours'`, **any status** (cancelled, expired, accepted, declined all count); if the count is `>= 10` raise `rate_limited`. The 11th submit is the first refused. It is served by the existing customer indexes: `pickup_requests_customer_idx (customer_id, created_at desc)` and `table_requests_customer_keyset_idx (customer_id, created_at desc, id desc)`. No new index. The table function's source says `create function`, so its new definition says `create or replace function`; that one word is the only other difference from its source.

Order of checks stays: auth, profile, key, advisory lock, **idempotent replay**, business, time, items/party, text, availability, empty order, **pending checks, then backstop**, insert. A replay at any limit returns the original row and writes nothing.

Rules: any comparison on a nullable value uses `is distinct from` / `is not distinct from`, never `=` or `<>` (counts are never NULL, so none is needed in the new code). The migration file is pure ASCII (no box-drawing characters, no smart quotes), and any pattern that needs a special character uses an escaped code point.

No `db:types` change (signatures identical).

## Storage
None.

## Edge Functions
None.

## Components & hooks
- `src/features/requests/messages.ts` — new text for `too_many_pending` and `rate_limited` (below). `RequestErrorCode`, `SERVER_CODES` and `mapRequestError` in `api.ts` are unchanged: both codes stay live.
- No new components or hooks.

**Wording (final, Archan's):**
- `too_many_pending`: "You have too many requests waiting. You can have up to 3 pickup and 3 table requests waiting, and 1 per place. Cancel one or wait for an answer."
- `rate_limited`: "You've sent a lot of requests to this place today. Please try again tomorrow."

Straight apostrophes only. "Place", not "restaurant", because pickup requests also go to homemade sellers and the text is shared (it matches `NOT_AVAILABLE`: "This place isn't available right now."). There is no "or call them": no screen shows a phone number or contact for a restaurant or a homemade seller (the schema has no such column), so the text cannot point to one.

One server code (`too_many_pending`) covers both the 3-cap and the 1-per-place case, so the text names both. `rate_limited` is not dead code: the backstop raises it, and an older server that still answers the hourly limit gets the same message.

## Files to create
- `supabase/migrations/<timestamp>_request_limits.sql`
- `src/features/requests/__tests__/TableRequestFormLimits.test.tsx` (new test file: the table form shows both new texts in its error bar; the spec 11 table form test is not edited)

## Files to change
- `supabase/tests/09-pickup-requests.test.sql`, `supabase/tests/11-table-requests.test.sql` (forced edits, listed below; plan counts 263 to 269 and 352 to 364)
- `scripts/seed/requestsData.ts`, `scripts/seed/requests.ts` (a limit demo customer, `seed-customer-limit@example.com`, with 10 cancelled pickup requests to one restaurant created within the last 24 hours of seed time, so the backstop can be tried with one request; plus a header comment), `scripts/seed/__tests__/sellerInbox.test.ts` (forced: its customer-key list gains `limit`) and new tests in `scripts/seed/__tests__/requestsData.test.ts` (the limit demo rows; no seeded customer has more than 3 pending requests per kind or more than 1 per business)
- `src/features/requests/messages.ts`
- `src/features/requests/__tests__/PickupRequestForm.test.tsx` and any other test that pins the old `too_many_pending` or `rate_limited` text (found by grep for `already have a request waiting`, `Try again later`, `sent a lot of requests`; known: `PickupRequestForm.test.tsx:417, 418, 549-557`)
- `docs/product/v1.md` sections 8 and 9 (one sentence each with the new limits), the section 14 row 11b, and at ship one Changelog line
- `.claude/skills/supabase-patterns/SKILL.md` lines 37 and 91
- `CLAUDE.md` (status row; ship step)

**Forced edits to older tests (approved by Archan, to be listed in the PR body):**
- pgTAP 09 (`09-pickup-requests.test.sql`, plan 263 to 269): the cap-5 cases (L600-625) are replaced by cap-3 cases; the hourly block (L627-644: 11th `rate_limited`, replay at the rate limit, 59-minute-old rows, exactly-an-hour rows, "another customer is not affected") is replaced by the new 24-hour backstop cases and by the proof that 12 submits in one hour to 12 different places are all accepted; the helper `pg_temp.cycle` stays (used by the backstop cases); three small helpers and users 45 to 49 with their fixture rows are added; fixture comments updated. Kept as they are: one pending per business (L589-593), unswept overdue row (L595-598), replay at the pending limit (L573-584).
- pgTAP 11 (`11-table-requests.test.sql`, plan 352 to 364): cap 5 to 3 (L432-439); the hourly block (L447-455) is replaced by the backstop cases and by the proof that 11 submits in one hour to 11 different restaurants are all accepted; the independence cases (L456-471) are retargeted (pending caps to 3, the two "ten in an hour does not rate-limit the other kind" cases rewritten as "10 rows of one kind to a restaurant do not block the other kind at that restaurant"); the five-expired-rows case (L473-477) becomes three; two pickup submits are wrapped in a small helper so a break shows as a failed test instead of an error; fixture comments updated and users 56 to 60 added. Kept: L440-446, L479-485.
- jest: `PickupRequestForm.test.tsx` regex for `too_many_pending` (L417) and for `rate_limited` (L418, L549-557) to match the new texts, and any other test that pins the old wording. The rate-limited tolerance tests otherwise stay as they are and are edited only where they pin the old message text. `messages.test.ts` gains the two new texts and its smart-quote regex (L39) is left as it is.
- pgTAP 10 and 10b are not edited; they pass unchanged against the new functions.
- Anything else: stop and ask Archan.

## New dependencies
No new dependencies.

## Rules for implementation
Always include:
- RLS on every new table + pgTAP test (no new table here; existing RLS unchanged)
- Supabase calls only in `src/features/<x>/api.ts`
- Theme tokens only, no hardcoded colors/sizes
- Loading / empty / error / success states on every screen
- Accessibility labels on every touchable
Feature-specific rules:
- Copy each function body from its latest definition, state in the PR which file each came from, and change only what this spec says. A diff of the new function against its source must show only the cap constant, the removed hourly block and the new backstop block.
- `is distinct from` in NULL checks; escaped code points only in SQL and in regexes. Non-ASCII rule: the new migration, and every changed file that has no non-ASCII character today (`messages.ts`, `11-table-requests.test.sql`, and the new files), must have zero hits on the whole file (`grep -nP '[^\x00-\x7F]'`); for every other changed file (older files that already hold box-drawing characters, arrows or currency signs, such as `09-pickup-requests.test.sql`, `PickupRequestForm.test.tsx`, `v1.md`, `SKILL.md`, `CLAUDE.md`) the check runs on the ADDED lines only (`git diff -U0 <file> | grep '^+' | grep -nP '[^\x00-\x7F]'`), with zero hits. The existing characters stay untouched. Each check command is first proved on a scratch file (it must hit a known bad line and must not hit a clean one) before it is trusted.
- Deliberate-break proofs for every new or changed limit assertion: temporarily re-create the function broken, inside `lives_ok(...)` in a transaction that is rolled back, and show the matching test fails. Breaks to prove: cap 4 instead of 3; backstop limit 11 instead of 10; backstop check removed; counting not per restaurant (all restaurants); counting not per kind (pickup rows counted for table, or the reverse); 24-hour window widened (for example 25 h) and narrowed (for example 23 h); status filter added to the backstop (so cancelled/expired stop counting).
- The advisory lock stays, so the caps are safe against concurrent submits.
- Old tests are edited only where forced (list above), and every edit is listed in the PR body.
- One PR, two gates. **Gate A:** migration, pgTAP (new and forced older edits), deliberate-break proofs. **Gate B:** app wording, jest edits, docs and skill, manual run. Archan approves each gate. No `db push`, no `--linked`, no `service_role`, no secrets; CI must be green before merge.

## Out of scope
- Per-restaurant caps beyond the backstop, no-show tracking (v1.md §15 question 2), notifications and their throttling (spec 12), request filters (11c), theme refresh (11d).
- Any new table, column, index or RLS policy.
- Changing the seller side, the idempotency key logic, expiry times, the pickup or table time windows, or the party size range.
- Editing shipped specs 09, 10, 10b and 11 (they are history; this spec supersedes their limit numbers).
- Per-user admin overrides, captcha, IP-based limits (v1.md §3 and §16).

## Definition of done
- [x] pgTAP: 3 pending pickup requests are accepted, the 4th raises `too_many_pending`; same for table; nothing is written when refused.
- [x] pgTAP: pickup and table caps are independent (3 pending pickups do not block a table request, and the reverse).
- [x] pgTAP: a 2nd pending request to the same restaurant is refused for each kind; a different restaurant is accepted.
- [x] pgTAP: cancelling, accepting, declining and expiry (swept, and unswept with `expires_at <= now`) each free a pending slot; unswept overdue rows do not count toward the cap.
- [x] pgTAP: the hourly limit is gone: more than 10 submits in one hour to different places (12 for pickup, 11 for table; each cancelled right after so the pending cap is never reached) are all accepted. The only refusal is the backstop at the 11th submit to the same place within 24 hours.
- [x] pgTAP backstop: the 10th submit in 24 h to one restaurant is accepted, the 11th raises `rate_limited` and writes nothing, for pickup and for table.
- [x] pgTAP backstop: cancelled, expired, accepted and declined rows all count.
- [x] pgTAP backstop: kinds are independent (10 pickup rows to a restaurant do not block a table request to it, and the reverse); a different restaurant is not affected; a different customer is not affected.
- [x] pgTAP backstop: rows 23 hours 59 minutes old count, rows just over 24 hours old do not.
- [x] pgTAP: a replay (same idempotency key) at the pending cap and at the backstop limit returns the original row and writes nothing.
- [x] pgTAP outsider cannot: another customer's pending or recent rows do not count toward my caps; `anon` cannot execute either function; the existing tests that stop a user reading or cancelling another user's request still pass.
- [x] Deliberate-break proofs fail the matching test for every break listed in the rules, each wrapped in `lives_ok` and rolled back.
- [x] Both functions keep their exact signatures, return type, `security definer`, `search_path` and grants; `src/types/database.ts` is unchanged; the app on `main` works against the new server.
- [x] The new migration is pure ASCII and the non-ASCII byte check is clean under the rule in "Rules for implementation" (whole file for the migration and for files that are clean today, added lines only for the rest), on all changed source, test and markdown files (the markdown check also covers invisible characters such as zero-width spaces and bidirectional marks, proved on a scratch file first).
- [x] The app shows the new `too_many_pending` text ("You have too many requests waiting. You can have up to 3 pickup and 3 table requests waiting, and 1 per place. Cancel one or wait for an answer.") in the pickup form, table form and cancel/arrived error bars, and the new `rate_limited` text ("You've sent a lot of requests to this place today. Please try again tomorrow.") for the backstop; no other message changes.
- [x] The seed has a limit demo customer (`seed-customer-limit@example.com`) with 10 cancelled pickup requests to one restaurant within the last 24 hours of seed time, and no seeded customer has more than 3 pending requests per kind or more than 1 per business (a jest test asserts both).
- [x] `npm run lint`, `npm run typecheck`, `npm test` and `npx supabase test db` pass; CI is green.
- [x] `docs/product/v1.md` sections 8 and 9 state the limits, `.claude/skills/supabase-patterns/SKILL.md` has the new numbers, and no file outside the shipped specs 09, 10, 10b and 11 and the old migrations still states the old pending cap or the hourly limit for requests.

## Test plan
- Unit/component tests (jest): `messages.test.ts` covers the two new texts (and the apostrophe check); `PickupRequestForm.test.tsx` and the new `TableRequestFormLimits.test.tsx` show `too_many_pending` and `rate_limited` in the error bar with the new text; `api.test.ts` and `tableApi.test.ts` still map both codes; `scripts/seed/__tests__/requestsData.test.ts` covers the limit demo rows and the seeded pending counts.
- Database tests (pgTAP): edited `09-pickup-requests.test.sql` and `11-table-requests.test.sql` as listed, with new cases for the cap of 3, the 24-hour backstop (10th ok, 11th refused, every status counts, 23h59m counts, older than 24 h does not, per kind, per restaurant, per customer), replay at the limits, nothing written when refused, and the deliberate-break proofs. Plan counts updated.
- Manual check on device (iOS Simulator, run by Archan; seed accounts use password `password123`): sign in as `seed-customer-limit@example.com`, send a pickup request to `seed_rest_010` and see the new `rate_limited` text at once (the seed already holds 10 cancelled requests there from the last 24 hours), then confirm another place still works; as `seed-customer-sam@example.com` send pickup requests until 3 are waiting, see the new `too_many_pending` text on the 4th and on a second request to the same place, cancel one and send again; same for table requests at three restaurants that accept tables (a pickup still works while 3 tables wait).

## Decisions
- **Wording is final as in "Wording" above** (Archan, after the plan review): "place" instead of "restaurant" in both texts, no "or call them", straight apostrophes.
- **Seed and a new table-form test are in scope** (Archan): see "Files to create" and "Files to change". The optional escaping of the smart-quote regex in `messages.test.ts` is NOT approved; that line stays.
- **Non-ASCII rule** as written in "Rules for implementation".
- **pgTAP 10 and 10b** must keep passing unchanged; if either depended on the old caps, stop and ask Archan.

## Open questions
None. (Archan decided: backstop accepted at 10 per customer per restaurant per kind per rolling 24 hours; one `too_many_pending` code with the combined wording; one PR with two gates.)

## Results
- **Gate A (database):** migration `request_limits` re-creates both functions; each diff against its source shows only the cap constant, the removed hourly block, the new backstop block, and `create or replace` for the table function. pgTAP 09 (plan 271) and 11 (plan 364) pass, 10 and 10b pass unchanged; the whole suite is 2082 assertions on a freshly reset database. Deliberate-break proofs (breaks 1 to 9 plus 8b) each turned the matching tests red, run in rolled-back transactions through `lives_ok`.
- **Gate B (app, seed, docs):** the two new texts, the new table-form test, the limit demo seed customer, docs and skill notes. Lint, typecheck and the full jest run (186 suites, 2789 tests, run twice) pass.
- **Code review:** security found nothing above Low (the Low, no overall daily cap across places, is accepted and recorded for spec 12 in `docs/product/v1.md`, the carry-forward list); quality approved with suggestions, which were applied.
- **Manual check (iOS Simulator only, run by Archan; not a real iPhone and not Android):** all checks good. The backstop block at one place with another place still working; the pickup cap of 3 and 1 per place; the table cap of 3 with pickups independent; cancel and large text unchanged.
- **Carry-forward:** overall daily request cap across places and notification throttling (spec 12); a real iPhone and Android check of the two messages is still open; pgTAP 11 covers four statuses for the "every status counts" case while pgTAP 09 covers all six.
