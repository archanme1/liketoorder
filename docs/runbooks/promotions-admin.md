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

## See promotions awaiting payment, with their invoice

```sql
select p.id, b.name, p.pay_by, now() < p.pay_by as within_window, r.status as payment,
       r.invoice_sent_at, r.invoice_id, r.customer_id, p.price_cents, p.currency_code
  from public.promotions p
  join public.businesses b on b.id = p.business_id
  left join public.promotion_payments r
         on r.promotion_id = p.id and r.status in ('reserved', 'open', 'void_pending', 'uncollectible')
 where p.status = 'payment_due'
 order by p.pay_by;
```

A row with `within_window` false reads "Payment window closed." to the seller; its open invoice is voided
by `void_pending`.

## Payments needing attention

Run these from time to time (for example with `void_pending`, once a week) and after any webhook
trouble. Each normally returns no rows.

```sql
-- Stripe events that matched none of our payments, newest first.
select event_id, type, livemode, received_at
  from public.stripe_events
 where outcome = 'mismatch'
 order by received_at desc
 limit 50;

-- Refunds the webhook still owes (its refund call failed; Stripe retries the event for up to 3 days).
select r.id, r.promotion_id, r.status, r.payment_intent_id, r.updated_at
  from public.promotion_payments r
 where r.status = 'needs_refund'
   and r.updated_at < now() - interval '10 minutes'
 order by r.updated_at;

-- Invoices waiting to be voided by void_pending (the same rows it works through, oldest first).
select r.id, r.promotion_id, r.status, r.invoice_id, r.created_at
  from public.promotion_payments r
  join public.promotions p on p.id = r.promotion_id
 where r.status = 'void_pending'
    or (r.status in ('open', 'uncollectible') and p.pay_by <= now())
 order by r.created_at, r.id;
```

- **`mismatch` is expected for activity that is not ours:** the Stripe account may also carry other
  payments (for example welcometohvac's other business). Look up the event in the Stripe dashboard
  (Developers, Events) and act only if it concerns a LikeToOrder promotion. A refund or dispute that
  arrived before its payment was recorded also shows here: check the campaign and refund or cancel by
  hand if needed.
- **An `invoice.paid` for one of our invoices with bad data is never stored as `mismatch`:** the server
  refuses it (`invalid_event_data`), the webhook answers an error and Stripe retries it. Repeated failures
  show in the Stripe dashboard (Developers, Webhooks); tell Claude, it is a PR 2 bug or a clock problem.
- **A `needs_refund` row older than 10 minutes:** the automatic refund has not gone through yet. If it is
  still there the next day, refund the payment in the Stripe dashboard, then tell Claude.

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
- The answer of `admin_review_promotion` shows only the id, the state and the window; it never
  carried a price. To see the locked price, use the query under "See every campaign, its state and its
  payment". (Spec 16b D15 removed the price only from what the app receives: `get_my_promotion` and
  `private.promotion_json`.)
- Then send the invoice (next section). Nothing is charged until the seller pays Stripe's invoice.

## Your admin secret (once, then at the start of each terminal session)

The two admin commands below need your **admin secret** (`PROMOTION_ADMIN_SECRET`). It is the only
thing that lets anyone send or void invoices, so it lives in your password manager and nowhere else:
never in a file in the repo, never in chat, never in a screenshot.

**Make it once**, in your own terminal:

```sh
openssl rand -hex 32
```

This prints 64 random characters. Copy them into your password manager, then clear the screen
(`clear`). The function refuses a secret shorter than 32 characters (it answers `not_configured`).
Setting it on the hosted project is a setup step you do yourself (spec 16b, "What Archan does himself").

**At the start of each terminal session**, load it into a shell variable without it showing on screen
or in your shell history:

```sh
read -rs PROMOTION_ADMIN_SECRET
```

Paste the secret from your password manager and press Enter (nothing is shown). The variable stays in
this shell only (it is not exported, so programs you start from this terminal do not get it). The
commands below read it from there; you never type it into a command. **When you are done**, remove it:

```sh
unset PROMOTION_ADMIN_SECRET
```

In the commands, replace `<project-ref>` with your Supabase project reference (Project Settings in the
Supabase dashboard).

## Send the invoice (admin command `invoice`)

After approving the headline, copy, fill in the promotion id, and paste:

```sh
printf 'x-admin-secret: %s\n' "$PROMOTION_ADMIN_SECRET" | curl -sS -X POST "https://<project-ref>.supabase.co/functions/v1/promotion-invoice" -H @- -H 'Content-Type: application/json' -d '{"action":"invoice","promotion_id":"<promotion id>"}' -w '\nHTTP %{http_code}\n'
```

