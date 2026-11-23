-- Spec 16b (PR 1): promotion payment database - new states, closed payment tables, the seven
-- service_role functions, the Stripe event rules (D2, D3, D5, D6, D11, D12) and migration safety.
-- now() is fixed for the whole transaction. All Stripe ids are obvious fakes that match the checks.
begin;
select plan(197);

-- -- Ids ----------------------------------------------------------------------
-- Users ...-1b16-<n>, businesses ...-1b17-<n>, promotions ...-1b18-<n>, payments ...-1b19-<n>.
create function pg_temp.u(n int) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-1b16-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.b(n int) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-1b17-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.p(n int) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-1b18-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.pay(n int) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-1b19-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.inv(n int) returns text language sql immutable as $$
  select 'in_FakeTest' || lpad(n::text, 4, '0') $$;
create function pg_temp.cus(n int) returns text language sql immutable as $$
  select 'cus_FakeTest' || lpad(n::text, 4, '0') $$;
create function pg_temp.pi(n int) returns text language sql immutable as $$
  select 'pi_FakeTest' || lpad(n::text, 4, '0') $$;

create function pg_temp.keys(j jsonb) returns text[] language sql immutable as $$
  select coalesce(array_agg(k order by k collate "C"), array[]::text[]) from jsonb_object_keys(j) k $$;

-- One owner and a listed, fresh restaurant with a map point near the grid point (-30.00, -100.00).
create function pg_temp.mkb(n int) returns void language plpgsql as $$
begin
  insert into auth.users (id, email) values (pg_temp.u(n), 'pay' || n || '@example.test');
  insert into public.businesses (id, owner_id, type, name, cuisine_code, accepts_table_requests,
                                 map_lat, map_lng, public_address, is_listed)
  values (pg_temp.b(n), pg_temp.u(n), 'restaurant', 'Paid place ' || n, 'IT', false,
          -30 + n * 0.0001, -100, n || ' Exact St', true);
  insert into public.business_locations (business_id, place_id, formatted_address, lat, lng, resolved_at, place_status)
  values (pg_temp.b(n), 'plpay' || n, n || ' Exact St', -30 + n * 0.0001, -100, now() - interval '1 day', 'ok');
end $$;

-- One campaign written directly (fixtures only). Promotion n belongs to business n.
create function pg_temp.mkp(n int, st text, s interval default null, e interval default null,
                            payby interval default null, free boolean default false,
                            paid interval default null, cur text default 'CAD', price int default 2500,
                            pref date default null, created interval default '-10 days')
returns void language sql as $$
  insert into public.promotions (id, business_id, category, headline, status, price_cents, currency_code,
                                 length_days, starts_at, ends_at, pay_by, is_free, paid_at, preferred_start,
                                 reject_reason, cancelled_by, cancelled_at, created_at)
  values (pg_temp.p(n), pg_temp.b(n), 'new_dish', 'Paid fixture ' || n, st, price, cur, 7,
          now() + s, now() + e, now() + payby, free, now() + paid, pref,
          case when st = 'rejected' then 'other' end,
          case when st = 'cancelled' then 'admin' end,
          case when st = 'cancelled' then now() - interval '1 day' end,
          now() + created);
$$;

-- One payment row written directly. Reserved rows carry no ids; paid-like rows carry a PaymentIntent.
create function pg_temp.mkpay(n int, promo int, st text, amount int default 2500, live boolean default false,
                              created interval default '-5 days')
returns void language sql as $$
  insert into public.promotion_payments (id, promotion_id, amount_cents, currency_code, status, customer_id,
                                         invoice_id, livemode, invoice_sent_at, payment_intent_id, paid_at,
                                         created_at)
  values (pg_temp.pay(n), pg_temp.p(promo), amount, 'CAD', st,
          case when st <> 'reserved' then pg_temp.cus(n) end,
          case when st <> 'reserved' then pg_temp.inv(n) end,
          case when st <> 'reserved' then live end,
          case when st <> 'reserved' then now() + created end,
          case when st in ('paid', 'partially_refunded', 'needs_refund', 'refund_requested', 'refunded', 'disputed')
               then pg_temp.pi(n) end,
          case when st in ('paid', 'partially_refunded', 'needs_refund', 'refund_requested', 'refunded', 'disputed')
               then now() + created end,
          now() + created);
$$;

-- Stripe events, as the webhook will pass them (PR 2).
create function pg_temp.ev(n int, typ text, d jsonb, live boolean default false) returns jsonb
language sql as $$ select public.record_stripe_event('evt_FakeTest' || lpad(n::text, 4, '0'), typ, live, d) $$;
create function pg_temp.pd(n int, amount int default 2500, cur text default 'cad', at timestamptz default now())
returns jsonb language sql stable as $$
  select jsonb_build_object('invoice_id', pg_temp.inv(n), 'payment_intent_id', pg_temp.pi(n),
                            'amount_paid', amount, 'currency', cur,
                            'paid_at', floor(extract(epoch from at))::bigint) $$;
create function pg_temp.rd(n int, amount int, full_refund boolean) returns jsonb language sql immutable as $$
  select jsonb_build_object('payment_intent_id', pg_temp.pi(n), 'amount_refunded', amount, 'refunded', full_refund) $$;
create function pg_temp.dd(n int) returns jsonb language sql immutable as $$
  select jsonb_build_object('payment_intent_id', pg_temp.pi(n)) $$;
create function pg_temp.vd(n int) returns jsonb language sql immutable as $$
  select jsonb_build_object('invoice_id', pg_temp.inv(n)) $$;

create function pg_temp.as_user(n int) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', pg_temp.u(n)), true);
end $$;
create function pg_temp.pstate(n int) returns text language sql stable as $$
  select private.promotion_json(pg_temp.p(n)) ->> 'state' $$;
create function pg_temp.pstatus(n int) returns text language sql stable as $$
  select status from public.promotions where id = pg_temp.p(n) $$;
create function pg_temp.paystatus(n int) returns text language sql stable as $$
  select status from public.promotion_payments where id = pg_temp.pay(n) $$;
create function pg_temp.promoted(n int) returns boolean language sql as $$
  select coalesce((select (x ->> 'promoted')::boolean
                     from jsonb_array_elements(public.map_restaurants_in_bounds(-30.1, -29.9, -100.1, -99.9) -> 'pins') x
                    where (x ->> 'id')::uuid = pg_temp.b(n)), false) $$;
create function pg_temp.in_offers(n int) returns boolean language sql as $$
  select exists (select 1 from jsonb_array_elements(public.list_offers_near(-30, -100, 5, null, null, null, null) -> 'offers') o
                  where (o ->> 'business_id')::uuid = pg_temp.b(n)) $$;

