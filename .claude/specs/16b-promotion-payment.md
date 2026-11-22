# Spec 16b: Promotion Payment

**Branch:** `feature/promotion-payment` (spec commits only). Then four PRs, each cut from `main` after the previous one is merged: `feature/promotion-payment-db` (PR 1), `feature/promotion-payment-functions` (PR 2), `feature/promotion-payment-app` (PR 3), `feature/promotion-payment-launch-docs` (PR 4).
**Product spec:** `docs/product/v1.md` §7 (Ads: payment and activation), §3 (out of scope), §13 (Legal), §14 row 16b, §15 Q1, §16 (the five spec 16b items)
**Plan mode:** required: it changes the schema and RLS, adds two Edge Functions with server secrets and touches more than 5 files.
**Status:** 📝 Spec written. Amended 2026-11-21 after gate S: sellers pay **outside the app** (store rules).

## Overview
Today a seller asks for a promotion, Archan reads the headline, sends an invoice outside the app and switches the campaign on with one SQL call. After this spec, payment is handled by Stripe and the campaign switches on by itself, but **all payment happens outside the app** (Store rules):

1. The seller requests a promotion with a category and a headline (spec 16, unchanged).
2. Archan approves the **headline** with one SQL call. The price is locked at this moment.
3. The seller receives a payment link **outside the app**, by email (how exactly is Q13). The app shows only "Your headline was approved. We'll be in touch with next steps."
4. The seller pays on Stripe's own page in their browser. The app never sees card numbers and never shows a price, a Pay button or a link.
5. Stripe tells our server that the payment succeeded (a signed webhook). Only that message schedules the campaign.
6. The next time the seller opens or pulls to refresh the Promote screen, it shows "Paid and scheduled". The campaign then runs exactly as in spec 16 (larger flag, Offers card, Sponsored) and ends by the server clock.

The Stripe payment page and the email show the public business name **"welcometohvac"**, and the item reads **"LikeToOrder promotion, 7 days"**, so a buyer sees both names together (D1). It comes now because spec 16 built every surface a paid campaign shows on, and the manual invoice and manual activation do not scale.

### What people see, in plain words

**Seller, Promote screen (Manage Business, seller mode on).** Status only: no price, no Pay button, no payment link, and no wording that points to paying somewhere else.
- **Awaiting approval:** "Waiting for review." with **Cancel request**.
- **Headline approved, not paid yet:** "Your headline was approved. We'll be in touch with next steps." with **Cancel request**.
- **Paid and scheduled:** "Paid and scheduled. Starts on 2 Dec, ends on 9 Dec." with **Contact us to cancel** (no button that ends a paid campaign by itself).
- **Active:** "Active until 9 Dec." with **Contact us to cancel**.
- **Ended:** "Ended on 9 Dec." with **Promote again** (spec 16).
- **Payment window closed:** "Payment window closed." with **Promote again**.
- **Refunded:** "Refunded." with **Promote again**. The campaign is not shown on the maps or in Offers.
- **Rejected / Cancelled:** as spec 16.
- The screen updates when it opens and on the existing pull to refresh. There is no "confirming payment" step and no polling.

**Outside the app (email and the Stripe page, Q13):** the price, the 7-day deadline, the Stripe page, the receipt, and "The charge appears as WELCOMETOHVAC."

**Customers and guests:** nothing changes. A paid campaign looks exactly like a spec 16 campaign.

**Archan (admin: the dashboard SQL editor, an admin command and the Stripe dashboard)**
- Approves a headline (`approve_headline`), rejects, or cancels, with documented SQL (runbook updated).
- Creates the seller's payment link with the admin function (the delivery depends on Q13).
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
- PR 3 (app): `src/features/promotions/{schema.ts,format.ts,messages.ts}`, `src/features/promotions/components/{PromoteScreen,PromotionStatusCard}.tsx`

## User stories
- As a seller, after my headline is approved I receive a way to pay outside the app, pay the locked price on Stripe's page, and then see my campaign as paid and scheduled in the app.
- As a seller, I see who will charge me (welcometohvac, for a LikeToOrder promotion) on the payment page and on my card statement.
- As a seller, I am never charged twice for one campaign; a payment that cannot be honoured is refunded automatically (D5).
- As a seller, if I don't pay in time, nothing is charged and I can promote again.
- As Archan, I approve headlines with one SQL call, create payment links with one admin command, refund in the Stripe dashboard, and the app reflects all of it without manual activation.
- As anyone, I can trust that a campaign is live only because Stripe confirmed the money, never because the app said so.

## Screens & routes
- `app/seller/promote.tsx` (PR 3): unchanged route; `PromoteScreen` gains the status wording above.
- No new route, no return link, no new tab, no customer screen.

### Where spec 16 already shows a price or payment wording in the app (paths only, unchanged by this commit; see Q15)
- `src/features/promotions/components/PromoteScreen.tsx` (the invitation shows the price line and the payment note)
- `src/features/promotions/components/PromotionStatusCard.tsx` (the requested card shows the price)
- `src/features/promotions/format.ts` (`formatPromotionPrice`, `offerLine`: "CAD 25.00 for 7 days")
- `src/features/promotions/messages.ts` (`REQUESTED_TEXT` and `PAYMENT_NOTE`: "We'll contact you about payment."; `START_NOTE`: "after payment"; reject reason `not_paid`: "the invoice wasn't paid.")
- `src/features/promotions/schema.ts` (`price_cents` in the `get_my_promotion` answer; data, not shown text)
- Not related: menu prices for food (`src/features/menu/`, `src/features/map/components/SheetMenu.tsx`, `src/features/requests/`) are a seller's own prices, not a purchase in the app. The `pricetag` icon of the Offers tab (`app/(tabs)/_layout.tsx`, `TabIcon.tsx`) is an icon name only. No `stripe` or `checkout` text exists in `src/` or `app/` today.

## Payment flow and states

### In plain words
A promotion now has two gates: Archan says yes to the words, then Stripe says yes to the money. The money part happens entirely outside the app. Nothing in the app can open the second gate. If the seller does not pay within 7 days, the chance to pay simply lapses (by the server clock, no job), and the seller can start again.

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