(The secret goes to `curl` through a pipe, so it does not appear in the command line or the process list.)

**What it answers:**

| Answer | HTTP | What it means | What to do |
|---|---|---|---|
| `{"ok":true,"invoice_status":"sent"}` | 200 | Stripe sent the invoice email to the seller. | Nothing. In Stripe test mode no email is sent: open the invoice in the Stripe dashboard instead. |
| no text | 401 | The admin secret is missing or wrong. | Run the `read -rs` line again and paste the right secret. |
| `"error":"invalid_input"` | 400 | The command text is wrong (for example the promotion id is not a full id). | Check the id and the quotes, then run it again. |
| `"error":"not_found"` | 404 | No promotion has this id. | Check the id. |
| `"error":"not_payable"` | 409 | The promotion is not awaiting payment (not approved yet, cancelled, already paid), or it was cancelled while the command ran. | Check its status. Nothing was sent; if a draft or invoice was made, it was deleted or voided (if that failed, see "Leftovers at Stripe" below). |
| `"error":"payment_window_closed"` | 409 | Less than 1 hour is left before `pay_by`. | Too late to invoice; the seller can promote again. |
| `"error":"already_sent"` | 409 | This promotion's invoice was already sent. | Nothing. It never sends a second one. |
| `"error":"no_email"` | 409 | The owner's account has no email address. | Nothing was created at Stripe. Contact the seller another way. |
| `"error":"rate_limited"` | 429 | More than 10 tries for this promotion in this hour. | Wait for the next hour. |
| `"error":"stripe_error"` | 502 | Stripe refused or did not answer. | **Run the same command again.** It continues where it stopped and never makes a second invoice. If it keeps failing, check the Stripe dashboard and tell Claude. (If the owner changed their email since the first try, Stripe refuses the repeat for about a day; run it again the next day.) |
| `"error":"payments_unavailable"` | 503 | The Stripe key is not set on the server. | Set it (setup step), then run again. |
| `"error":"not_configured"` | 503 | The admin secret on the server is missing or too short, or the promotion's currency is not CAD. | Set a proper secret (setup step); for a currency problem, tell Claude. |
| `"error":"internal_error"` | 500 | Something else failed (for example the database). | Run it again later; if it repeats, tell Claude. |

- The function looks up the business and the owner's email itself; you never type an email. The email
  goes only to Stripe and is never shown, logged or stored by us.
- If the promotion stops being payable during the run (a cancel, or the window passed), the invoice is
  not sent: an unattached draft is deleted, or a finalized invoice is voided.
- **Never run `invoice` twice at the same time for one promotion** (two terminals, or a double paste).
  Wait for the first answer. Two runs at once can make the second delete the draft the first just
  attached, and the promotion then needs fixing by hand (tell Claude).

## Void stale invoices (admin command `void_pending`)

Copy and paste (nothing to fill in except the project reference):

```sh
printf 'x-admin-secret: %s\n' "$PROMOTION_ADMIN_SECRET" | curl -sS -X POST "https://<project-ref>.supabase.co/functions/v1/promotion-invoice" -H @- -H 'Content-Type: application/json' -d '{"action":"void_pending"}' -w '\nHTTP %{http_code}\n'
```

It voids at Stripe every invoice that should no longer be paid: those of cancelled or rejected
promotions (`void_pending`) and those whose payment window has passed (at most 100 per run, oldest first).

**What it answers:** `{"ok":true,"voided":2,"failed":0,"skipped":0}` (HTTP 200).
- **voided:** voided at Stripe (or, for a draft that was never finalized, deleted) and marked void here.
- **skipped:** already paid at Stripe; the webhook handles it (refunded automatically if it cannot be honoured).
- **failed:** Stripe refused or did not answer for that invoice; it stays on the list. Run the command
  again later. If the same ones keep failing, open them in the Stripe dashboard and tell Claude. If
  very many keep failing (100 or more), newer ones are never reached: the "Invoices waiting to be
  voided" query under "Payments needing attention" shows what is waiting.
- The other answers (401, `payments_unavailable`, `not_configured`, `internal_error`) mean the same as
  in the table above.
- **Run it after every cancel or reject of a promotion awaiting payment, and from time to time** (for
  example once a week). Until it runs, a stale invoice stays payable at Stripe; if the seller pays it,
  the money is refunded automatically, and Stripe keeps its processing fee.