-- -- Fixtures (as postgres) -------------------------------------------------------
select pg_temp.mkb(n) from generate_series(1, 52) n;

select pg_temp.mkp(1, 'requested', price => 2000);                                      -- full happy path
select pg_temp.mkp(2, 'payment_due', payby => '7 days', pref => (now() at time zone 'UTC')::date + 3);
select pg_temp.mkp(3, 'approved', '-1 day', '6 days', paid => '-1 day');                 -- paid, started
select pg_temp.mkp(4, 'approved', '2 days', '9 days', paid => '-1 day');                 -- paid, scheduled
select pg_temp.mkp(5, 'approved', '-1 day', '6 days', paid => '-1 day');                 -- dispute, started
select pg_temp.mkp(6, 'approved', '2 days', '9 days', paid => '-1 day');                 -- dispute, scheduled
select pg_temp.mkp(n, 'payment_due', payby => '7 days') from generate_series(7, 8) n;    -- wrong amount, currency
select pg_temp.mkp(n, 'payment_due', payby => '-1 day') from generate_series(9, 10) n;   -- late webhook
select pg_temp.mkp(n, 'payment_due', payby => '7 days') from generate_series(11, 12) n;  -- bad paid_at
select pg_temp.mkp(13, 'cancelled');                                                     -- void_pending paid
select pg_temp.mkp(n, 'payment_due', payby => '7 days') from generate_series(14, 16) n;  -- livemode, voided, uncollectible
select pg_temp.mkp(n, 'payment_due', payby => '7 days') from generate_series(18, 21) n;  -- cancels and reviews
select pg_temp.mkp(22, 'payment_due', payby => '-1 hour');                                -- lapse then request
select pg_temp.mkp(23, 'payment_due', payby => '7 days');                                 -- request while due
select pg_temp.mkp(24, 'requested');                                                      -- free approve
select pg_temp.mkp(25, 'requested');                                                      -- not_payable
select pg_temp.mkp(26, 'payment_due', payby => '59 minutes');                             -- window closed
select pg_temp.mkp(27, 'payment_due', payby => '7 days', cur => 'USD');                   -- not CAD
select pg_temp.mkp(28, 'payment_due', payby => '7 days');                                 -- rate limit
select pg_temp.mkp(29, 'payment_due', payby => '7 days');                                 -- open, in window
select pg_temp.mkp(30, 'payment_due', payby => '-2 days');                                -- uncollectible, lapsed
select pg_temp.mkp(31, 'payment_due', payby => '7 days');                                 -- dispute on needs_refund
select pg_temp.mkp(32, 'payment_expired', payby => '-1 day');                             -- expired, newer request
select pg_temp.mkp(33, 'requested', created => '-1 day');
select pg_temp.mkp(46, 'payment_expired', payby => '-1 day');                             -- honour rule, no newer request
select pg_temp.mkp(47, 'payment_due', payby => '7 days');                                 -- paid_at before the row
select pg_temp.mkp(48, 'payment_due', payby => '7 days');                                 -- paid_at clamped
select pg_temp.mkp(49, 'payment_due', payby => '7 days');                                 -- delete guard: open
select pg_temp.mkp(50, 'cancelled');                                                      -- delete guard: void
select pg_temp.mkp(51, 'payment_due', payby => '-1 hour');                                -- attach after the window
select pg_temp.mkp(52, 'payment_due', payby => '7 days');                                 -- cancel with uncollectible
update public.promotions set business_id = pg_temp.b(32) where id = pg_temp.p(33);
select pg_temp.mkp(40, 'approved', '-1 day', '6 days', free => true);                     -- free (spec 16) rows
select pg_temp.mkp(41, 'approved', '2 days', '9 days', free => true);
select pg_temp.mkp(42, 'approved', '-10 days', '-3 days', free => true);

select pg_temp.mkpay(2, 2, 'open');
select pg_temp.mkpay(3, 3, 'paid');
select pg_temp.mkpay(4, 4, 'paid');
select pg_temp.mkpay(5, 5, 'paid');
select pg_temp.mkpay(6, 6, 'paid');
select pg_temp.mkpay(n, n, 'open') from generate_series(7, 12) n;
select pg_temp.mkpay(13, 13, 'void_pending');
select pg_temp.mkpay(n, n, 'open') from generate_series(14, 16) n;
select pg_temp.mkpay(18, 18, 'open');
select pg_temp.mkpay(19, 19, 'reserved');
select pg_temp.mkpay(20, 20, 'open');
select pg_temp.mkpay(21, 21, 'open');
select pg_temp.mkpay(29, 29, 'open');
select pg_temp.mkpay(30, 30, 'uncollectible');
select pg_temp.mkpay(31, 31, 'open');
select pg_temp.mkpay(32, 32, 'open');
select pg_temp.mkpay(n, n, 'open') from generate_series(46, 49) n;
select pg_temp.mkpay(50, 50, 'void');
select pg_temp.mkpay(51, 51, 'reserved');
select pg_temp.mkpay(52, 52, 'uncollectible');

-- Settings: this file's own row, independent of seed.sql.
delete from public.promotion_settings;
insert into public.promotion_settings (price_cents, currency_code, length_days) values (2500, 'CAD', 7);
delete from public.map_rate_limits;    -- dev data must not count toward the limits below

-- -- 1. Structure (12) ----------------------------------------------------------------
select is(pg_get_constraintdef((select oid from pg_constraint where conname = 'promotions_status_check'
                                   and conrelid = 'public.promotions'::regclass)),
  'CHECK ((status = ANY (ARRAY[''requested''::text, ''payment_due''::text, ''approved''::text, ''rejected''::text, ''cancelled''::text, ''payment_expired''::text, ''refunded''::text])))',
  'promotions_status_check allows exactly the seven stored statuses');
select has_column('public', 'promotions', 'pay_by', 'promotions has pay_by');
select has_column('public', 'promotions', 'paid_at', 'promotions has paid_at');
select has_column('public', 'promotions', 'refunded_at', 'promotions has refunded_at');
select col_not_null('public', 'promotions', 'is_free', 'promotions.is_free is not null');
select throws_ok($$ insert into public.promotions (business_id, category, headline, status, price_cents, currency_code,
                                                   length_days, starts_at, ends_at)
                   values (pg_temp.b(45), 'new_dish', 'No payment', 'approved', 2500, 'CAD', 7, now(), now() + interval '7 days') $$,
  '23514', null, 'promotions_paid: an approved row needs is_free or paid_at');