"Payment failed" is not a stored state. Stripe shows a declined card on its own page and the seller can try another card there. Cards only (wallets included), no delayed methods (D4), so there is no "pending payment" state.

`payment_due` past its deadline becomes the stored `payment_expired` only when something writes to it (the seller's next `request_promotion`, or a late paid webhook). Reads never write. A payment that arrives after the deadline is refunded automatically (D5).

### Technical flow
1. `request_promotion` (spec 16) -> `requested`.
2. `private.admin_review_promotion(id, 'approve_headline')` -> `payment_due`; locks the price (re-snapshot from `promotion_settings`), sets `pay_by = now() + 7 days` and `reviewed_at`.
3. Archan (or a worker, Q13) calls the **admin-only** Edge Function `promotion-checkout` with the promotion id and the `x-admin-secret` header. The function calls `private.begin_promotion_checkout(promotion_id)` (service role only), which looks up the owner and business itself and, under a row lock, returns a still-open session's URL or reserves a new `promotion_payments` row. The function creates the Checkout Session at Stripe (REST, `Idempotency-Key: checkout-<payment id>`), stores the session id, URL and the session's `livemode` with `private.attach_checkout_session`, and returns `{ url, expires_at }` to the admin caller only. The app never calls it. (If Q13 picks Stripe Invoicing, this step creates an invoice instead; see Q13 (b).)
4. The link reaches the seller outside the app (Q13). The seller pays on Stripe.
5. Stripe calls Edge Function `stripe-webhook`. It verifies the signature, checks the event's `livemode` against `STRIPE_EXPECT_LIVEMODE`, then calls `private.record_stripe_event(...)`. On a paid `checkout.session.completed` the database checks the session id is ours, the event's livemode equals the payment row's, the amount and currency equal the locked price, and the promotion is still `payment_due` and within `pay_by`; then it sets `approved`, `paid_at`, `starts_at`, `ends_at` (D2). Otherwise it marks the payment `needs_refund` and returns the refund target, and the webhook refunds it (D5, D12).
6. The app reads `get_my_promotion` when the Promote screen opens or is pulled to refresh, and shows the state.

## Money rules
- **Price source:** `promotion_settings` (spec 16). One row: one price for the one campaign length (7 days). Several lengths would be a new spec.
- **Currency:** CAD only. `begin_promotion_checkout` refuses a promotion whose locked `currency_code` is not `CAD` (`not_configured`). Amounts are integer cents end to end; Stripe gets `unit_amount = price_cents`, `currency = 'cad'`.
- **Price lock:** at headline approval. `approve_headline` re-snapshots price, currency and length. A later change of `promotion_settings` never changes a `payment_due` row. Stripe is always asked for the locked row price, never the settings row.
- **Payment window:** 7 days after approval. A Checkout Session expires after at most 24 hours (Stripe's limit) and never later than `pay_by`; if less than 30 minutes remain before `pay_by`, a new link is refused (`payment_window_closed`). See Q13 for what this means for an emailed link.
- **One campaign, one payment:** at most one open payment row per promotion (unique partial index). Asking for a link twice reuses the open session's URL.
- **Duplicate or late payments (D5):** any paid session for a promotion that is no longer `payment_due` (already paid, cancelled, expired, refunded), or with a wrong amount or currency, is refunded in full automatically by the webhook, with `Idempotency-Key: refund-<payment id>`.
- **Refunds (D6, Resolved Q3):** full refunds only, only by Archan, only in the Stripe dashboard. The webhook (`charge.refunded`) records it:
  - **full refund** -> promotion `refunded`; a scheduled or running campaign stops at once (`ends_at = least(ends_at, now())`, kept for history);
  - **partial refund** (should not happen) -> recorded on the payment row only; the campaign keeps running.
  - Sellers cannot refund or cancel a paid campaign from the app ("Contact us to cancel", Resolved Q2).
- **Disputes (chargebacks, Resolved Q5):** `charge.dispute.created` is recorded and the campaign stops like a full refund. Handling evidence is Archan's job in the Stripe dashboard.
- **Webhook replay safety (D3):** `stripe_events.event_id` is the primary key; a replayed or re-delivered event does nothing new and is answered with 200, except that a payment still in `needs_refund` returns its refund target again (D12). Every state change also checks the current state, so out-of-order events are safe.

## Database changes
One new migration in PR 1 (`npx supabase migration new promotion_payment`). Spec 16's migration is not edited. If Q13 picks (b) Stripe Invoicing, the payment table changes as listed under Q13 before PR 1 is planned.

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

-- 3. One row per Stripe Checkout Session.
create table public.promotion_payments (
  id                    uuid primary key default gen_random_uuid(),
  promotion_id          uuid not null references public.promotions(id) on delete restrict,
  amount_cents          integer not null check (amount_cents > 0),
  currency_code         text not null check (currency_code = 'CAD'),
  status                text not null default 'reserved'
                          check (status in ('reserved','open','paid','expired','needs_refund',
                                            'refund_requested','refunded','partially_refunded','disputed')),
  checkout_session_id   text unique check (checkout_session_id ~ '^cs_(test|live)_[A-Za-z0-9]+$'),
  checkout_url          text check (checkout_url like 'https://checkout.stripe.com/%'),
  session_expires_at    timestamptz,
  livemode              boolean,             -- recorded at attach time from the created session (D11)
  payment_intent_id     text unique,
  refunded_cents        integer not null default 0 check (refunded_cents >= 0),
  created_at            timestamptz not null default now(),
  paid_at               timestamptz,
  updated_at            timestamptz not null default now(),
  constraint promotion_payments_refund_le check (refunded_cents <= amount_cents),
  constraint promotion_payments_open_attached
    check (status = 'reserved' or (checkout_session_id is not null and livemode is not null))
);
create unique index promotion_payments_one_open on public.promotion_payments (promotion_id)
  where status in ('reserved','open');
create unique index promotion_payments_one_paid on public.promotion_payments (promotion_id)
  where status = 'paid';          -- a second paid session goes to needs_refund instead

-- 4. Webhook idempotency and audit.
create table public.stripe_events (
  event_id     text primary key check (event_id ~ '^evt_[A-Za-z0-9]+$'),
  type         text not null,
  livemode     boolean not null,
  received_at  timestamptz not null default now(),
  outcome      text not null    -- 'applied' | 'ignored' | 'refund_requested' | 'mismatch'
);
```
No card data, names, emails or full Stripe payloads are stored; only ids, amounts and statuses.

**RLS and privileges.** RLS on for `promotion_payments` and `stripe_events`, no policies, no grants to `anon` or `authenticated` (the spec 16 / `map_rate_limits` pattern). The payment fields on `promotions` (`pay_by`, `paid_at`, `refunded_at`, `is_free`, `status`) stay unwritable by clients (no client grants on `promotions`, unchanged).

**Functions.** All security definer, `set search_path = ''`, `revoke execute ... from public, anon, authenticated`, then granted as below. The 05 allowlist test is updated.

| Function | Grant | What it does |
|---|---|---|
| `get_my_promotion()` (replaced, same signature) | authenticated | Adds `paid`, `is_free` and the new derived states. It returns no payment link, no Stripe id and no receipt. The price fields stay in the answer for now (Q15). |
| `request_promotion(...)` (replaced, same signature) | authenticated | Also refuses while a `payment_due` row is within `pay_by` (`already_open`). Under the business lock, it first stores `payment_expired` on the caller's own lapsed `payment_due` row, so the unique index frees up. |
| `cancel_my_promotion(uuid)` (replaced) | authenticated | Allowed for `requested` and `payment_due` (an open payment row is marked `expired` in our table; a payment that still arrives is refunded by D5). Refused with `contact_support` for a paid campaign. A free campaign (`is_free`) keeps spec 16 behaviour. |
| `private.admin_review_promotion(...)` (replaced) | none (database owner) | New decision `approve_headline` (requested only): re-snapshot price, currency and length, set `pay_by = now() + interval '7 days'`, status `payment_due`. `approve` keeps spec 16 behaviour and sets `is_free = true`. `reject` and `cancel` are also allowed on `payment_due`. Admin `cancel` of a paid campaign is allowed but does not refund (the runbook says: refund in Stripe first). |
| `private.begin_promotion_checkout(p_promotion_id uuid) returns jsonb` | service_role only | Looks up the business and owner itself; the promotion must be `payment_due`, `pay_by - now() >= 30 min`, currency CAD. Locks the promotion row. Returns `{reuse_url, expires_at}` for a still-open session with more than 5 minutes left, else reserves a payment row and returns `{payment_id, amount_cents, currency, length_days, expires_at, business_name}`. A reserved row older than 2 minutes with no session (the Stripe call failed) is expired first. Errors: `not_found`, `not_payable`, `payment_window_closed`, `not_configured`. |
| `private.attach_checkout_session(p_payment_id uuid, p_session_id text, p_url text, p_expires_at timestamptz, p_livemode boolean)` | service_role only | `reserved` -> `open`; format-checked ids; records the session's `livemode` on the payment row (D11). |
| `private.record_stripe_event(p_event_id text, p_type text, p_livemode boolean, p_data jsonb) returns jsonb` | service_role only | Inserts into `stripe_events` with `on conflict do nothing`. A duplicate does nothing new, **but** if the payment it names is still `needs_refund`, it returns `{outcome:'duplicate', refund:{payment_id, payment_intent_id}}` again (D12). By type, with row locks: unknown session -> `mismatch`, nothing changed; **event livemode differs from the payment row's livemode -> `mismatch`, nothing changed** (D11); `checkout.session.completed` (paid) -> amount and currency must match the row and the promotion must be `payment_due` within `pay_by` -> `approved`, `paid_at = now()`, window per D2; otherwise payment `needs_refund` and returns the refund target. `checkout.session.expired` -> payment `expired` if `open`. `charge.refunded` -> `refunded_cents`; full -> payment `refunded`, promotion `refunded`, window closed. `charge.dispute.created` -> payment `disputed`, campaign stopped. Any other type -> `ignored`. Any event for a payment still in `needs_refund` also returns its refund target (D12). |
| `private.mark_refund_requested(p_payment_id uuid)` | service_role only | `needs_refund` -> `refund_requested`, called by the webhook only after Stripe accepted the refund call. Until then the payment stays `needs_refund`. |
| `private.promotion_is_active(uuid)` | unchanged | Still `approved` and in window; `refunded` rows never count. |

## Storage
None.

## Edge Functions
Both live in `supabase/functions/` in the existing `index.ts` (wiring) + `handler.ts` (pure, testable with injected dependencies) style, use `_shared/http.ts`, and are added to `deno.json` `check` and to `config.toml`. No Stripe SDK (D7): small `fetch` calls to `https://api.stripe.com/v1/...` (form-encoded) and our own signature check with Web Crypto. Neither function is ever called by the app.

**`promotion-checkout`** (admin only; `verify_jwt = false`, protected by a server secret header like `push-sender`'s `x-cron-secret`)
- Auth: header `x-admin-secret` compared in constant time with `PROMOTION_ADMIN_SECRET`. Missing or wrong -> 401, no body detail, no database call. The secret is never in the app.
- Input: `POST { promotion_id: uuid }`. The function looks up the owner and business through `begin_promotion_checkout`; the caller never names an owner.
- Output: `200 { url, expires_at }` (a `https://checkout.stripe.com/` URL only) or `{ error: code }` with the codes above plus `rate_limited` and `payments_unavailable`.
- Rate limit: 10 calls per promotion per hour (a quota row keyed on the promotion id), so a leaked admin secret or a looping worker cannot create sessions without bound.
- Checkout Session parameters: `mode=payment`; `payment_method_types[]=card` (D4); one line item with `price_data[currency]=cad`, `unit_amount=<locked cents>`, `product_data[name]="LikeToOrder promotion, 7 days"`, `product_data[description]="<business name>: <category>"`; `metadata[promotion_id]`, `metadata[payment_id]`, `client_reference_id=<payment id>`; no `customer_email` sent unless Q13 needs it; `payment_intent_data[statement_descriptor_suffix]=LIKETOORDER` only if Archan's setup step confirms the length fits; `expires_at` (at most 24 hours, never after `pay_by`); `success_url` points to a plain Stripe-hosted or static thank-you message, never into the app. `Idempotency-Key: checkout-<payment id>`.
- Records the created session's `livemode` through `attach_checkout_session`.
- Secrets: `PROMOTION_ADMIN_SECRET`, `STRIPE_SECRET_KEY` (a restricted key, D10). Missing Stripe key -> `503 payments_unavailable` (the local default).
- Logs: event codes only; never a key, a secret, the URL or full ids.

**`stripe-webhook`** (`verify_jwt = false`: Stripe sends no JWT; the signature is the auth)
- Reads the raw body (max 64 KB, else 413) before parsing. Verifies `Stripe-Signature`: `t=` within 300 s of now, and any `v1=` equal (constant-time) to HMAC-SHA256(`STRIPE_WEBHOOK_SECRET`, `t + "." + body`). Failure -> 400, no detail, nothing written.
- Only then parses JSON (zod). **Checks the event's `livemode` equals `STRIPE_EXPECT_LIVEMODE`** before any database call; a mismatch -> 200 with nothing written (D11).
- Calls `private.record_stripe_event`. If the answer carries a refund target, calls `POST /v1/refunds` (`payment_intent`, `reason=duplicate`, `Idempotency-Key: refund-<payment id>`), then `mark_refund_requested`. **If the refund call fails, the webhook answers 500** so Stripe retries the event; the retry (a duplicate) returns the same refund target and the same idempotency key keeps it to one refund (D12).
- Returns 200 for applied, duplicate (with no refund pending), ignored and mismatched events, so Stripe stops retrying; 500 on our own database error or a failed refund call, so Stripe retries, which is safe by D3 and D12.
- Secrets: `STRIPE_WEBHOOK_SECRET`, `STRIPE_SECRET_KEY` (refunds only), `STRIPE_EXPECT_LIVEMODE` (`false` until launch).
- Subscribed events: `checkout.session.completed`, `checkout.session.expired`, `charge.refunded`, `charge.dispute.created` (Q13 (b) changes this list).

**Deployment:** Archan deploys with `npx supabase functions deploy promotion-checkout stripe-webhook` at release (never from a session), after setting the secrets himself with `npx supabase secrets set`.

## Components & hooks
**PR 1 (app side, no behaviour change):** `src/features/promotions/schema.ts` accepts the new keys and states of `get_my_promotion` (like spec 16 D11), so the app on main keeps working. Nothing reads them yet.

**PR 3 (app, status wording only):**
- `src/features/promotions/schema.ts`: the new states.
- `src/features/promotions/messages.ts` and `format.ts`: the status lines in "What people see" ("Paid and scheduled. Starts on ...", "Active until ...", "Refunded.", "Payment window closed.").
- `src/features/promotions/components/PromoteScreen.tsx`, `PromotionStatusCard.tsx`: the new states with their actions (Cancel request, Contact us to cancel, Promote again).
- No new hook, no new component, no browser, no polling (the existing query and pull to refresh are enough).

## Files to create
- PR 1 (database):
  - `supabase/migrations/<ts>_promotion_payment.sql`
  - `supabase/tests/16b-promotion-payment.test.sql`
- PR 2 (functions):
  - `supabase/functions/promotion-checkout/{index.ts,handler.ts}`
  - `supabase/functions/stripe-webhook/{index.ts,handler.ts}`
  - `supabase/functions/_shared/stripe.ts` (form encoding, signature verify, the REST calls; pure where possible)
  - `supabase/functions/tests/{stripe-signature.test.ts,stripe-webhook.test.ts,promotion-checkout.test.ts}` and `supabase/functions/tests/fixtures/stripeEvents.ts` (fake events signed inside the test with an obviously fake secret such as `whsec_test_fake_only`)
  - `scripts/dev/fake-stripe-event.ts` (local only: signs a fake event with a secret passed on the command line and posts it to the local webhook; refuses any non-localhost URL)
- PR 3 (app): jest tests for the new states only.
- PR 4 (launch docs):
  - `docs/runbooks/stripe-setup.md` (Archan's steps below, test then live)

## Files to change
- PR 1: `supabase/tests/05-seller-onboarding.test.sql` (allowlists), `supabase/tests/16-promotions.test.sql` (only the assertions on the old status list and the old `request` / `cancel` behaviour; listed exactly at gate B, stop and ask for any other), `supabase/seed.sql` and `scripts/seed/promotions.ts` (one row in each new state), `src/types/database.ts` (regenerated), `src/features/promotions/schema.ts` (new keys accepted), `docs/runbooks/promotions-admin.md` (`approve_headline`, the admin link command, refunds in Stripe), `docs/product/v1.md` §7, §15, §16.
- PR 2: `supabase/config.toml` (two function blocks), `supabase/functions/deno.json` (check task), `supabase/functions/_shared/rateLimit.ts` (+ the per-promotion `checkout` kind; its SQL quota side is in PR 1's migration), `.env.example` (names of the four function secrets, no values).
- PR 3: `PromoteScreen.tsx`, `PromotionStatusCard.tsx`, `schema.ts`, `format.ts`, `messages.ts`.
- PR 4: `docs/product/v1.md` §16 (before-launch list), CLAUDE.md row.

## New dependencies
No new dependencies. No Stripe SDK in the app or the Edge Functions (D7), no new Deno import, no native rebuild.

## Decisions
- **D1 Names on the payment page (Resolved Q-D1).** Stripe public business name **welcometohvac** on the Stripe page, emails and receipts; the product line reads **"LikeToOrder promotion, 7 days"** so buyers connect the two. Statement descriptor `WELCOMETOHVAC`; the suffix `LIKETOORDER` only if Stripe's length rules allow, checked at Archan's setup step. "The charge appears as WELCOMETOHVAC" is said in the email (Q13), not in the app.
- **D2 Campaign window at payment (Resolved Q6).** `starts_at = greatest(now(), preferred_start at 00:00 America/Toronto)`, `ends_at = starts_at + length_days`. With no preferred start, it starts at payment. If the window would overlap (not expected: one open campaign per business), the payment is refunded (D5) rather than shifted.
- **D3 Idempotency by event id.** `stripe_events.event_id` is the primary key; every handler also checks the current state, so retries and out-of-order events are safe.
- **D4 Cards only.** `payment_method_types=card`. Apple Pay and Google Pay are turned on in the Stripe dashboard and work on Stripe's page as card wallets, with no code change (Resolved Q7). No delayed methods, so payment is known at `checkout.session.completed`.
- **D5 Automatic refund of payments we cannot honour.** Duplicate, late, after a cancel, or a wrong amount: a full automatic refund from the webhook, idempotent. Archan sees them in Stripe and in `stripe_events.outcome = 'refund_requested'`. Stripe keeps its card-processing fee on a refund ("Stripe's processing fees from the original transaction aren't returned", [Stripe refunds](https://docs.stripe.com/refunds), read 2026-11-21), so each such case costs a small fee. This includes a seller who cancels in the app while a Stripe page is still open and then pays on it.
  - *Possible later improvement (not built now):* when the seller cancels, also expire the open session at Stripe (best effort, `POST /v1/checkout/sessions/<id>/expire`), so the page can no longer take money.
- **D6 Refunds only by Archan in Stripe (Resolved Q2, Q3).** The app has no refund button. Full refunds only; a full refund stops the campaign; a partial refund is recorded only.
- **D7 No Stripe SDK.** The REST calls and an HMAC check are small, need no dependency, and are fully testable with fake signed events. If PR 2's plan finds the form encoding too fragile, `npm:stripe` is the alternative and needs Archan's approval as a new dependency.
- **D8 Receipts from Stripe.** Stripe's email receipt only. The app shows no receipt link. No invoices from our side until the tax question is answered (unless Q13 picks Stripe Invoicing).
- **D9 Opening and returning: superseded** while the pay-outside plan stands. The app opens no payment page and has no return link. Revisit only if Q14 allows a link-out.
- **D10 Restricted key.** `STRIPE_SECRET_KEY` is a restricted key with only Checkout Sessions write, Refunds write and Charges read (plus Invoices and Customers write if Q13 picks (b)).
- **D11 Test events never touch live, two separate checks.** (a) The webhook function refuses an event whose `livemode` differs from `STRIPE_EXPECT_LIVEMODE`, before any database call. (b) The checkout function records the session's `livemode` on the payment row at attach time, and `record_stripe_event` answers `mismatch` with nothing changed when an event's `livemode` differs from that row's. Each check has its own test.
- **D12 No lost refunds.** A payment that needs a refund stays `needs_refund` until `mark_refund_requested` runs after Stripe accepted the refund call. A duplicate event, and any later event for that payment, returns the refund target again while it is `needs_refund`. If the refund call fails, the webhook answers 500 so Stripe retries; the same `Idempotency-Key: refund-<payment id>` keeps it to one refund.
- **D13 Admin-only link creation.** `promotion-checkout` takes no user JWT and is never called by the app. It is protected by `PROMOTION_ADMIN_SECRET` in the `x-admin-secret` header (constant-time compare, the `push-sender` pattern), looks up the owner itself, and is rate-limited per promotion.

## Rules for implementation
- RLS on every new table, plus pgTAP proving outsiders are refused.
- Supabase calls only in `src/features/promotions/api.ts`.
- Theme tokens only, no hardcoded colours or sizes. Loading, empty, error (with Retry) and success on every screen. Accessibility labels and roles on every touchable, 44 pt targets.
- Feature-specific rules:
  - **No payment in the app:** the app never shows a price for a promotion purchase (once Q15 is decided), a Pay button, a payment link, a Stripe URL, or wording that steers to paying elsewhere ("pay by email", "pay online", "check your email to pay"). Status wording only.
  - **Secrets:** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and `PROMOTION_ADMIN_SECRET` exist only as Supabase Edge Function secrets set by Archan. Never in the app, never `EXPO_PUBLIC_*`, never in the repo, `app.config.ts`, CI logs, chat or seed. `.env.example` lists names only. Claude never reads `.env` or `supabase/functions/.env`.
  - **No Stripe key in the app at all**, not even a publishable key.
  - **No card data:** nothing in the app or the database holds card details; the database stores ids, amounts and statuses only.
  - **The server decides:** only `record_stripe_event` (called after a verified signature) can set a paid campaign to `approved`. No client-callable function sets `paid_at`, `approved` or `refunded`, or touches `promotion_payments` or `stripe_events`.
  - **Signature first:** no JSON parse and no database call before the signature and timestamp pass. **Admin secret first** in `promotion-checkout`.
  - **Amounts in cents**, CAD only, compared exactly with the locked row.
  - **All tests use fake signed events** and a fake admin secret created in the test. No real Stripe account, key or network call in any test or session; the REST calls are injected and faked.
  - Migrations are append-only (the `protect-files` guard hook blocks edits to existing migrations); run `npm run db:types` after the migration. If the guard hook blocks anything, stop and ask.
  - All SQL and TS ASCII-only; byte-check after writing.

## Store rules (MUST CHECK) - plan: pay outside the app; Q14 open
**MUST be settled BEFORE PR 1 is planned, not only before PR 3, because an in-app-purchase requirement changes the price, the fee and the app screens. Archan's supervisor (Cowork Claude) researches the live Apple and Google pages and records the answer here; Archan only decides.**

First search (spec draft, 2026-11-21):
- Apple App Review Guidelines 3.1.1 require In-App Purchase to unlock features or digital content in an app. 3.1.3(g) covers apps whose main purpose is ad management; LikeToOrder is not such an app. Sources: [Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/), [MacRumors, Oct 2022](https://www.macrumors.com/2022/10/24/apple-updates-app-store-review-guidelines-2/).
- Google Play requires Play Billing for in-app purchases of digital goods and services, with listed exceptions; none names advertising. Sources: [Play Payments policy FAQ](https://support.google.com/googleplay/android-developer/answer/10281818), [Understanding Google Play's Payments policy](https://support.google.com/googleplay/android-developer/answer/9858738).

**Answer (gate S, dated 2026-11-21, read by Cowork Claude; NOT legal advice):**
1. **Apple:** 3.1.1 requires In-App Purchase to unlock features. 3.1.3(g) exempts only apps whose sole purpose is managing ad campaigns, and says buying ads displayed in the **same** app (for example "boosts" in a social app) must use In-App Purchase. LikeToOrder is not an ad-management app. Outside the US storefront, 3.1.1(a) bars buttons, external links or calls to action that steer to other purchase methods unless Apple has granted an entitlement. Source: [Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/).
2. **Google:** the Payments policy requires Play Billing for digital goods and services bought in the app, lists no exception for advertising or business purchases, and bars leading users to another payment method, including by linking to a webpage. Canada appears in none of the alternative-billing programs on the page read. Sources: [Play Payments policy FAQ](https://support.google.com/googleplay/android-developer/answer/10281818), [Understanding user choice billing](https://support.google.com/googleplay/android-developer/answer/13821247).
3. **Caveats:** Apple's wording came through a summary, not word for word; Google's full Payments policy page (answer 9992660) and country list were not read; neither store's reviewer has been asked. Before submitting the app, re-read both live pages and consider asking App Review.
   - *Update, same day (the Q14 check below):* Google's full Payments policy page (answer 9992660) and the program country lists have now been read; they confirm points 2 and the absence of Canada. Apple's 3.1.1 / 3.1.3(g) text again came through a summary of a long page, so the Apple caveat stands.
4. **PLAN until Q14 is answered:** sellers pay **OUTSIDE the app**. Apple In-App Purchase and Google Play Billing stay out of scope (an amendment is needed if a store refuses this route).

## Tax and receipts (needs an accountant; not decided)
- Whether Ontario HST (13 %) applies to selling promotion placement to Ontario businesses, and whether welcometohvac must register (the small-supplier threshold): accountant's view.
- Whether the settings price is **tax-inclusive or tax-exclusive**, and whether to use Stripe Tax or a fixed tax line: decided by Archan after the accountant. Until then one `price_cents` is stored and charged exactly, with no tax line.
- What a seller needs as a receipt or invoice for their bookkeeping (business name, HST number if registered, date, amount, tax): accountant's view. Stripe receipts are the default (D8); Stripe Invoicing (Q13 (b)) is the alternative.
- Refund receipts and the effect of refunds on tax: accountant's view.
- None of this blocks building; it blocks the switch to live mode.

## What Archan does himself (Claude does none of this)
1. Create a Stripe account for welcometohvac (Canada) yourself in the browser. Do not share any login with Claude.
2. Stay in **Test mode** (the toggle in the Stripe dashboard) for everything until the before-launch step.
3. In Settings > Public details, set the public business name to **welcometohvac**, the support email and the support phone or URL.
4. Set the statement descriptor `WELCOMETOHVAC` and check whether the suffix `LIKETOORDER` fits Stripe's length rules; tell Claude only yes or no.
5. Add branding (icon, colour) so the Stripe page and emails look consistent.
6. Add the bank account for payouts and complete the identity checks Stripe asks for (needed before live mode; can be done now).
7. In Settings > Payment methods, keep cards on, turn on Apple Pay and Google Pay, and leave delayed methods off (D4).
8. In Test mode, create a **restricted key** with only the permissions in D10.
9. Make a long random **admin secret** yourself (for example with a password manager) for `PROMOTION_ADMIN_SECRET`. Keep it in your password manager; it is what lets you create payment links.
10. After PR 2 is merged and you have deployed the functions, add a test-mode webhook endpoint pointing to the hosted `stripe-webhook` URL with the events listed under Edge Functions; copy its signing secret.
11. Set the four secrets yourself in a terminal (never in chat, never in a file in the repo): `npx supabase secrets set STRIPE_SECRET_KEY=... STRIPE_WEBHOOK_SECRET=... STRIPE_EXPECT_LIVEMODE=false PROMOTION_ADMIN_SECRET=...`.
12. Tell Claude only "test secrets are set". Never paste a key, a secret or a screenshot showing one into chat. If one is ever pasted, roll it at once (in Stripe, or make a new admin secret).
13. No Expo rebuild is needed for this spec (unless Q14 changes the plan).

## Out of scope
- **In-app payment of any kind** (Apple In-App Purchase, Google Play Billing, an in-app browser sheet, a Pay button)
- **Link-out to a payment page from the app until Q14 is answered**
- Live mode, live keys and a live webhook endpoint (before launch, below)
- Subscriptions, several campaign lengths, coupons, discounts, credits
- Tax calculation and our own invoices (pending the accountant; Q13 (b) would use Stripe's)
- Seller self-service refunds or cancellation of a paid campaign
- Expiring the open Stripe session when a seller cancels (a possible later improvement, D5)
- Payment for orders: v1 §3 (orders stay trust-based)
- Stripe Connect or paying sellers
- An admin screen (spec 16 Q17)
- Push notifications about payments
- Everything in v1 §3

## Definition of done
**PR 1 (database, `feature/promotion-payment-db`)**
- [ ] RLS on `promotion_payments` and `stripe_events`; `anon` and `authenticated` hold no privileges. **An outsider cannot** read, insert, update or delete any payment or event row, or call `begin_promotion_checkout`, `attach_checkout_session`, `record_stripe_event` or `mark_refund_requested` (anon and authenticated refused). The 05 allowlists are updated.
- [ ] Migration safety: rows approved before this migration get `is_free = true` and still read as active, scheduled or ended exactly as before (pgTAP compares `get_my_promotion`, `promotion_is_active` and the map `promoted` flag for seeded pre-migration rows); existing `requested` rows are unchanged.
- [ ] `approve_headline` locks the price: changing `promotion_settings` afterwards does not change the amount `begin_promotion_checkout` returns.
- [ ] Every transition: requested -> payment_due -> approved (paid); payment_due -> payment_expired (lapse, then a new request succeeds); payment_due -> cancelled (seller); paid -> refunded (full); a partial refund keeps it active; a dispute stops it; a seller cancel of a paid campaign -> `contact_support`; the free `approve` still works.
- [ ] `get_my_promotion` returns every derived state in the table, with fixed times relative to `now()`, and no payment link, Stripe id or receipt.
- [ ] A refunded or disputed campaign is not `promoted` on the map functions and not in `list_offers_near`.
- [ ] `record_stripe_event`: a duplicate event id changes nothing; a duplicate, and any later event, for a payment in `needs_refund` returns the refund target again; after `mark_refund_requested` a duplicate returns no refund target; an event whose livemode differs from the payment row's -> `mismatch`, nothing changed; wrong amount or currency -> `needs_refund`, no activation.
- [ ] Deliberate breaks, each red on its named test, then reverted and `cmp`-checked: (a) remove the `stripe_events` conflict guard; (b) accept an amount mismatch; (c) grant `begin_promotion_checkout` to authenticated; (d) read the price from settings instead of the row at checkout; (e) skip the refund target on a duplicate for a `needs_refund` payment; (f) drop the row-livemode check.
- [ ] Seed has one row in each new state; `db:types` regenerated; the zod schema accepts the new keys with no behaviour change; jest, lint, typecheck and `npx supabase test db` green; runbook and v1 §7, §15, §16 updated.

**PR 2 (Edge Functions, `feature/promotion-payment-functions`)**
- [ ] Admin function (Deno tests): **refused without the admin secret** (missing header, wrong secret, a user JWT instead: all 401 with no database call); the compare is constant-time; the per-promotion rate limit; missing Stripe key -> 503 `payments_unavailable`; reuse of an open session; the Stripe request body has the locked amount, `cad`, card only, the product name, metadata, an `expires_at` within 24 hours and never after `pay_by`, and the idempotency key; the session's livemode is passed to `attach_checkout_session`.
- [ ] Webhook (Deno tests, fake signed events, fake `fetch`): bad signature, old timestamp, missing header and a body over 64 KB are refused with no database call; a valid paid `checkout.session.completed` activates; an event whose livemode differs from `STRIPE_EXPECT_LIVEMODE` is refused before any database call (tested separately from the row check); a refund target leads to one `POST /v1/refunds` with `Idempotency-Key: refund-<id>`, then `mark_refund_requested`; a failed refund call answers 500 and does not call `mark_refund_requested`; a retried duplicate with a refund target repeats the refund call with the same key.
- [ ] Deliberate breaks, each red on its named test, then reverted and `cmp`-checked: (g) skip the signature check; (h) skip the `STRIPE_EXPECT_LIVEMODE` check; (i) answer 200 when the refund call fails; (j) not repeat the refund on a duplicate that carries a refund target; (k) skip the admin secret check.
- [ ] `grep` proves no `sk_`, `rk_` or `whsec_` value outside the tests' obvious fakes, and no `EXPO_PUBLIC_STRIPE` anywhere.
- [ ] `scripts/dev/fake-stripe-event.ts` refuses a non-localhost URL (unit test). `deno lint`, `deno task check`, `deno task test` green; `config.toml`, `deno.json` and `.env.example` (names only) updated.

**PR 3 (app, `feature/promotion-payment-app`; status wording only)**
- [ ] The Promote screen shows every state in "What people see" with its action, plus loading, error and Retry; pull to refresh updates it.
- [ ] **The app contains no price, Pay button or payment link for a promotion purchase**; `grep` proves no `checkout.stripe.com` or other Stripe URL, and no "stripe" text, in `src/` and `app/`. (Removing the existing price display is Q15.)
- [ ] Screen-reader labels on Contact us to cancel and Promote again; the largest text size fits.
- [ ] Archan's Simulator run with seed rows for each state (awaiting approval, headline approved, paid and scheduled, active, ended, payment window closed, refunded), plus the fake-event script for the webhook path (a `payment_due` row becomes "Paid and scheduled" after pull to refresh).
- [ ] If Q14 later allows a link-out, PR 3 grows again (button, browser sheet, return handling) through a short amendment approved by Archan.

**PR 4 (launch docs, `feature/promotion-payment-launch-docs`)**
- [ ] `docs/runbooks/stripe-setup.md` with Archan's steps for test and live; v1 §16 updated with the before-launch list below.

## Before launch (separate from building)
1. Store-rule answer re-read on the live pages before submitting the app (Store rules, caveat 3); Q14 answered or left closed.
2. Accountant's answer on HST, the tax-inclusive price and receipts; the price set accordingly in the live `promotion_settings`.
3. Stripe live mode: identity and bank verified; a live restricted key; a live webhook endpoint with the events; live secrets and a new live admin secret set by Archan; `STRIPE_EXPECT_LIVEMODE=true`.
4. One real-money test with a real card at the smallest price, then a full refund in the dashboard; check the statement descriptor on the card statement and the receipt email.
5. Terms (spec 18): price, payment, refunds, disputes, and who charges (welcometohvac for LikeToOrder).
6. VoiceOver and TalkBack on the new status lines.

## Test plan
- **pgTAP** `supabase/tests/16b-promotion-payment.test.sql` (PR 1): everything under PR 1, calling the private functions as the database owner with fake event payloads; plus the approved 05 and 16 edits. Run with `npx supabase test db` after `npx supabase db reset` (local only).
- **Deno** `supabase/functions/tests/` (PR 2): signature verify (known-answer vectors computed in the test from a fake secret), the admin secret check, the webhook and admin handlers with an injected fake RPC and a fake `fetch`. No network.
- **jest** (PR 1 and PR 3): the schema keys (PR 1); the status wording, `PromoteScreen` states and the "no Stripe text" grep check (PR 3).
- **Local manual without Stripe** (after PR 2): `npx supabase db reset`, then `scripts/dev/fake-stripe-event.ts` signs a fake `checkout.session.completed` with a made-up local secret and posts it to the local webhook; after pull to refresh the Promote screen shows "Paid and scheduled". Archan runs it; the local function reads the made-up secret from his local function env, which Claude does not read.
- **Manual in Stripe test mode** (Archan, after his setup steps): create a link with the admin command, pay with a Stripe test card in a desktop browser, then check the app.

## Delivery: PRs and gates
I stop and commit at every gate (named files, a conventional message, no push) and wait for Archan's "approved". The spec commits live on `feature/promotion-payment`. Every PR is cut from `main` after the previous one is merged.

| PR | Branch | Gates | Migration |
|---|---|---|---|
| spec | `feature/promotion-payment` | **A** spec + CLAUDE.md row + spec 16 status line. **A2** this amendment (gate S result, pay outside the app). | No |
| 0 store check | none (docs) | **S** done 2026-11-21: pay outside the app. Q14 stays open and does not block PR 1. **Q13 must be answered before PR 2 is planned** (it changes the admin function and possibly the payment table, so ideally before PR 1 is planned too). | No |
| 1 database | `feature/promotion-payment-db` | **B** migration + pgTAP (new + 05/16 edits), `test db` green, breaks (a) to (f). **C** seed, `db:types`, zod keys, runbook, v1 §7/§15/§16. Review, ship. | **Yes** (one) |
| 2 functions | `feature/promotion-payment-functions` | **D1** `_shared/stripe.ts` + signature tests. **D2** both functions, Deno tests with fake signed events and a fake admin secret, breaks (g) to (k). **D3** fake-event script, `config.toml`, `deno.json`, `.env.example` names. Review, ship. | No |
| 3 app | `feature/promotion-payment-app` | **E1** schema, format, messages, `PromoteScreen` and `PromotionStatusCard` status wording + tests. **F** Archan's Simulator run with seed rows and the fake-event script. No dependency, no native rebuild. Review, ship. | No |
| 4 launch docs | `feature/promotion-payment-launch-docs` | **G** `stripe-setup.md`, v1 §16. Ship. | No |

## Privacy and security position
- No payment happens in the app: no price for the purchase, no Pay button, no link, no Stripe key, no card data.
- Card data never touches our servers or database. Stripe hosts the payment page.
- Four server secrets, set only by Archan. Payment links are created only by an admin caller holding `PROMOTION_ADMIN_SECRET`.
- Only a verified Stripe signature can mark a campaign paid. Clients cannot write any payment field.
- We store Stripe ids, amounts and statuses; no names, emails or full payloads (Q13 (b) would give Stripe the seller's email, server side only).
- Test and live events are kept apart twice: by `STRIPE_EXPECT_LIVEMODE` in the webhook and by the payment row's `livemode` in the database.

## Resolved questions
All resolved by Archan on 2026-11-21.

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

## Open questions
1. **Q11 Tax:** the accountant's view on Ontario HST, a tax-inclusive or tax-exclusive price, registration and receipts. Blocks live mode, not building.

2. **Q13 How the seller receives the payment link** (options for Archan; not decided here). **Must be answered before PR 2 is planned.** One fact shapes all three: a Stripe Checkout Session expires after at most 24 hours, while the payment window is 7 days. Fees below are from [Stripe Canada pricing](https://stripe.com/en-ca/pricing) and [Stripe Invoicing pricing](https://stripe.com/invoicing/pricing), read 2026-11-21.
   - **(a) Launch manually.** After approving, Archan runs one documented command that calls the admin function and pastes the Stripe link into an email from his own address.
     - Effort: lowest; PR 2 as written, plus a runbook command.
     - Cost: Stripe card fees only ("2.9% + CA$0.30" per domestic card payment).
     - New secrets: none beyond `PROMOTION_ADMIN_SECRET`.
     - Privacy: Archan sees the seller's email (he already can, in the dashboard); it is sent from a personal mailbox.
     - Failure: a human step. He can forget, or send it to the wrong person. Because a Checkout link dies within 24 hours, a seller who pays on day 3 needs a **new** link, so Archan must resend it.
     - Plainly: this is manual work every time, which Archan has said he finds painful. It is fine only for the first few sellers.
   - **(b) Stripe sends the email (Stripe Invoicing).** The admin function creates a Stripe invoice with `collection_method=send_invoice` and `days_until_due=7`. Stripe then emails the seller "the invoice ... with payment instructions" and a hosted pay page.
     - Effort: medium. The admin function creates a Customer (with the seller's email, read server side from auth) and an invoice instead of a Checkout Session.
     - Webhook changes: it listens to `invoice.paid` (Stripe recommends it "rather than invoice.payment_succeeded"), `invoice.voided` and `invoice.marked_uncollectible` in place of the two `checkout.session.*` events; `charge.refunded` and `charge.dispute.created` stay.
     - Table changes: `promotion_payments` stores `invoice_id` (and `customer_id`) instead of `checkout_session_id` / `checkout_url`.
     - Cancel: a seller cancel or a lapsed window voids the invoice at Stripe (`POST /v1/invoices/<id>/void`), which also mostly removes the D5 late-payment fee case.
     - Cost: card fees plus "0.4%" (Starter) or "0.5%" (Plus) "per paid invoice". About CA$0.10 on CA$25.00.
     - New secrets: none (the restricted key also needs Invoices and Customers write).
     - Privacy: the seller's email goes to Stripe (a payment processor), server side only, and must be named in the privacy policy (spec 18). Stripe also gives a proper invoice, which may help with Q11.
     - Failure: Stripe retries the email and shows its status in the dashboard. The link stays valid until the due date, so no resend is needed.
   - **(c) Our own email worker.** A small server worker (the `push-sender` pattern from spec 12) sends an email through an email service after approval.
     - Effort: highest. A new email service account, a template, sender domain setup (SPF/DKIM on welcometohvac.com), and handling bounces.
     - Cost: the email service's fees plus Stripe card fees.
     - New secrets: an email service API key.
     - Privacy: the seller's email goes to one more company (the email service).
     - Failure: our worker must retry. It still emails a Checkout link that dies within 24 hours, so it needs either a re-send loop or a stable link of our own (a website, out of scope).
   - **Recommendation: (b) Stripe Invoicing.** It removes the manual step, matches the 7-day window without resending, needs no new service or secret, and costs about 0.4% more. (a) is a reasonable stop-gap for the first few sellers only. If (b) is chosen, the Database changes, the admin function, the webhook events and the tests above are amended before PR 1 is planned.

3. **Q14 ARCHAN'S PROPOSAL (recorded as given):** "Open the payment page on a website from the app (redirect the seller to a web payment page, then ask them to go back to the app), to stay outside the store payment rules."
   - **Status: NOT the plan; blocked pending the check below.**
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
     - **Conclusion of the check:** no Apple entitlement and no Google program for Canada was found on the pages read. Whether a business promotion purchase would qualify anywhere: not confirmed. Q14 stays open and blocked. The plan stays "pay outside the app".

4. **Q15 Price in the app.** Spec 16 shows the promotion price in the app (the paths listed under Screens & routes: the invitation's price line and payment note, the requested card's price, and the "We'll contact you about payment" texts). Should PR 3 remove the price and the payment wording from the app, and keep the price only in the email and on the Stripe page? Recommendation: yes, to match the pay-outside plan (the app would then say only what a promotion does and its length). This changes spec 16 screens, so it needs Archan's decision before PR 3 is planned.
