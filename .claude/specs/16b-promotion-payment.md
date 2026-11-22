# Spec 16b: Promotion Payment

**Branch:** `feature/promotion-payment` (this spec commit only). Then four PRs, each cut from `main` after the previous one is merged: `feature/promotion-payment-db` (PR 1), `feature/promotion-payment-functions` (PR 2), `feature/promotion-payment-app` (PR 3), `feature/promotion-payment-launch-docs` (PR 4).
**Product spec:** `docs/product/v1.md` §7 (Ads: payment and activation), §3 (out of scope), §13 (Legal), §14 row 16b, §15 Q1, §16 (the five spec 16b items)
**Plan mode:** required: it changes the schema and RLS, adds two Edge Functions with server secrets, adds a dependency (`expo-web-browser`, D9) and touches more than 5 files.
**Status:** 📝 Spec written

## Overview
Today a seller asks for a promotion, Archan reads the headline, sends an invoice outside the app and switches the campaign on with one SQL call. After this spec, the seller pays inside the app flow:

1. The seller requests a promotion with a category and a headline (spec 16, unchanged).
2. Archan approves the **headline** with one SQL call. The price is locked at this moment.
3. Only then does the Promote screen show **Pay CAD 25.00**. The seller has 7 days to pay.
4. Tapping it opens Stripe's own payment page (Stripe Checkout) in an in-app browser sheet. The app never sees card numbers.
5. The seller pays and comes back to the app. The app shows "Confirming your payment..." and asks the server again.
6. Stripe tells our server that the payment succeeded (a signed webhook). Only that message schedules the campaign. The app saying "I paid" changes nothing.
7. The campaign then runs exactly as in spec 16 (larger flag, Offers card, Sponsored), and ends by the server clock.

The payment page shows the public business name **"welcometohvac"**, and the item reads **"LikeToOrder promotion, 7 days"**, so a buyer sees both names together (D1). It comes now because spec 16 built every surface a paid campaign shows on, and the manual invoice does not scale.

### What people see, in plain words

**Seller, Promote screen (Manage Business, seller mode on)**
- **Awaiting approval** (was "Requested"): "Waiting for review. You'll be able to pay once your headline is approved." with **Cancel request**.
- **Awaiting payment:** "Your headline was approved. Pay CAD 25.00 by 28 Nov to start your 7-day promotion. Starts on 2 Dec, or the day you pay if later." Buttons **Pay CAD 25.00** and **Cancel request**. A small line: "Payments are handled by Stripe. The charge appears as WELCOMETOHVAC."
- **Confirming payment** (after returning from the payment page, while the server has not yet heard from Stripe): "Confirming your payment..." with a spinner. After 30 seconds without news: "We haven't received confirmation yet. If you paid, it will show here shortly. You won't be charged twice." with **Check again**.
- **Last attempt not completed** (the payment page was closed or timed out): still Awaiting payment, plus "Your last payment wasn't completed. You haven't been charged."
- **Paid and scheduled:** "Paid. Starts on 2 Dec, ends on 9 Dec." with **Contact us to cancel** (no button that ends a paid campaign by itself).
- **Active:** "Promoted until 9 Dec." (spec 16) with **Contact us to cancel**.
- **Ended:** "Ended on 9 Dec." with **Promote again** (spec 16).
- **Payment expired:** "The payment window closed on 28 Nov. You weren't charged." with **Promote again**.
- **Refunded:** "Refunded on 4 Dec." with **Promote again**. The campaign is not shown on the maps or in Offers.
- **Rejected / Cancelled:** as spec 16.
- A **View receipt** link (the Stripe receipt, D8) appears on Paid, Active, Ended and Refunded.

**Customers and guests:** nothing changes. A paid campaign looks exactly like a spec 16 campaign.

**Archan (admin: the dashboard SQL editor and the Stripe dashboard)**
- Approves a headline (`approve_headline`), rejects, or cancels, with documented SQL (runbook updated).
- Refunds only in the Stripe dashboard, full refunds only. The webhook records the refund and stops the campaign (D6).
- The old manual `approve` (with a start time, no payment) stays for free or compensating campaigns (`is_free`, Resolved Q4).

## Depends on
16 promotions (✅ Shipped, all four PRs). 05 seller-onboarding (Edge Function patterns, `_shared/`). 12 notifications (Edge Function secrets pattern). All ✅ Shipped.

## Context to load
- `CLAUDE.md`, this spec, `docs/product/v1.md` §7 and §16 (the spec 16b items)
- `.claude/specs/16-promotions.md` (Database changes, Decisions D5, D6, D10, D13)
- `.claude/skills/supabase-patterns/SKILL.md`
- PR 1 (database): `supabase/migrations/20261120214854_promotions.sql`, `supabase/tests/16-promotions.test.sql`, `supabase/tests/05-seller-onboarding.test.sql` (allowlists), `docs/runbooks/promotions-admin.md`, `supabase/seed.sql`, `scripts/seed/promotions.ts`, `src/features/promotions/schema.ts`
- PR 2 (functions): `supabase/functions/{deno.json,_shared/http.ts,_shared/auth.ts,_shared/rateLimit.ts,push-sender/index.ts,push-sender/handler.ts}`, `supabase/functions/tests/helpers.ts`, `supabase/config.toml` (the `[functions.*]` blocks), `.env.example`
- PR 3 (app): `src/features/promotions/{api.ts,schema.ts,format.ts}`, `src/features/promotions/hooks/useMyPromotion.ts`, `src/features/promotions/components/{PromoteScreen,PromotionStatusCard}.tsx`, `app.config.ts`

