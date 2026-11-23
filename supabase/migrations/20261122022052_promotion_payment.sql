-- Spec 16b PR 1: promotion payment (database). Payment happens outside the app: Archan approves the
-- headline (price locked), an admin Edge Function (PR 2) asks Stripe to email an invoice, and only a
-- verified Stripe webhook (PR 2) calling record_stripe_event can schedule a paid campaign.
-- Spec 16's migration is not edited (fix forward).
--
-- New stored states: payment_due (headline approved, waiting for the money until pay_by), payment_expired
-- (written only when something writes to a lapsed payment_due row) and refunded. Reads never write:
-- payment_due past pay_by already reads as payment_expired by the server clock.
--
-- Roles: the three app functions stay granted to authenticated. The seven service functions live in
-- public (the API exposes only public; the claim_push_batch pattern) and are granted to service_role
-- only. admin_review_promotion and the helpers stay in private (database owner only).

-- -- 1. New stored statuses -----------------------------------------------------
-- The spec 16 check was written inline, so Postgres named it promotions_status_check.
alter table public.promotions drop constraint promotions_status_check;
alter table public.promotions add constraint promotions_status_check
  check (status in ('requested', 'payment_due', 'approved', 'rejected', 'cancelled', 'payment_expired', 'refunded'));

-- -- 2. Payment columns -------------------------------------------------------------
alter table public.promotions
  add column pay_by      timestamptz,
  add column paid_at     timestamptz,
  add column refunded_at timestamptz,
  add column is_free     boolean not null default false;   -- the manual 'approve' path (no payment)

-- -- 3. Migration safety ------------------------------------------------------------
-- Every campaign approved before this migration was approved by hand with no payment (spec 16), so it
-- is marked free BEFORE the paid rule below is added. Existing 'requested' rows are left as they are.
update public.promotions set is_free = true where status = 'approved';

-- -- 4. Rules -----------------------------------------------------------------------
alter table public.promotions
  add constraint promotions_pay_by check (status <> 'payment_due' or pay_by is not null),
  add constraint promotions_paid   check (status <> 'approved' or is_free or paid_at is not null);

-- -- 5. One open campaign request per business covers both waiting states ------------
drop index public.promotions_one_request;
create unique index promotions_one_request on public.promotions (business_id)
  where status in ('requested', 'payment_due');

-- -- 6. One row per Stripe invoice ------------------------------------------------------
-- Ids, amounts and statuses only: no card data, no email, no name, no Stripe payload.
-- A row is 'reserved' before Stripe has an invoice; a reserved row cancelled before that becomes 'void'
-- with no ids. Every other status carries the customer, the invoice and the livemode.
-- on delete cascade: a business delete cascades to its promotions and payment rows, except that
-- promotion_payments_guard_delete (below) refuses while a row is still payable or owed a refund. Stripe
-- keeps the financial record; the runbook says to settle and check Stripe before deleting a business.
create table public.promotion_payments (
  id                uuid primary key default gen_random_uuid(),
  promotion_id      uuid not null references public.promotions(id) on delete cascade,
  amount_cents      integer not null check (amount_cents > 0),
  currency_code     text not null check (currency_code = 'CAD'),
  status            text not null default 'reserved'
                      check (status in ('reserved', 'open', 'void_pending', 'void', 'uncollectible', 'paid',
                                        'needs_refund', 'refund_requested', 'refunded', 'partially_refunded',
                                        'disputed')),
  customer_id       text unique check (customer_id ~ '^cus_[A-Za-z0-9]+$'),   -- one Customer per payment
  invoice_id        text unique check (invoice_id ~ '^in_[A-Za-z0-9]+$'),
  invoice_sent_at   timestamptz,
  livemode          boolean,                                                   -- from Stripe's answer (D11)
  payment_intent_id text unique check (payment_intent_id ~ '^pi_[A-Za-z0-9]+$'),
  refunded_cents    integer not null default 0 check (refunded_cents >= 0),
  created_at        timestamptz not null default now(),
  paid_at           timestamptz,
  updated_at        timestamptz not null default now(),
  constraint promotion_payments_refund_le check (refunded_cents <= amount_cents),
  constraint promotion_payments_attached
    check (status in ('reserved', 'void')
           or (invoice_id is not null and customer_id is not null and livemode is not null)),
  constraint promotion_payments_refund_target
    check (status not in ('needs_refund', 'refund_requested') or payment_intent_id is not null)
);
create unique index promotion_payments_one_open on public.promotion_payments (promotion_id)
  where status in ('reserved', 'open', 'void_pending');