select throws_ok($$ insert into public.promotions (business_id, category, headline, status, price_cents, currency_code, length_days)
                   values (pg_temp.b(45), 'new_dish', 'No deadline', 'payment_due', 2500, 'CAD', 7) $$,
  '23514', null, 'promotions_pay_by: a payment_due row needs pay_by');
select matches(pg_get_indexdef('public.promotions_one_request'::regclass),
  'WHERE \(status = ANY \(ARRAY\[''requested''::text, ''payment_due''::text\]\)\)',
  'promotions_one_request now covers requested and payment_due');
select throws_ok($$ insert into public.promotions (business_id, category, headline, status, price_cents, currency_code, length_days, pay_by)
                   values (pg_temp.b(29), 'new_dish', 'Second', 'payment_due', 2500, 'CAD', 7, now() + interval '1 day') $$,
  '23505', null, 'one business cannot hold a requested and a payment_due row at once');
select ok((select relrowsecurity from pg_class where oid = 'public.promotion_payments'::regclass),
  'RLS is enabled on promotion_payments');
select ok((select relrowsecurity from pg_class where oid = 'public.stripe_events'::regclass),
  'RLS is enabled on stripe_events');
select is_empty($$ select 1 from pg_policies where schemaname = 'public'
                     and tablename in ('promotion_payments', 'stripe_events') $$,
  'promotion_payments and stripe_events have no policies');

-- -- 2. Privileges and outsiders (32) ---------------------------------------------------
select is_empty($$ select r, t, a from unnest(array['anon', 'authenticated']) r,
                                       unnest(array['public.promotion_payments', 'public.stripe_events']) t,
                                       unnest(array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger']) a
                    where has_table_privilege(r, t, a) $$,
  'anon and authenticated hold no privilege on promotion_payments or stripe_events');
select is_empty($$ select r, f from unnest(array['anon', 'authenticated']) r,
                    unnest(array['public.begin_promotion_invoice(uuid)', 'public.attach_invoice(uuid, text, text, boolean)',
                                 'public.mark_invoice_sent(uuid)', 'public.list_invoices_to_void()',
                                 'public.mark_invoice_void(uuid)', 'public.record_stripe_event(text, text, boolean, jsonb)',
                                 'public.mark_refund_requested(uuid)', 'public.check_invoice_sendable(uuid)']) f
                    where has_function_privilege(r, f, 'execute') $$,
  'anon and authenticated cannot execute any of the eight service functions');
select is((select count(*)::int from unnest(array['public.begin_promotion_invoice(uuid)',
                                 'public.attach_invoice(uuid, text, text, boolean)', 'public.mark_invoice_sent(uuid)',
                                 'public.list_invoices_to_void()', 'public.mark_invoice_void(uuid)',
                                 'public.record_stripe_event(text, text, boolean, jsonb)',
                                 'public.mark_refund_requested(uuid)', 'public.check_invoice_sendable(uuid)']) f
            where has_function_privilege('service_role', f, 'execute')), 8,
  'service_role can execute all eight service functions');
select ok(not has_function_privilege('service_role', 'private.admin_review_promotion(uuid, text, timestamptz, text)', 'execute'),
  'admin_review_promotion stays database-owner only');
select is_empty($$ select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'private' and p.proname in ('void_open_payment', 'stop_promotion', 'refund_target')
                      and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')
                           or has_function_privilege('service_role', p.oid, 'execute')) $$,
  'the three private payment helpers are executable by no API role');
select is_empty($$ select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public'
                      and p.proname in ('begin_promotion_invoice', 'attach_invoice', 'mark_invoice_sent', 'list_invoices_to_void',
                                        'mark_invoice_void', 'record_stripe_event', 'mark_refund_requested',
                                        'check_invoice_sendable')
                      and (not p.prosecdef or p.proconfig is distinct from array['search_path=""']) $$,
  'every service function is security definer with an empty search_path');

set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok($$ select * from public.promotion_payments $$, '42501', null, 'anon cannot read promotion_payments');
select throws_ok($$ insert into public.promotion_payments (promotion_id, amount_cents, currency_code) values (pg_temp.p(29), 1, 'CAD') $$,
  '42501', null, 'anon cannot insert a payment');
select throws_ok($$ update public.promotion_payments set status = 'paid' $$, '42501', null, 'anon cannot update a payment');
select throws_ok($$ delete from public.promotion_payments $$, '42501', null, 'anon cannot delete a payment');
select throws_ok($$ select * from public.stripe_events $$, '42501', null, 'anon cannot read stripe_events');
select throws_ok($$ insert into public.stripe_events (event_id, type, livemode, outcome) values ('evt_FakeTest9999', 'x', false, 'ignored') $$,
  '42501', null, 'anon cannot insert an event');
select throws_ok($$ select public.begin_promotion_invoice(pg_temp.p(29)) $$, '42501', null, 'anon cannot call begin_promotion_invoice');
select throws_ok($$ select public.attach_invoice(pg_temp.pay(29), 'cus_FakeTest9999', 'in_FakeTest9999', false) $$, '42501', null,
  'anon cannot call attach_invoice');
select throws_ok($$ select public.mark_invoice_sent(pg_temp.pay(29)) $$, '42501', null, 'anon cannot call mark_invoice_sent');
select throws_ok($$ select public.list_invoices_to_void() $$, '42501', null, 'anon cannot call list_invoices_to_void');
select throws_ok($$ select public.mark_invoice_void(pg_temp.pay(29)) $$, '42501', null, 'anon cannot call mark_invoice_void');
select throws_ok($$ select public.record_stripe_event('evt_FakeTest9999', 'invoice.paid', false, '{}') $$, '42501', null,
  'anon cannot call record_stripe_event');
select throws_ok($$ select public.mark_refund_requested(pg_temp.pay(29)) $$, '42501', null, 'anon cannot call mark_refund_requested');
select throws_ok($$ select public.check_invoice_sendable(pg_temp.pay(29)) $$, '42501', null, 'anon cannot call check_invoice_sendable');
reset role;
set local role authenticated;
select pg_temp.as_user(29);
select throws_ok($$ select * from public.promotion_payments $$, '42501', null, 'authenticated cannot read promotion_payments');
select throws_ok($$ insert into public.promotion_payments (promotion_id, amount_cents, currency_code) values (pg_temp.p(29), 1, 'CAD') $$,
  '42501', null, 'authenticated cannot insert a payment');
