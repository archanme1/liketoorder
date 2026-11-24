# Spec 16b: Promotion Payment

**Branch:** `feature/promotion-payment` (spec commits only, shipped as a docs-only PR). Then four PRs, each cut from `main` after the previous one is merged: `feature/promotion-payment-db` (PR 1), `feature/promotion-payment-functions` (PR 2), `feature/promotion-payment-app` (PR 3), `feature/promotion-payment-launch-docs` (PR 4).
**Product spec:** `docs/product/v1.md` §7 (Ads: payment and activation), §3 (out of scope), §13 (Legal), §14 row 16b, §15 Q1, §16 (the five spec 16b items)
**Plan mode:** required: it changes the schema and RLS, adds two Edge Functions with server secrets and touches more than 5 files.
**Status:** 🚧 In progress: spec PR #39 (990edd2), PR 1 #40 (ef847fe) shipped 2026-11-23, PR 2 next. Amended 2026-11-21 after gate S (sellers pay **outside the app**) and after Q13 / Q15 (Stripe Invoicing; no price or payment wording in the app). Amended 2026-11-22 with the PR 1 build decisions (see "PR 1 as built" under Database changes, and D18). Amended 2026-11-23 at PR 2 gate D0 (Stripe research, Archan's answers to the PR 2 plan questions; see "PR 2 research (D0)" under Edge Functions).

## Overview
Today a seller asks for a promotion, Archan reads the headline, sends an invoice outside the app and switches the campaign on with one SQL call. After this spec, Stripe sends the invoice and the campaign switches on by itself, and **all payment happens outside the app** (Store rules):

1. The seller requests a promotion with a category and a headline (spec 16, unchanged).
2. Archan approves the **headline** with one SQL call. The price is locked at this moment.
3. Archan runs one admin command. Our server asks Stripe to create an invoice, and **Stripe emails the seller** an invoice with a link to Stripe's hosted pay page (D14).
4. The seller pays on Stripe's page in their browser. The app never sees card numbers, and never shows a price, a Pay button, a link or payment instructions.
5. Stripe tells our server that the invoice was paid (a signed webhook). Only that message schedules the campaign.
6. The next time the seller opens or pulls to refresh the Promote screen, it shows "Paid and scheduled". The campaign then runs exactly as in spec 16 (larger flag, Offers card, Sponsored) and ends by the server clock.

The invoice, its email and the hosted page show the public business name **"welcometohvac"**, and the line item reads **"LikeToOrder promotion, 7 days"**, so a buyer sees both names together (D1). It comes now because spec 16 built every surface a paid campaign shows on, and manual invoicing and activation do not scale.

### What people see, in plain words

**Seller, Promote screen (Manage Business, seller mode on).** Status only: no price, no Pay button, no payment link, and no wording that points to paying somewhere else (Resolved Q15).
- **Invitation (no campaign yet):** what a promotion does and how long it runs ("A larger flag on the map and a card in Offers for 7 days."), the form, and "We review every headline before it goes live." No price.
- **Awaiting approval:** "Waiting for review." with **Cancel request**.
- **Headline approved, not paid yet:** "Your headline was approved. We'll be in touch with next steps." with **Cancel request**.
- **Paid and scheduled:** "Paid and scheduled. Starts on 2 Dec, ends on 9 Dec." with **Contact us to cancel** (no button that ends a paid campaign by itself).
- **Active:** "Active until 9 Dec." with **Contact us to cancel**.
- **Ended:** "Ended on 9 Dec." with **Promote again** (spec 16).
- **Payment window closed:** "Payment window closed." with **Promote again**.
- **Refunded:** "Refunded." with **Promote again**. The campaign is not shown on the maps or in Offers.
- **Rejected / Cancelled:** as spec 16 (the `not_paid` reason reads "the payment window closed.").
- The screen updates when it opens and on the existing pull to refresh. There is no "confirming payment" step and no polling.

**Outside the app (the Stripe invoice email and its hosted page):** the price, the due date, the pay page, the receipt, and the seller name welcometohvac.

**Customers and guests:** nothing changes. A paid campaign looks exactly like a spec 16 campaign.

**Archan (admin: the dashboard SQL editor, two admin commands and the Stripe dashboard)**
- Approves a headline (`approve_headline`), rejects, or cancels, with documented SQL (runbook updated).
- Sends the invoice with the admin command `invoice` (D13, D14).
- Voids invoices that should no longer be paid (after a cancel or a lapsed window) with the admin command `void_pending` (D16).
- Refunds only in the Stripe dashboard, full refunds only. The webhook records the refund and stops the campaign (D6).
- The old manual `approve` (with a start time, no payment) stays for free or compensating campaigns (`is_free`, Resolved Q4).

## Depends on
16 promotions (✅ Shipped, all four PRs). 05 seller-onboarding (Edge Function patterns, `_shared/`). 12 notifications (the `push-sender` server-secret header pattern). All ✅ Shipped.

## Context to load
- `CLAUDE.md`, this spec, `docs/product/v1.md` §7 and §16 (the spec 16b items)
- `.claude/specs/16-promotions.md` (Database changes, Decisions D5, D6, D10, D13)
- `.claude/skills/supabase-patterns/SKILL.md`
- PR 1 (database): `supabase/migrations/20261120214854_promotions.sql`, `supabase/tests/16-promotions.test.sql`, `supabase/tests/05-seller-onboarding.test.sql` (allowlists), `docs/runbooks/promotions-admin.md`, `supabase/seed.sql`, `scripts/seed/promotions.ts`, `src/features/promotions/schema.ts`
- PR 2 (functions): `supabase/functions/{deno.json,_shared/http.ts,_shared/rateLimit.ts,push-sender/index.ts,push-sender/handler.ts}`, `supabase/functions/tests/helpers.ts`, `supabase/config.toml` (the `[functions.*]` blocks), `.env.example`
- PR 3 (app): `src/features/promotions/{schema.ts,format.ts,messages.ts}`, `src/features/promotions/components/{PromoteScreen,PromotionStatusCard}.tsx`, their tests in `src/features/promotions/__tests__/`

## User stories
- As a seller, after my headline is approved I get an invoice email from Stripe, pay the locked price on Stripe's page, and then see my campaign as paid and scheduled in the app.
- As a seller, I see who will charge me (welcometohvac, for a LikeToOrder promotion) on the invoice and on my card statement.
- As a seller, I am never charged twice for one campaign; a payment that cannot be honoured is refunded automatically (D5).
- As a seller, if I don't pay in time, nothing is kept and I can promote again.
- As Archan, I approve headlines with one SQL call, send invoices and void stale ones with admin commands, refund in the Stripe dashboard, and never activate a campaign by hand.
- As anyone, I can trust that a campaign is live only because Stripe confirmed the money, never because the app said so.

## Screens & routes
- `app/seller/promote.tsx` (PR 3): unchanged route; `PromoteScreen` shows the status wording above.
- No new route, no return link, no new tab, no customer screen.

### Price and payment wording removed from the app in PR 3 (Resolved Q15)
| Place | Today | After PR 3 |
|---|---|---|
| `src/features/promotions/components/PromoteScreen.tsx`, invitation price line | "CAD 25.00 for 7 days" | "A larger flag on the map and a card in Offers for 7 days." (length only) |
| `PromoteScreen.tsx`, invitation payment note (`PAYMENT_NOTE`) | "Nothing is charged in the app. We'll contact you about payment." | "We review every headline before it goes live." |
| `src/features/promotions/components/PromotionStatusCard.tsx`, requested card price | the price line | removed (no replacement) |
| `src/features/promotions/format.ts` `formatPromotionPrice` | price formatting | deleted |
| `format.ts` `offerLine` | "CAD 25.00 for 7 days" | replaced by a length-only helper ("for 7 days") |
| `src/features/promotions/messages.ts` `REQUESTED_TEXT` | "Waiting for review. We'll contact you about payment." | "Waiting for review." |
| `messages.ts` `PAYMENT_NOTE` | (above) | replaced by the review note above |
| `messages.ts` `START_NOTE` | "We'll confirm the exact dates after payment." | "We'll confirm the exact dates when your promotion is scheduled." |
| `messages.ts` reject reason `not_paid` | "the invoice wasn't paid." | "the payment window closed." |
| `src/features/promotions/schema.ts` | `price_cents`, `currency_code` required in the `get_my_promotion` answer | no longer read; see D15 for removing them from the answer |
| `PromoteScreen.tsx:127`, stop-campaign confirmation (free running campaigns only since PR 1) | "It ends at once. Refunds are handled outside the app." | "It ends at once." |
| `PromoteScreen.tsx:12`, `:15`, `:227-239` | imports and use of `formatPromotionPrice`, `offerLine`, `PAYMENT_NOTE` in the invitation | removed with the rows above |
| `PromotionStatusCard.tsx:8-9`, `:31-34` | imports and the requested-card price line | removed (row above) |
| `PromoteForm.tsx:21`, `:150` | `START_NOTE` as the start-day field note | the new `START_NOTE` wording above |
| `format.ts:34` (comment), `:37`, `:58` | "an invoice is in that currency" comment; `formatPromotionPrice`; `offerLine` | deleted with the functions above |
| `schema.ts:43-44`, `:61-62` | `price_cents`, `currency_code` in the settings and promotion schemas | D15 |
| Tests that assert the old wording (PR 1 grep, 2026-11-22) | `messages.test.ts`, `format.test.ts`, `PromoteForm.test.tsx`, `PromoteScreen.test.tsx`, `a11y.test.tsx` | updated in PR 3 |

Not related and unchanged: menu food prices (`src/features/menu/`, `src/features/map/components/SheetMenu.tsx`, `src/features/requests/`) are a seller's own prices, not a purchase in the app. The `pricetag` icon name of the Offers tab is an icon only.

## Payment flow and states

### In plain words
A promotion now has two gates: Archan says yes to the words, then Stripe says yes to the money. The money part happens entirely outside the app, by an invoice that Stripe emails. Nothing in the app can open the second gate. If the seller does not pay within 7 days, the campaign can no longer start (by the server clock, no job), and the seller can start again.

### Stored and derived states
Stored statuses become: `requested`, `payment_due` (new), `approved`, `rejected`, `cancelled`, `payment_expired` (new), `refunded` (new). Derived as in spec 16 D5 (server clock at read time, no job):

| Stored | Condition | State shown | Seller sees (status only) |
|---|---|---|---|
| requested | | requested | "Waiting for review." |
| payment_due | now() < pay_by | awaiting_payment | "Your headline was approved. We'll be in touch with next steps." |
| payment_due | now() >= pay_by | payment_expired | "Payment window closed." |
| payment_expired | | payment_expired | "Payment window closed." |
| approved | now() < starts_at | scheduled | "Paid and scheduled. Starts on ..., ends on ..." ("Scheduled. Starts on ..." for a free campaign) |
| approved | starts_at <= now() < ends_at | active | "Active until ..." (maps, Offers) |
| approved | now() >= ends_at | ended | "Ended on ..." |
| refunded | | refunded | "Refunded." |
| rejected | | rejected | as spec 16 |
| cancelled | | cancelled | as spec 16 |

"Payment failed" is not a stored state. Stripe shows a declined card on its own page and the seller can try another card there. Cards only (wallets included), no delayed methods (D4).

