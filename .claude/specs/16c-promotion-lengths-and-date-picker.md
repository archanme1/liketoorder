# Spec 16c: Promotion Lengths and Date Picker

**Branch:** `feature/promotion-lengths-and-date-picker` (spec commit only; shipped as a docs-only PR together with the 16b status commit 97e33f8). After that, two PRs, each cut from `main` once the previous one is merged: `feature/promotion-lengths-invoice` (PR 1) and `feature/promotion-lengths-app` (PR 2).
**Product spec:** `docs/product/v1.md` §7 (Ads: campaign, payment and activation), §3 (out of scope), §14 (roadmap; the 16c row is added in PR 2), §16 (before-launch items about the live price)
**Plan mode:** required. It changes the schema and a client function's signature, touches more than 5 files, and changes the Promote form.
**Status:** 📝 Spec written

## Overview
Today every promotion runs for 7 days at one price, read from the single `promotion_settings` row, and the seller chooses a preferred start from 14 day chips. After this spec, the seller chooses **how long** the campaign runs: 1, 3, 5, 7 or 30 days. They pick the **preferred start day in a calendar pop-up**. Each length has its own price, held in a new `promotion_plans` table that Archan changes with admin SQL, never with an app update.

The app still **never shows a price or payment wording** (store rules, spec 16b Resolved Q15). The seller chooses a length with no price next to it. The price appears only on the Stripe invoice, and Archan may also publish it on his own website; the app never links there. Payment stays outside the app through Stripe Invoicing (spec 16b, unchanged).

The length and the price are locked when Archan approves the headline, as today. The invoice line reads "LikeToOrder promotion, 3 days", or "1 day" for a 1-day campaign. The campaign runs from its start for exactly its length.

This spec comes now because 16b built the payment route around one fixed length, and 16b PR 4 (launch docs) should describe the final offer.

### What people see, in plain words
**Seller, Promote screen, invitation (no campaign yet):**
- "A larger flag on the map and a card in Offers for the days you choose, both marked Sponsored." This replaces "... for 7 days ...".
- "We review every headline before it goes live." (unchanged)
- The form, in this order:
  1. **Category** (unchanged)
  2. **Headline** (unchanged)
  3. **How long:** radio chips "1 day", "3 days", "5 days", "7 days", "30 days". Only the lengths the server offers are shown, in that order. **None is chosen at first** (7 is not special). Sending without one shows "Choose how long it runs." on the field.
  4. **Preferred start** (calendar pop-up, below)
  5. **Send request**
- No price, amount, currency or "per day" anywhere.

**The calendar pop-up (Preferred start):**
- The field shows "As soon as possible" until a day is chosen, then "Preferred start: Tuesday, December 2".
- Its button reads "Choose start day", or "Change start day" once a day is chosen. A second button, "Clear start day", appears only when a day is chosen and goes back to "As soon as possible".
- **iOS:** the button opens a dialog titled "Preferred start day" with the inline calendar (`mode="date"`), plus Cancel and Done. Done applies the day; Cancel, the backdrop and back discard it. At very large text sizes it switches to the compact wheels (`pickerDisplay` from `PickupTimePicker`).
- **Android:** the system date dialog. That dialog ignores the minimum and maximum, so the result is clamped (the `PickupTimePicker` pattern).
- **Days offered:** from **today** to **today + 60 days**, both counted in **America/Toronto**, whatever zone the phone is in. Days outside that range cannot be chosen.
- **A chosen day that has passed** (the form was left open overnight): on send, the app clears it back to "As soon as possible" and shows "That start day has passed. Pick another one." It does not send. The server refuses it anyway (`invalid_start`), and the form already clears the field on that code.
- The note under the field is unchanged: "We'll confirm the exact dates when your promotion is scheduled."

**After sending (status card):** requested and headline-approved cards also show "Length: 3 days", because no dates exist yet. The other states keep their date-based wording, so nothing changes there: "Paid and scheduled. Starts on 2 Dec, ends on 5 Dec.", "Scheduled. Starts on ...", "Active until 5 Dec.", "Ended on 5 Dec.". The dates come from the server window (`ends_at = starts_at + length_days`). No state wording mentions 7 days any more.

**No lengths offered** (no active plan, for example on the live project until launch): the screen keeps today's "Promotions aren't available yet." and shows no form (Resolved Q4).

**Customers:** nothing changes. A 1-day or 30-day campaign looks like any other.