select throws_ok($$ update public.promotion_payments set status = 'paid' $$, '42501', null, 'authenticated cannot update a payment');
select throws_ok($$ delete from public.promotion_payments $$, '42501', null, 'authenticated cannot delete a payment');
select throws_ok($$ select * from public.stripe_events $$, '42501', null, 'authenticated cannot read stripe_events');
select throws_ok($$ update public.stripe_events set outcome = 'applied' $$, '42501', null, 'authenticated cannot update an event');
select throws_ok($$ select public.begin_promotion_invoice(pg_temp.p(29)) $$, '42501', null,
  'authenticated cannot execute begin_promotion_invoice');
select throws_ok($$ select public.attach_invoice(pg_temp.pay(29), 'cus_FakeTest9999', 'in_FakeTest9999', false) $$, '42501', null,
  'authenticated cannot call attach_invoice');
select throws_ok($$ select public.mark_invoice_sent(pg_temp.pay(29)) $$, '42501', null, 'authenticated cannot call mark_invoice_sent');
select throws_ok($$ select public.list_invoices_to_void() $$, '42501', null, 'authenticated cannot call list_invoices_to_void');
select throws_ok($$ select public.mark_invoice_void(pg_temp.pay(29)) $$, '42501', null, 'authenticated cannot call mark_invoice_void');
select throws_ok($$ select public.record_stripe_event('evt_FakeTest9999', 'invoice.paid', false, '{}') $$, '42501', null,
  'authenticated cannot call record_stripe_event');
select throws_ok($$ select public.mark_refund_requested(pg_temp.pay(29)) $$, '42501', null,
  'authenticated cannot call mark_refund_requested');
select throws_ok($$ select public.check_invoice_sendable(pg_temp.pay(29)) $$, '42501', null,
  'authenticated cannot call check_invoice_sendable');
select throws_ok($$ update public.promotions set paid_at = now(), status = 'approved' $$, '42501', null,
  'authenticated cannot write the payment fields of promotions');
reset role;
select is(pg_temp.paystatus(29), 'open', 'the outsider calls changed nothing');

-- -- 3. Migration safety: free (spec 16) campaigns read exactly as before (9) ----------------
select is(pg_temp.pstate(40), 'active', 'a free running campaign still reads active');
select is(pg_temp.pstate(41), 'scheduled', 'a free future campaign still reads scheduled');
select is(pg_temp.pstate(42), 'ended', 'a free past campaign still reads ended');
select ok(private.promotion_is_active(pg_temp.b(40)), 'a free running campaign is still active');
select ok(not private.promotion_is_active(pg_temp.b(41)) and not private.promotion_is_active(pg_temp.b(42)),
  'free scheduled and ended campaigns are not active');
select ok(pg_temp.promoted(40), 'a free running campaign is still promoted on the map');
select ok(not pg_temp.promoted(41) and not pg_temp.promoted(42), 'free scheduled and ended campaigns are not promoted');
select ok(pg_temp.in_offers(40), 'a free running campaign is still in Offers');
select is((select count(*)::int from public.promotions where status = 'approved' and not is_free and paid_at is null), 0,
  'no approved row is neither free nor paid');

-- -- 4. list_invoices_to_void and mark_invoice_void, before any event (5) --------------------
select set_eq($$ select (x ->> 'payment_id')::uuid from jsonb_array_elements(public.list_invoices_to_void()) x $$,
  $$ values (pg_temp.pay(9)), (pg_temp.pay(10)), (pg_temp.pay(13)), (pg_temp.pay(30)), (pg_temp.pay(32)), (pg_temp.pay(46)) $$,
  'list_invoices_to_void lists exactly the void_pending rows and the open or uncollectible rows past pay_by');
select is(pg_temp.keys(public.list_invoices_to_void() -> 0), array['invoice_id', 'payment_id'],
  'each listed invoice has exactly payment_id and invoice_id');
select ok(public.mark_invoice_void(pg_temp.pay(30)), 'mark_invoice_void voids an uncollectible lapsed invoice');
select is(pg_temp.paystatus(30), 'void', 'the payment row is void');
select ok(not public.mark_invoice_void(pg_temp.pay(30)), 'marking it again does nothing');

-- -- 4b. Attach and the pre-send check (S3) (6) ---------------------------------------------------
select throws_ok($$ select public.attach_invoice(pg_temp.pay(51), 'cus_FakeTest0051', 'in_FakeTest0051', false) $$,
  'P0001', 'not_attachable', 'attach_invoice refuses a reserved row whose payment window has passed');
select is(pg_temp.paystatus(51), 'reserved', 'the refused attach changed nothing');
select ok(public.check_invoice_sendable(pg_temp.pay(29)), 'check_invoice_sendable: an open invoice within pay_by may be sent');
select ok(not public.check_invoice_sendable(pg_temp.pay(9)), 'check_invoice_sendable: not after pay_by');
select ok(not public.check_invoice_sendable(pg_temp.pay(13)), 'check_invoice_sendable: not after a cancel (void_pending)');
select ok(not public.check_invoice_sendable('00000000-0000-0000-1b19-999999999999'), 'check_invoice_sendable: not for an unknown id');

-- -- 5. The happy path: approve_headline, invoice, paid, refunds (34) -------------------------
create temp table rev1 as select private.admin_review_promotion(pg_temp.p(1), 'approve_headline') as j;
select is((select j ->> 'state' from rev1), 'awaiting_payment', 'approve_headline answers awaiting_payment');
select results_eq(
  $$ select status, price_cents, currency_code, length_days, pay_by = now() + interval '7 days', reviewed_at = now(), is_free
       from public.promotions where id = pg_temp.p(1) $$,
  $$ values ('payment_due'::text, 2500, 'CAD'::text, 7, true, true, false) $$,
  'approve_headline stores payment_due, locks the settings price and opens a 7-day window');
select throws_ok($$ select private.admin_review_promotion(pg_temp.p(1), 'approve_headline') $$, 'P0001', 'invalid_transition',
  'a headline cannot be approved twice');
update public.promotion_settings set price_cents = 9900;
create temp table beg1 as select public.begin_promotion_invoice(pg_temp.p(1)) as j;
select is((select (j ->> 'amount_cents')::int from beg1), 2500,
  'price lock: begin_promotion_invoice uses the locked row price, not the changed settings');
update public.promotion_settings set price_cents = 2500;
select is(pg_temp.keys((select j from beg1)),
  array['amount_cents', 'business_name', 'currency', 'customer_id', 'invoice_id', 'length_days', 'owner_id', 'pay_by',
        'payment_id', 'resume'],
  'a reservation has exactly the documented keys');