## User stories
- As a seller, after my headline is approved I can pay the locked price on a Stripe page opened from the app, come back, and see my campaign scheduled.
- As a seller, I see who will charge me (welcometohvac, for a LikeToOrder promotion) before I pay and on my card statement.
- As a seller, I am never charged twice for one campaign; a payment that cannot be honoured is refunded automatically (D5).
- As a seller, if I don't pay in time, nothing is charged and I can promote again.
- As Archan, I approve headlines with one SQL call, refund in the Stripe dashboard, and the app reflects both without manual steps.
- As anyone, I can trust that a campaign is live only because Stripe confirmed the money, never because the app said so.

## Screens & routes
- `app/seller/promote.tsx` (PR 3): unchanged route; `PromoteScreen` gains the states above.
- Return (PR 3): the browser sheet comes back to `liketoorder://seller/promote` (D9). Whatever comes back only triggers a refetch.
- No new tab, no customer screen.

## Payment flow and states

### In plain words
A promotion now has two gates: Archan says yes to the words, then Stripe says yes to the money. Nothing in the app can open the second gate by itself. If the seller does not pay within 7 days, the offer to pay simply lapses (by the server clock, no job), and the seller can start again.

### Stored and derived states
Stored statuses become: `requested`, `payment_due` (new), `approved`, `rejected`, `cancelled`, `payment_expired` (new), `refunded` (new). Derived as in spec 16 D5 (server clock at read time, no job):

| Stored | Condition | State shown | Seller sees |
|---|---|---|---|
| requested | | requested | Awaiting approval |
| payment_due | now() < pay_by | awaiting_payment | Awaiting payment (+ "last attempt not completed" when the latest checkout row is `expired`) |
| payment_due | now() >= pay_by | payment_expired | Payment expired |
| payment_expired | | payment_expired | Payment expired |
| approved | now() < starts_at | scheduled | Paid and scheduled ("Scheduled" for a free campaign) |
| approved | starts_at <= now() < ends_at | active | Active (maps, Offers) |
| approved | now() >= ends_at | ended | Ended |
| refunded | | refunded | Refunded |
| rejected | | rejected | Rejected |
| cancelled | | cancelled | Cancelled |

"Payment failed" is not a stored state. Stripe Checkout shows a declined card on its own page and the seller can try another card there; the session stays open. If the seller leaves or the session times out, Stripe sends `checkout.session.expired` and the row shows "last attempt not completed". Cards only (wallets included), no delayed methods (D4), so there is no "pending payment" state.

