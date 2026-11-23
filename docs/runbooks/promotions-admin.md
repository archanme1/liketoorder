# Promotions: admin runbook (specs 16 and 16b)

How Archan handles promotion requests. There is no admin screen. Reviewing a headline is one SQL call
in the Supabase dashboard's **SQL editor**, which runs as the database owner. Sending and voiding
invoices are two **admin commands** (calls to the `promotion-invoice` Edge Function with your admin
secret; they exist only after spec 16b PR 2 is deployed). Refunds happen only in the **Stripe
dashboard**. The app can never make any of these calls. No keys or passwords belong in this file.

## How it works, in plain words

1. A seller taps **Promote your business** in Manage Business and sends a request: a category, a
   headline (at most 60 characters) and an optional preferred start day.
2. Archan reads the headline and **approves the headline** (`approve_headline`). This locks the price,
   currency and length from today's settings and opens a **7-day payment window** (`pay_by`).
3. Archan runs the admin command **`invoice`**. Stripe emails the seller an invoice for the locked
   price, due on `pay_by`, from the public business name welcometohvac ("LikeToOrder promotion, 7 days").
4. The seller pays on Stripe's page, outside the app. Stripe tells our server (a signed webhook), and
   **only that** schedules the campaign: it starts at payment, or at 00:00 Toronto on the preferred day
   if that is later, and runs for the locked number of days.
5. While the campaign runs, the place gets the larger "Ad" flag on its map, "Sponsored" on its sheet and
   a card in Offers. When the end time passes, all of that stops by itself (the server clock, no job).
6. If the seller does not pay by `pay_by`, the campaign can no longer start and the seller can promote
   again. The open invoice stays payable at Stripe until it is voided: run **`void_pending`**.
7. A free campaign (for example a compensation) still uses the old manual **`approve`** with a start
   time and no payment. It is marked `is_free`.

States the seller sees: requested, awaiting payment ("Your headline was approved. We'll be in touch with
next steps."), scheduled, active, ended, payment window closed, refunded, rejected, cancelled.
Stored statuses: `requested`, `payment_due`, `approved`, `rejected`, `cancelled`, `payment_expired`,
`refunded`. Scheduled, active and ended come from an approved window and the clock; awaiting payment
and payment window closed come from `payment_due` and `pay_by`. The app shows no price, no Pay button
and no payment link (store rules).

## See waiting requests

```sql
select p.id, b.name, b.type, p.category, p.headline, p.preferred_start, p.created_at
  from public.promotions p
  join public.businesses b on b.id = p.business_id
 where p.status = 'requested'
 order by p.created_at;
```

## See every campaign, its state and its payment

```sql
select p.id, b.name, p.status,
       case when p.status = 'approved' then
              case when now() < p.starts_at then 'scheduled'
                   when now() < p.ends_at then 'active' else 'ended' end
            when p.status = 'payment_due' then
              case when now() < p.pay_by then 'awaiting_payment' else 'payment_expired' end
            else p.status end as state,
       p.is_free, p.price_cents, p.currency_code, p.pay_by, p.paid_at, p.starts_at, p.ends_at,
       r.status as payment, r.refunded_cents, p.headline, p.reject_reason, p.cancelled_by
  from public.promotions p
  join public.businesses b on b.id = p.business_id
  left join lateral (select x.status, x.refunded_cents from public.promotion_payments x
                      where x.promotion_id = p.id order by x.created_at desc limit 1) r on true
 order by p.created_at desc;
```

`price_cents` is in the currency's minor unit: 2500 with CAD is CAD 25.00.

## Approve the headline (the normal path)

Before approving, read the headline. **Reject with reason `headline` if it holds a phone number, an
email, a link or a street address** (home cooks especially: their exact address is shown only after an
accepted request). The server already refuses emails, numbers with 10 or more digits and line breaks,
but it cannot catch everything (a link, a street address, a number written in words).

```sql
select private.admin_review_promotion('<promotion id>', 'approve_headline');
```

- Only a `requested` promotion can be approved this way.
- It copies the price, currency and length from today's settings onto the promotion (the **price
  lock**); a later settings change never changes it. It needs a settings row (`not_configured`).
- It sets `pay_by` to now plus 7 days. The answer shows the state `awaiting_payment`.
- Then send the invoice (next section). Nothing is charged until the seller pays Stripe's invoice.

## Send the invoice (admin command `invoice`, after spec 16b PR 2)

A `POST` to the deployed `promotion-invoice` function with the header `x-admin-secret` (your admin
secret from your password manager, never pasted into chat or a file) and the body
`{ "action": "invoice", "promotion_id": "<promotion id>" }`. The exact command is added here by spec 16b
PR 4 (`docs/runbooks/stripe-setup.md`).

- The function looks up the business and the owner's email itself; you never type an email.
- Running it twice never sends a second invoice: it answers `already_sent`, or finishes a run that
  stopped half-way.
- It is refused with less than 1 hour left before `pay_by` (`payment_window_closed`), for a promotion
  that is not awaiting payment (`not_payable`), for a currency other than CAD (`not_configured`), and
  after 10 calls for one promotion in an hour (`rate_limited`).
- In Stripe **test mode** no email is sent: open the invoice from the Stripe dashboard instead.

## Void stale invoices (admin command `void_pending`, after spec 16b PR 2)