select results_eq(
  $$ select (j ->> 'resume')::boolean, (j ->> 'owner_id')::uuid, j ->> 'business_name', j ->> 'currency',
            (j ->> 'length_days')::int, j -> 'customer_id' = 'null'::jsonb from beg1 $$,
  $$ values (false, pg_temp.u(1), 'Paid place 1'::text, 'CAD'::text, 7, true) $$,
  'a new reservation names the owner and business itself, with no Stripe ids yet');
select is((select status from public.promotion_payments where id = (select (j ->> 'payment_id')::uuid from beg1)), 'reserved',
  'the reserved row exists');
select is((select (j ->> 'payment_id')::uuid from (select public.begin_promotion_invoice(pg_temp.p(1)) as j) x),
  (select (j ->> 'payment_id')::uuid from beg1), 'a second call resumes the same reserved payment (no expiry)');
select is((public.begin_promotion_invoice(pg_temp.p(1)) ->> 'resume')::boolean, true, 'and says resume');
select throws_ok($$ select public.attach_invoice((select (j ->> 'payment_id')::uuid from beg1), 'cus_Fake_Bad', 'in_FakeTest0001', false) $$,
  'P0001', 'invalid_id', 'attach_invoice refuses an id that does not match the format');
select is(public.attach_invoice((select (j ->> 'payment_id')::uuid from beg1), pg_temp.cus(1), pg_temp.inv(1), false),
  '{"ok": true}'::jsonb, 'attach_invoice records the customer, the invoice and the livemode');
select results_eq(
  $$ select status, customer_id, invoice_id, livemode from public.promotion_payments
      where id = (select (j ->> 'payment_id')::uuid from beg1) $$,
  $$ values ('open'::text, 'cus_FakeTest0001'::text, 'in_FakeTest0001'::text, false) $$,
  'the row is open with its ids');
select throws_ok($$ select public.attach_invoice((select (j ->> 'payment_id')::uuid from beg1), 'cus_FakeTest0101', 'in_FakeTest0101', false) $$,
  'P0001', 'not_attachable', 'an open row cannot be attached again');
select results_eq(
  $$ select (j ->> 'resume')::boolean, j ->> 'customer_id', j ->> 'invoice_id'
       from (select public.begin_promotion_invoice(pg_temp.p(1)) as j) x $$,
  $$ values (true, 'cus_FakeTest0001'::text, 'in_FakeTest0001'::text) $$,
  'an open, unsent invoice is resumed with its ids');
select ok(public.mark_invoice_sent((select (j ->> 'payment_id')::uuid from beg1)), 'mark_invoice_sent marks it sent');
select ok(not public.mark_invoice_sent((select (j ->> 'payment_id')::uuid from beg1)), 'marking it sent again does nothing');
select is(public.begin_promotion_invoice(pg_temp.p(1)), '{"already_sent": true, "invoice_status": "sent"}'::jsonb,
  'a call after sending answers already_sent and never creates a second invoice');
select is((select count(*)::int from public.promotion_payments where promotion_id = pg_temp.p(1)), 1,
  'one campaign, one payment row');

select is(pg_temp.ev(101, 'invoice.paid', pg_temp.pd(1)), '{"outcome": "applied"}'::jsonb,
  'a matching invoice.paid is applied');
select results_eq(
  $$ select status, paid_at is not null, starts_at = now(), ends_at = now() + interval '7 days', is_free
       from public.promotions where id = pg_temp.p(1) $$,
  $$ values ('approved'::text, true, true, true, false) $$,
  'the campaign is approved, paid and starts at payment (no preferred start, D2)');
select is((select status || '|' || payment_intent_id from public.promotion_payments where promotion_id = pg_temp.p(1)),
  'paid|pi_FakeTest0001', 'the payment is paid with its PaymentIntent');
select ok(private.promotion_is_active(pg_temp.b(1)) and pg_temp.promoted(1) and pg_temp.in_offers(1),
  'a paid campaign is active, promoted and in Offers');
select is((select outcome from public.stripe_events where event_id = 'evt_FakeTest0101'), 'applied',
  'the event is recorded as applied');
select is(pg_temp.ev(101, 'invoice.paid', pg_temp.pd(1)), '{"outcome": "duplicate"}'::jsonb,
  'a duplicate event id changes nothing');
select is((select count(*)::int from public.stripe_events where event_id = 'evt_FakeTest0101'), 1,
  'the duplicate stored no second event row');
select pg_temp.as_user(1);
select throws_ok($$ select public.cancel_my_promotion(pg_temp.p(1)) $$, 'P0001', 'contact_support',
  'a seller cannot cancel a paid campaign (contact_support)');
select is(pg_temp.ev(102, 'charge.refunded', pg_temp.rd(1, 1000, false)), '{"outcome": "applied"}'::jsonb,
  'a partial refund is recorded');
select results_eq(
  $$ select r.status, r.refunded_cents, p.status from public.promotion_payments r join public.promotions p on p.id = r.promotion_id
      where r.promotion_id = pg_temp.p(1) $$,
  $$ values ('partially_refunded'::text, 1000, 'approved'::text) $$,
  'a partial refund is recorded on the payment only; the campaign keeps running');
select ok(private.promotion_is_active(pg_temp.b(1)), 'the partially refunded campaign is still active');
select is(pg_temp.ev(103, 'charge.refunded', pg_temp.rd(1, 2500, true)), '{"outcome": "applied"}'::jsonb,
  'a full refund is applied');
select results_eq(
  $$ select r.status, r.refunded_cents, p.status, p.refunded_at = now() from public.promotion_payments r
       join public.promotions p on p.id = r.promotion_id where r.promotion_id = pg_temp.p(1) $$,
  $$ values ('refunded'::text, 2500, 'refunded'::text, true) $$,
  'a full refund marks the payment and the campaign refunded');
select ok(not private.promotion_is_active(pg_temp.b(1)) and not pg_temp.promoted(1) and not pg_temp.in_offers(1),
  'a refunded campaign is not active, not promoted and not in Offers');

-- -- 6. Preferred start, refunds and disputes on started and scheduled campaigns (16) ---------
select is(pg_temp.ev(201, 'invoice.paid', pg_temp.pd(2)) ->> 'outcome', 'applied', 'a paid campaign with a preferred day');
select results_eq(
  $$ select status, starts_at, ends_at from public.promotions where id = pg_temp.p(2) $$,
  $$ select 'approved'::text, ((now() at time zone 'UTC')::date + 3)::timestamp at time zone 'America/Toronto',
            ((now() at time zone 'UTC')::date + 3)::timestamp at time zone 'America/Toronto' + interval '7 days' $$,
  'it starts at 00:00 Toronto on the preferred day (D2)');