create unique index promotion_payments_one_paid on public.promotion_payments (promotion_id)
  where status = 'paid';          -- a second paid invoice goes to needs_refund instead

-- A payment row that still matters at Stripe cannot be deleted, not even by the cascade from a business
-- or account delete: an open, void_pending or uncollectible invoice is still payable (it must be voided
-- first, admin command void_pending), and a needs_refund row is a refund still owed. Deleting it would
-- lose the only link between a later payment or refund and the seller. Settle or void first.
create function private.guard_payment_delete() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.status in ('open', 'void_pending', 'uncollectible', 'needs_refund') then
    raise exception 'payment_unsettled';
  end if;
  return old;
end $$;
revoke execute on function private.guard_payment_delete() from public, anon, authenticated, service_role;
create trigger promotion_payments_guard_delete
  before delete on public.promotion_payments
  for each row execute function private.guard_payment_delete();

-- -- 7. Webhook idempotency and audit ---------------------------------------------------
create table public.stripe_events (
  event_id    text primary key check (event_id ~ '^evt_[A-Za-z0-9]+$'),
  type        text not null,
  livemode    boolean not null,
  received_at timestamptz not null default now(),
  outcome     text not null check (outcome in ('applied', 'ignored', 'refund_requested', 'mismatch'))
);

-- -- 8. Closed tables: no policies, no client privileges --------------------------------
alter table public.promotion_payments enable row level security;
alter table public.stripe_events enable row level security;
revoke all on public.promotion_payments from anon, authenticated;
revoke all on public.stripe_events from anon, authenticated;

-- -- 9. Rate-limit kind for invoicing (10 calls per promotion per hour) --------------------
alter table public.map_rate_limits drop constraint map_rate_limits_kind_check;
alter table public.map_rate_limits
  add constraint map_rate_limits_kind_check
  check (kind in ('pins', 'details', 'homemade_pins', 'homemade_details', 'offers', 'promotion_invoice'));

-- -- 10. Functions ---------------------------------------------------------------------------
-- Lock order, in every function below: the promotion row first, then its payment row (no deadlocks).
-- (request_promotion locks the business row before either, as in spec 16.)

-- The seller's view of one campaign, with the derived state. Adds paid and is_free; no invoice id,
-- link, Stripe id or receipt. The price keys stay until spec 16b PR 3 (D15).
create or replace function private.promotion_json(p_promotion_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
           'id', p.id,
           'category', p.category,
           'headline', p.headline,
           'preferred_start', p.preferred_start,
           'state', case p.status
                      when 'approved' then case when now() < p.starts_at then 'scheduled'
                                                when now() < p.ends_at then 'active'
                                                else 'ended' end
                      when 'payment_due' then case when now() < p.pay_by then 'awaiting_payment'
                                                   else 'payment_expired' end
                      else p.status end,
           'starts_at', p.starts_at,
           'ends_at', p.ends_at,
           'reject_reason', p.reject_reason,
           'price_cents', p.price_cents,
           'currency_code', p.currency_code,
           'length_days', p.length_days,
           'paid', p.paid_at is not null,
           'is_free', p.is_free,
           'created_at', p.created_at)
    from public.promotions p
   where p.id = p_promotion_id;
$$;
revoke execute on function private.promotion_json(uuid) from public, anon, authenticated, service_role;

-- A campaign's open payment row stops being payable from our side: an open invoice becomes
-- void_pending (voided at Stripe by the admin command void_pending, D16); a reserved row with no
-- invoice yet becomes void, so attach_invoice refuses it and nothing is finalized or sent.
-- The caller has already locked the promotion row.
create function private.void_open_payment(p_promotion_id uuid) returns void
language sql security definer set search_path = '' as $$
  update public.promotion_payments
     set status = case status when 'reserved' then 'void' else 'void_pending' end,
         updated_at = now()
   where promotion_id = p_promotion_id
     and status in ('reserved', 'open');
$$;
revoke execute on function private.void_open_payment(uuid) from public, anon, authenticated, service_role;