`payment_due` past its deadline becomes the stored `payment_expired` only when something writes to it (the seller's next `request_promotion`, or a late paid webhook). Reads never write. A payment that arrives after the deadline is refunded automatically (D5).

### Technical flow
1. `request_promotion` (spec 16) -> `requested`.
2. `private.admin_review_promotion(id, 'approve_headline')` -> `payment_due`; locks the price (re-snapshot from `promotion_settings`), sets `pay_by = now() + 7 days` and `reviewed_at`.
3. The app calls Edge Function `promotion-checkout` (JWT). It checks the caller and the rate limit, then calls `private.begin_promotion_checkout(user_id, promotion_id)` (service role only), which under a row lock returns a still-open session's URL, or reserves a new `promotion_payments` row. The function creates the Checkout Session at Stripe (REST, `Idempotency-Key: checkout-<payment id>`), stores the session id, URL and the session's `livemode` with `private.attach_checkout_session`, and returns only `{ url }`.
4. The app opens the URL (D9). The seller pays on Stripe.
5. Stripe calls Edge Function `stripe-webhook`. It verifies the signature, checks the event's `livemode` against `STRIPE_EXPECT_LIVEMODE`, then calls `private.record_stripe_event(...)`. On a paid `checkout.session.completed` the function checks the session id is ours, the event's livemode equals the payment row's, the amount and currency equal the locked price, and the promotion is still `payment_due` and within `pay_by`; then it sets `approved`, `paid_at`, `starts_at`, `ends_at` (D2). Otherwise it marks the payment `needs_refund` and returns the refund target, and the webhook refunds it (D5, D12).
6. The app returns, refetches `get_my_promotion` (every 3 s for up to 30 s), and shows the result.

## Money rules
- **Price source:** `promotion_settings` (spec 16). One row: one price for the one campaign length (7 days). Several lengths would be a new spec.
- **Currency:** CAD only. `begin_promotion_checkout` refuses a promotion whose locked `currency_code` is not `CAD` (`not_configured`). Amounts are integer cents end to end; Stripe gets `unit_amount = price_cents`, `currency = 'cad'`.
- **Price lock:** at headline approval. `approve_headline` re-snapshots price, currency and length; until then the request-time snapshot from spec 16 is shown as the estimated price. A later change of `promotion_settings` never changes a `payment_due` row. Checkout always charges the locked row price, never the settings row.
- **Payment window:** 7 days after approval. Each Checkout Session expires after 1 hour (`expires_at`; Stripe allows 30 minutes to 24 hours) and never later than `pay_by`. If less than 30 minutes remain before `pay_by`, checkout is refused (`payment_window_closed`).
- **One campaign, one payment:** at most one open checkout row per promotion (unique partial index). Tapping Pay twice reuses the open session's URL.
- **Duplicate or late payments (D5):** any paid session for a promotion that is no longer `payment_due` (already paid, cancelled, expired, refunded), or with a wrong amount or currency, is refunded in full automatically by the webhook, with `Idempotency-Key: refund-<payment id>`.
- **Refunds (D6, Resolved Q3):** full refunds only, only by Archan, only in the Stripe dashboard. The webhook (`charge.refunded`) records it:
  - **full refund** -> promotion `refunded`; a scheduled or running campaign stops at once (`ends_at = least(ends_at, now())`, kept for history);
  - **partial refund** (should not happen) -> recorded on the payment row only; the campaign keeps running.
  - Sellers cannot refund or cancel a paid campaign from the app ("Contact us to cancel", Resolved Q2).
- **Disputes (chargebacks, Resolved Q5):** `charge.dispute.created` is recorded and the campaign stops like a full refund. Handling evidence is Archan's job in the Stripe dashboard.
- **Webhook replay safety (D3):** `stripe_events.event_id` is the primary key; a replayed or re-delivered event does nothing new and is answered with 200, except that a payment still in `needs_refund` returns its refund target again (D12). Every state change also checks the current state, so out-of-order events are safe.

## Database changes
One new migration in PR 1 (`npx supabase migration new promotion_payment`). Spec 16's migration is not edited.

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
  receipt_url           text,
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
No card data, names, emails or full Stripe payloads are stored; only ids, amounts, statuses and the receipt URL.

**RLS and privileges.** RLS on for `promotion_payments` and `stripe_events`, no policies, no grants to `anon` or `authenticated` (the spec 16 / `map_rate_limits` pattern). The payment fields on `promotions` (`pay_by`, `paid_at`, `refunded_at`, `is_free`, `status`) stay unwritable by clients (no client grants on `promotions`, unchanged).

**Functions.** All security definer, `set search_path = ''`, `revoke execute ... from public, anon, authenticated`, then granted as below. The 05 allowlist test is updated.

| Function | Grant | What it does |
|---|---|---|
| `get_my_promotion()` (replaced, same signature) | authenticated | Adds `pay_by`, `paid`, `is_free`, `last_checkout` (`open` / `expired` / null), `receipt_url`, and the new derived states. The price shown is the locked one once `payment_due`. |
| `request_promotion(...)` (replaced, same signature) | authenticated | Also refuses while a `payment_due` row is within `pay_by` (`already_open`). Under the business lock, it first stores `payment_expired` on the caller's own lapsed `payment_due` row, so the unique index frees up. |
| `cancel_my_promotion(uuid)` (replaced) | authenticated | Allowed for `requested` and `payment_due` (an open checkout row is marked `expired` in our table; a payment that still arrives is refunded by D5). Refused with `contact_support` for a paid campaign. A free campaign (`is_free`) keeps spec 16 behaviour. |
| `private.admin_review_promotion(...)` (replaced) | none (database owner) | New decision `approve_headline` (requested only): re-snapshot price, currency and length, set `pay_by = now() + interval '7 days'`, status `payment_due`. `approve` keeps spec 16 behaviour and sets `is_free = true`. `reject` and `cancel` are also allowed on `payment_due`. Admin `cancel` of a paid campaign is allowed but does not refund (the runbook says: refund in Stripe first). |
| `private.begin_promotion_checkout(p_user_id uuid, p_promotion_id uuid) returns jsonb` | service_role only | Owner check through the business; the promotion must be `payment_due`, `pay_by - now() >= 30 min`, currency CAD. Locks the promotion row. Returns `{reuse_url}` for a still-open session with more than 5 minutes left, else reserves a payment row and returns `{payment_id, amount_cents, currency, length_days, expires_at, business_name}`. A reserved row older than 2 minutes with no session (the Stripe call failed) is expired first. Errors: `not_found` (unknown or not the caller's, the same answer), `not_payable`, `payment_window_closed`, `not_configured`. |
| `private.attach_checkout_session(p_payment_id uuid, p_session_id text, p_url text, p_expires_at timestamptz, p_livemode boolean)` | service_role only | `reserved` -> `open`; format-checked ids; records the session's `livemode` on the payment row (D11). |
| `private.record_stripe_event(p_event_id text, p_type text, p_livemode boolean, p_data jsonb) returns jsonb` | service_role only | Inserts into `stripe_events` with `on conflict do nothing`. A duplicate does nothing new, **but** if the payment it names is still `needs_refund`, it returns `{outcome:'duplicate', refund:{payment_id, payment_intent_id}}` again (D12). By type, with row locks: unknown session -> `mismatch`, nothing changed; **event livemode differs from the payment row's livemode -> `mismatch`, nothing changed** (D11); `checkout.session.completed` (paid) -> amount and currency must match the row and the promotion must be `payment_due` within `pay_by` -> `approved`, `paid_at = now()`, window per D2; otherwise payment `needs_refund` and returns the refund target. `checkout.session.expired` -> payment `expired` if `open`. `charge.refunded` -> `refunded_cents`; full -> payment `refunded`, promotion `refunded`, window closed. `charge.dispute.created` -> payment `disputed`, campaign stopped. Any other type -> `ignored`. Any event for a payment still in `needs_refund` also returns its refund target (D12). |
| `private.mark_refund_requested(p_payment_id uuid)` | service_role only | `needs_refund` -> `refund_requested`, called by the webhook only after Stripe accepted the refund call. Until then the payment stays `needs_refund`. |
| `private.promotion_is_active(uuid)` | unchanged | Still `approved` and in window; `refunded` rows never count. |

## Storage
None.

## Edge Functions
Both live in `supabase/functions/` in the existing `index.ts` (wiring) + `handler.ts` (pure, testable with injected dependencies) style, use `_shared/http.ts`, and are added to `deno.json` `check` and to `config.toml`. No Stripe SDK (D7): two small `fetch` calls to `https://api.stripe.com/v1/...` (form-encoded) and our own signature check with Web Crypto.

**`promotion-checkout`** (`verify_jwt = true`, and `getUser` inside, like the Places proxies)
- Input: `POST { promotion_id: uuid }`. Output: `200 { url }` (a `https://checkout.stripe.com/` URL only) or `{ error: code }` with the codes above plus `rate_limited` and `payments_unavailable`.
- Rate limit: a new quota kind `checkout` in `_shared/rateLimit.ts` (10 per user per hour).
- Checkout Session parameters: `mode=payment`; `payment_method_types[]=card` (D4); one line item with `price_data[currency]=cad`, `unit_amount=<locked cents>`, `product_data[name]="LikeToOrder promotion, 7 days"`, `product_data[description]="<business name>: <category>"`; `metadata[promotion_id]`, `metadata[payment_id]`, `client_reference_id=<payment id>`; no `customer_email` sent (Stripe collects it, we store no email); `payment_intent_data[statement_descriptor_suffix]=LIKETOORDER` only if Archan's setup step confirms the length fits; `expires_at`; `success_url` and `cancel_url` per D9. `Idempotency-Key: checkout-<payment id>`.
- Records the created session's `livemode` through `attach_checkout_session`.
- Secrets: `STRIPE_SECRET_KEY` (a restricted key, D10). Missing secret -> `503 payments_unavailable` (the local default).
- Logs: event codes only; never the key, the URL or full user ids.

**`stripe-webhook`** (`verify_jwt = false`: Stripe sends no JWT; the signature is the auth)
- Reads the raw body (max 64 KB, else 413) before parsing. Verifies `Stripe-Signature`: `t=` within 300 s of now, and any `v1=` equal (constant-time) to HMAC-SHA256(`STRIPE_WEBHOOK_SECRET`, `t + "." + body`). Failure -> 400, no detail, nothing written.
- Only then parses JSON (zod). **Checks the event's `livemode` equals `STRIPE_EXPECT_LIVEMODE`** before any database call; a mismatch -> 200 with nothing written (D11).
- Calls `private.record_stripe_event`. If the answer carries a refund target, calls `POST /v1/refunds` (`payment_intent`, `reason=duplicate`, `Idempotency-Key: refund-<payment id>`), then `mark_refund_requested`. **If the refund call fails, the webhook answers 500** so Stripe retries the event; the retry (a duplicate) returns the same refund target and the same idempotency key keeps it to one refund (D12).
- Returns 200 for applied, duplicate (with no refund pending), ignored and mismatched events, so Stripe stops retrying; 500 on our own database error or a failed refund call, so Stripe retries, which is safe by D3 and D12.
- Secrets: `STRIPE_WEBHOOK_SECRET`, `STRIPE_SECRET_KEY` (refunds only), `STRIPE_EXPECT_LIVEMODE` (`false` until launch).
- Subscribed events: `checkout.session.completed`, `checkout.session.expired`, `charge.refunded`, `charge.dispute.created`.

**Deployment:** Archan deploys with `npx supabase functions deploy promotion-checkout stripe-webhook` at release (never from a session), after setting the secrets himself with `npx supabase secrets set`.

## Components & hooks
**PR 1 (app side, no behaviour change):** `src/features/promotions/schema.ts` accepts the new keys and states of `get_my_promotion` (like spec 16 D11), so the app on main keeps working. Nothing reads them yet.

**PR 3 (app):**
- `src/features/promotions/api.ts`: `startCheckout(promotionId)` (calls `supabase.functions.invoke('promotion-checkout')`, zod-checks that `url` starts with `https://checkout.stripe.com/`), `mapCheckoutError`.
- `src/features/promotions/schema.ts`: the checkout answer.
- `src/features/promotions/hooks/useStartCheckout.ts` (mutation), `useConfirmPayment.ts` (refetch every 3 s up to 30 s after return; stops on a final state or when the screen blurs).
- `src/features/promotions/checkoutBrowser.ts`: opens the URL (D9) and resolves when the sheet closes; a thin wrapper, mocked in tests.
- `src/features/promotions/components/PromoteScreen.tsx`, `PromotionStatusCard.tsx`: the new states; `PayButton.tsx` (shows the locked price; disabled while starting; spoken label "Pay CAD 25.00, opens Stripe payment page").
- `src/features/promotions/format.ts`: "Pay by 28 Nov", the locked price wording, "Refunded on".

## Files to create
- PR 1 (database):
  - `supabase/migrations/<ts>_promotion_payment.sql`
  - `supabase/tests/16b-promotion-payment.test.sql`
- PR 2 (functions):
  - `supabase/functions/promotion-checkout/{index.ts,handler.ts}`
  - `supabase/functions/stripe-webhook/{index.ts,handler.ts}`
  - `supabase/functions/_shared/stripe.ts` (form encoding, signature verify, the two REST calls; pure where possible)
  - `supabase/functions/tests/{stripe-signature.test.ts,stripe-webhook.test.ts,promotion-checkout.test.ts}` and `supabase/functions/tests/fixtures/stripeEvents.ts` (fake events signed inside the test with an obviously fake secret such as `whsec_test_fake_only`)
  - `scripts/dev/fake-stripe-event.ts` (local only: signs a fake event with a secret passed on the command line and posts it to the local webhook; refuses any non-localhost URL)
- PR 3 (app):
  - `src/features/promotions/hooks/{useStartCheckout,useConfirmPayment}.ts`, `src/features/promotions/checkoutBrowser.ts`, `src/features/promotions/components/PayButton.tsx`, jest tests
- PR 4 (launch docs):
  - `docs/runbooks/stripe-setup.md` (Archan's steps below, test then live)

## Files to change
- PR 1: `supabase/tests/05-seller-onboarding.test.sql` (allowlists), `supabase/tests/16-promotions.test.sql` (only the assertions on the old status list and the old `request` / `cancel` behaviour; listed exactly at gate B, stop and ask for any other), `supabase/seed.sql` and `scripts/seed/promotions.ts` (one `payment_due` and one paid campaign), `src/types/database.ts` (regenerated), `src/features/promotions/schema.ts` (new keys accepted), `docs/runbooks/promotions-admin.md` (`approve_headline`, refunds in Stripe), `docs/product/v1.md` §7, §15, §16.
- PR 2: `supabase/config.toml` (two function blocks), `supabase/functions/deno.json` (check task), `supabase/functions/_shared/rateLimit.ts` (+ `checkout` kind; its SQL quota side is in PR 1's migration), `.env.example` (names of the three function secrets, no values).
- PR 3: `PromoteScreen.tsx`, `PromotionStatusCard.tsx`, `api.ts`, `schema.ts`, `format.ts`, `package.json` (`expo-web-browser`), `app.config.ts` only if D9 needs it.
- PR 4: `docs/product/v1.md` §16 (before-launch list), CLAUDE.md row.

## New dependencies
- `expo-web-browser` (app, PR 3, Resolved Q8): opens Stripe Checkout in an in-app browser sheet (SFSafariViewController / Custom Tabs) and returns to the app. Installed with `npx expo install expo-web-browser`. Needs one native rebuild by Archan.
- No Stripe SDK in the app or the Edge Functions (D7). No new Deno import.

## Decisions
- **D1 Names on the payment page (Resolved Q-D1).** Stripe public business name **welcometohvac** on the Checkout page and receipts; the product line reads **"LikeToOrder promotion, 7 days"** so buyers connect the two. Statement descriptor `WELCOMETOHVAC`; the suffix `LIKETOORDER` only if Stripe's length rules allow, checked at Archan's setup step. The Promote screen says before paying: "Payments are handled by Stripe. The charge appears as WELCOMETOHVAC."
- **D2 Campaign window at payment (Resolved Q6).** `starts_at = greatest(now(), preferred_start at 00:00 America/Toronto)`, `ends_at = starts_at + length_days`. With no preferred start, it starts at payment. If the window would overlap (not expected: one open campaign per business), the payment is refunded (D5) rather than shifted.
- **D3 Idempotency by event id.** `stripe_events.event_id` is the primary key; every handler also checks the current state, so retries and out-of-order events are safe.
- **D4 Cards only.** `payment_method_types=card`. Apple Pay and Google Pay are turned on in the Stripe dashboard and work through Checkout as card wallets, with no code change (Resolved Q7). No delayed methods, so payment is known at `checkout.session.completed`.
- **D5 Automatic refund of payments we cannot honour.** Duplicate, late, after a cancel, or a wrong amount: a full automatic refund from the webhook, idempotent. Archan sees them in Stripe and in `stripe_events.outcome = 'refund_requested'`. Stripe normally keeps its card-processing fee on a refund, so each such case costs a small fee. This includes a seller who cancels while a Stripe page is still open and then pays on it.
  - *Possible later improvement (not built now):* when the seller cancels, also expire the open session at Stripe (best effort, `POST /v1/checkout/sessions/<id>/expire`), so the page can no longer take money.
- **D6 Refunds only by Archan in Stripe (Resolved Q2, Q3).** The app has no refund button. Full refunds only; a full refund stops the campaign; a partial refund is recorded only.
- **D7 No Stripe SDK.** Two REST calls and an HMAC check are small, need no dependency, and are fully testable with fake signed events. If PR 2's plan finds the form encoding too fragile, `npm:stripe` is the alternative and needs Archan's approval as a new dependency.
- **D8 Receipts from Stripe.** Stripe's email receipt and the charge's `receipt_url` (shown in the app). No invoices from our side until the tax question is answered.
- **D9 Opening and returning (Resolved Q8, Q9).** `WebBrowser.openAuthSessionAsync(url, 'liketoorder://seller/promote')`. PR 3's planning starts by testing which return Stripe accepts, in this order of preference:
  1. a redirect-only Edge Function that answers with a 302 to `liketoorder://seller/promote?checkout=done` (Supabase Edge Functions do not serve HTML pages on the default domain, so it must be a pure redirect);
  2. a tiny static page on a domain Archan owns (welcometohvac.com) that redirects to the app;
  3. no return link at all: the app just refetches when the browser sheet closes.
  In every case the app never treats "done" as paid; it only refetches `get_my_promotion`.
- **D10 Restricted key.** `STRIPE_SECRET_KEY` is a restricted key with only Checkout Sessions write, Refunds write and Charges read.
- **D11 Test events never touch live, two separate checks.** (a) The webhook function refuses an event whose `livemode` differs from `STRIPE_EXPECT_LIVEMODE`, before any database call. (b) The checkout function records the session's `livemode` on the payment row at attach time, and `record_stripe_event` answers `mismatch` with nothing changed when an event's `livemode` differs from that row's. Each check has its own test.
- **D12 No lost refunds.** A payment that needs a refund stays `needs_refund` until `mark_refund_requested` runs after Stripe accepted the refund call. A duplicate event, and any later event for that payment, returns the refund target again while it is `needs_refund`. If the refund call fails, the webhook answers 500 so Stripe retries; the same `Idempotency-Key: refund-<payment id>` keeps it to one refund.

## Rules for implementation
- RLS on every new table, plus pgTAP proving outsiders are refused.
- Supabase calls only in `src/features/promotions/api.ts`.
- Theme tokens only, no hardcoded colours or sizes. Loading, empty, error (with Retry) and success on every screen. Accessibility labels and roles on every touchable, 44 pt targets.
- Feature-specific rules:
  - **Secrets:** `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` exist only as Supabase Edge Function secrets set by Archan. Never in the app, never `EXPO_PUBLIC_*`, never in the repo, `app.config.ts`, CI logs, chat or seed. `.env.example` lists names only. Claude never reads `.env` or `supabase/functions/.env`.
  - **No publishable key:** Checkout is hosted, so the app holds no Stripe key at all.
  - **No card data:** the app never shows, collects or stores card details; the database stores ids, amounts and statuses only.
  - **The server decides:** only `record_stripe_event` (called after a verified signature) can set a paid campaign to `approved`. No client-callable function sets `paid_at`, `approved` or `refunded`, or touches `promotion_payments` or `stripe_events`.
  - **Signature first:** no JSON parse and no database call before the signature and timestamp pass.
  - **Amounts in cents**, CAD only, compared exactly with the locked row.
  - **All tests use fake signed events** with a fake secret created in the test. No real Stripe account, key or network call in any test or session; the REST calls are injected and faked.
  - Migrations are append-only (the `protect-files` guard hook blocks edits to existing migrations); run `npm run db:types` after the migration. If the guard hook blocks anything, stop and ask.
  - All SQL and TS ASCII-only; byte-check after writing.

## Store rules (MUST CHECK)
**MUST be settled BEFORE PR 1 is planned, not only before PR 3, because an in-app-purchase requirement changes the price, the fee and the app screens. Archan's supervisor (Cowork Claude) researches the live Apple and Google pages and records the answer here; Archan only decides.**

Not decided here. What a first search found (not legal advice; the live pages must be read in full):
- Apple App Review Guidelines 3.1.1 require In-App Purchase to unlock features or digital content in an app. Apple's October 2022 update added 3.1.3(g) for **advertising management apps**, apps whose main purpose is buying and managing ad campaigns. LikeToOrder is not such an app (its main purpose is finding food), so 3.1.3(g) likely does not cover it. Reporting at the time said digital "boosts" bought inside social apps **do** need In-App Purchase. The Canada rules on linking out to an external payment must be checked on the live page. Sources: [Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/), [MacRumors, Oct 2022](https://www.macrumors.com/2022/10/24/apple-updates-app-store-review-guidelines-2/).
- Google Play requires Play Billing for in-app purchases of digital goods and services, with listed exceptions (physical goods, goods consumed only outside the app, and others). The search found no exception that names advertising. Google also published US-only changes after a court injunction. Sources: [Play Payments policy](https://support.google.com/googleplay/android-developer/answer/10281818), [Understanding Google Play's Payments policy](https://support.google.com/googleplay/android-developer/answer/9858738), [Google Play payments](https://play.google.com/about/monetization-ads/payments).

**Questions to answer from the live Apple and Google pages:**
1. Is a promotion of a business's place inside LikeToOrder (shown only inside LikeToOrder) "digital content or a feature used in the app" under Apple 3.1.1, like a social-media boost, or does any exception cover it?
2. Under Apple 3.1.1 / 3.1.3, may the app open or link to an external Stripe page for it at all, in Canada (and in the US, given the 2025 US changes)? Does a link-out need an entitlement (StoreKit External Purchase Link) in Canada?
3. Under Google Play's Payments policy, is it a "digital good or service" that needs Play Billing, and is user-choice or alternative billing available in Canada for this app?
4. If In-App Purchase is required: would Apple and Google accept a consumable at a fixed price, and what are the fees? Would Archan accept that?
5. If an in-app payment route is not allowed: is a **web-only route** allowed, where the app shows no price, no Pay button and no link ("We've emailed you how to pay"), and the seller pays from an emailed Stripe link or a website?

**If a rule forces the web-only route:** the database and webhook (PR 1, PR 2) are unchanged. PR 3 changes: the Promote screen shows "Awaiting payment. We've emailed you how to pay." with no price and no link; the checkout session is created by an admin call (or a Stripe Payment Link per promotion) and emailed by Archan. The webhook activates the campaign the same way. This needs a short spec amendment approved by Archan.

**Answer:** (to be recorded here by Cowork Claude, with sources and the date read.)

## Tax and receipts (needs an accountant; not decided)
- Whether Ontario HST (13 %) applies to selling promotion placement to Ontario businesses, and whether welcometohvac must register (the small-supplier threshold): accountant's view.
- Whether the settings price is **tax-inclusive or tax-exclusive**, and whether to use Stripe Tax or a fixed tax line: decided by Archan after the accountant. Until then one `price_cents` is stored and charged exactly, with no tax line.
- What a seller needs as a receipt or invoice for their bookkeeping (business name, HST number if registered, date, amount, tax): accountant's view. Stripe receipts are the default (D8); Stripe Invoicing is the alternative.
- Refund receipts and the effect of refunds on tax: accountant's view.
- None of this blocks building; it blocks the switch to live mode.

## What Archan does himself (Claude does none of this)
1. Create a Stripe account for welcometohvac (Canada) yourself in the browser. Do not share any login with Claude.
2. Stay in **Test mode** (the toggle in the Stripe dashboard) for everything until the before-launch step.
3. In Settings > Public details, set the public business name to **welcometohvac**, the support email and the support phone or URL.
4. Set the statement descriptor `WELCOMETOHVAC` and check whether the suffix `LIKETOORDER` fits Stripe's length rules; tell Claude only yes or no.
5. Add branding (icon, colour) so the Checkout page looks consistent.
6. Add the bank account for payouts and complete the identity checks Stripe asks for (needed before live mode; can be done now).
7. In Settings > Payment methods, keep cards on, turn on Apple Pay and Google Pay, and leave delayed methods off (D4).
8. In Test mode, create a **restricted key** with only Checkout Sessions write, Refunds write and Charges read (D10).
9. After PR 2 is merged and you have deployed the functions, add a test-mode webhook endpoint pointing to the hosted `stripe-webhook` URL with the four events listed under Edge Functions; copy its signing secret.
10. Set the three secrets yourself in a terminal (never in chat, never in a file in the repo): `npx supabase secrets set STRIPE_SECRET_KEY=... STRIPE_WEBHOOK_SECRET=... STRIPE_EXPECT_LIVEMODE=false`.
11. Tell Claude only "test secrets are set". Never paste a key, a secret or a screenshot showing one into chat. If one is ever pasted, roll it in the Stripe dashboard at once.

## Out of scope
- Live mode, live keys and a live webhook endpoint (before launch, below)
- Subscriptions, several campaign lengths, coupons, discounts, credits
- Tax calculation and our own invoices (pending the accountant)
- Seller self-service refunds or cancellation of a paid campaign
- Expiring the open Stripe session when a seller cancels (a possible later improvement, D5)
- Payment for orders: v1 §3 (orders stay trust-based)
- Stripe Connect or paying sellers
- An admin screen (spec 16 Q17)
- Apple / Google In-App Purchase (only if the store check forces it; a spec amendment)
- Push notifications about payments
- Everything in v1 §3

## Definition of done
**PR 1 (database, `feature/promotion-payment-db`)**
- [ ] RLS on `promotion_payments` and `stripe_events`; `anon` and `authenticated` hold no privileges. **An outsider cannot** read, insert, update or delete any payment or event row, or call `begin_promotion_checkout`, `attach_checkout_session`, `record_stripe_event` or `mark_refund_requested` (anon and authenticated refused). The 05 allowlists are updated.
- [ ] **An outsider cannot** start checkout for another owner's promotion (`not_found`, the same answer as an unknown id).
- [ ] Migration safety: rows approved before this migration get `is_free = true` and still read as active, scheduled or ended exactly as before (pgTAP compares `get_my_promotion`, `promotion_is_active` and the map `promoted` flag for seeded pre-migration rows); existing `requested` rows are unchanged.
- [ ] `approve_headline` locks the price: changing `promotion_settings` afterwards does not change the amount `begin_promotion_checkout` returns.
- [ ] Every transition: requested -> payment_due -> approved (paid); payment_due -> payment_expired (lapse, then a new request succeeds); payment_due -> cancelled (seller); paid -> refunded (full); a partial refund keeps it active; a dispute stops it; a seller cancel of a paid campaign -> `contact_support`; the free `approve` still works.
- [ ] `get_my_promotion` returns every derived state in the table, with fixed times relative to `now()`.
- [ ] A refunded or disputed campaign is not `promoted` on the map functions and not in `list_offers_near`.
- [ ] `record_stripe_event`: a duplicate event id changes nothing; a duplicate, and any later event, for a payment in `needs_refund` returns the refund target again; after `mark_refund_requested` a duplicate returns no refund target; an event whose livemode differs from the payment row's -> `mismatch`, nothing changed; wrong amount or currency -> `needs_refund`, no activation.
- [ ] Deliberate breaks, each red on its named test, then reverted and `cmp`-checked: (a) remove the `stripe_events` conflict guard; (b) accept an amount mismatch; (c) grant `begin_promotion_checkout` to authenticated; (d) read the price from settings instead of the row at checkout; (e) skip the refund target on a duplicate for a `needs_refund` payment; (f) drop the row-livemode check.
- [ ] Seed has one `payment_due` and one paid campaign; `db:types` regenerated; the zod schema accepts the new keys with no behaviour change; jest, lint, typecheck and `npx supabase test db` green; runbook and v1 §7, §15, §16 updated.

**PR 2 (Edge Functions, `feature/promotion-payment-functions`)**
- [ ] Webhook (Deno tests, fake signed events, fake `fetch`): bad signature, old timestamp, missing header and a body over 64 KB are refused with no database call; a valid paid `checkout.session.completed` activates; an event whose livemode differs from `STRIPE_EXPECT_LIVEMODE` is refused before any database call (tested separately from the row check); a refund target leads to one `POST /v1/refunds` with `Idempotency-Key: refund-<id>`, then `mark_refund_requested`; a failed refund call answers 500 and does not call `mark_refund_requested`; a retried duplicate with a refund target repeats the refund call with the same key.
- [ ] Checkout (Deno tests): no JWT -> 401; missing secret -> 503 `payments_unavailable`; rate limit; reuse of an open session; the Stripe request body has the locked amount, `cad`, card only, the product name, metadata and the idempotency key; the session's livemode is passed to `attach_checkout_session`; the response holds only `{ url }`.
- [ ] Deliberate breaks, each red on its named test, then reverted and `cmp`-checked: (g) skip the signature check; (h) skip the `STRIPE_EXPECT_LIVEMODE` check; (i) answer 200 when the refund call fails; (j) not repeat the refund on a duplicate that carries a refund target.
- [ ] `grep` proves no `sk_`, `rk_` or `whsec_` value outside the tests' obvious fakes, and no `EXPO_PUBLIC_STRIPE` anywhere.
- [ ] `scripts/dev/fake-stripe-event.ts` refuses a non-localhost URL (unit test). `deno lint`, `deno task check`, `deno task test` green; `config.toml`, `deno.json` and `.env.example` (names only) updated.

**PR 3 (app, `feature/promotion-payment-app`; only after the store check is settled)**
- [ ] The Promote screen shows every state in "What people see", each with its action, plus loading, error and Retry.
- [ ] Pay opens only an `https://checkout.stripe.com/` URL (the api test refuses anything else).
- [ ] Returning never shows Paid until `get_my_promotion` says so (a test with a fake that stays `payment_due`).
- [ ] Confirming polls at most 30 s, stops on blur, and shows Check again.
- [ ] Screen-reader labels on Pay, Check again and View receipt; the largest text size fits.
- [ ] Archan's Simulator run in Stripe **test mode** with a Stripe test card: pay, return, Paid and scheduled; close the page, "not completed"; pay in two sessions, the second refunded automatically; a full refund in the dashboard, Refunded and gone from the map.

**PR 4 (launch docs, `feature/promotion-payment-launch-docs`)**
- [ ] `docs/runbooks/stripe-setup.md` with Archan's steps for test and live; v1 §16 updated with the before-launch list below.

## Before launch (separate from building)
1. Store-check answer recorded (section above) and, if needed, the web-only amendment shipped.
2. Accountant's answer on HST, the tax-inclusive price and receipts; the price set accordingly in the live `promotion_settings`.
3. Stripe live mode: identity and bank verified; a live restricted key; a live webhook endpoint with the four events; live secrets set by Archan; `STRIPE_EXPECT_LIVEMODE=true`.
4. One real-money test with a real card at the smallest price, then a full refund in the dashboard; check the statement descriptor on the card statement and the receipt email.
5. Terms (spec 18): price, payment, refunds, disputes, and who charges (welcometohvac for LikeToOrder).
6. VoiceOver and TalkBack on the payment states.

## Test plan
- **pgTAP** `supabase/tests/16b-promotion-payment.test.sql` (PR 1): everything under PR 1, calling the private functions as the database owner with fake event payloads; plus the approved 05 and 16 edits. Run with `npx supabase test db` after `npx supabase db reset` (local only).
- **Deno** `supabase/functions/tests/` (PR 2): signature verify (known-answer vectors computed in the test from a fake secret), the webhook and checkout handlers with an injected fake RPC and a fake `fetch`. No network.
- **jest** (PR 1 and PR 3): the schema keys (PR 1); `api` (URL allowlist, error map), `format`, `useConfirmPayment` (fake timers), `PromoteScreen` states, `PayButton` accessibility (PR 3).
- **Local manual without Stripe** (after PR 2): `npx supabase db reset`, then `scripts/dev/fake-stripe-event.ts` signs a fake `checkout.session.completed` with a made-up local secret and posts it to the local webhook; the campaign becomes paid and scheduled. Archan runs it; the local function reads the made-up secret from his local function env, which Claude does not read.
- **Manual in Stripe test mode** (Archan, after his setup steps): the PR 3 Simulator run.

## Delivery: PRs and gates
I stop and commit at every gate (named files, a conventional message, no push) and wait for Archan's "approved". The spec commit lives on `feature/promotion-payment`. Every PR is cut from `main` after the previous one is merged.

| PR | Branch | Gates | Migration |
|---|---|---|---|
| spec | `feature/promotion-payment` | **A** spec + CLAUDE.md row + spec 16 status line (this commit). | No |
| 0 store check | none (docs) | **S** the store answer recorded in this spec by Cowork Claude and decided by Archan, before PR 1 is planned. Stop if it forces In-App Purchase or the web-only route (spec amendment first). | No |
| 1 database | `feature/promotion-payment-db` | **B** migration + pgTAP (new + 05/16 edits), `test db` green, breaks (a) to (f). **C** seed, `db:types`, zod keys, runbook, v1 §7/§15/§16. Review, ship. | **Yes** (one) |
| 2 functions | `feature/promotion-payment-functions` | **D1** `_shared/stripe.ts` + signature tests. **D2** both functions, Deno tests with fake signed events, breaks (g) to (j). **D3** fake-event script, `config.toml`, `deno.json`, `.env.example` names. Review, ship. | No |
| 3 app | `feature/promotion-payment-app` | **E0** D9 return test. **E1** api, schema, hooks, browser wrapper + tests. **E2** screen states + tests. **E3** `expo-web-browser`, Archan rebuilds. **F** Archan's test-mode Simulator run. Review, ship. | No |
| 4 launch docs | `feature/promotion-payment-launch-docs` | **G** `stripe-setup.md`, v1 §16. Ship. | No |

## Privacy and security position
- Card data never touches the app or our database. Stripe hosts the page.
- Two server secrets, set only by Archan; the app holds no Stripe key.
- Only a verified Stripe signature can mark a campaign paid. Clients cannot write any payment field.
- We store Stripe ids, amounts, statuses and the receipt URL; no names, emails or full payloads.
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
- **Q8** `expo-web-browser`, an in-app sheet, one rebuild.
- **Q9** The return candidates in D9, tested first in PR 3's planning.
- **Q10** The store check is researched by Cowork Claude on the live pages and decided by Archan, before PR 1 is planned (Store rules section).
- **Q12** Existing `requested` rows stay as they are; existing `approved` rows are marked `is_free` by the migration.

## Open questions
1. **Q11 Tax:** the accountant's view on Ontario HST, a tax-inclusive or tax-exclusive price, registration and receipts. Blocks live mode, not building.

The store check (Q10) is not an open question for Archan to research; it is a gate (S) before PR 1 is planned, see Store rules.