select is(pg_temp.pstate(2), 'scheduled', 'and reads scheduled');
select is(pg_temp.ev(301, 'charge.refunded', pg_temp.rd(3, 2500, true)) ->> 'outcome', 'applied', 'full refund, started campaign');
select results_eq(
  $$ select status, starts_at = now() - interval '1 day', ends_at = now() from public.promotions where id = pg_temp.p(3) $$,
  $$ values ('refunded'::text, true, true) $$,
  'a started refunded campaign stops now: ends_at is cut, starts_at kept');
select ok(not pg_temp.promoted(3) and not pg_temp.in_offers(3)
          and not (public.get_restaurant_details(pg_temp.b(3)) ->> 'sponsored')::boolean,
  'a refunded campaign is not promoted, not in Offers and not sponsored');
select is(pg_temp.ev(401, 'charge.refunded', pg_temp.rd(4, 2500, true)) ->> 'outcome', 'applied', 'full refund, scheduled campaign');
select results_eq(
  $$ select status, starts_at = now() + interval '2 days', ends_at = now() + interval '9 days' from public.promotions where id = pg_temp.p(4) $$,
  $$ values ('refunded'::text, true, true) $$,
  'a scheduled refunded campaign keeps its window as history (window order holds)');
select is(pg_temp.ev(501, 'charge.dispute.created', pg_temp.dd(5)) ->> 'outcome', 'applied', 'a dispute on a started campaign');
select results_eq(
  $$ select p.status, p.cancelled_by, p.cancelled_at = now(), p.ends_at = now(), r.status
       from public.promotions p join public.promotion_payments r on r.promotion_id = p.id where p.id = pg_temp.p(5) $$,
  $$ values ('cancelled'::text, 'admin'::text, true, true, 'disputed'::text) $$,
  'a dispute stops a started campaign: cancelled by admin now, the payment disputed');
select ok(not private.promotion_is_active(pg_temp.b(5)) and not pg_temp.promoted(5) and not pg_temp.in_offers(5),
  'a disputed campaign is not active, not promoted and not in Offers');
select is(pg_temp.ev(601, 'charge.dispute.created', pg_temp.dd(6)) ->> 'outcome', 'applied', 'a dispute on a scheduled campaign');
select results_eq(
  $$ select status, cancelled_by, ends_at = now() + interval '9 days' from public.promotions where id = pg_temp.p(6) $$,
  $$ values ('cancelled'::text, 'admin'::text, true) $$,
  'a disputed scheduled campaign is cancelled and keeps its window');
select pg_temp.as_user(3);
select is(public.get_my_promotion() -> 'promotion' ->> 'state', 'refunded', 'the seller of a refunded campaign sees refunded');
select pg_temp.as_user(5);
select is(public.get_my_promotion() -> 'promotion' ->> 'state', 'cancelled', 'the seller of a disputed campaign sees cancelled');
select pg_temp.as_user(2);
select is((public.get_my_promotion() -> 'promotion' ->> 'paid')::boolean, true, 'a paid campaign reads paid');

-- -- 7. Payments that cannot be honoured, and refund targets (D5, D12) (18) --------------------
select is(pg_temp.ev(701, 'invoice.paid', pg_temp.pd(7, 2400)),
  jsonb_build_object('outcome', 'refund_requested',
                     'refund', jsonb_build_object('payment_id', pg_temp.pay(7), 'payment_intent_id', 'pi_FakeTest0007')),
  'invoice.paid with a wrong amount does not activate and names the refund');
select results_eq($$ select pg_temp.pstatus(7), pg_temp.paystatus(7) $$, $$ values ('payment_due'::text, 'needs_refund'::text) $$,
  'the campaign stays payment_due and the payment needs a refund');
select is(pg_temp.ev(701, 'invoice.paid', pg_temp.pd(7, 2400)),
  jsonb_build_object('outcome', 'duplicate',
                     'refund', jsonb_build_object('payment_id', pg_temp.pay(7), 'payment_intent_id', 'pi_FakeTest0007')),
  'D12 duplicate returns the refund target while the payment is needs_refund');
select is(pg_temp.ev(702, 'invoice.voided', pg_temp.vd(7)) -> 'refund' ->> 'payment_intent_id', 'pi_FakeTest0007',
  'D12 a later event for a needs_refund payment returns the refund target too');
select is(pg_temp.paystatus(7), 'needs_refund', 'a later event does not clear needs_refund');
select ok(public.mark_refund_requested(pg_temp.pay(7)), 'mark_refund_requested after Stripe accepted the refund');
select is(pg_temp.paystatus(7), 'refund_requested', 'the payment is refund_requested');
select is(pg_temp.ev(701, 'invoice.paid', pg_temp.pd(7, 2400)), '{"outcome": "duplicate"}'::jsonb,
  'no target after mark_refund_requested: a duplicate no longer names the refund');
select ok(not public.mark_refund_requested(pg_temp.pay(7)), 'mark_refund_requested twice does nothing');
select is(pg_temp.ev(703, 'charge.refunded', pg_temp.rd(7, 2400, true)) ->> 'outcome', 'applied', 'the automatic refund arrives');
select results_eq($$ select pg_temp.pstatus(7), pg_temp.paystatus(7) $$, $$ values ('payment_due'::text, 'refunded'::text) $$,
  'an automatic refund changes only the payment row');
select is(pg_temp.ev(801, 'invoice.paid', pg_temp.pd(8, 2500, 'usd')) ->> 'outcome', 'refund_requested',
  'invoice.paid in the wrong currency does not activate');
select is(pg_temp.pstatus(8), 'payment_due', 'the wrong-currency campaign stays payment_due');
select is(pg_temp.ev(1301, 'invoice.paid', pg_temp.pd(13)) ->> 'outcome', 'refund_requested',
  'a payment on a void_pending invoice (after a cancel) is refunded');
select is(pg_temp.pstatus(13), 'cancelled', 'the cancelled campaign stays cancelled');
select is(pg_temp.ev(3201, 'invoice.paid', pg_temp.pd(32, 2500, 'cad', now() - interval '2 days')) ->> 'outcome', 'refund_requested',
  'a payment in time on an expired campaign whose business opened a newer request is refunded');
select is(pg_temp.ev(3101, 'invoice.paid', pg_temp.pd(31, 2400)) ->> 'outcome', 'refund_requested', 'a needs_refund payment');
select is(pg_temp.ev(3102, 'charge.dispute.created', pg_temp.dd(31)), '{"outcome": "applied"}'::jsonb,
  'a dispute on a payment still owed a refund records disputed and names no refund');