-- Stops a campaign after a full refund ('refunded') or a dispute ('cancelled' by admin). The window is
-- kept as history; ends_at is cut to now only when the campaign has already started, so
-- promotions_window_order (ends_at > starts_at) always holds. The status change alone already takes it
-- off the maps and Offers. The caller has already locked the promotion row.
create function private.stop_promotion(p_promotion_id uuid, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_status not in ('refunded', 'cancelled') then
    raise exception 'invalid_status';
  end if;
  update public.promotions
     set status       = p_status,
         ends_at      = case when starts_at < now() and now() < ends_at then now() else ends_at end,
         refunded_at  = case when p_status = 'refunded' then now() else refunded_at end,
         cancelled_by = case when p_status = 'cancelled' then 'admin' else cancelled_by end,
         cancelled_at = case when p_status = 'cancelled' then now() else cancelled_at end
   where id = p_promotion_id;
end $$;
revoke execute on function private.stop_promotion(uuid, text) from public, anon, authenticated, service_role;

-- The refund the webhook must make, while the payment is still needs_refund (D12); null otherwise.
create function private.refund_target(p_payment_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('refund', jsonb_build_object('payment_id', r.id,
                                                         'payment_intent_id', r.payment_intent_id))
    from public.promotion_payments r
   where r.id = p_payment_id
     and r.status = 'needs_refund';
$$;
revoke execute on function private.refund_target(uuid) from public, anon, authenticated, service_role;

-- -- request_promotion (replaced, same signature) ------------------------------------------
-- As spec 16, plus: under the business lock the caller's own lapsed payment_due row is first stored
-- as payment_expired (so promotions_one_request frees up), and a payment_due row within pay_by counts
-- as open (already_open).
create or replace function public.request_promotion(p_category text, p_headline text, p_preferred_start date)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c_ctrl   constant text := '[\x00-\x09\x0B-\x1F\u007F-\u009F\u200B-\u200D\u202A-\u202E\u2066-\u2069\uFEFF]';
  c_edge   constant text := '^[ \n\u00A0\u115F\u1160\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\u3164\uFFA0]+|[ \n\u00A0\u115F\u1160\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\u3164\uFFA0]+$';
  c_mail   constant text := '[a-z0-9._%+-]+[ \u00A0\u2000-\u200A\u202F\u3000]*[@\uFF20][ \u00A0\u2000-\u200A\u202F\u3000]*[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}';
  c_sep    constant text := '[][ \n\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000.()/_,+-]';
  c_daily  constant integer := 5;
  v_uid      uuid := auth.uid();
  v_today    date := (now() at time zone 'UTC')::date;
  v_business uuid;
  s          public.promotion_settings;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  select b.id into v_business from public.businesses b where b.owner_id = v_uid for update;
  if v_business is null or not private.business_can_promote(v_business) then
    raise exception 'not_eligible';
  end if;

  select * into s from public.promotion_settings;
  if not found then
    raise exception 'not_configured';
  end if;

  if p_category is null or p_category not in ('new_dish', 'special_offer', 'featured') then
    raise exception 'invalid_category';
  end if;
  if p_headline is null or char_length(p_headline) not between 1 and 60
     or p_headline ~ c_ctrl or p_headline ~ c_edge or p_headline ~ '[\n\r]'
     or p_headline ~* c_mail or regexp_replace(p_headline, c_sep, '', 'g') ~ '[0-9]{10,}' then
    raise exception 'invalid_headline';
  end if;
  if p_preferred_start is not null
     and (p_preferred_start < v_today - 1 or p_preferred_start > v_today + 90) then
    raise exception 'invalid_start';
  end if;

  -- The lapsed payment window is stored now (reads never write). Its open invoice, if any, is voided
  -- at Stripe by the admin command void_pending (list_invoices_to_void lists it by pay_by).
  update public.promotions
     set status = 'payment_expired'
   where business_id = v_business
     and status = 'payment_due'
     and pay_by <= now();

  if exists (select 1 from public.promotions p
              where p.business_id = v_business
                and (p.status = 'requested'
                     or (p.status = 'payment_due' and p.pay_by > now())
                     or (p.status = 'approved' and p.ends_at > now()))) then
    raise exception 'already_open';
  end if;

  if (select count(*) from public.promotions p
       where p.business_id = v_business and p.created_at > now() - interval '24 hours') >= c_daily then
    raise exception 'too_many_requests';
  end if;

  begin
    insert into public.promotions (business_id, category, headline, preferred_start,
                                   price_cents, currency_code, length_days)
    values (v_business, p_category, p_headline, p_preferred_start,
            s.price_cents, s.currency_code, s.length_days);
  exception when unique_violation then
    raise exception 'already_open';
  end;

  return public.get_my_promotion();
end $$;
revoke execute on function public.request_promotion(text, text, date) from public, anon, authenticated;
grant execute on function public.request_promotion(text, text, date) to authenticated;

-- -- cancel_my_promotion (replaced, same signature) ------------------------------------------
-- The caller's own requested or awaiting_payment campaign, and a free (is_free) scheduled or active
-- one as in spec 16. A paid campaign cannot be ended from the app: contact_support ("Contact us to
-- cancel"). Cancelling while payment is due makes the payment row void_pending (or void, if no invoice
-- exists yet). Someone else's id and an unknown id give the same answer.
create or replace function public.cancel_my_promotion(p_promotion_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  p        public.promotions;
  v_state  text;
begin
  select pr.* into p
    from public.promotions pr
    join public.businesses b on b.id = pr.business_id
   where pr.id = p_promotion_id
     and b.owner_id = auth.uid()
     for update of pr;
  if not found then
    raise exception 'not_found';
  end if;

  v_state := private.promotion_json(p.id) ->> 'state';
  if v_state in ('scheduled', 'active') and not p.is_free then
    raise exception 'contact_support';
  end if;
  if v_state not in ('requested', 'awaiting_payment', 'scheduled', 'active') then
    raise exception 'not_cancellable';
  end if;

  update public.promotions
     set status = 'cancelled', cancelled_by = 'seller', cancelled_at = now()
   where id = p.id;
  perform private.void_open_payment(p.id);

  return public.get_my_promotion();
end $$;
revoke execute on function public.cancel_my_promotion(uuid) from public, anon, authenticated;
grant execute on function public.cancel_my_promotion(uuid) to authenticated;

-- -- admin_review_promotion (replaced, same signature; database owner only) ------------------
-- See docs/runbooks/promotions-admin.md.
--   approve_headline (requested): locks price, currency and length again from promotion_settings and
--                    opens a 7-day payment window (payment_due). The campaign starts only when paid.
--   approve          (requested): spec 16, a free campaign (is_free) with a start time, no payment.
--   reject           (requested or payment_due): with a reason; an open payment row is voided.
--   cancel           (requested, payment_due, scheduled, active): an open payment row is voided. A paid
--                    campaign is cancelled WITHOUT a refund: refund in the Stripe dashboard first.
create or replace function private.admin_review_promotion(
  p_promotion_id  uuid,
  p_decision      text,
  p_starts_at     timestamptz default null,
  p_reject_reason text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  p        public.promotions;
  s        public.promotion_settings;
  v_state  text;
begin
  select * into p from public.promotions where id = p_promotion_id for update;
  if not found then
    raise exception 'not_found';
  end if;
  v_state := private.promotion_json(p.id) ->> 'state';

  if p_decision = 'approve_headline' and p.status = 'requested' then
    select * into s from public.promotion_settings;
    if not found then
      raise exception 'not_configured';
    end if;
    update public.promotions
       set status = 'payment_due', price_cents = s.price_cents, currency_code = s.currency_code,
           length_days = s.length_days, pay_by = now() + interval '7 days', reviewed_at = now()
     where id = p.id;
  elsif p_decision = 'approve' and p.status = 'requested' then
    if p_starts_at is null or p_starts_at < now() - interval '1 hour' then
      raise exception 'invalid_start';
    end if;
    begin
      update public.promotions
         set status = 'approved', is_free = true, starts_at = p_starts_at,
             ends_at = p_starts_at + make_interval(days => p.length_days), reviewed_at = now()
       where id = p.id;
    exception when exclusion_violation then
      raise exception 'overlap';
    end;
  elsif p_decision = 'reject' and p.status in ('requested', 'payment_due') then
    if p_reject_reason is null or p_reject_reason not in ('headline', 'not_paid', 'not_eligible', 'other') then
      raise exception 'invalid_reason';
    end if;
    update public.promotions
       set status = 'rejected', reject_reason = p_reject_reason, reviewed_at = now()
     where id = p.id;
    perform private.void_open_payment(p.id);
  elsif p_decision = 'cancel' and (p.status in ('requested', 'payment_due') or v_state in ('scheduled', 'active')) then
    update public.promotions
       set status = 'cancelled', cancelled_by = 'admin', cancelled_at = now(), reviewed_at = now()
     where id = p.id;
    perform private.void_open_payment(p.id);
  else
    raise exception 'invalid_transition';
  end if;

  return (select jsonb_build_object('id', x.j -> 'id', 'state', x.j -> 'state',
                                    'starts_at', x.j -> 'starts_at', 'ends_at', x.j -> 'ends_at')
            from (select private.promotion_json(p.id) as j) x);
end $$;
revoke execute on function private.admin_review_promotion(uuid, text, timestamptz, text)
  from public, anon, authenticated, service_role;

-- -- begin_promotion_invoice (service_role: the admin Edge Function promotion-invoice) ---------
-- Looks up the business and owner itself. The promotion must be payment_due with at least 1 hour left
-- before pay_by, in CAD. At most 10 calls per promotion per hour (map_rate_limits, key promo:<id>).
-- Answers:
--   { already_sent: true, invoice_status: 'sent' }  the invoice was already sent;
--   { resume: true|false, payment_id, owner_id, business_name, amount_cents, currency, length_days,
--     pay_by, customer_id, invoice_id }             a new reservation (resume false, ids null) or the
--                                                   open/reserved row of a run that stopped half-way
--                                                   (resume true; same payment id, so the same Stripe
--                                                   idempotency keys). A reserved row never expires.
-- Errors: not_found, not_payable, payment_window_closed, not_configured, rate_limited.
create function public.begin_promotion_invoice(p_promotion_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c_hourly constant integer := 10;
  p        public.promotions;
  r        public.promotion_payments;
  v_calls  integer;
  v_owner  uuid;
  v_name   text;
  v_resume boolean;
begin
  select * into p from public.promotions where id = p_promotion_id for update;
  if not found then
    raise exception 'not_found';
  end if;

  insert into public.map_rate_limits (caller_key, kind, window_start, calls)
  values ('promo:' || p.id::text, 'promotion_invoice', date_trunc('hour', now(), 'UTC'), 1)
  on conflict (caller_key, kind, window_start)
    do update set calls = public.map_rate_limits.calls + 1
  returning calls into v_calls;
  if v_calls > c_hourly then
    raise exception 'rate_limited';
  end if;

  if p.status <> 'payment_due' then
    raise exception 'not_payable';
  end if;

  select * into r
    from public.promotion_payments
   where promotion_id = p.id and status in ('reserved', 'open', 'void_pending')
     for update;
  if r.id is not null and r.status = 'open' and r.invoice_sent_at is not null then
    return jsonb_build_object('already_sent', true, 'invoice_status', 'sent');
  end if;

  if p.pay_by - now() < interval '1 hour' then
    raise exception 'payment_window_closed';
  end if;
  if p.currency_code <> 'CAD' then
    raise exception 'not_configured';
  end if;
  if r.id is not null and r.status = 'void_pending' then
    raise exception 'not_payable';      -- not expected: void_pending only follows a cancel or a reject
  end if;

  select b.owner_id, b.name into v_owner, v_name from public.businesses b where b.id = p.business_id;

  v_resume := r.id is not null;
  if not v_resume then
    insert into public.promotion_payments (promotion_id, amount_cents, currency_code)
    values (p.id, p.price_cents, p.currency_code)
    returning * into r;
  end if;

  return jsonb_build_object(
    'resume', v_resume,
    'payment_id', r.id,
    'owner_id', v_owner,
    'business_name', v_name,
    'amount_cents', r.amount_cents,
    'currency', r.currency_code,
    'length_days', p.length_days,
    'pay_by', p.pay_by,
    'customer_id', r.customer_id,
    'invoice_id', r.invoice_id);
end $$;
revoke execute on function public.begin_promotion_invoice(uuid) from public, anon, authenticated;
grant execute on function public.begin_promotion_invoice(uuid) to service_role;

-- -- attach_invoice (service_role) -----------------------------------------------------------
-- reserved -> open with the Stripe Customer, the draft invoice and its livemode (D11). Any other status
-- (for example void after a cancel) gives not_attachable, so the caller stops before finalize or send.
create function public.attach_invoice(p_payment_id uuid, p_customer_id text, p_invoice_id text, p_livemode boolean)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_promotion uuid;
  r           public.promotion_payments;
begin
  if p_customer_id is null or p_customer_id !~ '^cus_[A-Za-z0-9]+$'
     or p_invoice_id is null or p_invoice_id !~ '^in_[A-Za-z0-9]+$'
     or p_livemode is null then
    raise exception 'invalid_id';
  end if;

  select x.promotion_id into v_promotion from public.promotion_payments x where x.id = p_payment_id;
  if v_promotion is null then
    raise exception 'not_found';
  end if;
  perform 1 from public.promotions where id = v_promotion for update;
  select * into r from public.promotion_payments where id = p_payment_id for update;
  if r.status <> 'reserved' then
    raise exception 'not_attachable';
  end if;

  update public.promotion_payments
     set status = 'open', customer_id = p_customer_id, invoice_id = p_invoice_id,
         livemode = p_livemode, updated_at = now()
   where id = r.id;
  return jsonb_build_object('ok', true);
end $$;
revoke execute on function public.attach_invoice(uuid, text, text, boolean) from public, anon, authenticated;
grant execute on function public.attach_invoice(uuid, text, text, boolean) to service_role;

-- -- mark_invoice_sent (service_role) ----------------------------------------------------------
-- After Stripe accepted the send call. True when an open, unsent row was marked.
create function public.mark_invoice_sent(p_payment_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_promotion uuid;
begin
  select x.promotion_id into v_promotion from public.promotion_payments x where x.id = p_payment_id;
  if v_promotion is null then
    return false;
  end if;
  perform 1 from public.promotions where id = v_promotion for update;
  update public.promotion_payments
     set invoice_sent_at = now(), updated_at = now()
   where id = p_payment_id and status = 'open' and invoice_sent_at is null;
  return found;
end $$;
revoke execute on function public.mark_invoice_sent(uuid) from public, anon, authenticated;
grant execute on function public.mark_invoice_sent(uuid) to service_role;

-- -- list_invoices_to_void (service_role) --------------------------------------------------------
-- The invoices that should no longer be paid: every void_pending row, plus open or uncollectible rows
-- whose payment window has passed. Oldest first, at most 100: [{ payment_id, invoice_id }].
create function public.list_invoices_to_void() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('payment_id', x.id, 'invoice_id', x.invoice_id)
                            order by x.created_at, x.id), '[]'::jsonb)
    from (select r.id, r.invoice_id, r.created_at
            from public.promotion_payments r
            join public.promotions p on p.id = r.promotion_id
           where r.status = 'void_pending'
              or (r.status in ('open', 'uncollectible') and p.pay_by <= now())
           order by r.created_at, r.id
           limit 100) x;
$$;
revoke execute on function public.list_invoices_to_void() from public, anon, authenticated;
grant execute on function public.list_invoices_to_void() to service_role;

-- -- mark_invoice_void (service_role) --------------------------------------------------------------
-- After Stripe accepted the void call. True when an open, void_pending or uncollectible row became void.
create function public.mark_invoice_void(p_payment_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_promotion uuid;
begin
  select x.promotion_id into v_promotion from public.promotion_payments x where x.id = p_payment_id;
  if v_promotion is null then
    return false;
  end if;
  perform 1 from public.promotions where id = v_promotion for update;
  update public.promotion_payments
     set status = 'void', updated_at = now()
   where id = p_payment_id and status in ('open', 'void_pending', 'uncollectible');
  return found;
end $$;
revoke execute on function public.mark_invoice_void(uuid) from public, anon, authenticated;
grant execute on function public.mark_invoice_void(uuid) to service_role;

-- -- mark_refund_requested (service_role) ------------------------------------------------------
-- needs_refund -> refund_requested, only after Stripe accepted the refund call (D12).
create function public.mark_refund_requested(p_payment_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_promotion uuid;
begin
  select x.promotion_id into v_promotion from public.promotion_payments x where x.id = p_payment_id;
  if v_promotion is null then
    return false;
  end if;
  perform 1 from public.promotions where id = v_promotion for update;
  update public.promotion_payments
     set status = 'refund_requested', updated_at = now()
   where id = p_payment_id and status = 'needs_refund';
  return found;
end $$;
revoke execute on function public.mark_refund_requested(uuid) from public, anon, authenticated;
grant execute on function public.mark_refund_requested(uuid) to service_role;

-- -- record_stripe_event (service_role: the stripe-webhook Edge Function, after the signature) ----
-- p_data, built by the webhook from the verified event:
--   invoice.paid                   { invoice_id, payment_intent_id, amount_paid, currency, paid_at }
--                                  (paid_at: Stripe's paid time in Unix seconds)
--   invoice.voided                 { invoice_id }
--   invoice.marked_uncollectible   { invoice_id }
--   charge.refunded                { payment_intent_id, amount_refunded, refunded }  (refunded: fully)
--   charge.dispute.created         { payment_intent_id }
-- Raises invalid_event_data (the webhook answers 500 and Stripe retries) when an invoice.paid names OUR
-- invoice but carries a missing or malformed payment_intent_id or amount_paid, or a paid_at more than
-- 5 minutes ahead; nothing is stored. Unknown invoices and PaymentIntents are 'mismatch' (not ours).
-- Answer: { outcome } where outcome is applied, ignored, refund_requested, mismatch or duplicate, plus
-- { refund: { payment_id, payment_intent_id } } while the payment named is still needs_refund (D12),
-- also on a duplicate. Event ids are idempotent (D3); every change also checks the current state.
create function public.record_stripe_event(p_event_id text, p_type text, p_livemode boolean, p_data jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_known    boolean := p_type in ('invoice.paid', 'invoice.voided', 'invoice.marked_uncollectible',
                                   'charge.refunded', 'charge.dispute.created');
  v_payment  uuid;
  v_promo    uuid;
  v_new      text;
  v_outcome  text;
  p          public.promotions;
  r          public.promotion_payments;
  v_pi       text;
  v_amount   bigint;
  v_paid_at  timestamptz;
  v_start    timestamptz;
  v_ok       boolean;
  v_full     boolean;
  v_cents    integer;
begin
  if p_event_id is null or p_event_id !~ '^evt_[A-Za-z0-9]+$' or p_type is null or p_livemode is null
     or p_data is null or jsonb_typeof(p_data) <> 'object' then
    raise exception 'invalid_event';
  end if;

  -- The payment this event names (read without a lock; locked below in the fixed order).
  if p_type in ('invoice.paid', 'invoice.voided', 'invoice.marked_uncollectible') then
    select x.id, x.promotion_id into v_payment, v_promo
      from public.promotion_payments x where x.invoice_id = p_data ->> 'invoice_id';
  elsif p_type in ('charge.refunded', 'charge.dispute.created') then
    select x.id, x.promotion_id into v_payment, v_promo
      from public.promotion_payments x where x.payment_intent_id = p_data ->> 'payment_intent_id';
  end if;

  insert into public.stripe_events (event_id, type, livemode, outcome)
  values (p_event_id, p_type, p_livemode, 'ignored')
  on conflict (event_id) do nothing
  returning event_id into v_new;
  if v_new is null then
    -- A replayed event does nothing new, except that a refund still owed is named again (D12).
    return jsonb_build_object('outcome', 'duplicate') || coalesce(private.refund_target(v_payment), '{}'::jsonb);
  end if;

  if v_payment is null then
    v_outcome := case when v_known then 'mismatch' else 'ignored' end;
    update public.stripe_events set outcome = v_outcome where event_id = p_event_id;
    return jsonb_build_object('outcome', v_outcome);
  end if;

  select * into p from public.promotions where id = v_promo for update;
  select * into r from public.promotion_payments where id = v_payment for update;

  -- A test event never touches a live row and the other way round (D11).
  if r.livemode is distinct from p_livemode then
    update public.stripe_events set outcome = 'mismatch' where event_id = p_event_id;
    return jsonb_build_object('outcome', 'mismatch');
  end if;

  v_outcome := 'ignored';

  if p_type = 'invoice.paid' then
    v_pi := p_data ->> 'payment_intent_id';
    -- The invoice is OURS, so the seller may have paid: bad data must not use the event up. Raising
    -- rolls the whole call back, the stripe_events row included, so the webhook answers 500 and
    -- Stripe's retry is processed afresh (not a duplicate). Events for invoices that are not ours
    -- stay 'mismatch' above: the Stripe account may carry other activity, and those must not loop.
    if v_pi is null or v_pi !~ '^pi_[A-Za-z0-9]+$'
       or coalesce(p_data ->> 'amount_paid', '') !~ '^[0-9]{1,12}$' then
      raise exception 'invalid_event_data';
    end if;
    if coalesce(p_data ->> 'currency', '') !~ '^[A-Za-z]{3}$'
       or coalesce(p_data ->> 'paid_at', '') !~ '^[0-9]{1,12}$' then
      update public.stripe_events set outcome = 'mismatch' where event_id = p_event_id;
      return jsonb_build_object('outcome', 'mismatch');
    end if;
    v_amount  := (p_data ->> 'amount_paid')::bigint;
    v_paid_at := to_timestamp((p_data ->> 'paid_at')::bigint);
    -- Stripe's paid time: more than 5 minutes in the future means a clock is off; raise, so the retry
    -- succeeds once the clocks agree (within 5 minutes it is clamped to now). Before our payment row
    -- existed is impossible for this invoice: mismatch.
    if v_paid_at > now() + interval '5 minutes' then
      raise exception 'invalid_event_data';
    end if;
    if v_paid_at < r.created_at - interval '5 minutes' then
      update public.stripe_events set outcome = 'mismatch' where event_id = p_event_id;
      return jsonb_build_object('outcome', 'mismatch');
    end if;
    v_paid_at := least(v_paid_at, now());

    if r.status in ('open', 'void_pending', 'void', 'uncollectible') then
      update public.promotion_payments
         set payment_intent_id = v_pi, paid_at = v_paid_at, updated_at = now()
       where id = r.id;

      -- Honoured only for the open invoice of a campaign still waiting for this money at the moment it
      -- was paid (a late webhook must not refund a payment made in time). payment_expired counts only if
      -- the business has opened nothing newer since.
      v_ok := r.status = 'open'
              and v_amount = r.amount_cents
              and upper(p_data ->> 'currency') = r.currency_code
              and v_paid_at < p.pay_by
              and (p.status = 'payment_due'
                   or (p.status = 'payment_expired'
                       and not exists (select 1 from public.promotions o
                                        where o.business_id = p.business_id and o.id <> p.id
                                          and o.created_at > p.created_at
                                          and o.status in ('requested', 'payment_due', 'approved'))));
      if v_ok then
        -- D2: start at payment, or at the preferred day (00:00 Toronto) if that is later.
        v_start := greatest(now(), coalesce((p.preferred_start::timestamp) at time zone 'America/Toronto', now()));
        begin
          update public.promotions
             set status = 'approved', paid_at = v_paid_at, starts_at = v_start,
                 ends_at = v_start + make_interval(days => p.length_days)
           where id = p.id;
          update public.promotion_payments set status = 'paid', updated_at = now() where id = r.id;
          v_outcome := 'applied';
        exception when exclusion_violation or unique_violation then
          v_ok := false;   -- an overlapping window: refunded rather than shifted (D2, D5)
        end;
      end if;
      if not v_ok then
        update public.promotion_payments set status = 'needs_refund', updated_at = now() where id = r.id;
        v_outcome := 'refund_requested';
      end if;
    end if;

  elsif p_type = 'invoice.voided' then
    if r.status in ('open', 'void_pending', 'uncollectible') then
      update public.promotion_payments set status = 'void', updated_at = now() where id = r.id;
      v_outcome := 'applied';
    end if;

  elsif p_type = 'invoice.marked_uncollectible' then
    if r.status = 'open' then
      update public.promotion_payments set status = 'uncollectible', updated_at = now() where id = r.id;
      v_outcome := 'applied';
    end if;

  elsif p_type = 'charge.refunded' then
    if coalesce(p_data ->> 'amount_refunded', '') !~ '^[0-9]{1,12}$'
       or jsonb_typeof(p_data -> 'refunded') is distinct from 'boolean' then
      update public.stripe_events set outcome = 'mismatch' where event_id = p_event_id;
      return jsonb_build_object('outcome', 'mismatch');
    end if;
    v_full  := (p_data ->> 'refunded')::boolean;
    -- Capped at the locked amount, so a wrong-amount payment can never break refund_le.
    v_cents := least((p_data ->> 'amount_refunded')::bigint, r.amount_cents)::integer;
    if r.status in ('paid', 'partially_refunded') then
      update public.promotion_payments
         set status = case when v_full then 'refunded' else 'partially_refunded' end,
             refunded_cents = greatest(refunded_cents, v_cents), updated_at = now()
       where id = r.id;
      -- Only the payment that activated the campaign can end it; a partial refund is recorded only (D6).
      if v_full and p.status = 'approved' and not p.is_free then
        perform private.stop_promotion(p.id, 'refunded');
      end if;
      v_outcome := 'applied';
    elsif r.status in ('needs_refund', 'refund_requested', 'disputed') then
      -- An automatic refund (or a refund of a disputed charge) changes the payment row only.
      update public.promotion_payments
         set status = case when v_full and r.status <> 'disputed' then 'refunded' else r.status end,
             refunded_cents = greatest(refunded_cents, v_cents), updated_at = now()
       where id = r.id;
      v_outcome := 'applied';
    end if;

  elsif p_type = 'charge.dispute.created' then
    if r.status in ('paid', 'partially_refunded', 'needs_refund', 'refund_requested', 'refunded') then
      update public.promotion_payments set status = 'disputed', updated_at = now() where id = r.id;
      -- A chargeback stops the campaign it paid for (Resolved Q5): stored cancelled by admin.
      if r.status in ('paid', 'partially_refunded') and p.status = 'approved' and not p.is_free then
        perform private.stop_promotion(p.id, 'cancelled');
      end if;
      v_outcome := 'applied';
    end if;
  end if;

  update public.stripe_events set outcome = v_outcome where event_id = p_event_id;
  return jsonb_build_object('outcome', v_outcome) || coalesce(private.refund_target(r.id), '{}'::jsonb);
end $$;
revoke execute on function public.record_stripe_event(text, text, boolean, jsonb) from public, anon, authenticated;
grant execute on function public.record_stripe_event(text, text, boolean, jsonb) to service_role;

comment on function public.cancel_my_promotion(uuid) is
  'Cancel the caller''s requested or awaiting-payment promotion, or a free scheduled or active one (spec 16, 16b).';
comment on function public.begin_promotion_invoice(uuid) is
  'Reserve or resume the one Stripe invoice of a payment_due promotion (spec 16b). service_role only.';
comment on function public.record_stripe_event(text, text, boolean, jsonb) is
  'Apply one verified Stripe event idempotently (spec 16b). service_role only.';