## Leftovers at Stripe to delete by hand

- **An orphan Customer or draft invoice:** if an `invoice` run stopped half-way and was only run again
  more than 24 hours later, Stripe may have forgotten the first attempt, so a second Customer or draft
  can exist next to the one in use. It is never finalized or sent and cannot be paid. Delete it in the
  Stripe dashboard (Invoices, filter Draft, open it, Delete draft; Customers, open it, Delete). Check
  first that it is not the one in use: compare its id with `invoice_id` and `customer_id` in the
  "See promotions awaiting payment" query above.
- **A lost draft after a cancel:** if a promotion was cancelled (or its window passed) while an
  `invoice` run was in progress, the run deletes the draft it had just made; if that delete failed, the
  draft stays at Stripe with no row of ours pointing to it. It carries `metadata[payment_id]`, was never
  finalized or sent, cannot be paid, and is safe to delete (Invoices, filter Draft, open it, Delete draft).
- **Never mark one of our invoices "paid out of band"** in the Stripe dashboard. It has no card payment
  behind it, so the webhook cannot match a payment and Stripe keeps retrying the event for 3 days with
  errors. Money received another way is a free campaign (`approve`, below) after voiding the invoice.

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

- Allowed for a requested promotion, one awaiting payment (also after its window passed: it reads
  "Payment window closed." until something writes to it), and a scheduled or running campaign.
- An open or uncollectible invoice becomes `void_pending`: **run `void_pending`** afterwards.
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
| `invalid_transition` | That decision is not possible in the current state: `approve_headline` and `approve` need a requested promotion; `reject` needs a requested one or one stored `payment_due` (awaiting payment, or with its window passed); `cancel` needs a requested one, one stored `payment_due`, or a scheduled or active one; the decision must be `approve_headline`, `approve`, `reject` or `cancel`. |
| `invalid_reason` | A reject without a reason, or a reason that is not one of the four words above. |
| `not_payable` | Admin command `invoice` for a promotion that is not awaiting payment (still requested, already paid, cancelled ...). |
| `payment_window_closed` | Admin command `invoice` with less than 1 hour left before `pay_by`. The seller can send a new request after the window. |
| `rate_limited` | More than 10 `invoice` calls for one promotion in an hour. Wait, then run it once. |
| `payment_unsettled` | A delete of a business, an account or a payment row while a payment is still payable or owed a refund. Settle it first (see "Things to know"). Nothing was deleted. |

## Things to know

- A business can send at most 5 requests in 24 hours (whatever happened to them).
- Approval does not check the business again. A campaign shows only while the place is listed and
  visible on its map; if the place is hidden, nothing shows, and the campaign's time keeps running.
- No card data and no email is stored in our database: only Stripe ids, amounts and statuses
  (`public.promotion_payments`, `public.stripe_events`).
- **Before deleting a business or an account** (which also deletes its promotions and payment rows by
  cascade):
  1. Void every open invoice at Stripe: cancel the promotion if needed, then run `void_pending`.
  2. Make sure no payment still owes a refund (`needs_refund` or `refund_requested`, query under
     "Payments needing attention") and the refunds are done in Stripe.
  3. Check the paid payments in Stripe (Stripe keeps them; our rows go with the cascade).

  The database refuses the delete with `payment_unsettled` while any payment row of that business is
  still `open`, `void_pending`, `uncollectible` or `needs_refund`; nothing is deleted then. Note for
  spec 18 (account deletion): this guard also blocks a self-service account delete until the payments
  are settled, and the flow must handle it.
- **Hosted rollout:** each hosted migration must ship together with an app update, never before one.
  The app checks the server's answers strictly: an older app build refuses new keys or states (spec 16's
  `promoted` and `sponsored`; spec 16b's `paid`, `is_free` and the new states).
  - **Spec 16b:** release the spec 16b PR 3 app first (or at the same time), then apply ALL spec 16b
    migrations together (PR 1 `20261122022052_promotion_payment.sql` and PR 3
    `20261124145046_promotion_price_out_of_app.sql`). Never a migration before the app: the app on
    main before PR 3 requires the price keys that the PR 3 migration removes, and would show an error
    on the Promote screen. The PR 3 app works with and without that migration (it drops the old price
    keys).
- **The app shows status only** (spec 16b, store rules): no price, no Pay button, no payment link and
  no payment wording. A seller with a paid campaign sees "Contact us to cancel." as plain text; spec 18
  adds the real support contact. The price, due date and receipt are only in Stripe's invoice email.