-- -- 8. Late webhooks: paid_at, not the delivery time, decides (D2, D5) (6) -------------------
select is(pg_temp.ev(901, 'invoice.paid', pg_temp.pd(9, 2500, 'cad', now() - interval '2 days')) ->> 'outcome', 'applied',
  'late webhook: paid before pay_by but delivered after it activates');
select results_eq(
  $$ select status, paid_at = date_trunc('second', now() - interval '2 days'), starts_at = now() from public.promotions where id = pg_temp.p(9) $$,
  $$ values ('approved'::text, true, true) $$,
  'paid_at is Stripe''s paid time; the window still starts at delivery');
select is(pg_temp.ev(1001, 'invoice.paid', pg_temp.pd(10, 2500, 'cad', now() - interval '1 hour')) ->> 'outcome', 'refund_requested',
  'paid after pay_by is needs_refund');
select is(pg_temp.ev(1101, 'invoice.paid', pg_temp.pd(11) - 'paid_at'), '{"outcome": "mismatch"}'::jsonb,
  'paid_at missing is mismatch');
select results_eq($$ select pg_temp.pstatus(11), pg_temp.paystatus(11),
                            (select payment_intent_id from public.promotion_payments where id = pg_temp.pay(11)) $$,
  $$ values ('payment_due'::text, 'open'::text, null::text) $$, 'a mismatch changes nothing');
select throws_ok($$ select pg_temp.ev(1201, 'invoice.paid', pg_temp.pd(12, 2500, 'cad', now() + interval '1 day')) $$,
  'P0001', 'invalid_event_data',
  'our invoice.paid with a paid_at more than 5 minutes ahead raises (the webhook answers 500, Stripe retries)');
select is((select count(*)::int from public.stripe_events where event_id = 'evt_FakeTest1201'), 0,
  'the raise rolled back the event row, so the retry is not a duplicate');
select is(pg_temp.ev(1201, 'invoice.paid', pg_temp.pd(12)) ->> 'outcome', 'applied',
  'the retry of the same event id with a sane paid_at is processed');
select throws_ok($$ select pg_temp.ev(2901, 'invoice.paid', pg_temp.pd(29) - 'payment_intent_id') $$,
  'P0001', 'invalid_event_data', 'our invoice.paid without a payment_intent_id raises');
select throws_ok($$ select pg_temp.ev(2902, 'invoice.paid', pg_temp.pd(29) || '{"amount_paid": "25.00"}'::jsonb) $$,
  'P0001', 'invalid_event_data', 'our invoice.paid with a malformed amount_paid raises');
select results_eq($$ select pg_temp.paystatus(29), (select count(*)::int from public.stripe_events
                                                     where event_id in ('evt_FakeTest2901', 'evt_FakeTest2902')) $$,
  $$ values ('open'::text, 0) $$, 'the raised events stored nothing and changed nothing');
select is(pg_temp.ev(4601, 'invoice.paid', pg_temp.pd(46, 2500, 'cad', now() - interval '2 days')) ->> 'outcome', 'applied',
  'honour rule: paid in time on a campaign already stored payment_expired, with no newer request, activates');
select results_eq($$ select pg_temp.pstatus(46), pg_temp.paystatus(46) $$, $$ values ('approved'::text, 'paid'::text) $$,
  'honour rule: the campaign is approved and the payment paid');
select is(pg_temp.ev(4701, 'invoice.paid', pg_temp.pd(47, 2500, 'cad', now() - interval '6 days')), '{"outcome": "mismatch"}'::jsonb,
  'a paid_at more than 5 minutes before the payment row was created is mismatch');
select results_eq($$ select pg_temp.pstatus(47), pg_temp.paystatus(47) $$, $$ values ('payment_due'::text, 'open'::text) $$,
  'the too-early paid_at changed nothing');
select is(pg_temp.ev(4801, 'invoice.paid', pg_temp.pd(48, 2500, 'cad', now() + interval '2 minutes')) ->> 'outcome', 'applied',
  'a paid_at within 5 minutes in the future is accepted');
select results_eq($$ select paid_at = now() from public.promotions where id = pg_temp.p(48)
                    union all select paid_at = now() from public.promotion_payments where id = pg_temp.pay(48) $$,
  $$ values (true), (true) $$, 'and is clamped to now on the campaign and the payment');

-- -- 9. Livemode, voids, unknowns (D3, D11) (9) -------------------------------------------------
select is(pg_temp.ev(1401, 'invoice.paid', pg_temp.pd(14), true), '{"outcome": "mismatch"}'::jsonb,
  'D11 row livemode mismatch: a live event for a test payment is mismatch');
select results_eq($$ select pg_temp.pstatus(14), pg_temp.paystatus(14) $$, $$ values ('payment_due'::text, 'open'::text) $$,
  'D11 the livemode mismatch changed nothing');
select is((select outcome || '|' || livemode from public.stripe_events where event_id = 'evt_FakeTest1401'), 'mismatch|true',
  'the mismatched event is kept for audit');
select is(pg_temp.ev(1501, 'invoice.voided', pg_temp.vd(15)) ->> 'outcome', 'applied', 'invoice.voided is applied');
select is(pg_temp.paystatus(15), 'void', 'invoice.voided makes the payment void');
select is(pg_temp.ev(1601, 'invoice.marked_uncollectible', pg_temp.vd(16)) ->> 'outcome', 'applied', 'marked_uncollectible is recorded');
select is(pg_temp.paystatus(16), 'uncollectible', 'the payment is uncollectible');
select is(pg_temp.ev(1701, 'invoice.paid', pg_temp.pd(99)), '{"outcome": "mismatch"}'::jsonb,
  'an invoice that is not ours is mismatch');
select is(pg_temp.ev(1702, 'customer.created', '{}'), '{"outcome": "ignored"}'::jsonb, 'an unknown event type is ignored');

-- -- 10. Seller and admin transitions while payment is due (14) ------------------------------
select pg_temp.as_user(18);
select is(public.get_my_promotion() -> 'promotion' ->> 'state', 'awaiting_payment', 'payment_due within pay_by reads awaiting_payment');
select is(public.cancel_my_promotion(pg_temp.p(18)) -> 'promotion' ->> 'state', 'cancelled',
  'a seller can cancel while payment is due');