**Archan (admin SQL, runbook):** changes the price of a length, turns a length off or on, and approves headlines (the chosen length's price is locked then). The Stripe invoice says "LikeToOrder promotion, N days".

### Accessibility
- **Length chips:** the existing `ChoiceChips` pattern.
  - `accessibilityRole="radiogroup"` with the label "How long", and each chip `radio` with `accessibilityState.selected`.
  - Spoken as "3 days", or "3 days, selected". The selection is also shown by a check mark and bold text, never by colour alone.
  - 44 pt minimum targets; the chips wrap at the largest text size (`maxFontMultiplier`).
  - The error line starts with the warning sign and uses a polite live region.
- **Calendar buttons:** `Button` with labels "Choose start day" / "Change start day" / "Clear start day". The current choice is read as text before the button.
  - iOS dialog: `accessibilityViewIsModal`; focus moves to the title on open; Cancel is labelled "Cancel, keep the current start day" and Done is labelled "Done, use this start day".
- **Reduce Motion:** nothing new loops. The dialog uses `animationType="none"` under Reduce Motion (`useReduceMotion`), as `PickupTimePicker` does.
- **Largest text:** every line wraps, Cancel and Done stay in view, and the control scrolls.

## Depends on
- 16 promotions: ✅ Shipped.
- 16b promotion payment: PR 1 to 3 shipped (#40 to #42). PR 4 (launch docs) comes after 16c by Archan's choice, and 16c does not need it.
- 11 table-requests: `PickupTimePicker` and its jest mock of the date picker.

## Context to load
- `CLAUDE.md`, this spec, and `docs/product/v1.md` §7 and §16
- `.claude/specs/16b-promotion-payment.md`: Money rules, Database changes ("PR 1 as built"), D2, D15, the hosted-rollout line
- `.claude/skills/supabase-patterns/SKILL.md`
- PR 1: `supabase/functions/promotion-invoice/{handler.ts,rpc.ts}`, `supabase/functions/tests/promotion-invoice.test.ts`
- PR 2, database: `supabase/migrations/20261122022052_promotion_payment.sql` (the `request_promotion`, `admin_review_promotion` and `begin_promotion_invoice` blocks), `supabase/migrations/20261124145046_promotion_price_out_of_app.sql`, `supabase/tests/16-promotions.test.sql`, `supabase/tests/16b-promotion-payment.test.sql`, `supabase/tests/05-seller-onboarding.test.sql` (allowlist), `supabase/seed.sql`, `scripts/seed/promotions.ts`, `docs/runbooks/promotions-admin.md`
- PR 2, app: `src/features/promotions/{schema,api,format,messages}.ts`, `components/{PromoteForm,PromoteScreen,PromotionStatusCard}.tsx`, `__fixtures__/{promotion,noPayment}.ts`, `src/features/requests/components/PickupTimePicker.tsx` (the pattern), and `jest.setup.ts` (the date-picker mock, around line 378)

## User stories
- As a seller, I choose how long my promotion runs (1, 3, 5, 7 or 30 days) without seeing a price in the app, and the invoice I get by email charges the price of that length.
- As a seller, I pick my preferred start day in a calendar and can clear it to start as soon as possible.
- As a seller, my campaign ends exactly its length after it starts, and the app shows the real dates.
- As Archan, I set or change the price of each length and turn lengths off or on with one SQL statement, with no app update.
- As Archan, a price change never alters a campaign whose headline I already approved.

## Screens & routes
- `app/seller/promote.tsx`: unchanged route. `PromoteScreen` gets the length chooser and the calendar field. Seller only.
- No new route, tab or customer screen.

## Database changes
One migration in PR 2 (`npx supabase migration new promotion_plans`). No existing migration is edited.

```sql
-- 1. Plans: one row per offered length. Prices are Archan's and change only by admin SQL.
create table public.promotion_plans (
  length_days   integer primary key check (length_days in (1, 3, 5, 7, 30)),
  price_cents   integer not null check (price_cents > 0),
  currency_code text    not null default 'CAD' references public.currencies(code)
                          check (currency_code = 'CAD'),
  active        boolean not null default true,
  updated_at    timestamptz not null default now()
);
alter table public.promotion_plans enable row level security;
revoke all on public.promotion_plans from anon, authenticated;
-- No policies: only the security-definer functions below read it.

-- 2. Data: the single settings row (if any) becomes its plan. Spec 16 always used length 7.
--    A row that cannot become a plan (another length or currency) stops the migration
--    instead of being lost.
insert into public.promotion_plans (length_days, price_cents, currency_code)
select s.length_days, s.price_cents, s.currency_code from public.promotion_settings s;
-- (the check constraints raise for any length other than 1/3/5/7/30 or a non-CAD currency)
drop table public.promotion_settings;
```

- **Existing promotions are not touched.** Their stored `length_days` (7), `price_cents` and `currency_code` stay; no `promotions` column changes. A `payment_due` row keeps its locked price.
- **The live project** has no settings row today, so it gets no plan row. That is intended: live plan rows are added only when the payment route is live (Before launch).
- **Migration safety proof** (as in 16b PR 1): a local snapshot before and after `migration up`, compared with `cmp`.
  - Setup: a settings row `(2500, CAD, 7)` and promotions in each stored state.
  - Expected: the `promotions` dump is identical; `promotion_plans` has exactly `(7, 2500, CAD, true)`; `promotion_settings` is gone.
  - A second scratch run with a settings row of length 14 must make the migration fail (then roll back).

**Admin SQL (runbook):**
```sql
-- set or change the price of one length (also turns it on)
insert into public.promotion_plans (length_days, price_cents) values (3, 1200)
  on conflict (length_days) do update set price_cents = excluded.price_cents, active = true, updated_at = now();
-- turn a length off (sellers stop seeing it; requests already sent keep their price)
update public.promotion_plans set active = false, updated_at = now() where length_days = 30;
```

**RLS and privileges:** RLS is on for `promotion_plans`, with no policies and no grants to `anon` or `authenticated`. `service_role` keeps the default access that the seed script and the Studio use, as `promotion_settings` had. `promotions` client grants are unchanged (none).

**Functions** (all `security definer`, `set search_path = ''`, revoke from `public, anon, authenticated`, then grant as listed):

| Function | Change | Grant |
|---|---|---|
| `public.request_promotion(p_category text, p_headline text, p_preferred_start date, p_length_days integer)` | **New signature.** The old `(text, text, date)` is **dropped in the same migration** (see "Retiring the old signature"). The checks run in this order: `not_authenticated`, `not_eligible`, then `not_configured` (no active plan at all), `invalid_category`, `invalid_headline`, `invalid_length` (null or not an active plan), `invalid_start`. A start day is valid only from the Toronto date today to today + 60; the old rule was UTC date -1 to +90. The insert snapshots the plan's `price_cents`, `currency_code` and `length_days`. Everything else is the 16b body: lapsed `payment_due` handling, `already_open`, the 5-per-day cap, the unique-violation backstop. It returns `get_my_promotion()`. | authenticated |
| `public.get_my_promotion()` (same signature) | Answer: `{ promotion, lengths, eligible }`. `lengths` lists the active plans' `length_days` in ascending order, such as `[1,3,5,7,30]`, or `[]` when none are active. **No price, currency or plan object.** The `settings` key is gone. | authenticated (unchanged) |
| `private.admin_review_promotion(...)` (same signature) | `approve_headline` locks the price and currency of **the plan matching the row's own `length_days`** (the seller's choice), not the 7-day plan, and still sets `pay_by = now() + 7 days`. No plan row for that length raises `not_configured`. A plan turned off since the request raises `plan_unavailable` (Resolved Q6). `approve` (free), `reject` and `cancel` are unchanged. | none (database owner) |
| `public.begin_promotion_invoice(uuid)` | **Unchanged.** It already returns `length_days` from the locked promotion row, and `amount_cents` from the payment row, which copies the locked `price_cents`. | service_role (unchanged) |
| `public.record_stripe_event(...)` | **Unchanged.** `ends_at = starts_at + make_interval(days => p.length_days)` already follows the stored length. | service_role (unchanged) |
| `private.promotion_json(uuid)`, `public.cancel_my_promotion(uuid)` | **Unchanged.** `promotion_json` already returns `length_days`. `cancel_my_promotion` returns the new `get_my_promotion` shape. | unchanged |

**Retiring the old signature safely.** `drop function public.request_promotion(text, text, date)` and `create function ... (text, text, date, integer)` happen in one migration, with no overload kept. This is safe for three reasons:
- **The rollout order holds:** the app version goes first or together, then all 16b and 16c migrations at once, never a migration before the app.
- **The live project can't take requests today anyway:** it has no settings or plan row, so every request there is already refused with `not_configured`.
- **The new app handles an old server:** it drops a legacy `settings` key before its strict parse, and `lengths` defaults to `[]`. So against an old server it shows "Promotions aren't available yet." and never calls the missing function.

An old app against the new server gets an error state on the Promote screen, which the rollout order rules out. pgTAP proves the old signature is gone (`hasnt_function`).

**pgTAP: existing assertions that must change** (one-for-one, same count unless noted; each is listed again at gate B):

`supabase/tests/16-promotions.test.sql` (plan 228):
- L191-192 setup: insert the 7-day row into `promotion_plans` instead of `promotion_settings`.
- L197, L199-200, L204-207, L212-215, L217-218 (table exists, RLS, table privileges for anon and authenticated, column privileges, no policies): point them at `promotion_plans`.
- L234, L240 (`request_promotion` execute privilege): the signature becomes `(text, text, date, integer)`.
- L299-304 and L314-318 (authenticated and anon cannot read, insert, update or delete settings): point them at `promotion_plans`.
- All 38 `request_promotion(...)` calls get a 4th argument `7`.
- L342-345 (`not_configured`): delete from and re-insert into `promotion_plans`.
- L389-390, L490, L556-557: the key set becomes `['eligible', 'lengths', 'promotion']`.
- L395-396 and L561-562: "settings has exactly the length" becomes `lengths = '[7]'`.
- L551: "settings is null with no row" becomes `lengths = '[]'`.

`supabase/tests/16b-promotion-payment.test.sql` (plan 221):
- L174-175 setup: `promotion_plans`.
- L333-336: wording only ("locks the plan price of its length").
- L339 and L343: `update public.promotion_plans set price_cents = ... where length_days = 7`.
- L342: wording ("not the changed plan").
- L587, L592, L681: the 4th argument `7`.
- L675-676 (the D15 `settings` key set) becomes: "lengths is an array of integers with no price".

`supabase/tests/05-seller-onboarding.test.sql`: the allowlist holds function **names**, and `request_promotion` keeps its name, so no change is expected. Gate B confirms it.

**New pgTAP file `supabase/tests/16c-promotion-lengths.test.sql`:**
- `promotion_plans`:
  - **outsiders:** RLS is on with no policies; anon and authenticated hold no table or column privileges; **an outsider (anon or authenticated) cannot select, insert, update or delete a plan** (42501).
  - **check constraints:** length 2 is refused; price 0 is refused; USD is refused.
- **Signatures:** the old `(text, text, date)` signature is gone; the new one exists; anon cannot execute it; authenticated can.
- **`request_promotion`:**
  - each of 1/3/5/7/30 stores that length and that plan's price and currency;
  - an inactive length, 14, 0 and null each give `invalid_length`;
  - no active plan gives `not_configured`;
  - start days in Toronto: yesterday gives `invalid_start`, today is accepted, +60 is accepted, +61 gives `invalid_start`.
- **`get_my_promotion`:**
  - `lengths` lists the active lengths only, ascending;
  - `[]` when none are active;
  - no key named `price_cents`, `currency_code`, `amount_cents` or `price` anywhere in the answer, in any state (recursive key scan).
- **`approve_headline`:**
  - a 3-day request locks the 3-day price;
  - changing the 3-day price afterwards does not change `begin_promotion_invoice`'s `amount_cents`;
  - a plan turned off before approval gives `plan_unavailable`;
  - a deleted plan gives `not_configured`;
  - a free `approve` on a 5-day row ends exactly 5 days after it starts.
- **`begin_promotion_invoice`** returns `length_days` 3 for a 3-day row.
- **`record_stripe_event` `invoice.paid`:**
  - on a 1-day row, `ends_at = starts_at + 1 day`;
  - on a 30-day row, `+ 30 days`;
  - the overlap rule (`promotions_no_overlap`) still refuses an overlapping window.
- **Stored rows:** a 7-day row from before keeps `length_days` 7 and its price after the 7-day plan's price changes or the plan is turned off.

**Deliberate breaks (PR 2, database), each run in a scratch transaction, red on its named test, then restored and proven with `cmp` (function md5s and grants):**
- **L1:** grant the new `request_promotion` to anon (red on "anon cannot execute request_promotion").
- **L2:** `approve_headline` reads the 7-day plan instead of the row's length (red on "a 3-day request locks the 3-day price").
- **L3:** `request_promotion` ignores `active` (red on "an inactive length gives invalid_length").
- **L4:** `get_my_promotion` returns plan prices (red on the key scan).
- **L5:** keep the old 3-argument signature (red on `hasnt_function`).
- **L6:** `record_stripe_event` uses 7 days instead of `length_days` (red on "1-day row ends 1 day after start").
- **L7:** the migration without the plan check constraint (a settings row of length 14 is silently carried over or lost; red in the scratch snapshot run).

## Storage
None.

## Edge Functions
**`promotion-invoice`** (PR 1; no database change, no deploy):
- **Description bug:** `handler.ts:105` builds "LikeToOrder promotion, ${length_days} days", which reads "1 days" for a 1-day campaign. Replace it with a pure exported `invoiceDescription(lengthDays)`: "LikeToOrder promotion, 1 day" or "LikeToOrder promotion, N days". It is used for both the invoice `description` and the invoice item's `description` (L123, L152).
- **Amount:** unchanged. It is already `begin.amount_cents`, taken from the locked payment row and never from a plan.
- **`rpc.ts` L23:** `length_days` is narrowed from "any positive integer" to 1 to 60, matching the column check. An out-of-range value becomes `internal_error` before any Stripe call.
- **The `stripe-webhook` does not change:** it never reads the length. Activation and `ends_at` are in `record_stripe_event`, which already uses the stored length.
- **Tests (Deno, fake `fetch`, fake RPC):**
  - the description and item for 1 day (singular), 3 days and 30 days;
  - the item amount equals begin's `amount_cents` for a 30-day row;
  - an out-of-range `length_days` makes no Stripe call.
- **Deliberate breaks:**
  - W14: always plural (red on the 1-day test);
  - W15: hard-code 7 (red on the 3 and 30-day tests).
  - Each is run in a scratch copy and restored with `cmp`.
- **Does it need PR 2b (16b hardening) first?** No. PR 2b concerns `attach_invoice` error codes and the livemode compare, which this PR does not touch. PR 2b stays a before-launch item.
- Nothing is deployed; Archan deploys at release.

## Components & hooks
- `schema.ts`:
  - `myPromotionSchema` becomes `{ promotion, lengths, eligible }`. `lengths` is an array of unique, ascending integers from 1 to 60, at most 10, with a default of `[]`.
  - A legacy `settings` key is dropped before the strict parse, like `LEGACY_PRICE_KEYS`, so an older server does not break the app.
  - `promoteFormSchema` gains `lengthDays`: a number that is required, with the message "Choose how long it runs.".
  - `preferredStart` stays a date or null.
- `api.ts`: `requestPromotion` sends `p_length_days`. The new error code `invalid_length` joins `PromotionErrorCode`.
- `messages.ts`:
  - `invalid_length`: "That length isn't available any more. Choose another one."
  - `LENGTH_REQUIRED`: "Choose how long it runs."
  - `START_PASSED`: "That start day has passed. Pick another one."
  - `START_DAY_TITLE`: "Preferred start day".
  - `ASAP_LABEL` is kept; `START_NOTE` is unchanged.
- `format.ts`:
  - `lengthLabel(n)` returns "1 day" or "N days"; `campaignLength` stays for "for N days" if it is still used, otherwise it is removed.
  - `invitationText()` takes no argument and returns the new sentence.
  - `startDayBounds(today)` returns `{ min: today, max: today + 60 }`; `TORONTO = 'America/Toronto'`.
  - Removed: `START_DAY_COUNT`, `startDayOptions`, `formatChipDayLong` (no chips any more). `formatChipDay` stays, because the status card uses it.
  - `statusText` is unchanged: its wording is all date-based.
- `components/PromoteForm.tsx`:
  - the length `ChoiceChips` comes from a new `lengths` prop;
  - the start-day chips are replaced by `StartDayPicker`;
  - on submit, a past start day is cleared with `START_PASSED`;
  - `invalid_length` is set on the length field.
- **New** `components/StartDayPicker.tsx`: date-only. It follows `PickupTimePicker`'s modal, focus, Reduce Motion and Android clamp pattern and reuses its exported `pickerDisplay`. `PickupTimePicker` itself is not changed.
  - The days offered are computed in America/Toronto, with `timeZoneName="America/Toronto"`.
  - The picked date is converted back to a `YYYY-MM-DD` Toronto day with `localToday`.
  - `onOpen` re-reads "now", so a form left open still offers valid days.
- `components/PromoteScreen.tsx`: `Invitation` reads `lengths`. An empty list shows the `not_configured` message; otherwise it passes `lengths` to the form.
- `components/PromotionStatusCard.tsx`: "Length: N days" on the requested and awaiting-payment cards.
- No new hook. `useRequestPromotion` passes the new field through.

## Files to create
- PR 1: none (tests are added to the existing `promotion-invoice.test.ts`).
- PR 2:
  - `supabase/migrations/<ts>_promotion_plans.sql`
  - `supabase/tests/16c-promotion-lengths.test.sql`
  - `src/features/promotions/components/StartDayPicker.tsx`
  - `src/features/promotions/__tests__/StartDayPicker.test.tsx`

## Files to change
- **PR 1:** `supabase/functions/promotion-invoice/{handler.ts,rpc.ts}`, `supabase/functions/tests/promotion-invoice.test.ts` (L179, L387, L397 plus the new cases).
- **PR 2, database:**
  - `supabase/tests/16-promotions.test.sql` and `16b-promotion-payment.test.sql` (exactly the lines listed above);
  - `supabase/seed.sql`, `scripts/seed/promotions.ts`, `src/types/database.ts` (regenerated);
  - `docs/runbooks/promotions-admin.md` (plan SQL, `plan_unavailable`);
  - `docs/product/v1.md`: §7 (lengths, no fixed length), §14 (add the 16c row), §16 (the "live price" items now name `promotion_plans`).
- **PR 2, app:**
  - `schema.ts`, `api.ts`, `format.ts`, `messages.ts`, `PromoteForm.tsx`, `PromoteScreen.tsx`, `PromotionStatusCard.tsx`;
  - fixtures `__fixtures__/promotion.ts` (`settings` becomes `lengths`) and `__fixtures__/noPayment.ts`;
  - tests that hard-code 7 or the old shape: `schema.test.ts`, `format.test.ts`, `messages.test.ts`, `hooks.test.tsx`, `PromoteForm.test.tsx` (the start-chip tests from L157 are replaced by picker tests, plus length tests), `PromoteScreen.test.tsx`, `a11y.test.tsx` (radios now include the lengths), `noPaymentInApp.test.ts`, `api.test.ts` (`p_length_days`);
  - CLAUDE.md row.
- **Seed:**
  - **`supabase/seed.sql`:** the `promotion_settings` insert becomes five `promotion_plans` rows, under a comment block: "PLACEHOLDER PRICES, LOCAL DEVELOPMENT ONLY. NEVER PUT THESE ON THE LIVE PROJECT. Real prices are Archan's and are set by admin SQL only when the payment route is live." The rows are 1 day 500, 3 days 1200, 5 days 1900, 7 days 2500, 30 days 8000, all CAD. `seed.sql` runs only on a local `db reset`.
  - **`scripts/seed/promotions.ts`:** reads `promotion_plans` (service role, local) and gives the demo campaigns different lengths: a paid scheduled 3-day, a free active 30-day, an ended 1-day, the rest 7-day. Each uses its own plan's price for `price_cents` and the payment row. `assertLocalUrl` still refuses any URL that is not localhost or 127.0.0.1.
- **No-payment scans (`__fixtures__/noPayment.ts`, `noPaymentInApp.test.ts`):**
  - **Rendered patterns stay.** A length such as "1 day" or "30 days" is allowed, and none of the patterns matches it (checked: `/\d+[.,]\d{2}\b/` needs a decimal part).
  - **Added rendered pattern:** `/\bper (day|week|month)\b|\/ ?day\b/i`, which is price-rate wording, so the pinned count goes up by one.
  - **`ALLOWED_STATUS_WORDS`:** the new invitation sentence replaces the 7-day sentence, plus "1 day", "30 days" and "Length: 3 days".
  - **Source scan:** adds `promotion_plans`. The app must never name the table; the grep command in the Definition of done gains that word.

## New dependencies
No new dependencies and no native rebuild. `@react-native-community/datetimepicker` 9.2.1 is already installed and in the development build (spec 11, `PickupTimePicker`), and `mode="date"` is part of the same native module. The jest mock (`jest.setup.ts`, `datetimepicker-<mode>`) already covers `date`.

## Rules for implementation
- RLS on the new table, plus pgTAP proving outsiders are refused. Supabase calls only in `src/features/promotions/api.ts`. Theme tokens only. Loading, empty, error (with Retry) and success states. Labels, roles and 44 pt targets.
- **No price in the app, ever:** the app never receives a plan price (`get_my_promotion` returns lengths only), never shows one, and never says "per day". A length on its own is allowed.
- **Prices change only by admin SQL;** no client function writes `promotion_plans`.
- **Placeholder prices** live only in `seed.sql`, the seed script and tests, each marked as a placeholder. They are never written to the live project, and live plan rows are set only after the payment route is live.
- **Lock at approval:** Stripe always gets the locked row's amount, never a plan's current price.
- **Time:** the start day is a Toronto calendar day, on the server and in the app.
- **Process:**
  - migrations are append-only; `npm run db:types` after the migration; all SQL and TS ASCII-only, byte-checked after writing;
  - no db push, no `--linked`, no deploy, no secrets, no Stripe call, no account; the tests use fakes only;
  - if the guard hook blocks anything, stop and ask.

## Out of scope
- Prices in the app in any form, including "from" prices, per-day rates or a link to Archan's website.
- Coupons, discounts, credits, bundles.
- Custom lengths (any length other than 1, 3, 5, 7, 30); adding one needs a migration (check constraint).
- Auto-renewal or subscriptions.
- A plans admin screen.
- Per-business prices or plans (Resolved Q3).
- Changing the length after the request is sent (cancel and request again).
- A start time of day: the start stays a day, beginning at 00:00 Toronto.
- Everything in spec 16b's Out of scope and v1 §3.

## Definition of done
**PR 1 (`feature/promotion-lengths-invoice`, functions):**
- [ ] `invoiceDescription` gives "LikeToOrder promotion, 1 day" and "LikeToOrder promotion, 30 days", and both invoice and item use it (Deno).
- [ ] The amount comes from begin's locked `amount_cents` for a 30-day row; an out-of-range `length_days` makes no Stripe call.
- [ ] Breaks W14 and W15 are red on their named tests and restored with `cmp`; `deno lint`, `deno task check` and `deno task test` are green.
- [ ] `git diff --stat main -- supabase/migrations src app` is empty.
- [ ] The webhook diff is empty. Nothing is deployed.

**PR 2 (`feature/promotion-lengths-app`, database and app):**
- [ ] **An outsider (anon or authenticated) cannot read, insert, update or delete `promotion_plans`,** and cannot execute the old `request_promotion` signature, which is gone. Anon cannot execute the new one (pgTAP).
- [ ] The migration safety snapshot: `promotions` is `cmp`-identical before and after; the 7-day plan equals the old settings row; a length-14 settings row makes the migration fail.
- [ ] Every new 16c pgTAP assertion above, and the exact 16 and 16b edits, are done; `npx supabase test db` is green; breaks L1 to L7 are red on their named tests and restored with `cmp`.
- [ ] `get_my_promotion` carries `lengths` only: no price key in any state (pgTAP key scan and the zod strict parse).
- [ ] The form:
  - the length chips come from the server, with none chosen at first;
  - sending without a length shows "Choose how long it runs.";
  - the request sends `p_length_days`;
  - `invalid_length` lands on the length field.
- [ ] The start day:
  - the calendar offers Toronto today to +60;
  - Cancel discards, Done applies, Clear goes back to "As soon as possible";
  - a passed day is cleared on send with `START_PASSED` and not sent;
  - Android clamps (jest with the mock).
- [ ] **No "7 days" is hard-coded** in `src/features/promotions` outside tests and fixtures (grep). The invitation uses the new sentence; the requested and awaiting cards show "Length: N days".
- [ ] **No price or payment wording:** the rendered scan passes in every state with lengths 1 and 30 shown, the source scan passes, and the documented grep gives nothing:
  ```bash
  grep -rnE "price_cents|currency_code|amount_cents|promotion_plans|per day|formatPromotionPrice|[Ii]nvoice" src/features/promotions app/seller/promote.tsx --exclude-dir=__tests__ --exclude-dir=__fixtures__
  ```
  (expected: only the `LEGACY_PRICE_KEYS` line of `schema.ts`)
- [ ] Accessibility (jest):
  - the length radiogroup with its selected state in words; 44 pt targets;
  - the picker buttons labelled; the dialog modal with focus on its title;
  - `animationType` "none" under Reduce Motion.
- [ ] Breaks J4 to J6 are each red on their named test and restored with `cmp`:
  - J4: a price shown next to a length chip (red on the rendered scan);
  - J5: 7 preselected (red on "none chosen at first");
  - J6: the start-day bound computed in UTC instead of Toronto (red on the zone test with a fixed `now` near midnight).
- [ ] The seed loads five placeholder plans marked as placeholders; `scripts/seed/promotions.ts` still refuses a hosted URL; `db:types` is regenerated; lint, typecheck and jest are green; the runbook and v1 §7, §14 and §16 are updated.
- [ ] Archan's Simulator rounds S1 to S6 pass.

## Test plan
- **Deno (PR 1):** fake RPC and fake `fetch`; the description and amount cases above.
- **pgTAP (PR 2):** the 16c file and the edited 16 and 16b files; run with `npx supabase db reset` then `npx supabase test db` (local only). The migration snapshot procedure is run once by Claude against local Docker only.
- **jest (PR 2):**
  - `StartDayPicker.test.tsx`: bounds in Toronto, Cancel, Done, Clear, Android clamp, Reduce Motion, labels;
  - the length cases in `PromoteForm.test.tsx`;
  - `PromoteScreen.test.tsx`: no lengths gives the not-available message; the length line on the cards; the rendered scan with all lengths;
  - schema: `lengths` parsing and legacy `settings` dropped;
  - the updated existing tests.
- **Simulator rounds (Archan, iOS Simulator, local only, one at a time, after `npx supabase db reset`, the seed scripts and `npx expo start --dev-client`; no rebuild):**
  - **S1 Invitation:** `seed-restaurant-001`. Expect the new sentence, chips 1 day / 3 days / 5 days / 7 days / 30 days with none chosen, and no price anywhere. Then the largest text size: everything wraps.
  - **S2 Required length:** fill category and headline, send. Expect "Choose how long it runs." under How long. Do not send yet.
  - **S3 Calendar:** Choose start day.
    - Today is the earliest day and +60 the latest; days after +60 are greyed.
    - Cancel keeps "As soon as possible"; pick a day, then Done shows it; Clear start day goes back.
    - VoiceOver starts on "Preferred start day".
    - At the largest text, the wheels appear and Cancel and Done stay visible.
  - **S4 Send a 3-day request** with a start day. Expect "Waiting for review.", "Length: 3 days" and "Preferred start: ...". Then in the local SQL editor run the free `approve` (runbook) with a start time. Pull to refresh: "Scheduled. Starts on X, ends on X+3."
  - **S5 Seeded 30-day:** `seed-restaurant-002` shows "Active until <30 days after start>". The paid 3-day demo shows "Paid and scheduled. Starts on ..., ends on ..." with 3 days between.
  - **S6 Plans switched off:** in the SQL editor, `update public.promotion_plans set active = false where length_days = 30;` then Promote again on a demo with no open campaign, then pull to refresh: 30 days is gone. Turn all lengths off: "Promotions aren't available yet." Turn them back on.
- **Before launch** (not this spec's PRs): the Android date dialog on a real phone; VoiceOver and TalkBack on the chips and the dialog.

## Delivery: PRs and gates
I stop and commit at every gate (files staged by name, a conventional message, no push) and wait for Archan's "approved".

| PR | Branch | Gates | Migration |
|---|---|---|---|
| spec | `feature/promotion-lengths-and-date-picker` | **A** spec + CLAUDE.md row (plus the carried 16b status commit 97e33f8). Docs-only PR. | No |
| 1 invoice wording | `feature/promotion-lengths-invoice` | **B1** `invoiceDescription`, `rpc.ts`, Deno tests. **B2** breaks W14 and W15. Review, ship. Nothing deployed. | No |
| 2 database + app | `feature/promotion-lengths-app` | **C1** migration + 16c pgTAP + the 16/16b edits, `test db` green, snapshot proof, breaks L1 to L7. **C2** seed (placeholders), `db:types`, schema/api (main keeps working from here), runbook, v1. **C3** length chips + `StartDayPicker` + form tests. **C4** screen and card wording, fixtures, scans, breaks J4 to J6. **F** Archan's Simulator rounds S1 to S6. Review, ship. | **Yes** (one) |

**Why the database and the app share one PR:** the migration drops the old `request_promotion` signature, which the app on main calls. Splitting them would leave main broken between PRs, or would need a second migration to drop a temporary overload. The gates keep each step small.

**Hosted rollout:** the app version first or together, then all 16b and 16c migrations at once; never a migration before the app. After that, 16b PR 4 (launch docs) describes the plans.

## Before launch (adds to spec 16b's list)
1. Live plan rows (real prices, Archan's decision after the accountant, Q11 of 16b) are set by admin SQL **only after the payment route is live** (16b before-launch items 2 to 4, 7 and 8 done). The live project keeps no plan row until then.
2. The real-money test uses the 1-day plan: check the invoice reads "LikeToOrder promotion, 1 day" and the amount equals that plan.
3. If Archan publishes the prices on his website, the app still never links there.
4. The Android date dialog and the screen readers checked on real phones.

## Resolved questions
Resolved by Archan on 2026-11-24.

1. **Q1 30-day frequency:** no extra limit on 30-day purchases (they pay). The one-open-campaign rule and the no-overlap rule stay.
2. **Q2 Long campaigns:** `pay_by` stays 7 days for every length; no extra scheduling limit.
3. **Q3 Turning lengths off:** no per-business plans in v1; one global `active` flag per length only.
4. **Q4 No active plans:** the seller sees "Promotions aren't available yet." and no form.
5. **Q5 Invoice text:** the invoice shows the length only ("LikeToOrder promotion, 3 days"), no dates.
6. **Q6 A length turned off after the request:** `approve_headline` refuses with `plan_unavailable`; Archan turns the plan back on or rejects the request.
7. **Q7 Start-day range:** today to today + 60 in America/Toronto, in the app and on the server.
8. **Q8 Length on the card:** "Length: N days" on the requested and awaiting-payment cards.

## Open questions
None of Archan's left for this spec. Spec 16b Q11 (tax: the accountant's view on HST, a tax-inclusive price and what the invoice must show) stays open there; it blocks live prices, not building.
