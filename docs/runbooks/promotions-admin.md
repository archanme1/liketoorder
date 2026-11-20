# Promotions: admin runbook (spec 16)

How Archan handles promotion requests. There is no admin screen: every step is one SQL call in the
Supabase dashboard's **SQL editor**, which runs as the database owner. The app can never make these
calls (the admin function is not granted to any app role). No keys or passwords are needed beyond
signing in to the dashboard, and none belong in this file.

## How it works, in plain words

1. A seller taps **Promote your business** in Manage Business and sends a request: a category, a
   headline (at most 60 characters) and an optional preferred start day. The request stores the price,
   currency and length that were set at that moment.
2. Archan reads the headline, sends an invoice outside the app and waits for payment.
3. Archan **approves** it with a start time (the campaign then runs for the stored number of days), or
   **rejects** it with a reason.
4. While the campaign runs, the place gets the larger "Ad" flag on its map, "Sponsored" on its sheet and
   a card in Offers. When the end time passes, all of that stops by itself: the server compares the end
   time with its clock on every read. No job runs and nothing needs to be switched off.
5. Archan can **cancel** a request or a campaign at any time before it ends (for example after a
   refund, which is also handled outside the app). The seller can cancel too, from the app.

States the seller sees: requested, scheduled (approved, not started), active, ended, rejected,
cancelled. Only requested, approved, rejected and cancelled are stored; scheduled, active and ended come
from the approved window and the clock.

## See waiting requests

```sql
select p.id, b.name, b.type, p.category, p.headline, p.preferred_start,
       p.price_cents, p.currency_code, p.created_at
  from public.promotions p
  join public.businesses b on b.id = p.business_id
 where p.status = 'requested'
 order by p.created_at;
```

`price_cents` is in the currency's minor unit: 2500 with CAD is CAD 25.00. Use this stored price on the
invoice, not today's settings (see "Set or change the price").

## See every campaign and its state

```sql
select p.id, b.name, p.status,
       case when p.status <> 'approved' then p.status
            when now() < p.starts_at then 'scheduled'
            when now() < p.ends_at then 'active'
            else 'ended' end as state,
       p.starts_at, p.ends_at, p.headline, p.reject_reason, p.cancelled_by
  from public.promotions p
  join public.businesses b on b.id = p.business_id
 order by p.created_at desc;
```

## Approve (after payment)

Before approving, read the headline. **Reject with reason `headline` if it holds a phone number, an
email, a link or a street address** (home cooks especially: their exact address is shown only after an
accepted request). The server already refuses emails, numbers with 10 or more digits and line breaks,
but it cannot catch everything (a link, a street address, a number written in words).

```sql
select private.admin_review_promotion('<promotion id>', 'approve', '2026-12-02 09:00 America/Toronto'::timestamptz);
```

- Arguments, in order: the promotion id, `'approve'`, the start time.
- Write the start with a time zone (as above), so it means the moment you intend.
- The end is set for you: the start plus the stored number of days (7 with today's settings).
- The start may be now, in the future, or at most 1 hour in the past.
- The answer shows the id, the state (`scheduled` or `active`), `starts_at` and `ends_at`.

## Reject

```sql
select private.admin_review_promotion('<promotion id>', 'reject', null, 'not_paid');
```

- Arguments, in order: the promotion id, `'reject'`, `null` (no start), the reason.
- Reasons (exactly one of these words):
  - `headline`: the headline is not acceptable (the seller can send a new request with another one);
  - `not_paid`: the invoice was not paid;
  - `not_eligible`: the business may not be promoted;
  - `other`: anything else.
- The seller sees "Not approved" with the reason, and can send a new request.

## Cancel (a request, a scheduled campaign or a running one)

```sql
select private.admin_review_promotion('<promotion id>', 'cancel');
```

- A running campaign stops at once: the larger flag, "Sponsored" and the Offers card disappear on the
  next refresh. Refunds are handled outside the app.
- An ended, rejected or already cancelled campaign cannot be cancelled.

## Set or change the price

There is one settings row. While it is missing, sellers see "Promotions aren't available yet." and
cannot send requests. Locally, `npx supabase db reset` adds a placeholder (2500, CAD, 7 days). On the
live project there is no row until the real price is decided.

```sql
insert into public.promotion_settings (price_cents, currency_code, length_days)
values (2500, 'CAD', 7)
on conflict (id) do update
  set price_cents = excluded.price_cents,
      currency_code = excluded.currency_code,
      length_days = excluded.length_days;
```

- `price_cents` is in the currency's minor unit and must be above 0; `length_days` is 1 to 60.
- **A price change never touches existing requests or campaigns.** Every request keeps the price,
  currency and length it was sent with; only new requests use the new values.

## What each error means

| Error | Meaning |
|---|---|
| `not_found` | No promotion has that id. Check the id from "See waiting requests". |
| `invalid_start` | Approving without a start, or with a start more than 1 hour in the past. |
| `overlap` | That business already has an approved campaign whose time overlaps this one. Pick a start at or after the other campaign's end (back-to-back is allowed). |
| `invalid_transition` | That decision is not possible in the current state: only a requested promotion can be approved or rejected; only a requested, scheduled or active one can be cancelled; the decision must be `approve`, `reject` or `cancel`. |
| `invalid_reason` | A reject without a reason, or a reason that is not one of the four words above. |

## Things to know

- A business can send at most 5 requests in 24 hours (whatever happened to them); the sixth is refused
  in the app with `too_many_requests`. Nothing for you to do.
- Approval does not check the business again. A campaign shows only while the place is listed and
  visible on its map; if the place is hidden, nothing shows, and the campaign's time keeps running.
- Payment is never handled in the app, and no card or payment data is stored anywhere.
- **Hosted rollout:** the hosted migration must ship together with an app update, never before one. The
  app checks the map answers strictly, so an app build from before spec 16 would refuse the new
  `promoted` and `sponsored` fields.