select is(pg_temp.paystatus(18), 'void_pending', 'its open invoice becomes void_pending (voided at Stripe by void_pending)');
select pg_temp.as_user(19);
select is(public.cancel_my_promotion(pg_temp.p(19)) -> 'promotion' ->> 'state', 'cancelled', 'cancel with a reserved payment');
select is(pg_temp.paystatus(19), 'void', 'a reserved row with no invoice becomes void');
select throws_ok($$ select public.attach_invoice(pg_temp.pay(19), 'cus_FakeTest0019', 'in_FakeTest0019', false) $$,
  'P0001', 'not_attachable', 'attach_invoice then refuses, so nothing is finalized or sent');
select is(private.admin_review_promotion(pg_temp.p(20), 'reject', null, 'not_paid') ->> 'state', 'rejected',
  'admin can reject while payment is due');
select is(pg_temp.paystatus(20), 'void_pending', 'the rejected campaign''s invoice becomes void_pending');
select is(private.admin_review_promotion(pg_temp.p(21), 'cancel') ->> 'state', 'cancelled', 'admin can cancel while payment is due');
select is(pg_temp.paystatus(21), 'void_pending', 'the cancelled campaign''s invoice becomes void_pending');
select is(private.admin_review_promotion(pg_temp.p(52), 'cancel') ->> 'state', 'cancelled', 'admin cancel with an uncollectible invoice');
select is(pg_temp.paystatus(52), 'void_pending', 'an uncollectible invoice (still payable at Stripe) becomes void_pending on a cancel');
select is(private.admin_review_promotion(pg_temp.p(24), 'approve', now() + interval '1 day') ->> 'state', 'scheduled',
  'the free approve still works');
select is((select is_free from public.promotions where id = pg_temp.p(24)), true, 'and marks the campaign free');
select pg_temp.as_user(24);
select is(public.cancel_my_promotion(pg_temp.p(24)) -> 'promotion' ->> 'state', 'cancelled',
  'a seller can still cancel a free campaign (spec 16)');
select throws_ok($$ select private.admin_review_promotion(pg_temp.p(4), 'cancel') $$, 'P0001', 'invalid_transition',
  'a refunded campaign cannot be cancelled again');

-- -- 11. Lapse, then a new request (6) ----------------------------------------------------------
select pg_temp.as_user(22);
select is(public.get_my_promotion() -> 'promotion' ->> 'state', 'payment_expired', 'payment_due past pay_by reads payment_expired');
select is(pg_temp.pstatus(22), 'payment_due', 'reads never write: still stored payment_due');
select is(public.request_promotion('featured', 'Back again', null) -> 'promotion' ->> 'state', 'requested',
  'after the window lapsed, a new request succeeds');
select is(pg_temp.pstatus(22), 'payment_expired', 'the lapsed row is stored payment_expired');
select is(pg_temp.pstate(22), 'payment_expired', 'and still reads payment_expired');
select pg_temp.as_user(23);
select throws_ok($$ select public.request_promotion('featured', 'Too soon', null) $$, 'P0001', 'already_open',
  'a request while payment is due within pay_by gets already_open');

-- -- 12. begin_promotion_invoice refusals and the rate limit (6) ------------------------------
select throws_ok($$ select public.begin_promotion_invoice(pg_temp.p(25)) $$, 'P0001', 'not_payable',
  'a requested campaign is not payable');
select throws_ok($$ select public.begin_promotion_invoice(pg_temp.p(26)) $$, 'P0001', 'payment_window_closed',
  'less than 1 hour before pay_by: payment_window_closed');
select throws_ok($$ select public.begin_promotion_invoice(pg_temp.p(27)) $$, 'P0001', 'not_configured',
  'a non-CAD campaign: not_configured');
select throws_ok($$ select public.begin_promotion_invoice('00000000-0000-0000-1b18-999999999999') $$, 'P0001', 'not_found',
  'an unknown promotion: not_found');
do $$ begin for i in 1..10 loop perform public.begin_promotion_invoice(pg_temp.p(28)); end loop; end $$;
select throws_ok($$ select public.begin_promotion_invoice(pg_temp.p(28)) $$, 'P0001', 'rate_limited',
  'the 11th call in an hour for one promotion is rate_limited');
select is((select count(*)::int from public.promotion_payments where promotion_id = pg_temp.p(28)), 1,
  'ten calls reserved exactly one payment row');

-- -- 13. The seller's view carries no payment detail (3) ------------------------------------------
select pg_temp.as_user(2);
select is(pg_temp.keys(public.get_my_promotion() -> 'promotion'),
  array['category', 'created_at', 'currency_code', 'ends_at', 'headline', 'id', 'is_free', 'length_days', 'paid',
        'preferred_start', 'price_cents', 'reject_reason', 'starts_at', 'state'],
  'the promotion object has exactly the documented keys (price keys until PR 3, D15)');
select ok((select bool_and(position(s in j::text) = 0)
             from (select public.get_my_promotion() as j) x,
                  unnest(array['in_', 'cus_', 'pi_', 'evt_', 'http', 'stripe']) s),
  'get_my_promotion carries no invoice id, Stripe id or link');
select pg_temp.as_user(10);
select throws_ok($$ select public.cancel_my_promotion(pg_temp.p(10)) $$, 'P0001', 'not_cancellable',
  'a lapsed payment window cannot be cancelled by the seller (it reads payment_expired)');

-- -- 14. Delete guard: a payment still payable or owed a refund is never deleted (S1) (6) ------
select throws_ok($$ delete from public.businesses where id = pg_temp.b(49) $$, 'P0001', 'payment_unsettled',
  'deleting a business with an open invoice is refused');
select results_eq(
  $$ select (select count(*)::int from public.businesses where id = pg_temp.b(49)),
            (select count(*)::int from public.promotions where id = pg_temp.p(49)),
            (select count(*)::int from public.promotion_payments where id = pg_temp.pay(49)) $$,
  $$ values (1, 1, 1) $$, 'the refused delete removed nothing');
select throws_ok($$ delete from public.promotion_payments where id = pg_temp.pay(49) $$, 'P0001', 'payment_unsettled',
  'an open payment row cannot be deleted directly either');
select throws_ok($$ delete from public.promotion_payments where id = pg_temp.pay(8) $$, 'P0001', 'payment_unsettled',
  'a refund-owed (needs_refund) row cannot be deleted');
select lives_ok($$ delete from public.businesses where id = pg_temp.b(50) $$,
  'deleting a business whose payment is void works');
select results_eq(
  $$ select (select count(*)::int from public.businesses where id = pg_temp.b(50)),
            (select count(*)::int from public.promotions where id = pg_temp.p(50)),
            (select count(*)::int from public.promotion_payments where id = pg_temp.pay(50)) $$,
  $$ values (0, 0, 0) $$, 'the business, its promotion and its void payment row are gone (cascade)');

select * from finish();
rollback;