The same function with the body `{ "action": "void_pending" }`. It voids at Stripe every invoice that
should no longer be paid: those of cancelled or rejected promotions (`void_pending`) and those whose
payment window has passed. It answers how many were voided and how many failed.

- **Run it after every cancel or reject of a promotion awaiting payment, and from time to time** (for
  example once a week). Until it runs, a stale invoice stays payable at Stripe; if the seller pays it,
  the money is refunded automatically, and Stripe keeps its processing fee.
- **A draft invoice that was never sent** (a run interrupted after Stripe created the draft) cannot be
  voided, and `void_pending` counts it as failed. Delete it by hand in the Stripe dashboard (Invoices,
  filter Draft, open it, Delete draft). A draft is never emailed and cannot be paid.

## Refunds (only in the Stripe dashboard)

- **Full refunds only, and only in the Stripe dashboard** (Payments, open the payment, Refund, full
  amount). There is no refund in the app or in SQL.
- The webhook records it: a full refund marks the promotion `refunded`; a running campaign stops at
  once, a scheduled one never starts. A partial refund (should not happen) is recorded on the payment
  only, and the campaign keeps running.
- **To end a paid campaign early, refund first, then cancel if needed.** An admin cancel of a paid
  campaign does **not** refund anything.
- A **dispute** (chargeback) stops the campaign by itself (stored `cancelled` by admin). Answer the
  dispute in the Stripe dashboard.
- Payments the server cannot honour (paid late, paid after a cancel, a wrong amount, a second payment)
  are refunded automatically. You see them in Stripe and in `public.stripe_events` with the outcome
  `refund_requested`.

## Approve a free campaign (no payment)

For a compensation or a free trial only:

```sql
select private.admin_review_promotion('<promotion id>', 'approve', '2026-12-02 09:00 America/Toronto'::timestamptz);
```

- Arguments, in order: the promotion id, `'approve'`, the start time (with a time zone).
- The end is the start plus the stored number of days. The start may be now, in the future, or at most
  1 hour in the past. The campaign is marked `is_free`; the seller can cancel it from the app.

## Reject

```sql
select private.admin_review_promotion('<promotion id>', 'reject', null, 'headline');
```

- Arguments, in order: the promotion id, `'reject'`, `null` (no start), the reason.
- Allowed for a `requested` promotion and for one awaiting payment (`payment_due`).
- Reasons (exactly one of these words): `headline`, `not_paid` (the payment window closed),
  `not_eligible`, `other`.
- An open invoice becomes `void_pending`: **run `void_pending`** afterwards.

## Cancel

```sql
select private.admin_review_promotion('<promotion id>', 'cancel');
```

- Allowed for a requested promotion, one awaiting payment, and a scheduled or running campaign.
- An open invoice becomes `void_pending`: **run `void_pending`** afterwards.
- A running campaign stops at once. **A paid campaign is not refunded by a cancel: refund in Stripe
  first.** Sellers cannot cancel a paid campaign in the app ("Contact us to cancel").

## Set or change the price

There is one settings row. While it is missing, sellers see "Promotions aren't available yet." and
cannot send requests. Locally, `npx supabase db reset` adds a placeholder (2500, CAD, 7 days).

**On the live project, do not add the real price row until the payment route is live** (spec 16b PR 2
deployed, the Stripe setup done and tested). Without the row, nobody can request a promotion.

```sql
insert into public.promotion_settings (price_cents, currency_code, length_days)
values (2500, 'CAD', 7)
on conflict (id) do update
  set price_cents = excluded.price_cents,
      currency_code = excluded.currency_code,
      length_days = excluded.length_days;
```

- `price_cents` is in the currency's minor unit and must be above 0; `length_days` is 1 to 60. Invoices
  are CAD only.
- **A price change never touches existing promotions.** The price is locked when the headline is
  approved; Stripe is always given the locked price.

## What each error means

| Error | Meaning |
|---|---|
| `not_found` | No promotion has that id. Check the id from "See waiting requests". |
| `not_configured` | `approve_headline` with no settings row. |
| `invalid_start` | A free `approve` without a start, or with a start more than 1 hour in the past. |
| `overlap` | A free `approve` whose time overlaps another approved campaign of that business. Pick a start at or after the other campaign's end. |
| `invalid_transition` | That decision is not possible in the current state: `approve_headline` and `approve` need a requested promotion; `reject` needs a requested or awaiting-payment one; `cancel` needs a requested, awaiting-payment, scheduled or active one; the decision must be `approve_headline`, `approve`, `reject` or `cancel`. |
| `invalid_reason` | A reject without a reason, or a reason that is not one of the four words above. |

## Things to know

- A business can send at most 5 requests in 24 hours (whatever happened to them).
- Approval does not check the business again. A campaign shows only while the place is listed and
  visible on its map; if the place is hidden, nothing shows, and the campaign's time keeps running.
- No card data and no email is stored in our database: only Stripe ids, amounts and statuses
  (`public.promotion_payments`, `public.stripe_events`).
- **Deleting a business or an account with paid campaigns** also deletes its promotions and their
  payment rows (cascade), so our record of those payments is gone. **Check the payments in Stripe
  first** (Stripe keeps them). Note for spec 18 (account deletion): handle paid campaigns before
  deleting.
- **Hosted rollout:** each hosted migration must ship together with an app update, never before one.
  The app checks the server's answers strictly: an older app build refuses new keys or states (spec 16's
  `promoted` and `sponsored`; spec 16b's `paid`, `is_free` and the new states).