`payment_due` past its deadline becomes the stored `payment_expired` only when something writes to it (the seller's next `request_promotion`, or a late paid webhook). Reads never write.

### Cancel and lapse: what this means at Stripe (consequence of "no job")
- An invoice is a separate object at Stripe. Our database cannot reach Stripe by itself, so a **seller cancel** (in the app) or an **admin cancel** (SQL) only marks the open invoice `void_pending` in our table. A **lapsed** window (past `pay_by`) changes nothing at Stripe at all.
- Until something voids it, **that invoice stays payable on Stripe's page** (its link works until about 30 days after the due date; [hosted invoice page](https://docs.stripe.com/invoicing/hosted-invoice-page), read 2026-11-21).
- **If the seller pays it anyway**, the webhook refunds the payment automatically (D5). Stripe keeps its processing fee on a refund, so each such case costs a small fee.
- **To keep this rare**, the runbook has one admin command, `void_pending`, which voids at Stripe every invoice that is `void_pending` or whose promotion is past `pay_by` (D16). Archan runs it after a cancel and from time to time.
- *Possible later improvement (not built now):* a small worker (the `push-sender` pattern) that voids these invoices automatically.

### Technical flow
1. `request_promotion` (spec 16) -> `requested`.
2. `private.admin_review_promotion(id, 'approve_headline')` -> `payment_due`; locks the price (re-snapshot from `promotion_settings`), sets `pay_by = now() + 7 days` and `reviewed_at`.
3. Archan runs the admin command: `POST promotion-invoice { action: 'invoice', promotion_id }` with the `x-admin-secret` header (D13). The function:
   - calls `public.begin_promotion_invoice(promotion_id)`, which looks up the business and owner itself and, under a row lock, reserves a payment row (or returns the existing one so a half-done run can resume);
   - reads the owner's email server side (`auth.admin.getUserById`). It never returns, logs or stores the email in our tables;
   - creates or reuses the Stripe Customer, creates the draft invoice, adds one invoice item for the locked amount, then finalizes and sends the invoice (exact calls in Edge Functions);
   - records the ids and `livemode` with `public.attach_invoice` and `public.mark_invoice_sent`;
   - returns only `{ ok, invoice_status }` to the admin caller.
   The app never calls it.
4. Stripe emails the seller (live mode only; test mode sends no email, D14). The seller pays on Stripe's hosted page.
5. Stripe calls Edge Function `stripe-webhook` with `invoice.paid`. The webhook:
   - verifies the signature and checks the event's `livemode` against `STRIPE_EXPECT_LIVEMODE`;
   - looks up the invoice's PaymentIntent with `GET /v1/invoice_payments?invoice=<id>&status=paid`;
   - calls `public.record_stripe_event(...)`. The database checks that the invoice id is ours, the event's livemode equals the payment row's, `amount_paid` and the currency equal the locked price, and the promotion is still `payment_due` within `pay_by` with an `open` payment row. Then it sets `approved`, `paid_at`, `starts_at`, `ends_at` (D2).
   Otherwise the database marks the payment `needs_refund` and returns the refund target, and the webhook refunds it (D5, D12).
6. The app reads `get_my_promotion` when the Promote screen opens or is pulled to refresh, and shows the state.

## Money rules
- **Price source:** `promotion_settings` (spec 16). One row: one price for the one campaign length (7 days). Several lengths would be a new spec.
- **Currency:** CAD only. `begin_promotion_invoice` refuses a promotion whose locked `currency_code` is not `CAD` (`not_configured`). Invoice amounts are integer cents end to end: the invoice item gets `amount = price_cents`, `currency = cad`, and the webhook compares `amount_paid` and `currency` exactly with the locked row.
- **Price lock:** at headline approval. `approve_headline` re-snapshots price, currency and length. A later change of `promotion_settings` never changes a `payment_due` row. Stripe is always given the locked row price, never the settings row.
- **Payment window:** 7 days after approval. The invoice's due date is set to exactly `pay_by` (D14). An invoice is refused if less than 1 hour remains before `pay_by` (`payment_window_closed`).
- **One campaign, one invoice:** at most one open payment row per promotion (unique partial index). Running the admin command twice resumes or reports `already_sent`; it never creates a second invoice.
- **Fees** (read 2026-11-21, to be re-checked at Archan's setup): Stripe card fees "2.9% + CA$0.30" per domestic card payment ([Stripe Canada pricing](https://stripe.com/en-ca/pricing)), plus about "0.4%" (Starter) or "0.5%" (Plus) "per paid invoice" ([Stripe Invoicing pricing](https://stripe.com/invoicing/pricing)).
- **Duplicate or late payments (D5):** any paid invoice whose promotion is no longer `payment_due` within `pay_by`, or whose payment row is `void_pending`, or with a wrong amount or currency, is refunded in full automatically by the webhook, with `Idempotency-Key: refund-<payment id>`.
- **Refunds (D6, Resolved Q3):** full refunds only, only by Archan, only in the Stripe dashboard. The webhook (`charge.refunded`, matched by `payment_intent`) records it:
  - **full refund** -> promotion `refunded`; a scheduled or running campaign stops at once (as built: `ends_at` is cut to now only if it has started; a scheduled one keeps its window as history);
  - **partial refund** (should not happen) -> recorded on the payment row only; the campaign keeps running.
  - Sellers cannot refund or cancel a paid campaign from the app ("Contact us to cancel", Resolved Q2).
- **Disputes (chargebacks, Resolved Q5):** `charge.dispute.created` (matched by `payment_intent`) is recorded and the campaign stops (as built: stored `cancelled` by admin, the payment `disputed`). Handling evidence is Archan's job in the Stripe dashboard.
- **Webhook replay safety (D3):** `stripe_events.event_id` is the primary key; a replayed or re-delivered event does nothing new and is answered with 200, except that a payment still in `needs_refund` returns its refund target again (D12). Every state change also checks the current state, so out-of-order events are safe.

## Database changes
One new migration in PR 1 (`npx supabase migration new promotion_payment`). Spec 16's migration is not edited. PR 3 adds one small replacing migration for D15.

```sql
-- 1. New stored statuses and payment columns on promotions.
alter table public.promotions drop constraint promotions_status_check;   -- exact name checked in PR 1
alter table public.promotions add constraint promotions_status_check
  check (status in ('requested','payment_due','approved','rejected','cancelled','payment_expired','refunded'));
alter table public.promotions
  add column pay_by       timestamptz,
  add column paid_at      timestamptz,
  add column refunded_at  timestamptz,
  add column is_free      boolean not null default false;      -- manual 'approve' path (Resolved Q4)

-- 2. Migration safety: every campaign approved before this migration was approved by hand
--    with no payment (spec 16), so it is marked free BEFORE the paid rule is added.
update public.promotions set is_free = true where status = 'approved';

alter table public.promotions
  add constraint promotions_pay_by check (status <> 'payment_due' or pay_by is not null),
  add constraint promotions_paid   check (status <> 'approved' or is_free or paid_at is not null);
-- Existing 'requested' rows stay as they are (Resolved Q12); they move on only through approve_headline.

-- One open campaign request per business now covers both waiting states.
drop index public.promotions_one_request;
create unique index promotions_one_request on public.promotions (business_id)
  where status in ('requested','payment_due');
-- promotions_no_overlap stays (approved windows).

-- 3. One row per Stripe invoice.
create table public.promotion_payments (
  id                    uuid primary key default gen_random_uuid(),
  promotion_id          uuid not null references public.promotions(id) on delete restrict,
  amount_cents          integer not null check (amount_cents > 0),
  currency_code         text not null check (currency_code = 'CAD'),
  status                text not null default 'reserved'
                          check (status in ('reserved','open','void_pending','void','uncollectible','paid',
                                            'needs_refund','refund_requested','refunded','partially_refunded','disputed')),
  customer_id           text unique check (customer_id ~ '^cus_[A-Za-z0-9]+$'),   -- see note: one Customer per payment
  invoice_id            text unique check (invoice_id ~ '^in_[A-Za-z0-9]+$'),
  invoice_sent_at       timestamptz,
  livemode              boolean,             -- recorded at creation from Stripe's answer (D11)
  payment_intent_id     text unique check (payment_intent_id ~ '^pi_[A-Za-z0-9]+$'),
  refunded_cents        integer not null default 0 check (refunded_cents >= 0),
  created_at            timestamptz not null default now(),
  paid_at               timestamptz,
  updated_at            timestamptz not null default now(),
  constraint promotion_payments_refund_le check (refunded_cents <= amount_cents),
  constraint promotion_payments_attached
    check (status = 'reserved' or (invoice_id is not null and customer_id is not null and livemode is not null))
);
create unique index promotion_payments_one_open on public.promotion_payments (promotion_id)
  where status in ('reserved','open','void_pending');
create unique index promotion_payments_one_paid on public.promotion_payments (promotion_id)
  where status = 'paid';          -- a second paid invoice goes to needs_refund instead

-- 4. Webhook idempotency and audit.
create table public.stripe_events (
  event_id     text primary key check (event_id ~ '^evt_[A-Za-z0-9]+$'),
  type         text not null,
  livemode     boolean not null,
  received_at  timestamptz not null default now(),
  outcome      text not null    -- 'applied' | 'ignored' | 'refund_requested' | 'mismatch'
);
```
- **One Customer per payment.** `customer_id` is unique, so each invoice gets a fresh Stripe Customer. This keeps a seller's changed email from going stale at Stripe, and no email is stored on our side. The cost is a few extra Customer objects at Stripe. Reusing one Customer per business is a later option.
- **Unchanged from the Checkout version:** amount, currency, the status values (plus `void_pending`, `void` and `uncollectible`), `livemode`, `payment_intent_id`, `refunded_cents`, `paid_at`, and the one-open / one-paid partial indexes.
- **Removed from the Checkout version:** `checkout_session_id`, `checkout_url` and `session_expires_at`.
- **Not stored:** card data, names, emails and full Stripe payloads. We keep only ids, amounts and statuses.

**RLS and privileges.** RLS on for `promotion_payments` and `stripe_events`, no policies, no grants to `anon` or `authenticated` (the spec 16 / `map_rate_limits` pattern). The payment fields on `promotions` (`pay_by`, `paid_at`, `refunded_at`, `is_free`, `status`) stay unwritable by clients (no client grants on `promotions`, unchanged).

**Functions.** All security definer, `set search_path = ''`, `revoke execute ... from public, anon, authenticated`, then granted as below. The 05 allowlist test is updated. Every function whose behaviour changes is listed.

| Function | Grant | What it does |
|---|---|---|
| `get_my_promotion()` (replaced, same signature) | authenticated | Adds `paid`, `is_free` and the new derived states. Returns no invoice id, link, Stripe id or receipt. In PR 1 the price fields stay in the answer so the app on main keeps working; PR 3 removes them (D15). |
| `request_promotion(...)` (replaced, same signature) | authenticated | Also refuses while a `payment_due` row is within `pay_by` (`already_open`). Under the business lock, it first stores `payment_expired` on the caller's own lapsed `payment_due` row, so the unique index frees up. |
| `cancel_my_promotion(uuid)` (replaced) | authenticated | Allowed for `requested` and `payment_due`. An `open` payment row becomes `void_pending` and a `reserved` one `void` (as built) (voided at Stripe by `void_pending`, D16; a payment that still arrives is refunded by D5). Refused with `contact_support` for a paid campaign. A free campaign (`is_free`) keeps spec 16 behaviour. |
| `private.admin_review_promotion(...)` (replaced) | none (database owner) | New decision `approve_headline` (requested only): re-snapshot price, currency and length, set `pay_by = now() + interval '7 days'`, status `payment_due`. `approve` keeps spec 16 behaviour and sets `is_free = true`. `reject` and `cancel` are also allowed on `payment_due`; both turn an open payment row into `void_pending`. Admin `cancel` of a paid campaign is allowed but does not refund (the runbook says: refund in Stripe first). |
| `public.begin_promotion_invoice(p_promotion_id uuid) returns jsonb` (new; was `begin_promotion_checkout`) | service_role only | Looks up the business and owner itself; the promotion must be `payment_due`, `pay_by - now() >= 1 hour`, currency CAD. Locks the promotion row. If an open row exists: `{already_sent: true, invoice_status}` when sent, or `{resume: {payment_id, customer_id, invoice_id}}` when a previous run stopped half-way. Else it reserves a row and returns `{payment_id, owner_id, business_name, amount_cents, currency, length_days, pay_by}`. A reserved row never expires; it is resumed with the same payment id (as built). Errors: `not_found`, `not_payable`, `payment_window_closed`, `not_configured`. |
| `public.attach_invoice(p_payment_id uuid, p_customer_id text, p_invoice_id text, p_livemode boolean)` (new; was `attach_checkout_session`) | service_role only | `reserved` -> `open`; format-checked ids; records `livemode` from Stripe's invoice answer (D11). |
| `public.mark_invoice_sent(p_payment_id uuid)` (new) | service_role only | Sets `invoice_sent_at` after Stripe accepted the send call. |
| `public.list_invoices_to_void() returns jsonb` (new) | service_role only | The `void_pending` rows, plus `open` rows whose promotion is past `pay_by`: `[{payment_id, invoice_id}]`, at most 100. |
| `public.mark_invoice_void(p_payment_id uuid)` (new) | service_role only | `open` or `void_pending` -> `void` after Stripe accepted the void call (also set by `invoice.voided`). |
| `public.record_stripe_event(p_event_id text, p_type text, p_livemode boolean, p_data jsonb) returns jsonb` (new) | service_role only | Inserts into `stripe_events` with `on conflict do nothing`. A duplicate does nothing new, **but** if the payment it names is still `needs_refund`, it returns `{outcome:'duplicate', refund:{payment_id, payment_intent_id}}` again (D12). By type, with row locks: unknown invoice or PaymentIntent -> `mismatch`, nothing changed; **event livemode differs from the payment row's livemode -> `mismatch`, nothing changed** (D11). `invoice.paid` (with `payment_intent_id` resolved by the webhook): stores `payment_intent_id`; `amount_paid` and currency must match the row, the row must be `open`, and the promotion must be `payment_due` within `pay_by` -> `approved`, `paid_at = now()`, window per D2; otherwise payment `needs_refund` and returns the refund target. `invoice.voided` -> payment `void`. `invoice.marked_uncollectible` -> payment `uncollectible` (recorded only). `charge.refunded` -> `refunded_cents`; full -> payment `refunded`, promotion `refunded`, window closed. `charge.dispute.created` -> payment `disputed`, campaign stopped. Any other type -> `ignored`. Any event for a payment still in `needs_refund` also returns its refund target (D12). |
| `public.mark_refund_requested(p_payment_id uuid)` (new) | service_role only | `needs_refund` -> `refund_requested`, called by the webhook only after Stripe accepted the refund call. Until then the payment stays `needs_refund`. |
| `public.check_invoice_sendable(p_payment_id uuid) returns boolean` (new, review S3) | service_role only | True only while the payment is `open` and its promotion is `payment_due` with `now() < pay_by`; false otherwise and for an unknown id. PR 2 calls it after finalize and before send. |
| `private.promotion_is_active(uuid)` | unchanged | Still `approved` and in window; `refunded` rows never count. |

### PR 1 as built (amendments 2026-11-22, approved by Archan at the PR 1 plan and gates)
These override the text above where they differ. Migration `20261122022052_promotion_payment.sql`.
- **Service functions live in `public`, granted to `service_role` only** (not `private`): the API exposes only `public`, so the Edge Functions could not call `private` functions (the `claim_push_batch` pattern). Each is created with `revoke execute ... from public, anon, authenticated` first, then `grant ... to service_role`. `admin_review_promotion` and the helpers stay in `private` (database owner only). `private` is not exposed.
- **Three private helpers:** `private.void_open_payment` (a cancel or reject: an `open` row becomes `void_pending`, a `reserved` row becomes `void`), `private.stop_promotion` (full refund or dispute) and `private.refund_target` (the D12 answer). The 05 private allowlist lists them.
- **Lock order:** every function locks the promotion row first, then its payment row (one comment line at the top of the function block). `request_promotion` locks the business row before either, as in spec 16.
- **Reserved rows never expire.** A reserved row always resumes with the same payment id (the same Stripe idempotency keys), so an interrupted run can never create a second invoice. A cancel or reject turns a reserved row into `void` (allowed without ids: `promotion_payments_attached` accepts `reserved` and `void`), and `attach_invoice` then refuses with `not_attachable`, so nothing is finalized or sent.
- **`begin_promotion_invoice` returns one shape:** `{ already_sent: true, invoice_status: 'sent' }`, or `{ resume, payment_id, owner_id, business_name, amount_cents, currency, length_days, pay_by, customer_id, invoice_id }` (`resume` false with null ids for a new reservation; true for a reserved or open, unsent row). Errors add `rate_limited`.
- **Late webhooks: `invoice.paid` carries `paid_at`** (Stripe's paid time, Unix seconds). The payment window and "still waiting for this money" are checked against `paid_at`, not the delivery time; the campaign window still starts at `greatest(now(), preferred day 00:00 Toronto)`. A missing `paid_at`, one more than **5 minutes** in the future (clock skew; within that it is clamped to now), or one more than 5 minutes before the payment row was created -> `mismatch`, nothing changed. A payment made in time on a campaign already stored `payment_expired` is honoured, **unless the business has opened a newer request** since (then refunded).
- **`list_invoices_to_void`** also lists `uncollectible` rows whose `pay_by` has passed (an uncollectible invoice can still be paid at Stripe), and `mark_invoice_void` accepts them.
- **Disputes and stopping a campaign:** a dispute stores the promotion as `cancelled` with `cancelled_by = 'admin'` and `cancelled_at` (the seller sees "Cancelled."); the payment becomes `disputed`. A full refund stores `refunded` and `refunded_at`. Stopping cuts `ends_at` to now **only if the campaign has already started**; a scheduled one keeps its window as history, so `promotions_window_order` always holds. The status change alone takes it off the maps and Offers.
- **`charge.refunded`** (`p_data`: `payment_intent_id`, `amount_refunded`, `refunded`): "full" is Stripe's `refunded` flag; `refunded_cents` stores `least(amount_refunded, amount_cents)` (so a wrong-amount payment cannot break `promotion_payments_refund_le` and loop the webhook into 500s). Only the payment that activated the campaign (status `paid` or `partially_refunded`) changes the promotion; an automatic refund (`needs_refund`, `refund_requested`) changes the payment row only.
- **FK `on delete cascade`** (not restrict): a business delete cascades to its promotions and must not be blocked. Stripe keeps the financial record; the runbook says to check Stripe before deleting a business with paid campaigns (note for spec 18 / account deletion).
- **`stripe_events.outcome`** has a check (`applied`, `ignored`, `refund_requested`, `mismatch`); `duplicate` is an answer only. An extra check `promotion_payments_refund_target` requires a PaymentIntent on `needs_refund` and `refund_requested` rows.
- **`get_my_promotion`** is not redefined: it picks up `paid` and `is_free` through the replaced `private.promotion_json`.

**Review fixes (2026-11-22, approved by Archan):**
- **Eight service functions** (was seven): `check_invoice_sendable` added (S3). The pgTAP asserts anon and authenticated cannot execute any of the eight and service_role can execute all eight.
- **S1 delete guard:** a `BEFORE DELETE` trigger on `promotion_payments` (`private.guard_payment_delete`, the fourth private helper) raises `payment_unsettled` (no ids in the message) while a row is `open`, `void_pending`, `uncollectible` or `needs_refund`, including the cascade from a business or account delete; nothing is deleted then. `reserved`, `void`, `paid`, `refunded`, `partially_refunded`, `refund_requested` and `disputed` rows may be deleted. The seed re-run first marks its own still-payable fake rows `void` (a plain service-role update; no bypass), then deletes. Runbook: settle before deleting; spec 18 must handle it.
- **S2 bad data on our own invoice raises:** an `invoice.paid` that names OUR invoice but has a missing or malformed `payment_intent_id` or `amount_paid`, or a `paid_at` more than 5 minutes ahead, raises `invalid_event_data`. The raise rolls back the whole call, the `stripe_events` row included, so the webhook answers 500 and Stripe's retry is processed afresh (not a duplicate). This replaces the earlier "a paid_at in the future is mismatch". Kept as `mismatch`: invoices and PaymentIntents that are **not ours** (the Stripe account may carry other activity, for example the welcometohvac business, so unknown events are expected and must not loop); a `charge.refunded` or `charge.dispute.created` for a PaymentIntent not recorded yet (refunds and disputes normally come days after the payment); a missing or malformed `currency` or `paid_at`; a `paid_at` more than 5 minutes before the payment row was created. The runbook has queries for `outcome = 'mismatch'` and for `needs_refund` rows older than 10 minutes.
- **S3 no invoice after the window:** `attach_invoice` also requires the promotion to be `payment_due` with `pay_by > now()` (else `not_attachable`); `check_invoice_sendable` is the pre-send check.
- **Q-S4:** `void_open_payment` also turns an `uncollectible` row (still payable at Stripe) into `void_pending` on a cancel or reject.
- **Q3:** the app maps `contact_support` (known and stale codes; "This promotion can't be cancelled here."), so a campaign paid while the Promote screen was open refreshes and the dead Cancel button goes away. No longer a PR 3 item.
- **Q-S7:** the zod schema gives `paid` and `is_free` a default of false, so the new app reads a server from before 16b. The new states still need the new app, so the hosted rule stays: each hosted migration ships only together with an app update, never before one.
- **Spec mismatch (review S6), recorded:** the honour rule blocks only on a newer request that is still `requested`, `payment_due` or `approved`. A newer request that was cancelled, rejected or expired does not block it (fair to the seller, who paid in time).

## Storage
None.

## Edge Functions
Both live in `supabase/functions/` in the existing `index.ts` (wiring) + `handler.ts` (pure, testable with injected dependencies) style, use `_shared/http.ts`, and are added to `deno.json` `check` and to `config.toml`. No Stripe SDK (D7): small `fetch` calls to `https://api.stripe.com/v1/...` (form-encoded, `Authorization: Bearer <restricted key>`, **`Stripe-Version: 2026-11-18.endive`** pinned on every request, D17) and our own signature check with Web Crypto. Neither function is ever called by the app.

**`promotion-invoice`** (admin only; was `promotion-checkout`; `verify_jwt = false`, protected by a server secret header like `push-sender`'s `x-cron-secret`)
- Auth: header `x-admin-secret` compared in constant time with `PROMOTION_ADMIN_SECRET`. Missing or wrong -> 401, no body detail, no database call. The secret is never in the app.
- `PROMOTION_ADMIN_SECRET` unset or shorter than 32 characters -> 503 `not_configured`, before the header is even compared (a short secret is treated as no secret).
- Input: `POST { action: 'invoice', promotion_id: uuid }` or `POST { action: 'void_pending' }`. The function looks up the owner and business itself; the caller never names an owner or an email.
- **`invoice`: the Stripe calls, in order.** Each call sends `Idempotency-Key: <step>-<payment id>` ("all POST requests accept idempotency keys", [idempotent requests](https://docs.stripe.com/api/idempotent_requests)). A resumed run skips the steps already recorded.
  1. `POST /v1/customers` with `email` (the owner's email, read server side, never logged), `name` (business name) and `metadata[payment_id]`. Key: `customer-<payment id>`.
  2. `POST /v1/invoices` with:
     - `customer`, `collection_method=send_invoice` (set explicitly);
     - `due_date=<pay_by as Unix seconds>`. We use `due_date` rather than `days_until_due`, because `days_until_due` counts from the moment the invoice is created, which is after approval, so it would not equal `pay_by`;
     - `auto_advance=false` (we finalize and send ourselves, with no one-hour delay);
     - `currency=cad`, `description="LikeToOrder promotion, 7 days"`, `pending_invoice_items_behavior=exclude`;
     - `metadata[promotion_id]`, `metadata[payment_id]`.
     Key: `invoice-<payment id>`. Then `attach_invoice` with the customer id, the invoice id and the invoice's `livemode`.
  3. `POST /v1/invoiceitems` with `customer`, `invoice=<invoice id>` (items can be added only to draft invoices), `amount=<locked cents>`, `currency=cad`, `description="LikeToOrder promotion, 7 days"` and `metadata[payment_id]`. Key: `invoiceitem-<payment id>`.
  4. `POST /v1/invoices/<id>/finalize` (the invoice becomes `open`). Key: `finalize-<payment id>`.
  5. **Before sending (PR 1 review S3):** call `check_invoice_sendable(payment id)`. If it is false (a cancel or the window passed during the run), do not send: void the finalized invoice (`POST /v1/invoices/<id>/void`, key `void-<payment id>`, then `mark_invoice_void`) and answer `not_payable`.
  6. `POST /v1/invoices/<id>/send` (Stripe emails the invoice). Key: `send-<payment id>`. Then `mark_invoice_sent`.
  - **Before step 1:** the owner's email is read; an owner with no email -> 409 `no_email`, and nothing is created at Stripe.
  - **Resume (PR 2 plan):** a resumed run with an invoice id first reads the invoice (`GET /v1/invoices/<id>`) and continues from its real state (`draft` with total 0 -> add the item; `draft` with the locked total -> finalize; `open` -> the pre-send check), so nothing is posted twice after Stripe has pruned an idempotency key (keys may be removed "after they're at least 24 hours old"). A draft with another total, or a `void`, `paid` or `uncollectible` invoice -> `stripe_error`, nothing finalized or sent. A resumed reserved row (no ids yet) repeats steps 1 and 2 with the same keys.
  - Returns 200 `{ ok: true, invoice_status: 'sent' }`, or `{ ok: false, error }` with an HTTP status: `invalid_input` 400; `not_found` 404; `not_payable`, `payment_window_closed`, `already_sent`, `no_email` 409; `rate_limited` 429; `stripe_error` 502 (run again: it resumes); `not_configured`, `payments_unavailable` 503; `internal_error` 500. A missing or wrong admin secret is 401 with no body. It never returns the hosted URL, the email or a Stripe id. In test mode Archan opens the invoice from the Stripe dashboard instead.
- **`void_pending`:** `public.list_invoices_to_void()`, then for each, in order, never stopping at a failure: `POST /v1/invoices/<id>/void` (voiding "only applies to finalized invoices"; "This cannot be undone"; voided invoices "aren't payable"). Key: `void-<payment id>`. Then `mark_invoice_void`. When Stripe refuses the void, the handler reads the invoice: a `draft` is deleted (`DELETE /v1/invoices/<id>`; "Attempts to delete invoices that are no longer in a draft state will fail") and then marked void; an invoice already `void` at Stripe is marked void; a `paid` one is skipped (the webhook owns it); anything else counts as failed. Every listed row has an invoice id (`promotion_payments_attached`), so the handler requires one. Returns 200 `{ ok: true, voided: n, failed: n, skipped: n }`.
- Sources for the calls and parameters, read 2026-11-21: [Invoicing integration](https://docs.stripe.com/invoicing/integration), [Create invoice](https://docs.stripe.com/api/invoices/create), [Create invoice item](https://docs.stripe.com/api/invoiceitems/create), [Finalize](https://docs.stripe.com/api/invoices/finalize), [Send](https://docs.stripe.com/api/invoices/send), [Void](https://docs.stripe.com/api/invoices/void), [Invoicing overview](https://docs.stripe.com/invoicing/overview), [Create customer](https://docs.stripe.com/api/customers/create).
- **The three points that had to be confirmed** (pending-items parameter, finalize and the email, the `auto_advance` default) are answered in "PR 2 research (D0)" below.
- Rate limit: 10 calls per promotion per hour, so a leaked admin secret or a looping caller cannot create invoices without bound. **As built in PR 1:** `public.begin_promotion_invoice` counts the calls itself in `map_rate_limits` (kind `promotion_invoice`, key `promo:<promotion id>`, an hourly window) and raises `rate_limited`. PR 2 maps that error; it needs no `_shared/rateLimit.ts` change.
- **If `attach_invoice` refuses (`not_attachable`, for example after a cancel during the run) after Stripe already created the draft invoice, PR 2 deletes that draft best-effort** (`DELETE /v1/invoices/<id>`; a draft can be deleted, not voided) and never finalizes or sends it. If that call fails, the runbook's "delete an unsent draft by hand" step covers it.
- Secrets: `PROMOTION_ADMIN_SECRET` (at least 32 characters), `STRIPE_SECRET_KEY` (a restricted key, D10). Missing Stripe key -> `503 payments_unavailable` (the local default). Neither function has any setting that changes the Stripe host: the key is only ever sent to `https://api.stripe.com` (Archan, PR 2 plan answer 4).
- Logs: event codes only; never a key, a secret, an email, a URL or full ids.
- **Database errors (PR 1 review S7):** map every RPC error to a code. Never log or return the raw Postgres error: a unique violation's DETAIL contains the full Stripe id.
- **Drafts in `void_pending` (PR 1 review Q-S9):** `list_invoices_to_void` can list an `open` row whose invoice was never finalized (a draft), which Stripe cannot void. The handler deletes drafts (`DELETE /v1/invoices/<id>`) and marks them void, marks invoices already void at Stripe, and counts failures and continues.
  - **Known limit (accepted by Archan, 2026-11-23):** the list is the 100 oldest rows. Rows that Stripe keeps refusing stay at its head; if 100 of them pile up, newer rows are never reached. The signal is the `failed` count in the command's answer and the runbook query for rows waiting to be voided. A real fix (a cursor past failed rows) needs a migration and is left for later.
- **Orphans after a late resume (accepted by Archan, 2026-11-23):** a reserved row resumed more than 24 hours after its first run may create a second Customer or draft invoice at Stripe (the first key may be pruned). The orphan is never finalized or sent; the runbook says to delete it by hand.
- **Built in PR 2 after the review (2026-11-23):**
  - An `open` invoice (after finalize, or found on a resume) is sent only if its `total` equals the locked amount; otherwise `stripe_error` and nothing is sent (review S2). The matching livemode check was **not built**: `begin_promotion_invoice` does not return the row's `livemode`, so the handler has nothing to compare with without a database change. The database already refuses a mismatched event (D11 (b)).
  - **Two `invoice` runs at the same time (review S1, known limit, accepted by Archan):** the second run's `attach_invoice` is refused and it deletes the draft the first run just attached. `attach_invoice` raises the same `not_attachable` for "already attached" and "no longer payable" (one combined check in the PR 1 SQL), so the handler cannot tell them apart without a database change. The runbook says never to run `invoice` twice at the same time for one promotion.
  - Not in the text above but built: both functions answer 405 to anything but POST; the webhook answers 400 (`bad_event`) to a correctly signed body that is not JSON or not an event; and it answers 503 for a missing `STRIPE_WEBHOOK_SECRET` or a `STRIPE_EXPECT_LIVEMODE` other than `true` / `false` before reading the body (approved at D3).
- **`record_stripe_event` may raise `invalid_event_data`** (PR 1 review S2): the webhook then answers 500 so Stripe retries.

**`stripe-webhook`** (`verify_jwt = false`: Stripe sends no JWT; the signature is the auth)
- Reads the raw body (max **256 KB**, else 413) before anything else. The cap was 64 KB; it was raised at D0 (Archan, 2026-11-23) because Stripe states no event size limit and the account may carry other activity (for example welcometohvac's other business) whose larger events must not fail forever: a 413 makes Stripe retry for up to three days. The endpoint is subscribed to the five event types below only.
- Verifies `Stripe-Signature`: `t=` within 300 s of now, and at least one `v1=` equal (constant-time) to HMAC-SHA256(`STRIPE_WEBHOOK_SECRET`, `t + "." + body`). Other schemes (`v0`, only on test events) are ignored. Failure (missing or malformed header, stale `t`, no matching `v1`) -> 400, no detail, nothing written. A missing `STRIPE_WEBHOOK_SECRET` -> 503 (Stripe retries).
- Only then parses JSON (zod). **Checks the event's `livemode` equals `STRIPE_EXPECT_LIVEMODE`** (exactly `true` or `false`; anything else -> 503) before any database call; a mismatch -> 200 with nothing written (D11).
- **`invoice.paid`:** the invoice in the event does not carry its PaymentIntent. In the pinned API version, the invoice has no `payment_intent` field; its `payments` are "not returned by default" ([Invoice object](https://docs.stripe.com/api/invoices/object), [Invoice Payment](https://docs.stripe.com/api/invoice-payment)).
  - The webhook first reads `amount_paid`, `currency` and `paid_at` (`status_transitions.paid_at`, Unix seconds) from the event. If any is missing or malformed, it answers 500 itself, before any Stripe or database call.
  - Then it calls `GET /v1/invoice_payments?invoice=<id>&status=paid` and takes `payment.payment_intent` of the paid payment. If that lookup fails, the webhook answers 500 (Stripe retries).
  - If the lookup finds no paid payment (for example an invoice "marked as paid out-of-band"), it passes `payment_intent_id: null`: the database answers `mismatch` for an invoice that is not ours (200, no loop) and raises `invalid_event_data` for ours (500, retry). The runbook says never to mark one of our invoices paid out of band.
  - It passes `invoice_id`, `payment_intent_id`, `amount_paid`, `currency` and `paid_at` to `record_stripe_event`.
- **Refunds for an invoice payment:** `POST /v1/refunds` with `payment_intent=<pi id>` ("you must specify a Charge or a PaymentIntent", [Create refund](https://docs.stripe.com/api/refunds/create); a PaymentIntent refund "is the same as refunding the underlying charge", [Refunds](https://docs.stripe.com/refunds)), `reason=duplicate`, `Idempotency-Key: refund-<payment id>`, then `mark_refund_requested`.
  - **If the refund call fails, the webhook answers 500**, so Stripe retries the event; the retry (a duplicate) returns the same refund target, and the same idempotency key keeps it to one refund (D12).
  - Stripe's error `charge_already_refunded` counts as success (then `mark_refund_requested`): it covers a retry that arrives after the idempotency key was pruned.
  - Stripe's invoice-specific alternative is a credit note with `refund_amount`. It is not used in v1, and the accountant may prefer it (Q11).
  - Whether a plain refund changes the invoice's status at Stripe: not confirmed. We do not rely on it, because our own row is updated from `charge.refunded`.
- Other events: `invoice.voided` and `invoice.marked_uncollectible` (data is the invoice); `charge.refunded` and `charge.dispute.created` (data is a charge or a dispute, both carrying `payment_intent`). All confirmed on [event types](https://docs.stripe.com/api/events/types), read 2026-11-21.
- Returns 200 for applied, duplicate (with no refund pending), ignored and mismatched events, so Stripe stops retrying; 500 on our own database error, a failed invoice-payment lookup or a failed refund call, so Stripe retries, which is safe by D3 and D12.
- Secrets: `STRIPE_WEBHOOK_SECRET`, `STRIPE_SECRET_KEY` (lookups and refunds), `STRIPE_EXPECT_LIVEMODE` (`false` until launch).
- Subscribed events: `invoice.paid`, `invoice.voided`, `invoice.marked_uncollectible`, `charge.refunded`, `charge.dispute.created`, and no others. (The two `checkout.session.*` events are gone.) Any other type that still arrives is passed with empty data and stored as `ignored`.
- Logs: event type and outcome or error code only; never an id, a secret, the body or an email.

### PR 2 research (D0)
Read 2026-11-23 on public docs.stripe.com pages only (no account, no key, no API call). "Not confirmed" means the docs read do not say it; the safe default is stated.

| # | Question | Answer | Source |
|---|---|---|---|
| 1 | Pending-items parameter on invoice create | `pending_invoice_items_behavior` (plural), values `exclude` / `include`, "Defaults to `exclude` if the parameter is omitted." The invoice-item page spells it `pending_invoice_item_behavior` in prose only; the create-invoice spelling is used. We send `exclude` explicitly. | [Create invoice](https://docs.stripe.com/api/invoices/create), [Create invoice item](https://docs.stripe.com/api/invoiceitems/create) |
| 2 | Does finalize alone email the seller | With `auto_advance=false`, "Emailing invoices" is "Not enabled" (the automatic-advancement table), so only our `/send` call emails. The dashboard setting is "Send finalized invoices to customers" (under "Manage invoices sent to customers"). The finalize page itself says nothing. Archan still checks the setting at setup step 7. | [Automatic advancement](https://docs.stripe.com/invoicing/integration/automatic-advancement-collection), [Send email](https://docs.stripe.com/invoicing/send-email), [Finalize](https://docs.stripe.com/api/invoices/finalize) |
| 3 | `auto_advance` default | "Defaults to false." We send `false` explicitly. | [Create invoice](https://docs.stripe.com/api/invoices/create) |
| 4 | Invoice email reply-to | **Not confirmed.** The pages say invoices show the support email from Public business information and that a verified custom domain is the sender domain; no reply-to is stated. Safe default: Archan checks it in the real-money test (Before launch 4). | [Customize](https://docs.stripe.com/invoicing/customize), [Send email](https://docs.stripe.com/invoicing/send-email) |
| 5 | Restricted key permission labels | **Not confirmed.** The page shows the form "Resource: Permission" (for example "Customers: Read", "Payment Intents: Write") and "Write permissions include Read permissions", but lists no labels for invoices, invoice items, invoice payments, refunds or charges. Safe default: Archan matches the D10 list at setup step 8 and gives nothing broader. | [Restricted keys](https://docs.stripe.com/keys/restricted-api-keys) |
| 6 | Payable after `due_date` | **Not confirmed** in words. An `open` invoice past its due date shows a "Past due" badge, and "Invoice URLs expire 30 days after the due date." Safe default: treat it as payable until voided (as the spec already does: `void_pending` and D5). | [Invoicing overview](https://docs.stripe.com/invoicing/overview), [Hosted invoice page](https://docs.stripe.com/invoicing/hosted-invoice-page) |
| 7 | Does a refund change the invoice status | **Not confirmed.** `paid` is "terminal"; no page says a refund changes it. We rely only on `charge.refunded`. | [Invoicing overview](https://docs.stripe.com/invoicing/overview), [Refunds](https://docs.stripe.com/refunds) |
| 8 | API version | "The current version is 2026-11-18.endive." Sent as the `Stripe-Version` header on every request. The webhook endpoint takes an `api_version` parameter: "Events sent to this endpoint will be generated with this Stripe Version". | [Versioning](https://docs.stripe.com/api/versioning), [Upgrades](https://docs.stripe.com/upgrades), [Create webhook endpoint](https://docs.stripe.com/api/webhook_endpoints/create) |
| 9 | `invoice.paid` shape | `data.object` is the invoice: top-level `amount_paid` ("in the smallest currency unit"), `currency` ("in lowercase"), `livemode`, `metadata`; no `payment_intent` field. `status_transitions.paid_at` appears in the object (described as "The timestamps at which the invoice status was updated"); its unit is not stated in prose (Stripe timestamps are Unix seconds). Safe default: require an integer, else 500. | [Invoice object](https://docs.stripe.com/api/invoices/object), [Event types](https://docs.stripe.com/api/events/types) |
| 10 | Invoice payments lookup | `GET /v1/invoice_payments` with filters `invoice`, `status` (`canceled`, `open`, `paid`), `payment`. The example shows `"payment": {"type": "payment_intent", "payment_intent": "pi_..."}`. | [Invoice Payment](https://docs.stripe.com/api/invoice-payment), [List invoice payments](https://docs.stripe.com/api/invoice-payment/list) |
| 11 | `charge.refunded`, `charge.dispute.created` | Charge: `payment_intent` (nullable), `amount_refunded`, `refunded` ("Whether the charge has been fully refunded"). Dispute: `payment_intent` ("ID of the PaymentIntent that's disputed"). Both events, plus `invoice.voided` and `invoice.marked_uncollectible` (invoice objects), are listed. | [Charge](https://docs.stripe.com/api/charges/object), [Dispute](https://docs.stripe.com/api/disputes/object), [Event types](https://docs.stripe.com/api/events/types) |
| 12 | Test-mode email | "Requests made in test-mode result in no emails being sent, despite sending an `invoice.sent` event." | [Send invoice](https://docs.stripe.com/api/invoices/send) |
| 13a | Idempotency | Keys may be removed "after they're at least 24 hours old"; a reused key with different parameters errors; GET and DELETE are "idempotent by definition" (no key sent). | [Idempotent requests](https://docs.stripe.com/api/idempotent_requests) |
| 13b | Void and delete | Void "only applies to finalized invoices"; delete fails for invoices "no longer in a draft state". | [Void](https://docs.stripe.com/api/invoices/void), [Delete](https://docs.stripe.com/api/invoices/delete) |
| 13c | Already refunded | Error code `charge_already_refunded`: "The charge you're attempting to refund has already been refunded." Refund `reason=duplicate` is a valid value. | [Error codes](https://docs.stripe.com/error-codes), [Create refund](https://docs.stripe.com/api/refunds/create) |
| 13d | `due_date` in the future | "Valid only for invoices where `collection_method=send_invoice`." A future-date rule is **not confirmed**; ours is always at least 1 hour ahead (`payment_window_closed` below that). | [Create invoice](https://docs.stripe.com/api/invoices/create) |
| 13e | Signature scheme | `Stripe-Signature` header; signed payload = timestamp, `.`, raw body; HMAC with SHA-256 keyed by the endpoint secret; "at least one `v1` entry" must match; ignore other schemes; libraries default to a 5 minute tolerance. Read through a page reader whose fetch was cut before this section (summarised, not word for word); it matches the scheme in this spec. | [Webhooks](https://docs.stripe.com/webhooks) |
| 13f | Event size and retries | No event size limit stated. Live retries "for up to three days"; sandbox retries "three times over the course of a few hours". | [Webhooks](https://docs.stripe.com/webhooks) |

Nothing found makes the plan unworkable: every call exists in the API reference of the pinned version, and refunding an invoice payment by its PaymentIntent is documented.

**Deployment:** Archan deploys with `npx supabase functions deploy promotion-invoice stripe-webhook` at release (never from a session), after setting the secrets himself with `npx supabase secrets set`.

## Components & hooks
**PR 1 (app side, no behaviour change):** `src/features/promotions/schema.ts` accepts the new keys and states of `get_my_promotion` (like spec 16 D11), so the app on main keeps working. Nothing reads them yet.

**PR 3 (app, status wording and price removal):**
- `src/features/promotions/schema.ts`: the new states; `price_cents` and `currency_code` no longer read, then no longer accepted once the D15 migration lands in the same PR.
- `src/features/promotions/messages.ts` and `format.ts`: the replacements in the table under Screens & routes, and the status lines in "What people see".
- `src/features/promotions/components/PromoteScreen.tsx`, `PromotionStatusCard.tsx`: the new states with their actions (Cancel request, Contact us to cancel, Promote again); no price.
- No new hook, no new component, no browser, no polling (the existing query and pull to refresh are enough).

## Files to create
- PR 1 (database):
  - `supabase/migrations/<ts>_promotion_payment.sql`
  - `supabase/tests/16b-promotion-payment.test.sql`
- PR 2 (functions):
  - `supabase/functions/promotion-invoice/{index.ts,handler.ts}`
  - `supabase/functions/stripe-webhook/{index.ts,handler.ts}`
  - `supabase/functions/_shared/stripe.ts` (form encoding, the pinned version header, signature verify, the REST calls; pure where possible)
  - `supabase/functions/{promotion-invoice,stripe-webhook}/rpc.ts` (zod-checked database calls, the `push-sender` pattern; raw Postgres errors mapped to codes)
  - `supabase/functions/tests/{stripe-signature.test.ts,stripe-webhook.test.ts,promotion-invoice.test.ts,fake-stripe-event.test.ts}` and `supabase/functions/tests/fixtures/stripeEvents.ts` (fake events signed inside the test with an obviously fake secret such as `whsec_test_fake_only`)
  - `scripts/dev/fake-stripe-event.ts` (local only, a Deno script run with `--allow-net=127.0.0.1,localhost`: signs a fake event with a secret passed on the command line and posts it to the local webhook; refuses any non-localhost URL; for the event types that need no Stripe call, see Test plan)
- PR 3 (app):
  - `supabase/migrations/<ts>_promotion_price_out_of_app.sql` (D15: replaces `get_my_promotion` without the price fields)
- PR 4 (launch docs):
  - `docs/runbooks/stripe-setup.md` (Archan's steps below, test then live)

## Files to change
- PR 1: `supabase/tests/05-seller-onboarding.test.sql` (allowlists), `supabase/tests/16-promotions.test.sql` (only the assertions on the old status list and the old `request` / `cancel` behaviour; listed exactly at gate B, stop and ask for any other), `supabase/seed.sql` and `scripts/seed/promotions.ts` (one row in each new state), `src/types/database.ts` (regenerated), `src/features/promotions/schema.ts` (new keys accepted), `docs/runbooks/promotions-admin.md` (`approve_headline`, the `invoice` and `void_pending` admin commands, refunds in Stripe), `docs/product/v1.md` §7, §15, §16.
- PR 2: `supabase/config.toml` (two function blocks), `supabase/functions/deno.json` (check task), `supabase/functions/_shared/http.ts` (export a raw-body reader built on the existing capped reader), (no `_shared/rateLimit.ts` change: the per-promotion limit is inside `begin_promotion_invoice`, PR 1), `.env.example` (names of the four function secrets, no values), `docs/runbooks/promotions-admin.md` (the two admin commands as one copy-paste terminal command each, the answers and error codes in plain words, how to make the admin secret).
- PR 3: `PromoteScreen.tsx`, `PromotionStatusCard.tsx`, `schema.ts`, `format.ts`, `messages.ts`, `src/types/database.ts` (regenerated), and the existing tests that assert the removed price or payment wording (listed exactly at the PR 3 plan; expected: `PromoteScreen.test.tsx`, `format` tests, `schema.test.ts`, `a11y.test.tsx`), plus `supabase/tests/16b-promotion-payment.test.sql` (key set of `get_my_promotion`).
- PR 4: `docs/product/v1.md` §16 (before-launch list; **PR 1 already wrote it**, review Q-S8: PR 4 only checks and updates it), CLAUDE.md row.

## New dependencies
No new dependencies. No Stripe SDK in the app or the Edge Functions (D7), no new Deno import, no native rebuild.

## Decisions
- **D1 Names (Resolved Q-D1).** The Stripe public business name **welcometohvac** appears on the invoice (the invoice's `account_name` is "The public name of the business"), its email, the hosted page and the receipt. The invoice line and description read **"LikeToOrder promotion, 7 days"**, so buyers connect the two. Statement descriptor `WELCOMETOHVAC`; the suffix `LIKETOORDER` only if Stripe's length rules allow, checked at Archan's setup step.
  - **The email's reply-to address: not confirmed** in the docs read. Archan checks it in test mode at setup step 7 (it should be the support email from Public details).
  - Stripe can also send invoice emails from a custom domain such as welcometohvac.com ("we send invoicing emails from that domain", [send email](https://docs.stripe.com/invoicing/send-email)); that is optional.
- **D2 Campaign window at payment (Resolved Q6).** `starts_at = greatest(now(), preferred_start at 00:00 America/Toronto)`, `ends_at = starts_at + length_days`. With no preferred start, it starts at payment. If the window would overlap (not expected: one open campaign per business), the payment is refunded (D5) rather than shifted.
- **D3 Idempotency by event id.** `stripe_events.event_id` is the primary key; every handler also checks the current state, so retries and out-of-order events are safe.
- **D4 Cards only.** The invoice's hosted page accepts cards; Apple Pay and Google Pay are turned on in the Stripe dashboard and work there as card wallets, with no code change (Resolved Q7). Bank-debit and other delayed methods stay off in the dashboard's invoice payment methods, so a payment is known at `invoice.paid`.
- **D5 Automatic refund of payments we cannot honour.** Duplicate, late (after `pay_by`), after a cancel (`void_pending`), or a wrong amount: a full automatic refund from the webhook, idempotent. Archan sees them in Stripe and in `stripe_events.outcome = 'refund_requested'`. Stripe keeps its card-processing fee on a refund ("Stripe's processing fees from the original transaction aren't returned", [Stripe refunds](https://docs.stripe.com/refunds), read 2026-11-21), so each such case costs a small fee. `void_pending` (D16) keeps these cases rare.
- **D6 Refunds only by Archan in Stripe (Resolved Q2, Q3).** The app has no refund button. Full refunds only; a full refund stops the campaign; a partial refund is recorded only.
- **D7 No Stripe SDK.** The REST calls and an HMAC check are small, need no dependency, and are fully testable with fake signed events. If PR 2's plan finds the form encoding too fragile, `npm:stripe` is the alternative and needs Archan's approval as a new dependency.
- **D8 Receipts and invoices from Stripe.** The Stripe invoice and its receipt are the seller's record. The app shows none. Whether the invoice needs tax lines or an HST number is Q11.
- **D9 Opening and returning: superseded** while the pay-outside plan stands. The app opens no payment page and has no return link. Revisit only if Q14 allows a link-out.
- **D10 Restricted key.** `STRIPE_SECRET_KEY` is a restricted key with only:
  - Customers write, Invoices write (create, read, finalize, send, void, and delete drafts), Invoice Items write, Refunds write;
  - Invoice Payments read.
  - No Charges permission: the code makes no charge call (`charge.*` events carry what the webhook needs). Removed at the PR 2 review (S4, 2026-11-23).
  Nothing broader. Stripe's restricted-key page says "Write permissions include Read permissions" and maps POST to write and GET to read ([restricted keys](https://docs.stripe.com/keys/restricted-api-keys), read 2026-11-21). The exact dashboard labels for Customers, Invoices, Invoice Items, Invoice Payments and Refunds are **not confirmed** on that page (re-read 2026-11-23 at D0: it shows only the form "Resource: Permission", for example "Customers: Read"); Archan matches them at setup step 8.
- **D11 Test events never touch live, two separate checks.** (a) The webhook function refuses an event whose `livemode` differs from `STRIPE_EXPECT_LIVEMODE`, before any database call. (b) The admin function records the invoice's `livemode` on the payment row at creation (`attach_invoice`), and `record_stripe_event` answers `mismatch` with nothing changed when an event's `livemode` differs from that row's. Each check has its own test.
- **D12 No lost refunds.** A payment that needs a refund stays `needs_refund` until `mark_refund_requested` runs after Stripe accepted the refund call. A duplicate event, and any later event for that payment, returns the refund target again while it is `needs_refund`. If the refund call fails, the webhook answers 500 so Stripe retries; the same `Idempotency-Key: refund-<payment id>` keeps it to one refund. After `mark_refund_requested`, a duplicate returns no refund target.
- **D13 Admin-only invoicing.** `promotion-invoice` takes no user JWT and is never called by the app. It is protected by `PROMOTION_ADMIN_SECRET` in the `x-admin-secret` header (constant-time compare, the `push-sender` pattern), looks up the owner itself, and is rate-limited per promotion.
- **D14 Stripe Invoicing (Resolved Q13 (b)).**
  - **The invoice:** `collection_method=send_invoice`, due date equal to `pay_by`, one invoice item for the locked amount in `cad`. The admin function finalizes and sends it, and Stripe emails the seller a hosted pay page.
  - **Test mode:** "Requests made in test-mode result in no emails being sent, despite sending an invoice.sent event" ([Send invoice](https://docs.stripe.com/api/invoices/send), read 2026-11-21). In test mode Archan opens the hosted invoice from the Stripe dashboard and pays it with a test card.
  - **The seller's email:** read server side from auth, sent only to Stripe, never returned, logged or stored in our tables. An owner with no email gets `no_email` and nothing at Stripe.
  - **One email, from our send call (D0, 2026-11-23):** with `auto_advance=false`, Stripe's automatic emailing is "Not enabled" ([automatic advancement](https://docs.stripe.com/invoicing/integration/automatic-advancement-collection)), so finalize sends nothing and the `/send` call sends the one invoice email. Archan still checks "Send finalized invoices to customers" at setup step 7. The reply-to address stays not confirmed (D0 row 4).
- **D15 Price out of the app's data (recommended; Archan confirms at the PR 3 plan).** `get_my_promotion` should stop returning `price_cents` and `currency_code` (for the promotion and the settings), because the app no longer shows them. Leaving them in the answer invites them to reappear in the UI, and a store reviewer reading network traffic would see a price for an in-app feature.
  - **Order matters:** PR 1 keeps the fields, so the app on main still works. PR 3 removes their use and adds one small replacing migration that drops them, then regenerates types.
  - The length (`length_days`) stays, for "for 7 days".
- **D16 Voiding stale invoices (consequence of "no job").** A seller cancel, an admin reject or cancel, or a lapsed window does not reach Stripe by itself. The documented admin command `void_pending` voids those invoices at Stripe. Until it runs, a stale invoice stays payable, and a payment on it is refunded by D5 (a small fee). A small worker that voids automatically is a possible later improvement, not built now.
- **D18 Promote screen in PR 1 (gate C, approved; `contact_support` mapped after the PR 1 review, Q3):** the app accepts the new states with the three final status lines ("Your headline was approved. We'll be in touch with next steps.", "Payment window closed.", "Refunded.") and no dead buttons: `awaiting_payment` counts as open and is cancelled like a request ("Cancel request"); a **paid** scheduled or active campaign shows no cancel button and no "Promote again" (the server answers `contact_support`; PR 3 adds "Contact us to cancel"); `payment_expired` and `refunded` offer "Promote again". No price or payment wording was added.
- **D17 Pinned Stripe API version.** Every Stripe request sends `Stripe-Version: 2026-11-18.endive` ("The current version is 2026-11-18.endive", [versioning](https://docs.stripe.com/api/versioning), read 2026-11-21). The webhook endpoint is created with the same API version (setup step 10), so event payloads match. Changing it is a reviewed code change.
  - Re-checked 2026-11-23 at D0: still "The current version is 2026-11-18.endive"; the header is `Stripe-Version`; the webhook endpoint's `api_version` decides the event payload version ([create webhook endpoint](https://docs.stripe.com/api/webhook_endpoints/create)).

## Rules for implementation
- RLS on every new table, plus pgTAP proving outsiders are refused.
- Supabase calls only in `src/features/promotions/api.ts`.
- Theme tokens only, no hardcoded colours or sizes. Loading, empty, error (with Retry) and success on every screen. Accessibility labels and roles on every touchable, 44 pt targets.
- Feature-specific rules:
  - **No payment in the app:** the app never shows a promotion price, a Pay button, a payment link, a Stripe URL, or wording that steers to paying elsewhere ("pay by email", "pay online", "check your email to pay", "invoice"). Status wording only.
  - **Secrets:** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and `PROMOTION_ADMIN_SECRET` exist only as Supabase Edge Function secrets set by Archan. Never in the app, never `EXPO_PUBLIC_*`, never in the repo, `app.config.ts`, CI logs, chat or seed. `.env.example` lists names only. Claude never reads `.env` or `supabase/functions/.env`.
  - **No Stripe key in the app at all**, not even a publishable key.
  - **No card data, no email in our tables:** the database stores Stripe ids, amounts and statuses only. The seller's email is read server side for the Stripe Customer and never logged or returned.
  - **The server decides:** only `record_stripe_event` (called after a verified signature) can set a paid campaign to `approved`. No client-callable function sets `paid_at`, `approved` or `refunded`, or touches `promotion_payments` or `stripe_events`.
  - **Signature first** in the webhook; **admin secret first** in `promotion-invoice`. No JSON parse and no database call before those pass.
  - **Amounts in cents**, CAD only, compared exactly with the locked row.
  - **Pinned API version** (D17) and an `Idempotency-Key` on every Stripe POST.
  - **All tests use fake signed events** and a fake admin secret created in the test. No real Stripe account, key or network call in any test or session; the REST calls are injected and faked.
  - Migrations are append-only (the `protect-files` guard hook blocks edits to existing migrations); run `npm run db:types` after each migration. If the guard hook blocks anything, stop and ask.
  - All SQL and TS ASCII-only; byte-check after writing.

## Store rules (MUST CHECK) - plan: pay outside the app (Stripe Invoicing email); Q14 open
**MUST be settled BEFORE PR 1 is planned, not only before PR 3, because an in-app-purchase requirement changes the price, the fee and the app screens. Archan's supervisor (Cowork Claude) researches the live Apple and Google pages and records the answer here; Archan only decides.**

First search (spec draft, 2026-11-21):
- Apple App Review Guidelines 3.1.1 require In-App Purchase to unlock features or digital content in an app. 3.1.3(g) covers apps whose main purpose is ad management; LikeToOrder is not such an app. Sources: [Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/), [MacRumors, Oct 2022](https://www.macrumors.com/2022/10/24/apple-updates-app-store-review-guidelines-2/).
- Google Play requires Play Billing for in-app purchases of digital goods and services, with listed exceptions; none names advertising. Sources: [Play Payments policy FAQ](https://support.google.com/googleplay/android-developer/answer/10281818), [Understanding Google Play's Payments policy](https://support.google.com/googleplay/android-developer/answer/9858738).

**Answer (gate S, dated 2026-11-21, read by Cowork Claude; NOT legal advice):**
1. **Apple:** 3.1.1 requires In-App Purchase to unlock features. 3.1.3(g) exempts only apps whose sole purpose is managing ad campaigns, and says buying ads displayed in the **same** app (for example "boosts" in a social app) must use In-App Purchase. LikeToOrder is not an ad-management app. Outside the US storefront, 3.1.1(a) bars buttons, external links or calls to action that steer to other purchase methods unless Apple has granted an entitlement. Source: [Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/).
2. **Google:** the Payments policy requires Play Billing for digital goods and services bought in the app, lists no exception for advertising or business purchases, and bars leading users to another payment method, including by linking to a webpage. Canada appears in none of the alternative-billing programs on the page read. Sources: [Play Payments policy FAQ](https://support.google.com/googleplay/android-developer/answer/10281818), [Understanding user choice billing](https://support.google.com/googleplay/android-developer/answer/13821247).
3. **Caveats:** Apple's wording came through a summary, not word for word; Google's full Payments policy page (answer 9992660) and country list were not read; neither store's reviewer has been asked. Before submitting the app, re-read both live pages and consider asking App Review.
   - *Update, same day (the Q14 check below):* Google's full Payments policy page (answer 9992660) and the program country lists have now been read; they confirm points 2 and the absence of Canada. Apple's 3.1.1 / 3.1.3(g) text again came through a summary of a long page, so the Apple caveat stands.
4. **PLAN until Q14 is answered:** sellers pay **OUTSIDE the app**, through the Stripe invoice email (Resolved Q13). Apple In-App Purchase and Google Play Billing stay out of scope (an amendment is needed if a store refuses this route).

## Tax and receipts (needs an accountant; not decided)
- Whether Ontario HST (13 %) applies to selling promotion placement to Ontario businesses, and whether welcometohvac must register (the small-supplier threshold): accountant's view.
- Whether the settings price is **tax-inclusive or tax-exclusive**, and whether to use Stripe Tax or a fixed tax line on the invoice: decided by Archan after the accountant. Until then one `price_cents` is stored and invoiced exactly, with no tax line.
- What the Stripe invoice must show for a seller's bookkeeping (business name, HST number if registered, date, amount, tax): accountant's view.
- Refunds versus credit notes, and the effect of refunds on tax: accountant's view.
- None of this blocks building; it blocks the switch to live mode.

## What Archan does himself (Claude does none of this)
1. Create a Stripe account for welcometohvac (Canada) yourself in the browser. Do not share any login with Claude.
2. Stay in **Test mode** (the toggle in the Stripe dashboard) for everything until the before-launch step.
3. In Settings > Public details, set the public business name to **welcometohvac**, the support email and the support phone or URL.
4. Set the statement descriptor `WELCOMETOHVAC` and check whether the suffix `LIKETOORDER` fits Stripe's length rules; tell Claude only yes or no.
5. Add branding (icon, colour) in Settings > Branding, so the invoice, its email and the hosted page look consistent.
6. Add the bank account for payouts and complete the identity checks Stripe asks for (needed before live mode; can be done now).
7. In the invoice settings: allow cards on the hosted invoice page (turn on Apple Pay and Google Pay; leave bank debits and other delayed methods off); check the "Send finalized invoices to customers" setting so the seller gets one email, not two (D14); note which address the invoice email shows as sender and reply-to; and check the Invoicing plan and fee (Starter or Plus).
8. In Test mode, create a **restricted key** with only the permissions in D10.
9. Make a long random **admin secret** yourself (for example with a password manager, or `openssl rand -hex 32` in your own terminal, never saved to a file in the repo) for `PROMOTION_ADMIN_SECRET`. It must be at least 32 characters, or the function refuses to work (`not_configured`). Keep it in your password manager; it is what lets you send and void invoices.
10. After PR 2 is merged and you have deployed the functions, add a test-mode webhook endpoint pointing to the hosted `stripe-webhook` URL, with the five events listed under Edge Functions and API version `2026-11-18.endive` (D17). Copy its signing secret.
11. Set the four secrets yourself in a terminal (never in chat, never in a file in the repo): `npx supabase secrets set STRIPE_SECRET_KEY=... STRIPE_WEBHOOK_SECRET=... STRIPE_EXPECT_LIVEMODE=false PROMOTION_ADMIN_SECRET=...`.
12. Tell Claude only "test secrets are set". Never paste a key, a secret or a screenshot showing one into chat. If one is ever pasted, roll it at once (in Stripe, or make a new admin secret).
13. No Expo rebuild is needed for this spec (unless Q14 changes the plan).
14. **End-to-end `invoice.paid` check in Test mode** (after step 11; the local script cannot do it): approve a seeded headline, run the `invoice` admin command, open the invoice from the Stripe dashboard (test mode sends no email), pay it with a Stripe test card, then check that the webhook delivery succeeded in the dashboard and the Promote screen shows "Paid and scheduled" after pull to refresh. Then refund it in full in the dashboard and check "Refunded.". Tell Claude only the outcome.

## Out of scope
- **In-app payment of any kind** (Apple In-App Purchase, Google Play Billing, an in-app browser sheet, a Pay button)
- **Link-out to a payment page from the app until Q14 is answered**
- Any price, invoice or payment wording in the app (Resolved Q15)
- A worker that voids stale invoices automatically (a possible later improvement, D16)
- Live mode, live keys and a live webhook endpoint (before launch, below)
- Subscriptions, several campaign lengths, coupons, discounts, credits, credit notes
- Tax calculation (pending the accountant)
- Seller self-service refunds or cancellation of a paid campaign
- Payment for orders: v1 §3 (orders stay trust-based)
- Stripe Connect or paying sellers
- An admin screen (spec 16 Q17)
- Push notifications about payments
- Everything in v1 §3

## Definition of done
**PR 1 (database, `feature/promotion-payment-db`)**
- [x] RLS on `promotion_payments` and `stripe_events`; `anon` and `authenticated` hold no privileges. **An outsider cannot** read, insert, update or delete any payment or event row, or call `begin_promotion_invoice`, `attach_invoice`, `mark_invoice_sent`, `list_invoices_to_void`, `mark_invoice_void`, `record_stripe_event` or `mark_refund_requested` (anon and authenticated refused). The 05 allowlists are updated.
- [x] Migration safety: rows approved before this migration get `is_free = true` and still read as active, scheduled or ended exactly as before (as proven: the **data update** is proven by the local before/after snapshot around `migration up`, identical by `cmp`, with the approved rows now `is_free` and the requested row unchanged; commit 30ccdf5. The pgTAP section proves only that free rows read exactly as spec 16 rows did: `get_my_promotion` state, `promotion_is_active`, the map `promoted` flag and Offers. Its "no approved row is neither free nor paid" assertion is a constraint check (`promotions_paid`), not proof of the update); existing `requested` rows are unchanged.
- [x] `approve_headline` locks the price: changing `promotion_settings` afterwards does not change the amount `begin_promotion_invoice` returns.
- [x] Every transition: requested -> payment_due -> approved (paid); payment_due -> payment_expired (lapse, then a new request succeeds); payment_due -> cancelled (seller; the payment row becomes `void_pending`); admin reject and cancel on `payment_due` (also `void_pending`); paid -> refunded (full); a partial refund keeps it active; a dispute stops it; a seller cancel of a paid campaign -> `contact_support`; the free `approve` still works.
- [x] `begin_promotion_invoice`: one open row per promotion; a second call returns `already_sent` or `resume`; `payment_window_closed` within 1 hour of `pay_by`. `list_invoices_to_void` returns exactly the `void_pending` rows and the open (and, as built, uncollectible) rows past `pay_by`.
- [x] `get_my_promotion` returns every derived state in the table, with fixed times relative to `now()`, and no invoice id, link, Stripe id or receipt.
- [x] A refunded or disputed campaign is not `promoted` on the map functions and not in `list_offers_near`.
- [x] `record_stripe_event`:
  - a duplicate event id changes nothing;
  - a duplicate, and any later event, for a payment in `needs_refund` returns the refund target again;
  - after `mark_refund_requested`, a duplicate `invoice.paid` returns no refund target;
  - an event whose livemode differs from the payment row's -> `mismatch`, nothing changed;
  - `invoice.paid` with a wrong `amount_paid` or currency, after `pay_by`, or on a `void_pending` row -> `needs_refund`, no activation;
  - `invoice.voided` -> `void`;
  - review fixes: bad data on our own `invoice.paid` raises and stores nothing (S2); the honour rule's passing path, a `paid_at` before the payment row (mismatch) and the clamp within 5 minutes (Q2).
- [x] Review fixes (2026-11-22): the delete guard (S1), `attach_invoice` window check and `check_invoice_sendable` (S3), `void_open_payment` on `uncollectible` (Q-S4), each with pgTAP. The 16b file has **211 assertions**; the section headers carry the true counts.
- [x] Deliberate breaks, each red on its named test, then reverted and `cmp`-checked:
  - (a) remove the `stripe_events` conflict guard;
  - (b) let `invoice.paid` with a wrong amount activate;
  - (c) grant `begin_promotion_invoice` to authenticated;
  - (d) read the price from settings instead of the row;
  - (e) skip the refund target on a duplicate for a `needs_refund` payment;
  - (f) drop the row-livemode check;
  - (g) make a duplicate `invoice.paid` return the refund target again after `mark_refund_requested`;
  - (h) check `pay_by` against `now()` instead of `paid_at` (red on "late webhook: paid before pay_by but delivered after it activates");
  - (i) guess `resume` from `created_at < now()` (the gate A bug; red on "and says resume").
  - (j) drop the honour rule's `payment_expired` branch (red on "honour rule: paid in time on a campaign already stored payment_expired, with no newer request, activates");
  - (k) drop the delete guard trigger (red on "deleting a business with an open invoice is refused");
  - (l) store `mismatch` instead of raising for our own invoice with a future `paid_at` (red on "our invoice.paid with a paid_at more than 5 minutes ahead raises ..." and "the raise rolled back the event row ...");
  - (m) drop the window check in `attach_invoice` (red on "attach_invoice refuses a reserved row whose payment window has passed");
  - (n) make `check_invoice_sendable` ignore the promotion state (red on "check_invoice_sendable: not after pay_by" and "... not after a cancel").
  - Done 2026-11-22 (commit 2f3b4ec for (a) to (i)); all of (a) to (n) re-run after the review fixes (commit "test: deliberate breaks ... review re-run"): each red on its named test, restores proven by `cmp` of function md5s and grants and of the repo files.
- [x] Seed has one row in each new state (as approved at the plan: `payment_due` and a paid campaign); `db:types` regenerated; the zod schema accepts the new keys with no behaviour change; jest, lint, typecheck and `npx supabase test db` green; runbook (with the `invoice` and `void_pending` commands) and v1 §7, §15, §16 updated.

**PR 2 (Edge Functions, `feature/promotion-payment-functions`)**
- [x] Admin function (Deno tests, fake `fetch`, fake database calls, fake email lookup):
  - **refused without the admin secret** (missing header, wrong secret, a user JWT instead: all 401 with no body, no database call and no Stripe call); the compare is constant-time;
  - `PROMOTION_ADMIN_SECRET` unset or shorter than 32 characters -> 503 `not_configured`;
  - the per-promotion rate limit (429 `rate_limited`); a missing Stripe key -> 503 `payments_unavailable`; each database error mapped to its code, never the raw text;
  - an owner with no email -> 409 `no_email` and no Stripe call;
  - `invoice` makes the five calls in order, each with its idempotency key and `Stripe-Version: 2026-11-18.endive`;
  - the invoice has `collection_method=send_invoice`, `due_date` equal to `pay_by`, `auto_advance=false`, `currency=cad`, `pending_invoice_items_behavior=exclude` and metadata; the item has the locked amount and "LikeToOrder promotion, 7 days";
  - the customer gets the owner's email, and the email appears in no log line and no response;
  - a failure at each step resumes at the right step on a second call (driven by the invoice's state at Stripe), with no second Customer, invoice or item;
  - `attach_invoice` refused -> the draft is deleted, nothing finalized or sent; `check_invoice_sendable` false -> the invoice is voided and marked, not sent;
  - `already_sent` -> 409 `{ ok: false, error: 'already_sent' }`; success -> exactly `{ ok: true, invoice_status: 'sent' }`;
  - `void_pending` voids each listed invoice and marks it; deletes drafts; marks invoices already void; skips paid ones; one failure does not stop the rest; answers the counts.
- [x] Webhook (Deno tests, fake signed events, fake `fetch`):
  - bad signature, old timestamp, missing header and a body over 256 KB (413) are refused with no database call and no Stripe call;
  - a valid `invoice.paid` triggers the invoice-payments lookup, passes `invoice_id`, `payment_intent_id`, `amount_paid`, `currency` and `paid_at` (from `status_transitions.paid_at`) on, and activates; a failed lookup answers 500; an event missing `paid_at`, `currency` or `amount_paid` answers 500 with no call; no paid payment found -> `payment_intent_id` null is passed;
  - an event whose livemode differs from `STRIPE_EXPECT_LIVEMODE` is refused before any database call (tested separately from the row check);
  - a database error or `invalid_event_data` answers 500; applied, duplicate without a target, ignored and mismatch answer 200;
  - a refund target leads to one `POST /v1/refunds` with `payment_intent` and `Idempotency-Key: refund-<id>`, then `mark_refund_requested`; `charge_already_refunded` counts as done;
  - a failed refund call answers 500 and does not call `mark_refund_requested`;
  - a retried duplicate with a refund target repeats the refund call with the same key;
  - the `p_data` shapes of `invoice.voided`, `invoice.marked_uncollectible`, `charge.refunded` and `charge.dispute.created`.
- [x] Deliberate breaks (labelled W1 to W10 so they do not collide with PR 1's letters), each run in a scratch copy, red on its named test, then restored and proven with `cmp` (done 2026-11-23 at gate D4: all ten red on their named tests, each restore `cmp`-equal to HEAD, tree clean, full Deno suite green after the last restore; all thirteen re-run after the review fixes, same result):
  - W1 skip the signature check;
  - W2 skip the `STRIPE_EXPECT_LIVEMODE` check;
  - W3 answer 200 when the refund call fails;
  - W4 not repeat the refund on a duplicate that carries a refund target;
  - W5 skip the admin secret check;
  - W6 let an `invoice.paid` with a wrong amount reach activation (the handler drops the amount it passes);
  - W7 log the customer email;
  - W8 skip `check_invoice_sendable` before send;
  - W9 skip the draft delete when `attach_invoice` refuses;
  - W10 drop the `Idempotency-Key` on one Stripe POST;
  - W11 create again on a retry instead of reading the invoice state (review Q1);
  - W12 send an open invoice whose total differs from the locked amount (review S2);
  - W13 let the fake-event script follow redirects (review S5).
- [x] `grep` proves no `sk_`, `rk_` or `whsec_` value outside the tests' obvious fakes, and no `EXPO_PUBLIC_STRIPE` anywhere.
- [x] `git diff --stat main -- supabase/migrations` is empty (no migration in PR 2).
- [x] `scripts/dev/fake-stripe-event.ts` refuses a non-localhost URL, and the signature it makes verifies (Deno test). `deno lint`, `deno task check`, `deno task test` green; `config.toml`, `deno.json`, `.env.example` (names only) and the runbook updated. Nothing deployed; no secret set.

**PR 3 (app, `feature/promotion-payment-app`; status wording and price removal)**
- [ ] The Promote screen shows every state in "What people see" with its action, plus loading, error and Retry; pull to refresh updates it.
- [ ] Every replacement in the table under Screens & routes is made; the matching existing tests are updated (listed exactly at the PR 3 plan).
- [ ] **The app contains no price, Pay button, payment link or payment wording for promotions**: `grep` proves no `checkout.stripe.com`, `invoice.stripe.com` or other Stripe URL, no "stripe", and no promotion price or payment wording (`formatPromotionPrice`, `price_cents`, "We'll contact you about payment", "invoice") in `src/features/promotions/`, `src/` and `app/`.
- [ ] D15 (if Archan confirms at the plan): the replacing migration drops the price fields from `get_my_promotion`, pgTAP checks the new key set, types are regenerated, and the zod schema refuses a price key.
- [ ] Screen-reader labels on Contact us to cancel and Promote again; the largest text size fits.
- [ ] Archan's Simulator run with seed rows for each state:
  - the invitation shows no price;
  - awaiting approval, headline approved, paid and scheduled, active, ended, payment window closed, refunded, rejected with the "payment window closed" reason;
  - the webhook path end to end: after Archan's deploy and test-mode setup, a test-mode invoice paid with a Stripe test card turns a `payment_due` row into "Paid and scheduled" after pull to refresh (the local fake-event script cannot do `invoice.paid`, see Test plan).
- [ ] If Q14 later allows a link-out, PR 3's scope grows again (button, browser sheet, return handling) through a short amendment approved by Archan.

**PR 4 (launch docs, `feature/promotion-payment-launch-docs`)**
- [ ] `docs/runbooks/stripe-setup.md` with Archan's steps for test and live; v1 §16 updated with the before-launch list below.

## Before launch (separate from building)
1. Store-rule answer re-read on the live pages before submitting the app (Store rules, caveat 3); Q14 answered or left closed.
2. Accountant's answer on HST, the tax-inclusive price and what the invoice must show; the price set accordingly in the live `promotion_settings`.
3. Stripe live mode: identity and bank verified; a live restricted key; a live webhook endpoint with the five events and the pinned API version; live secrets and a new live admin secret set by Archan; `STRIPE_EXPECT_LIVEMODE=true`.
4. One real-money test at the smallest price: a real invoice email to Archan's own address, paid with a real card, then a full refund in the dashboard; check the sender and reply-to, the statement descriptor and the receipt.
5. Terms and privacy policy (spec 18): price, payment by invoice, refunds, disputes, who charges (welcometohvac for LikeToOrder), and that the seller's email is shared with Stripe to send the invoice.
6. VoiceOver and TalkBack on the new status lines.

## Test plan
- **pgTAP** `supabase/tests/16b-promotion-payment.test.sql` (PR 1): everything under PR 1, calling the private functions as the database owner with fake event payloads; plus the approved 05 and 16 edits. Run with `npx supabase test db` after `npx supabase db reset` (local only). PR 3 extends it with the D15 key set.
- **Deno** `supabase/functions/tests/` (PR 2): signature verify (known-answer vectors computed in the test from a fake secret), the admin secret check, the five-call invoice sequence and its resume, `void_pending`, the webhook with the invoice-payments lookup and refunds, all with an injected fake RPC and a fake `fetch`. No network.
- **jest** (PR 1 and PR 3): the schema keys (PR 1); the status wording, the removed price, `PromoteScreen` states and the updated existing tests (PR 3).
- **Local manual without Stripe** (after PR 2): `npx supabase db reset`, then `scripts/dev/fake-stripe-event.ts` signs a fake event with a made-up local secret and posts it to the local webhook. It covers only the paths that need no Stripe call: `invoice.voided`, `invoice.marked_uncollectible`, the `charge.refunded` and `charge.dispute.created` shapes, and the signature and livemode refusals. Archan runs it; the local function reads the made-up secret from his local function env, which Claude does not read.
  - **No `invoice.paid` locally (Archan, 2026-11-23):** that path needs the invoice-payments lookup at Stripe, and the functions have no setting that could point the Stripe key at another host. `invoice.paid` is covered by the Deno tests (fake `fetch`) and checked end to end by Archan in Stripe test mode after his deploy (What Archan does himself, step 14).
- **Manual in Stripe test mode** (Archan, after his setup steps): run the `invoice` admin command, open the invoice from the Stripe dashboard (test mode sends no email), pay with a Stripe test card, then check the app; cancel another one and run `void_pending`.

## Delivery: PRs and gates
I stop and commit at every gate (named files, a conventional message, no push) and wait for Archan's "approved". The spec commits live on `feature/promotion-payment` and ship as one docs-only PR. Every PR is cut from `main` after the previous one is merged.

| PR | Branch | Gates | Migration |
|---|---|---|---|
| spec | `feature/promotion-payment` | **A** spec + CLAUDE.md row + spec 16 status line. **A2** gate S amendment (pay outside the app). **A3** Q13 / Q15 amendment (Stripe Invoicing, no price in the app). Shipped as a docs-only PR. | No |
| 0 store check | none (docs) | **S** done 2026-11-21: pay outside the app. Q14 stays open and does not block building. | No |
| 1 database | `feature/promotion-payment-db` | **B** migration + pgTAP (new + 05/16 edits), `test db` green, breaks (a) to (g). **C** seed, `db:types`, zod keys, runbook, v1 §7/§15/§16. Review, ship. | **Yes** (one) |
| 2 functions | `feature/promotion-payment-functions` | **D0** Stripe research on public docs + spec edits (done 2026-11-23, "PR 2 research (D0)"). **D1** `_shared/stripe.ts` + signature tests. **D2** `stripe-webhook` + Deno tests with fake signed events. **D3** `promotion-invoice` + Deno tests with a fake admin secret. **D4** breaks W1 to W10. **D5** fake-event script, `config.toml`, `deno.json`, `.env.example` names, runbook. Review, ship. Nothing deployed. | No |
| 3 app | `feature/promotion-payment-app` | **E1** schema, format, messages, `PromoteScreen` and `PromotionStatusCard`: status wording and price removal, updated tests. **E2** D15 replacing migration + pgTAP + `db:types` (if confirmed). **F** Archan's Simulator run with seed rows, plus the `invoice.paid` end to end in Stripe test mode (Archan's step 14). No dependency, no native rebuild. Review, ship. | Yes (D15, small) |
| 4 launch docs | `feature/promotion-payment-launch-docs` | **G** `stripe-setup.md`, v1 §16. Ship. | No |

## Privacy and security position
- No payment happens in the app: no price, no Pay button, no link, no invoice, no Stripe key, no card data (Resolved Q15).
- Card data never touches our servers or database. Stripe hosts the invoice and pay page.
- **The seller's email goes to Stripe**, read server side only, to create the Customer that receives the invoice. It is never returned to the app or the admin caller, never logged, and never stored in our tables. It must be named in the privacy policy (spec 18).
- Four server secrets, set only by Archan. Invoices are created and voided only by an admin caller holding `PROMOTION_ADMIN_SECRET`.
- Only a verified Stripe signature can mark a campaign paid. Clients cannot write any payment field.
- We store Stripe ids, amounts and statuses; no names, emails or full payloads.
- Test and live events are kept apart twice: by `STRIPE_EXPECT_LIVEMODE` in the webhook and by the payment row's `livemode` in the database.

## Resolved questions
Resolved by Archan on 2026-11-21.

- **Q-D1** Public business name welcometohvac, product line "LikeToOrder promotion, 7 days", descriptor `WELCOMETOHVAC`; the suffix `LIKETOORDER` only if Stripe's length rules allow, checked at Archan's setup step (D1).
- **Q1** 7 days to pay after headline approval.
- **Q2** "Contact us to cancel" for a paid campaign; no self-service refund (D6).
- **Q3** Full refunds only, by Archan in Stripe; a partial refund is recorded only (D6).
- **Q4** Keep the manual free `approve` (`is_free`).
- **Q5** A chargeback stops the campaign.
- **Q6** Start at payment, or at the preferred day if later (D2).
- **Q7** Apple Pay and Google Pay on in the Stripe dashboard; no code change (D4).
- **Q8** `expo-web-browser`: **superseded while the pay-outside plan stands; revisit if Q14 allows a link-out.**
- **Q9** The return page candidates: **superseded while the pay-outside plan stands; revisit if Q14 allows a link-out.**
- **Q10** Gate S done 2026-11-21 (Store rules, Answer): pay outside the app.
- **Q12** Existing `requested` rows stay as they are; existing `approved` rows are marked `is_free` by the migration.
- **Q13 (2026-11-21)** (b) Stripe Invoicing: the admin function creates a Stripe Customer and an invoice with `collection_method=send_invoice` and a 7-day due date, and Stripe emails the seller a hosted pay page (D14). Options (a) manual email and (c) our own email worker were not chosen.
- **Q15 (2026-11-21)** Remove the price and payment wording from the app. The app shows status only. Price, deadline and receipt appear only in the Stripe invoice email and its hosted page (table under Screens & routes; D15 for the data).

## Follow-ups (not in this spec)
- OffersPrivacy.test.tsx flaked once under full-suite load, passes alone and on rerun; timing, spec 16 PR 4 test. (Recorded 2026-11-23 at PR 2 gate D3; not touched in PR 2.)

## Open questions
1. **Q11 Tax:** the accountant's view on Ontario HST, a tax-inclusive or tax-exclusive price, registration, what the invoice must show, and refunds versus credit notes. Blocks live mode, not building.

2. **Q14 ARCHAN'S PROPOSAL (recorded as given):** "Open the payment page on a website from the app (redirect the seller to a web payment page, then ask them to go back to the app), to stay outside the store payment rules."
   - **Status: NOT the plan; blocked pending the check below.** The plan stays "pay outside the app" through the Stripe invoice email.
   - **Plain facts:**
     - Apple 3.1.1(a) and Google's Payments policy both treat a button, link or call to action in the app that sends users to another way of paying as steering.
     - The one storefront exception found is the US. Canada is not covered on the pages read.
     - The risk is app review rejection or later removal from the store, not a court case.
   - **Check (read-only, 2026-11-21, by Claude through a page reader; short phrases only; NOT legal advice):**
     - **Apple Guideline 3.1.1(a)** ([App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)): developers "may apply for entitlements" to link out for digital purchases. Outside the US storefront, apps may not include buttons, external links or other calls to action toward non-IAP purchasing, unless an entitlement applies. This text came through a summary of a long page (not word for word). Which storefronts the entitlements cover: not confirmed on this page.
     - **Apple StoreKit External Purchase Link Entitlement** ([support page](https://developer.apple.com/support/storekit-external-entitlement/)): the page served was "Distributing dating apps in the Netherlands"; the entitlement there is "only available for dating apps" in the Netherlands.
       - Who may apply: "an Account Holder in the Apple Developer Program".
       - Disclosure: a system sheet before each link ("You're about to leave the app ..."); the link opens in the default browser.
       - Fees: Apple's commission is reduced by 3% of the price.
       - Reporting: a weekly report within 15 calendar days.
       - Canada: not listed.
     - **Apple EU external purchase terms** ([EU page](https://developer.apple.com/support/apps-using-alternative-payment-providers-in-the-eu/)): EU/EEA storefronts only.
       - Disclosure: the `ExternalPurchaseCustomLink.showNotice` sheet.
       - Fees: link-out purchases carry a store services commission of 15% (10% for small businesses) on sales within 7 days of the tap.
       - Reporting: a monthly report within 15 days. Canada is not on the list.
     - **Apple StoreKit External Purchase documentation** (developer.apple.com/documentation/storekit/external-purchase): could not be read (title only). Not confirmed.
     - **Canada entitlement or program at Apple:** none found on the pages read. Not confirmed either way.
     - **Whether a business-to-business promotion purchase qualifies at Apple:** not confirmed. The categories found are Netherlands dating apps and EU apps.
     - **Google Payments policy full text** ([answer 9992660](https://support.google.com/googleplay/android-developer/answer/9992660)): apps "must use Google Play's billing system" for in-app digital goods unless Section 3, 8 or 9 applies.
       - Section 4 bars leading users to another payment method through "In-app webviews, buttons, links, messaging, advertisements, or other calls to action".
       - No exception for advertising or business-to-business purchases. "business productivity software" is listed among the cloud services that need Play Billing.
     - **Google external offers program** ([answer 14372887](https://support.google.com/googleplay/android-developer/answer/14372887)): "limited to EEA users".
       - Who may enrol: the developer "must be registered as a business".
       - Disclosure: an information screen shown through Google's APIs, which must "inform the user about the destination page".
       - Fees: an ongoing service fee of 20% on other in-app digital items bought within 24 hours of the link (10% for subscriptions; lower tiers exist).
       - Reporting: report transactions "within 24 hours". Canada is not eligible.
     - **Google user choice / alternative billing** ([answer 13821247](https://support.google.com/googleplay/android-developer/answer/13821247), [answer 12570971](https://support.google.com/googleplay/android-developer/answer/12570971)): markets are Australia, Brazil, Indonesia, Japan, South Africa, the United Kingdom and the EEA, plus separate programs for South Korea, India and the United States.
       - These programs are billing inside the app, not a link-out.
       - Fees: the service fee is reduced by 4%. Reporting: within 24 hours. Canada is not listed.
     - **Conclusion of the check:** no Apple entitlement and no Google program for Canada was found on the pages read. Whether a business promotion purchase would qualify anywhere: not confirmed. Q14 stays open and blocked.
