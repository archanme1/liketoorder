-- Spec 09 (PR 1): pickup requests backend — table and RLS, function privileges, submit rules,
-- idempotency, limits, expiry, display_status, list/get/cancel, the accepted-request address, and
-- that nothing private leaks. Own fixtures, one rolled-back transaction.
begin;
select plan(239);

-- ── Helpers (pg_temp) ───────────────────────────────────────────────────────
-- Ids:  users 00000000-0000-0000-0009-<n>   businesses …-0049-<n>   items …-0059-<n>
--       requests …-0069-<n>                  idempotency keys …-0079-<n>
create function pg_temp.u(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0009-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.b(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0049-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.i(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0059-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.r(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0069-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.k(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0079-' || lpad(n::text, 12, '0'))::uuid $$;

-- Impersonate user n: claims only (the role is set with `set local role` in the test itself).
create function pg_temp.as_user(n int) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', pg_temp.u(n)), true);
end $$;

-- Cron-job lookup that reports null (instead of aborting the file) when pg_cron is missing.
create function pg_temp.cron_field(p_name text, p_field text) returns text language plpgsql as $$
declare r text;
begin
  if to_regclass('cron.job') is null then return null; end if;
  execute format('select %I::text from cron.job where jobname = $1', p_field) into r using p_name;
  return r;
end $$;

-- Deletes a customer's rows (security definer: callable while impersonating that customer).
create function pg_temp.clear_requests(p_uid uuid) returns void language sql security definer set search_path = '' as $$
  delete from public.pickup_requests where customer_id = p_uid;
$$;

-- Runs a submit and returns 'OK' (rows are cleared again) or the error message.
create function pg_temp.submit_err(p_biz uuid, p_key uuid, p_at timestamptz, p_items jsonb, p_text text, p_note text)
returns text language plpgsql as $$
begin
  perform public.submit_pickup_request(p_biz, p_key, p_at, p_items, p_text, p_note);
  perform pg_temp.clear_requests(auth.uid());
  return 'OK';
exception when others then
  return sqlerrm;
end $$;

-- A submit with sensible defaults: Resto One, one hour ahead, a fresh key.
create function pg_temp.try(p_items jsonb default null, p_text text default null, p_note text default null,
                            p_at timestamptz default null, p_biz uuid default '00000000-0000-0000-0049-000000000001')
returns text language sql as $$
  select pg_temp.submit_err(p_biz, gen_random_uuid(), coalesce(p_at, now() + interval '1 hour'), p_items, p_text, p_note);
$$;

-- A submit that returns the request, or { "error": message } instead of raising.
create function pg_temp.submit_json(p_biz uuid, p_key uuid, p_at timestamptz, p_items jsonb, p_text text, p_note text)
returns jsonb language plpgsql as $$
begin
  return public.submit_pickup_request(p_biz, p_key, p_at, p_items, p_text, p_note);
exception when others then
  return jsonb_build_object('error', sqlerrm);
end $$;

create function pg_temp.cancel_err(p_id uuid) returns text language plpgsql as $$
begin
  perform public.cancel_pickup_request(p_id);
  return 'OK';
exception when others then
  return sqlerrm;
end $$;

-- A free-text submit to business n; returns the request id.
create function pg_temp.sub_biz(n int) returns uuid language sql as $$
  select (public.submit_pickup_request(pg_temp.b(n), gen_random_uuid(), now() + interval '1 hour', null, 'order', null) ->> 'id')::uuid;
$$;

-- [{ item_id: item 1, quantity: q }] with q any JSON value; and n valid lines (items 101..).
create function pg_temp.one(q jsonb) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('item_id', pg_temp.i(1), 'quantity', q));
$$;
create function pg_temp.lines(n int) returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object('item_id', pg_temp.i(100 + k), 'quantity', 1) order by k) from generate_series(1, n) k;
$$;

create function pg_temp.keys(j jsonb) returns text[] language sql immutable as $$
  select coalesce(array_agg(k order by k collate "C"), array[]::text[]) from jsonb_object_keys(j) k;
$$;

-- 10 submit-then-cancel rounds; keys and ids are kept for the replay test.
create temp table rl_keys (n int, k uuid, id uuid);
grant all on rl_keys to public;
create function pg_temp.cycle(p_from int, p_to int) returns void language plpgsql as $$
declare v jsonb; v_key uuid;
begin
  for n in p_from..p_to loop
    v_key := gen_random_uuid();
    v := public.submit_pickup_request(pg_temp.b(2), v_key, now() + interval '1 hour', null, 'round ' || n, null);
    insert into rl_keys values (n, v_key, (v ->> 'id')::uuid);
    perform public.cancel_pickup_request((v ->> 'id')::uuid);
  end loop;
end $$;

create temp table res (label text primary key, j jsonb);
grant all on res to public;

-- ── Fixtures (as postgres) ──────────────────────────────────────────────────
-- Users:  1 C1 (fixture requests)   2 C2   3 no username   4 owner R1   5 owner H1   6 owner H2   7 outsider
--         8 rate limit   9 pending limit   10..18, 20..27 owners of businesses 10..18, 20..27
--         30 thirty lines   31 validation   32 paging (51 rows)   33 submit   34 idempotency
--         35 one pending per business   36 expiry job   37 key sets   38 cascade customer   39 owner of business 30
--         40 second rate-limit customer   41 replay tests
-- Businesses (all fresh unless noted):  1 R1 restaurant, CAD   2 H1 homemade, CAD   3 H2 homemade, no currency
--   10 unlisted   11 stale 31 d   12 exactly 30 d   13 place not_found   14 no map point, no location
--   15 stale 31 d homemade   16 H3 homemade stale 31 d   17 H4 homemade   18 restaurant   20..27 homemade   30 homemade
-- Items:  1 Soup 850   2 Salad (no price)   3 Sold out   all on R1;   4 Bread 450 on H1;   5 Other Cake on H2;   101..131 on R1
insert into auth.users (id, email)
select pg_temp.u(n), 'p09_' || n || '@example.test'
  from unnest(array[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,20,21,22,23,24,25,26,27,30,31,32,33,34,35,36,37,38,39,40,41]) n;
update public.profiles set username = 'p09_' || right(id::text, 3) where id::text like '00000000-0000-0000-0009-%';
update public.profiles set username = null where id = pg_temp.u(3);

insert into public.businesses (id, owner_id, type, name, cuisine_code, map_lat, map_lng, public_address, is_listed, currency_code) values
  (pg_temp.b(1),  pg_temp.u(4),  'restaurant', 'Resto One',       'IT', 71.1, 101.1, '1 Main St, Tromso', true,  'CAD'),
  (pg_temp.b(2),  pg_temp.u(5),  'homemade',   'Home One',        'IT', 71.2, 101.2, null,                true,  'CAD'),
  (pg_temp.b(3),  pg_temp.u(6),  'homemade',   'Home Two',        'IT', 71.3, 101.3, null,                true,  null),
  (pg_temp.b(10), pg_temp.u(10), 'restaurant', 'Unlisted Resto',  'IT', 71.4, 101.4, '10 Main St',        false, null),
  (pg_temp.b(11), pg_temp.u(11), 'restaurant', 'Stale Resto',     'IT', 71.5, 101.5, '11 Main St',        true,  null),
  (pg_temp.b(12), pg_temp.u(12), 'restaurant', 'Edge Resto',      'IT', 71.6, 101.6, '12 Main St',        true,  null),
  (pg_temp.b(13), pg_temp.u(13), 'restaurant', 'Gone Resto',      'IT', 71.7, 101.7, '13 Main St',        true,  null),
  (pg_temp.b(14), pg_temp.u(14), 'restaurant', 'No Point Resto',  'IT', null, null,  null,                true,  null),
  (pg_temp.b(15), pg_temp.u(15), 'homemade',   'Stale Home',      'IT', 71.8, 101.8, null,                true,  null),
  (pg_temp.b(16), pg_temp.u(16), 'homemade',   'Stale Home Three','IT', 71.9, 101.9, null,                true,  null),
  (pg_temp.b(17), pg_temp.u(17), 'homemade',   'Home Four',       'IT', 72.0, 102.0, null,                true,  null),
  (pg_temp.b(18), pg_temp.u(18), 'restaurant', 'Resto Eighteen',  'IT', 72.1, 102.1, '18 Main St',        true,  null),
  (pg_temp.b(30), pg_temp.u(39), 'homemade',   'Cascade Home',    'IT', 72.2, 102.2, null,                true,  null);
insert into public.businesses (id, owner_id, type, name, cuisine_code, map_lat, map_lng, is_listed)
select pg_temp.b(n), pg_temp.u(n), 'homemade', 'Home ' || n, 'IT', 72.5, 102.5, true
  from unnest(array[20,21,22,23,24,25,26,27]) n;

insert into public.business_locations (business_id, place_id, formatted_address, lat, lng, resolved_at, place_status) values
  (pg_temp.b(1),  'pr1',  '1 Main St, Tromso',        71.1,      101.1,      now() - interval '1 day',   'ok'),
  (pg_temp.b(2),  'ph1',  '2 Secret Rd, Homeville',   71.987654, 101.123456, now() - interval '1 day',   'ok'),
  (pg_temp.b(3),  'ph2',  '3 Secret Rd, Homeville',   71.3,      101.3,      now() - interval '1 day',   'ok'),
  (pg_temp.b(10), 'pu',   '10 Main St',               71.4,      101.4,      now() - interval '1 day',   'ok'),
  (pg_temp.b(11), 'ps',   '11 Main St',               71.5,      101.5,      now() - interval '31 days', 'ok'),
  (pg_temp.b(12), 'pe',   '12 Main St',               71.6,      101.6,      now() - interval '30 days', 'ok'),
  (pg_temp.b(13), 'pg',   '13 Main St',               71.7,      101.7,      now() - interval '1 day',   'not_found'),
  (pg_temp.b(15), 'psh',  '15 Secret Rd, Staleville', 71.8,      101.8,      now() - interval '31 days', 'ok'),
  (pg_temp.b(16), 'ph3',  '16 Secret Rd, Staleville', 71.9,      101.9,      now() - interval '31 days', 'ok'),
  (pg_temp.b(17), 'ph4',  '17 Secret Rd, Fourville',  72.0,      102.0,      now() - interval '1 day',   'ok'),
  (pg_temp.b(18), 'pr18', '18 Main St',               72.1,      102.1,      now() - interval '1 day',   'ok');
insert into public.business_locations (business_id, place_id, formatted_address, lat, lng)
select pg_temp.b(n), 'pl' || n, n || ' Secret Rd, Lineville', 72.5, 102.5 from unnest(array[20,21,22,23,24,25,26,27,30]) n;

insert into public.menu_items (id, business_id, name, description, price_minor, is_available, position) values
  (pg_temp.i(1), pg_temp.b(1), 'Soup',       null, 850,  true,  1),
  (pg_temp.i(2), pg_temp.b(1), 'Salad',      null, null, true,  2),
  (pg_temp.i(3), pg_temp.b(1), 'Sold Out',   null, 700,  false, 3),
  (pg_temp.i(4), pg_temp.b(2), 'Bread',      null, 450,  true,  1),
  (pg_temp.i(5), pg_temp.b(3), 'Other Cake', null, 300,  true,  1);
insert into public.menu_items (id, business_id, name, description, price_minor, is_available, position)
select pg_temp.i(100 + n), pg_temp.b(1), 'Bulk ' || n, null, 100, true, 9 + n from generate_series(1, 31) n;

-- C1's fixture requests, newest first by number. r11 is pending but past its expires_at; r5 is stored expired.
insert into public.pickup_requests (id, business_id, customer_id, status, pickup_at, order_text, idempotency_key, expires_at, created_at)
select pg_temp.r(f.n), pg_temp.b(f.biz), pg_temp.u(f.cust), f.st, now() + interval '2 hours', 'fixture', pg_temp.k(900 + f.n),
       case f.n when 5 then now() - interval '1 minute' when 11 then now() - interval '1 minute' else now() + interval '30 minutes' end,
       now() - f.n * interval '1 minute'
  from (values (1, 2, 1, 'pending'), (2, 2, 1, 'accepted'), (3, 2, 1, 'completed'), (4, 2, 1, 'declined'),
               (5, 2, 1, 'expired'), (6, 2, 1, 'cancelled'), (7, 2, 1, 'no_show'), (8, 16, 1, 'accepted'),
               (9, 17, 1, 'accepted'), (10, 18, 1, 'accepted'), (11, 2, 1, 'pending'), (12, 3, 1, 'pending'),
               (50, 1, 2, 'pending')) as f(n, biz, cust, st);

-- Expiry-job fixtures for user 36 (pickup is a day away so every expires_at satisfies expires_at <= pickup_at).
insert into public.pickup_requests (id, business_id, customer_id, status, pickup_at, order_text, idempotency_key, expires_at, created_at)
select pg_temp.r(f.n), pg_temp.b(2), pg_temp.u(36), f.st, now() + interval '1 day', 'expiry', pg_temp.k(900 + f.n), f.ex, now() - interval '2 hours'
  from (values (60, 'pending',   now()),                          -- exactly due: expires
               (61, 'pending',   now() + interval '1 second'),    -- one second left: stays
               (62, 'accepted',  now() - interval '1 hour'),
               (63, 'declined',  now() - interval '1 hour'),
               (64, 'cancelled', now() - interval '1 hour'),
               (65, 'completed', now() - interval '1 hour'),
               (66, 'no_show',   now() - interval '1 hour'),
               (67, 'pending',   now() - interval '1 hour')) as f(n, st, ex);

-- 51 requests for user 32 (paging), 1 to 51 minutes old.
insert into public.pickup_requests (id, business_id, customer_id, status, pickup_at, order_text, idempotency_key, expires_at, created_at)
select pg_temp.r(100 + n), pg_temp.b(2), pg_temp.u(32), 'cancelled', now() + interval '1 day', 'paging', pg_temp.k(1000 + n),
       now() + interval '1 hour', now() - n * interval '1 minute'
  from generate_series(1, 51) n;

-- Cascade fixtures: user 38's requests on R1 and on business 30.
insert into public.pickup_requests (id, business_id, customer_id, pickup_at, order_text, idempotency_key, expires_at)
values (pg_temp.r(200), pg_temp.b(1),  pg_temp.u(38), now() + interval '2 hours', 'cascade', pg_temp.k(1200), now() + interval '30 minutes'),
       (pg_temp.r(201), pg_temp.b(30), pg_temp.u(38), now() + interval '2 hours', 'cascade', pg_temp.k(1201), now() + interval '30 minutes');

-- ── 1. Table, RLS and constraints ───────────────────────────────────────────
select ok((select relrowsecurity from pg_class where oid = 'public.pickup_requests'::regclass),
  'RLS is enabled on pickup_requests');
select is((select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'pickup_requests'), 0,
  'pickup_requests has no policies (no client path at all)');
select table_privs_are('public', 'pickup_requests', 'anon', array[]::text[], 'anon has no table-level privileges on pickup_requests');
select table_privs_are('public', 'pickup_requests', 'authenticated', array[]::text[], 'authenticated has no table-level privileges on pickup_requests');
select ok(not has_any_column_privilege('anon', 'public.pickup_requests', 'SELECT, INSERT, UPDATE, REFERENCES'),
  'anon has no column privileges on pickup_requests');
select ok(not has_any_column_privilege('authenticated', 'public.pickup_requests', 'SELECT, INSERT, UPDATE, REFERENCES'),
  'authenticated has no column privileges on pickup_requests');
select ok(exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'pickup_requests_customer_idx'), 'the customer index exists');
select ok(exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'pickup_requests_business_idx'), 'the business index exists');
select ok(exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'pickup_requests_pending_expiry_idx'
                   and indexdef like '%WHERE%pending%'), 'the partial pending-expiry index exists');
select ok(exists (select 1 from pg_constraint where conrelid = 'public.pickup_requests'::regclass and conname = 'pickup_requests_idem'
                   and contype = 'u' and pg_get_constraintdef(oid) like '%customer_id, idempotency_key%'),
  'the idempotency key is unique per customer');
select ok(exists (select 1 from pg_trigger where tgrelid = 'public.pickup_requests'::regclass and tgname = 'pickup_requests_set_updated_at'),
  'updated_at is set by a trigger');
select is(pg_temp.cron_field('pickup-requests-expire', 'schedule'), '* * * * *', 'the expiry job runs every minute');
select is(pg_temp.cron_field('pickup-requests-expire', 'command'), 'select private.expire_pickup_requests()', 'the expiry job calls the private function');

select throws_ok($$ insert into public.pickup_requests (business_id, customer_id, status, pickup_at, expires_at, idempotency_key, order_text)
                    values (pg_temp.b(1), pg_temp.u(7), 'bogus', now() + interval '1 day', now() + interval '1 hour', gen_random_uuid(), 'x') $$,
  '23514', null, 'an unknown status is refused by the check constraint');
select throws_ok($$ insert into public.pickup_requests (business_id, customer_id, pickup_at, expires_at, idempotency_key)
                    values (pg_temp.b(1), pg_temp.u(7), now() + interval '1 day', now() + interval '1 hour', gen_random_uuid()) $$,
  '23514', null, 'a request with neither items nor text is refused');
select throws_ok($$ insert into public.pickup_requests (business_id, customer_id, pickup_at, expires_at, idempotency_key, order_text)
                    values (pg_temp.b(1), pg_temp.u(7), now() + interval '1 hour', now() + interval '2 hours', gen_random_uuid(), 'x') $$,
  '23514', null, 'expires_at after pickup_at is refused');
select throws_ok($$ insert into public.pickup_requests (business_id, customer_id, pickup_at, expires_at, idempotency_key, order_text)
                    values (pg_temp.b(1), pg_temp.u(7), now() + interval '1 day', now() + interval '1 hour', gen_random_uuid(), E'a\tb') $$,
  '23514', null, 'a control character in order_text is refused by the table');
select throws_ok($$ insert into public.pickup_requests (business_id, customer_id, pickup_at, expires_at, idempotency_key, order_text)
                    values (pg_temp.b(1), pg_temp.u(7), now() + interval '1 day', now() + interval '1 hour', gen_random_uuid(), ' padded') $$,
  '23514', null, 'order_text with a leading space is refused by the table');
select throws_ok($$ insert into public.pickup_requests (business_id, customer_id, pickup_at, expires_at, idempotency_key, order_text, note)
                    values (pg_temp.b(1), pg_temp.u(7), now() + interval '1 day', now() + interval '1 hour', gen_random_uuid(), 'x', repeat('n', 301)) $$,
  '23514', null, 'a 301-character note is refused by the table');
select throws_ok($$ insert into public.pickup_requests (business_id, customer_id, pickup_at, expires_at, idempotency_key, items)
                    values (pg_temp.b(1), pg_temp.u(7), now() + interval '1 day', now() + interval '1 hour', gen_random_uuid(), '[]'::jsonb) $$,
  '23514', null, 'an empty items array is refused by the table');

-- ── 2. Function privileges ──────────────────────────────────────────────────
select is(
  (select coalesce(array_agg(p.proname::text order by p.proname::text), array[]::text[])
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('submit_pickup_request', 'list_my_pickup_requests', 'get_my_pickup_request', 'cancel_pickup_request', 'get_my_pickup_address')
      and has_function_privilege('authenticated', p.oid, 'execute')),
  array['cancel_pickup_request', 'get_my_pickup_address', 'get_my_pickup_request', 'list_my_pickup_requests', 'submit_pickup_request'],
  'authenticated can execute all five pickup functions');
select is_empty(
  $$ select p.proname::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('submit_pickup_request', 'list_my_pickup_requests', 'get_my_pickup_request', 'cancel_pickup_request', 'get_my_pickup_address')
        and (has_function_privilege('anon', p.oid, 'execute')
             or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0)) $$,
  'anon and PUBLIC can execute none of the five pickup functions');
select ok(not has_function_privilege('anon', 'private.expire_pickup_requests()', 'execute')
      and not has_function_privilege('authenticated', 'private.expire_pickup_requests()', 'execute')
      and not has_function_privilege('service_role', 'private.expire_pickup_requests()', 'execute'),
  'private.expire_pickup_requests is executable by none of anon, authenticated, service_role');
select ok(not has_function_privilege('anon', 'private.pickup_request_expiry(timestamptz, timestamptz)', 'execute')
      and not has_function_privilege('authenticated', 'private.pickup_request_expiry(timestamptz, timestamptz)', 'execute')
      and not has_function_privilege('service_role', 'private.pickup_request_expiry(timestamptz, timestamptz)', 'execute'),
  'private.pickup_request_expiry is executable by none of anon, authenticated, service_role');
select is_empty(
  $$ select p.oid::regprocedure::text from pg_proc p
      where p.oid in ('public.submit_pickup_request(uuid, uuid, timestamptz, jsonb, text, text)'::regprocedure,
                      'public.list_my_pickup_requests(timestamptz)'::regprocedure,
                      'public.get_my_pickup_request(uuid)'::regprocedure,
                      'public.cancel_pickup_request(uuid)'::regprocedure,
                      'public.get_my_pickup_address(uuid)'::regprocedure,
                      'private.expire_pickup_requests()'::regprocedure,
                      'private.pickup_request_expiry(timestamptz, timestamptz)'::regprocedure)
        and (not p.prosecdef or p.proconfig is distinct from array['search_path=""']) $$,
  'all seven new functions are security definer with an empty search_path');

-- ── 3. No client read or write path on the table ────────────────────────────
set local role authenticated;
select pg_temp.as_user(1);
select throws_ok($$ select * from public.pickup_requests $$, '42501', null, 'the customer cannot select the table directly');
select throws_ok($$ select status from public.pickup_requests where id = pg_temp.r(1) $$, '42501', null, 'the customer cannot select a request by id');
select throws_ok($$ insert into public.pickup_requests (business_id, customer_id, pickup_at, expires_at, idempotency_key, order_text)
                    values (pg_temp.b(1), pg_temp.u(1), now() + interval '1 hour', now() + interval '30 minutes', gen_random_uuid(), 'x') $$,
  '42501', null, 'the customer cannot insert a request');
select throws_ok($$ update public.pickup_requests set status = 'accepted' where id = pg_temp.r(1) $$, '42501', null,
  'the customer cannot update status');
select throws_ok($$ update public.pickup_requests set expires_at = now() + interval '2 hours' where id = pg_temp.r(1) $$, '42501', null,
  'the customer cannot update expires_at');
select throws_ok($$ update public.pickup_requests set customer_id = pg_temp.u(2) where id = pg_temp.r(1) $$, '42501', null,
  'the customer cannot update customer_id');
select throws_ok($$ delete from public.pickup_requests where id = pg_temp.r(1) $$, '42501', null, 'the customer cannot delete a request');
select pg_temp.as_user(5);
select throws_ok($$ select * from public.pickup_requests $$, '42501', null, 'the business owner cannot select requests (spec 10 adds a function)');
select throws_ok($$ update public.pickup_requests set status = 'accepted' where id = pg_temp.r(1) $$, '42501', null,
  'the business owner cannot update status directly');
select throws_ok($$ delete from public.pickup_requests where id = pg_temp.r(1) $$, '42501', null, 'the business owner cannot delete a request');
select pg_temp.as_user(7);
select throws_ok($$ select * from public.pickup_requests $$, '42501', null, 'an outsider cannot select requests');
select throws_ok($$ update public.pickup_requests set status = 'cancelled' where id = pg_temp.r(1) $$, '42501', null,
  'an outsider cannot update a request');
select throws_ok($$ insert into public.pickup_requests (business_id, customer_id, pickup_at, expires_at, idempotency_key, order_text)
                    values (pg_temp.b(1), pg_temp.u(1), now() + interval '1 hour', now() + interval '30 minutes', gen_random_uuid(), 'x') $$,
  '42501', null, 'an outsider cannot insert a request for someone else');
reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok($$ select * from public.pickup_requests $$, '42501', null, 'anon cannot select requests');
select throws_ok($$ insert into public.pickup_requests (business_id, customer_id, pickup_at, expires_at, idempotency_key, order_text)
                    values (pg_temp.b(1), pg_temp.u(1), now() + interval '1 hour', now() + interval '30 minutes', gen_random_uuid(), 'x') $$,
  '42501', null, 'anon cannot insert a request');
select throws_ok($$ update public.pickup_requests set status = 'cancelled' $$, '42501', null, 'anon cannot update requests');
select throws_ok($$ delete from public.pickup_requests $$, '42501', null, 'anon cannot delete requests');
select throws_ok($$ select public.submit_pickup_request(pg_temp.b(1), gen_random_uuid(), now() + interval '1 hour', null, 'x', null) $$,
  '42501', null, 'anon cannot call submit_pickup_request');
select throws_ok($$ select public.list_my_pickup_requests() $$, '42501', null, 'anon cannot call list_my_pickup_requests');
select throws_ok($$ select public.get_my_pickup_request(pg_temp.r(1)) $$, '42501', null, 'anon cannot call get_my_pickup_request');
select throws_ok($$ select public.cancel_pickup_request(pg_temp.r(1)) $$, '42501', null, 'anon cannot call cancel_pickup_request');
select throws_ok($$ select public.get_my_pickup_address(pg_temp.r(2)) $$, '42501', null, 'anon cannot call get_my_pickup_address');
reset role;

-- ── 4. Submit: success shapes, server-owned values, expiry ──────────────────
set local role authenticated;
select pg_temp.as_user(33);

-- a: restaurant, items + text + note, with a tampered price and name in p_items, one hour ahead
insert into res select 'a', public.submit_pickup_request(pg_temp.b(1), gen_random_uuid(), now() + interval '1 hour',
  jsonb_build_array(jsonb_build_object('item_id', pg_temp.i(1), 'quantity', 2, 'unit_price_minor', 1, 'name', 'Hacked'),
                    jsonb_build_object('item_id', pg_temp.i(2), 'quantity', 1)),
  E'  extra words \n', 'no onions');
select is(pg_temp.keys((select j from res where label = 'a')),
  array['business_id', 'business_name', 'business_type', 'created_at', 'currency_code', 'display_status', 'expires_at', 'id',
        'items', 'note', 'order_text', 'pickup_at', 'status'],
  'a request object has exactly the 13 documented keys (no customer_id, idempotency_key, responded_at, updated_at)');
select is((select j ->> 'status' from res where label = 'a'), 'pending', 'a new request is pending');
select is((select j ->> 'display_status' from res where label = 'a'), 'pending', 'a new request shows pending, not expired');
select is((select (j ->> 'created_at')::timestamptz from res where label = 'a'), now(), 'created_at is the server time');
select is((select (j ->> 'expires_at')::timestamptz - (j ->> 'created_at')::timestamptz from res where label = 'a'),
  interval '30 minutes', 'expires_at is created_at + 30 minutes when the pickup is later');
select is((select (j ->> 'pickup_at')::timestamptz from res where label = 'a'), now() + interval '1 hour', 'pickup_at is as requested');
select is((select j -> 'items' from res where label = 'a'),
  jsonb_build_array(jsonb_build_object('item_id', pg_temp.i(1), 'name', 'Soup', 'unit_price_minor', 850, 'quantity', 2),
                    jsonb_build_object('item_id', pg_temp.i(2), 'name', 'Salad', 'unit_price_minor', null, 'quantity', 1)),
  'the item snapshot uses the server''s names and prices; the tampered price and name are ignored; an unpriced item has a null price');
select is((select j ->> 'order_text' from res where label = 'a'), 'extra words', 'order_text is trimmed');
select is((select j ->> 'note' from res where label = 'a'), 'no onions', 'the note is stored');
select is((select j ->> 'currency_code' from res where label = 'a'), 'CAD', 'currency_code is copied from the business');
select is((select j ->> 'business_name' from res where label = 'a'), 'Resto One', 'business_name is read from the business');
select is((select j ->> 'business_type' from res where label = 'a'), 'restaurant', 'business_type is read from the business');
select pg_temp.clear_requests(pg_temp.u(33));

-- b: free text only, pickup 20 minutes ahead: expiry is the pickup time (earlier than created + 30 minutes)
select lives_ok($$ insert into res select 'b', public.submit_pickup_request(pg_temp.b(2), gen_random_uuid(), now() + interval '20 minutes', null, 'two loaves', null) $$,
  'a homemade cook accepts a free-text request');
select is((select (j ->> 'expires_at')::timestamptz from res where label = 'b'), now() + interval '20 minutes',
  'expires_at is the pickup time when that is earlier than created + 30 minutes');
select is((select j ->> 'display_status' from res where label = 'b'), 'pending', 'a request expiring in 20 minutes shows pending');
select ok((select jsonb_typeof(j -> 'items') = 'null' and jsonb_typeof(j -> 'note') = 'null' from res where label = 'b'),
  'a free-text request has null items and a null note');
select pg_temp.clear_requests(pg_temp.u(33));

-- c: homemade, items only
select lives_ok($$ insert into res select 'c', public.submit_pickup_request(pg_temp.b(2), gen_random_uuid(), now() + interval '3 hours',
  jsonb_build_array(jsonb_build_object('item_id', pg_temp.i(4), 'quantity', 1)), null, null) $$,
  'a homemade cook accepts an items-only request');
select is((select j ->> 'business_type' from res where label = 'c'), 'homemade', 'a homemade request is accepted with items only');
select is((select j -> 'items' from res where label = 'c'),
  jsonb_build_array(jsonb_build_object('item_id', pg_temp.i(4), 'name', 'Bread', 'unit_price_minor', 450, 'quantity', 1)),
  'the homemade item snapshot is read from menu_items');
select ok((select jsonb_typeof(j -> 'order_text') = 'null' from res where label = 'c'), 'an items-only request has a null order_text');
select pg_temp.clear_requests(pg_temp.u(33));

-- d: pickup exactly 30 minutes ahead (the two rules agree)
select lives_ok($$ insert into res select 'd', public.submit_pickup_request(pg_temp.b(2), gen_random_uuid(), now() + interval '30 minutes', null, 'x', null) $$,
  'a homemade cook accepts a request with the pickup at created + 30 minutes');
select is((select (j ->> 'expires_at')::timestamptz from res where label = 'd'), now() + interval '30 minutes',
  'pickup at created + 30 minutes: expires_at equals both');
select pg_temp.clear_requests(pg_temp.u(33));

-- e: a business with no currency
select lives_ok($$ insert into res select 'e', public.submit_pickup_request(pg_temp.b(3), gen_random_uuid(), now() + interval '1 hour', null, 'x', null) $$,
  'a homemade cook with no currency accepts a request');
select ok((select jsonb_typeof(j -> 'currency_code') = 'null' from res where label = 'e'), 'a business with no currency gives a null currency_code');
select pg_temp.clear_requests(pg_temp.u(33));

-- Key sets are the same in submit, get, list and cancel (user 37, one request).
select pg_temp.as_user(37);
insert into res select 'k_submit', public.submit_pickup_request(pg_temp.b(1), gen_random_uuid(), now() + interval '1 hour',
  jsonb_build_array(jsonb_build_object('item_id', pg_temp.i(1), 'quantity', 1)), 'with text', 'a note');
insert into res select 'k_get', public.get_my_pickup_request((select (j ->> 'id')::uuid from res where label = 'k_submit')) -> 'request';
insert into res select 'k_list', (public.list_my_pickup_requests() -> 'requests') -> 0;
select is(pg_temp.keys((select j from res where label = 'k_get')), pg_temp.keys((select j from res where label = 'k_submit')),
  'get_my_pickup_request has the same keys as submit_pickup_request');
select is(pg_temp.keys((select j from res where label = 'k_list')), pg_temp.keys((select j from res where label = 'k_submit')),
  'list_my_pickup_requests has the same keys as submit_pickup_request');
select is((select j from res where label = 'k_get'), (select j from res where label = 'k_submit'),
  'get returns exactly what submit returned');
select is((select j from res where label = 'k_list'), (select j from res where label = 'k_submit'),
  'list returns exactly what submit returned');
insert into res select 'k_cancel', public.cancel_pickup_request((select (j ->> 'id')::uuid from res where label = 'k_submit'));
select is(pg_temp.keys((select j from res where label = 'k_cancel')), pg_temp.keys((select j from res where label = 'k_submit')),
  'cancel_pickup_request has the same keys as submit_pickup_request');
select is((select j - 'status' - 'display_status' from res where label = 'k_cancel'),
          (select j - 'status' - 'display_status' from res where label = 'k_submit'),
  'cancel changes only status and display_status');
select is((select j ->> 'status' || '/' || (j ->> 'display_status') from res where label = 'k_cancel'), 'cancelled/cancelled',
  'a cancelled request is cancelled in both status and display_status');

-- ── 5. Submit: rejections (user 31; successes are cleared again) ────────────
select pg_temp.as_user(31);
select is(pg_temp.try(p_text := 'x'), 'OK', 'baseline: a valid free-text submit works');
select is(pg_temp.submit_err(null, gen_random_uuid(), now() + interval '1 hour', null, 'x', null), 'business_unavailable', 'a null business id is business_unavailable');
select is(pg_temp.try(p_text := 'x', p_biz := '00000000-0000-0000-0049-0000000fffff'), 'business_unavailable', 'an unknown business is business_unavailable');
select is(pg_temp.try(p_text := 'x', p_biz := pg_temp.b(10)), 'business_unavailable', 'an unlisted business is business_unavailable');
select is(pg_temp.try(p_text := 'x', p_biz := pg_temp.b(11)), 'business_unavailable', 'a restaurant resolved 31 days ago is business_unavailable');
select is(pg_temp.try(p_text := 'x', p_biz := pg_temp.b(12)), 'business_unavailable', 'a restaurant resolved exactly 30 days ago is business_unavailable');
select is(pg_temp.try(p_text := 'x', p_biz := pg_temp.b(13)), 'business_unavailable', 'a place Google no longer knows is business_unavailable');
select is(pg_temp.try(p_text := 'x', p_biz := pg_temp.b(14)), 'business_unavailable', 'a business with no map point is business_unavailable');
select is(pg_temp.try(p_text := 'x', p_biz := pg_temp.b(15)), 'business_unavailable', 'a homemade cook resolved 31 days ago is business_unavailable');
select is(
  (select count(distinct pg_temp.try(p_text := 'x', p_biz := b))::int
     from unnest(array[null, '00000000-0000-0000-0049-0000000fffff', pg_temp.b(10), pg_temp.b(11), pg_temp.b(12), pg_temp.b(13),
                       pg_temp.b(14), pg_temp.b(15)]::uuid[]) b),
  1, 'every reason a business is unavailable gives the identical error message');
select is(pg_temp.submit_err(pg_temp.b(1), null, now() + interval '1 hour', null, 'x', null), 'invalid_input', 'a null idempotency key is invalid_input');

-- pickup time
select is(pg_temp.submit_err(pg_temp.b(1), gen_random_uuid(), null, null, 'x', null), 'invalid_pickup_time', 'a null pickup time is invalid_pickup_time');
select is(pg_temp.try(p_text := 'x', p_at := now() + interval '14 minutes 59 seconds'), 'invalid_pickup_time', '14 minutes 59 seconds ahead is invalid_pickup_time');
select is(pg_temp.try(p_text := 'x', p_at := now() + interval '15 minutes'), 'OK', 'exactly 15 minutes ahead is accepted');
select is(pg_temp.try(p_text := 'x', p_at := now() + interval '7 days'), 'OK', 'exactly 7 days ahead is accepted');
select is(pg_temp.try(p_text := 'x', p_at := now() + interval '7 days 1 second'), 'invalid_pickup_time', '7 days and 1 second ahead is invalid_pickup_time');
select is(pg_temp.try(p_text := 'x', p_at := now() - interval '1 hour'), 'invalid_pickup_time', 'a pickup time in the past is invalid_pickup_time');

-- empty order
select is(pg_temp.try(), 'empty_order', 'no items and no text is empty_order');
select is(pg_temp.try(p_text := '   '), 'empty_order', 'blank text is empty_order');
select is(pg_temp.try(p_text := E' \n '), 'empty_order', 'spaces and newlines only is empty_order');
select is(pg_temp.try(p_items := '[]'), 'empty_order', 'an empty items array and no text is empty_order');
select is(pg_temp.try(p_items := '[]', p_text := 'just words'), 'OK', 'an empty items array with text is a text-only order');

-- item availability
select is(pg_temp.try(p_items := jsonb_build_array(jsonb_build_object('item_id', pg_temp.i(3), 'quantity', 1))), 'item_unavailable',
  'a sold-out item is item_unavailable');
select is(pg_temp.try(p_items := jsonb_build_array(jsonb_build_object('item_id', pg_temp.i(5), 'quantity', 1))), 'item_unavailable',
  'another business''s item is item_unavailable');
select is(pg_temp.try(p_items := jsonb_build_array(jsonb_build_object('item_id', '00000000-0000-0000-0059-0000000fffff', 'quantity', 1))),
  'item_unavailable', 'an unknown item is item_unavailable');
select is(pg_temp.try(p_items := jsonb_build_array(jsonb_build_object('item_id', pg_temp.i(1), 'quantity', 1),
                                                   jsonb_build_object('item_id', pg_temp.i(3), 'quantity', 1))),
  'item_unavailable', 'one good item and one sold-out item is item_unavailable (all or nothing)');

-- item shape and quantities
select is(pg_temp.try(p_items := pg_temp.one('0')), 'invalid_items', 'quantity 0 is invalid_items');
select is(pg_temp.try(p_items := pg_temp.one('21')), 'invalid_items', 'quantity 21 is invalid_items');
select is(pg_temp.try(p_items := pg_temp.one('1')), 'OK', 'quantity 1 is accepted');
select is(pg_temp.try(p_items := pg_temp.one('20')), 'OK', 'quantity 20 is accepted');
select is(pg_temp.try(p_items := pg_temp.one('1.5')), 'invalid_items', 'a fractional quantity is invalid_items');
select is(pg_temp.try(p_items := pg_temp.one('"2"')), 'invalid_items', 'a string quantity is invalid_items');
select is(pg_temp.try(p_items := pg_temp.one('null')), 'invalid_items', 'a null quantity is invalid_items');
select is(pg_temp.try(p_items := pg_temp.one('-1')), 'invalid_items', 'a negative quantity is invalid_items');
select is(pg_temp.try(p_items := pg_temp.lines(31)), 'invalid_items', '31 lines is invalid_items');
select is(pg_temp.try(p_items := jsonb_build_array(jsonb_build_object('item_id', pg_temp.i(1), 'quantity', 1),
                                                   jsonb_build_object('item_id', pg_temp.i(1), 'quantity', 2))),
  'invalid_items', 'the same item twice is invalid_items');
select is(pg_temp.try(p_items := jsonb_build_object('item_id', pg_temp.i(1), 'quantity', 1)), 'invalid_items', 'items that are not an array are invalid_items');
select is(pg_temp.try(p_items := jsonb_build_array(jsonb_build_object('quantity', 1))), 'invalid_items', 'a line with no item_id is invalid_items');
select is(pg_temp.try(p_items := jsonb_build_array(jsonb_build_object('item_id', 'not-a-uuid', 'quantity', 1))), 'invalid_items', 'an item_id that is not a uuid is invalid_items');
select is(pg_temp.try(p_items := '[1]'::jsonb), 'invalid_items', 'a line that is not an object is invalid_items');

-- free text
select is(pg_temp.try(p_text := repeat('a', 500)), 'OK', 'a 500-character order is accepted');
select is(pg_temp.try(p_text := repeat('a', 501)), 'invalid_text', 'a 501-character order is invalid_text');
select is(pg_temp.try(p_text := 'x', p_note := repeat('n', 300)), 'OK', 'a 300-character note is accepted');
select is(pg_temp.try(p_text := 'x', p_note := repeat('n', 301)), 'invalid_text', 'a 301-character note is invalid_text');
select is(pg_temp.try(p_text := E'a\tb'), 'invalid_text', 'a tab in the order is invalid_text');
select is(pg_temp.try(p_text := E'a\rb'), 'invalid_text', 'a carriage return in the order is invalid_text');
select is(pg_temp.try(p_text := 'x', p_note := E'a\x01b'), 'invalid_text', 'a control character in the note is invalid_text');
select is(pg_temp.try(p_text := E'line one\nline two'), 'OK', 'a newline inside the order is allowed');

-- 30 lines is the maximum (user 30)
select pg_temp.as_user(30);
select is(pg_temp.try(p_items := pg_temp.lines(30)), 'OK', '30 lines is accepted');

-- own business, profile and sign-in
select pg_temp.as_user(4);
select is(pg_temp.try(p_text := 'x'), 'own_business', 'a seller cannot request from their own business');
select pg_temp.as_user(3);
select is(pg_temp.try(p_text := 'x'), 'profile_incomplete', 'a profile without a username is profile_incomplete');
select pg_temp.as_user(31);
select is(pg_temp.try(p_text := 'x', p_biz := pg_temp.b(2)), 'OK', 'a seller can request from a different business than their own');
set local request.jwt.claims = '{"role":"authenticated"}';
select is(pg_temp.try(p_text := 'x'), 'not_signed_in', 'a token with no user is not_signed_in');
select throws_ok($$ select public.list_my_pickup_requests() $$, 'P0001', 'not_signed_in', 'list with no user is not_signed_in');
select throws_ok($$ select public.get_my_pickup_request(pg_temp.r(1)) $$, 'P0001', 'not_signed_in', 'get with no user is not_signed_in');
select throws_ok($$ select public.cancel_pickup_request(pg_temp.r(1)) $$, 'P0001', 'not_signed_in', 'cancel with no user is not_signed_in');
select throws_ok($$ select public.get_my_pickup_address(pg_temp.r(2)) $$, 'P0001', 'not_signed_in', 'address with no user is not_signed_in');

-- ── 6. Idempotency ──────────────────────────────────────────────────────────
select pg_temp.as_user(34);
insert into res select 'i1', public.submit_pickup_request(pg_temp.b(1), pg_temp.k(1), now() + interval '1 hour', null, 'first', null);
insert into res select 'i2', public.submit_pickup_request(pg_temp.b(2), pg_temp.k(1), now() + interval '2 hours', null, 'changed', 'other note');
select is((select j ->> 'id' from res where label = 'i2'), (select j ->> 'id' from res where label = 'i1'),
  'the same key returns the same request');
select is((select j from res where label = 'i2'), (select j from res where label = 'i1'),
  'the same key returns the original unchanged, even when the other arguments differ');
select pg_temp.as_user(33);
insert into res select 'i3', public.submit_pickup_request(pg_temp.b(1), pg_temp.k(1), now() + interval '1 hour', null, 'mine', null);
select isnt((select j ->> 'id' from res where label = 'i3'), (select j ->> 'id' from res where label = 'i1'),
  'the same key from another customer is an independent request');
select pg_temp.clear_requests(pg_temp.u(33));
select pg_temp.as_user(34);
select is(public.cancel_pickup_request((select (j ->> 'id')::uuid from res where label = 'i1')) ->> 'status', 'cancelled', 'the first request is cancelled');
select is((public.submit_pickup_request(pg_temp.b(1), pg_temp.k(1), now() + interval '1 hour', null, 'again', null)) ->> 'status', 'cancelled',
  'the same key after a cancel returns the cancelled request, not a new one');
reset role;
select is((select count(*)::int from public.pickup_requests where customer_id = pg_temp.u(34)), 1,
  'three submits with one key left exactly one row');
update public.businesses set is_listed = false where id = pg_temp.b(1);
set local role authenticated;
select pg_temp.as_user(34);
select is(pg_temp.submit_json(pg_temp.b(1), pg_temp.k(1), now() + interval '1 hour', null, 'again', null) ->> 'id',
  (select j ->> 'id' from res where label = 'i1'),
  'a replay still returns the request after the business became unavailable');
select is(pg_temp.try(p_text := 'x'), 'business_unavailable', 'a new key to that business is business_unavailable meanwhile');
reset role;
update public.businesses set is_listed = true where id = pg_temp.b(1);

-- Replays the on-conflict fallback cannot mask: user 41 holds the one allowed pending request for Resto One,
-- and each replay below would fail a check (pending limit, pickup time, empty order) if the key were not looked up first.
set local role authenticated;
select pg_temp.as_user(41);
select lives_ok($$ insert into res select 'r1', public.submit_pickup_request(pg_temp.b(1), pg_temp.k(10), now() + interval '1 hour', null, 'original', null) $$,
  'a first request is accepted for the replay tests');
select is(pg_temp.submit_json(pg_temp.b(1), pg_temp.k(10), now() + interval '2 hours', null, 'second try', null), (select j from res where label = 'r1'),
  'a replay while the one allowed pending request for that business exists returns the original, not too_many_pending');
select is(pg_temp.submit_json(pg_temp.b(1), pg_temp.k(10), now() - interval '1 hour', null, 'late', null), (select j from res where label = 'r1'),
  'a replay with a pickup time now in the past returns the original unchanged');
select is(pg_temp.submit_json(pg_temp.b(1), pg_temp.k(10), now() + interval '1 hour', null, null, null), (select j from res where label = 'r1'),
  'a replay with an empty order returns the original unchanged');
reset role;

-- ── 7. Limits ───────────────────────────────────────────────────────────────
set local role authenticated;
-- one pending request per business (user 35)
select pg_temp.as_user(35);
select lives_ok($$ select pg_temp.sub_biz(2) $$, 'a first pending request to a business is accepted');
select throws_ok($$ select pg_temp.sub_biz(2) $$, 'P0001', 'too_many_pending', 'a second pending request to the same business is too_many_pending');
select lives_ok($$ select pg_temp.sub_biz(3) $$, 'a pending request to a different business is accepted');

-- five pending in total (user 9)
select pg_temp.as_user(9);
select lives_ok($$ select pg_temp.sub_biz(20) $$, 'pending 1 of 5 is accepted');
select lives_ok($$ select pg_temp.sub_biz(21) $$, 'pending 2 of 5 is accepted');
select lives_ok($$ select pg_temp.sub_biz(22) $$, 'pending 3 of 5 is accepted');
select lives_ok($$ select pg_temp.sub_biz(23) $$, 'pending 4 of 5 is accepted');
select lives_ok($$ select pg_temp.sub_biz(24) $$, 'pending 5 of 5 is accepted');
select throws_ok($$ select pg_temp.sub_biz(25) $$, 'P0001', 'too_many_pending', 'a 6th pending request is too_many_pending');
select lives_ok($$ select public.cancel_pickup_request((select (x ->> 'id')::uuid from jsonb_array_elements(public.list_my_pickup_requests() -> 'requests') x
                                                         where x ->> 'business_id' = pg_temp.b(20)::text)) $$, 'cancelling one frees a slot');
select lives_ok($$ select pg_temp.sub_biz(25) $$, 'the 6th request is accepted after a cancel');
select throws_ok($$ select pg_temp.sub_biz(20) $$, 'P0001', 'too_many_pending', 'back at five pending, another is too_many_pending');
reset role;
update public.pickup_requests set expires_at = now() - interval '1 minute'
 where customer_id = pg_temp.u(9) and business_id = pg_temp.b(21);
set local role authenticated;
select pg_temp.as_user(9);
select lives_ok($$ select pg_temp.sub_biz(20) $$, 'a pending request past its expires_at (not yet swept) does not count');
reset role;
update public.pickup_requests set status = 'accepted' where customer_id = pg_temp.u(9) and business_id = pg_temp.b(22);
update public.pickup_requests set status = 'declined' where customer_id = pg_temp.u(9) and business_id = pg_temp.b(23);
set local role authenticated;
select pg_temp.as_user(9);
select lives_ok($$ select pg_temp.sub_biz(26) $$, 'accepted and declined requests do not count (3 pending, a 4th is accepted)');
select lives_ok($$ select pg_temp.sub_biz(27) $$, 'the 5th pending is accepted');
select throws_ok($$ select pg_temp.sub_biz(2) $$, 'P0001', 'too_many_pending', 'and the 6th is too_many_pending again');

-- 10 submits an hour (user 8)
select pg_temp.as_user(8);
select lives_ok($$ select pg_temp.cycle(1, 10) $$, '10 submits in an hour are accepted (each cancelled before the next)');
select throws_ok($$ select pg_temp.sub_biz(2) $$, 'P0001', 'rate_limited', 'the 11th submit in an hour is rate_limited');
select is(pg_temp.submit_json(pg_temp.b(2), (select k from rl_keys where n = 1), now() + interval '1 hour', null, 'x', null) ->> 'id',
  (select id::text from rl_keys where n = 1), 'a replay at the rate limit (10 in the hour) returns the original request, not rate_limited');
select pg_temp.as_user(40);
select lives_ok($$ select pg_temp.sub_biz(2) $$, 'another customer is not affected by the limit');
select pg_temp.as_user(8);
reset role;
update public.pickup_requests set created_at = now() - interval '59 minutes' where customer_id = pg_temp.u(8);
set local role authenticated;
select pg_temp.as_user(8);
select throws_ok($$ select pg_temp.sub_biz(2) $$, 'P0001', 'rate_limited', 'ten requests 59 minutes old still count');
reset role;
update public.pickup_requests set created_at = now() - interval '1 hour' where customer_id = pg_temp.u(8);
set local role authenticated;
select pg_temp.as_user(8);
select is(pg_temp.try(p_text := 'x', p_biz := pg_temp.b(2)), 'OK', 'requests exactly one hour old no longer count');
reset role;

-- ── 8. Expiry rule and job ──────────────────────────────────────────────────
select is(private.pickup_request_expiry(now() + interval '2 hours', now()), now() + interval '30 minutes',
  'expiry is created + 30 minutes when the pickup is later');
select is(private.pickup_request_expiry(now() + interval '10 minutes', now()), now() + interval '10 minutes',
  'expiry is the pickup time when that is earlier');
select is(private.pickup_request_expiry(now() + interval '30 minutes', now()), now() + interval '30 minutes',
  'expiry is the same when both are equal');

-- ── 9. display_status (user 1) ──────────────────────────────────────────────
set local role authenticated;
select pg_temp.as_user(1);
select is(public.get_my_pickup_request(pg_temp.r(11)) -> 'request' ->> 'display_status', 'expired',
  'a pending request past its expires_at shows expired before the job runs');
select is(public.get_my_pickup_request(pg_temp.r(11)) -> 'request' ->> 'status', 'pending', 'and its stored status is still pending');
select is((select x ->> 'display_status' from jsonb_array_elements(public.list_my_pickup_requests() -> 'requests') x
            where x ->> 'id' = pg_temp.r(11)::text), 'expired', 'the list shows it as expired too');
select is(public.get_my_pickup_request(pg_temp.r(1)) -> 'request' ->> 'display_status', 'pending', 'a pending request with time left shows pending');
select is(public.get_my_pickup_request(pg_temp.r(2)) -> 'request' ->> 'display_status', 'accepted', 'an accepted request shows accepted');
select is(public.get_my_pickup_request(pg_temp.r(5)) -> 'request' ->> 'display_status', 'expired', 'a stored expired request shows expired');

-- ── 10. List ────────────────────────────────────────────────────────────────
select is(pg_temp.keys(public.list_my_pickup_requests()), array['requests', 'server_now'], 'the list answer has exactly requests and server_now');
select is((public.list_my_pickup_requests() ->> 'server_now')::timestamptz, now(), 'server_now is the server''s clock');
select is(
  (select array_agg((x ->> 'id')::uuid order by ord) from jsonb_array_elements(public.list_my_pickup_requests() -> 'requests') with ordinality t(x, ord)),
  array[pg_temp.r(1), pg_temp.r(2), pg_temp.r(3), pg_temp.r(4), pg_temp.r(5), pg_temp.r(6), pg_temp.r(7), pg_temp.r(8), pg_temp.r(9),
        pg_temp.r(10), pg_temp.r(11), pg_temp.r(12)],
  'the list holds exactly the caller''s 12 requests, newest first');
select pg_temp.as_user(2);
select is(
  (select array_agg((x ->> 'id')::uuid) from jsonb_array_elements(public.list_my_pickup_requests() -> 'requests') x),
  array[pg_temp.r(50)], 'another customer''s list holds only their own request');
select pg_temp.as_user(7);
select is(public.list_my_pickup_requests() -> 'requests', '[]'::jsonb, 'a customer with no requests gets an empty array');
select pg_temp.as_user(5);
select is(public.list_my_pickup_requests() -> 'requests', '[]'::jsonb, 'a business owner''s list holds no customer requests');
select pg_temp.as_user(32);
select is(jsonb_array_length(public.list_my_pickup_requests() -> 'requests'), 50, 'a page holds 50 requests');
select is(public.list_my_pickup_requests() -> 'requests' -> 0 ->> 'id', pg_temp.r(101)::text, 'the newest request is first');
select is(
  (select array_agg((x ->> 'id')::uuid)
     from jsonb_array_elements(public.list_my_pickup_requests(now() - interval '50 minutes') -> 'requests') x),
  array[pg_temp.r(151)], 'p_before returns only older requests: the 51st');
select is(jsonb_array_length(public.list_my_pickup_requests(now() - interval '51 minutes') -> 'requests'), 0, 'nothing is older than the oldest');

-- ── 11. Get ─────────────────────────────────────────────────────────────────
select pg_temp.as_user(1);
select is(pg_temp.keys(public.get_my_pickup_request(pg_temp.r(1))), array['request', 'server_now'], 'the get answer has exactly request and server_now');
select is(public.get_my_pickup_request(pg_temp.r(1)) -> 'request' ->> 'id', pg_temp.r(1)::text, 'a customer reads their own request');
select is((public.get_my_pickup_request(pg_temp.r(1)) ->> 'server_now')::timestamptz, now(), 'get returns the server''s clock');
select is(jsonb_typeof(public.get_my_pickup_request('00000000-0000-0000-0069-0000000fffff') -> 'request'), 'null', 'an unknown id gives request null');
select pg_temp.as_user(2);
select is(public.get_my_pickup_request(pg_temp.r(1)) - 'server_now',
          public.get_my_pickup_request('00000000-0000-0000-0069-0000000fffff') - 'server_now',
  'someone else''s request and an unknown id give the identical answer');
select pg_temp.as_user(5);
select is(public.get_my_pickup_request(pg_temp.r(1)) - 'server_now', '{"request": null}'::jsonb, 'the owner of the business cannot read the customer''s request');
select pg_temp.as_user(7);
select is(public.get_my_pickup_request(pg_temp.r(1)) - 'server_now', '{"request": null}'::jsonb, 'an outsider cannot read the request');

-- ── 12. Cancel ──────────────────────────────────────────────────────────────
select pg_temp.as_user(2);
select is(pg_temp.cancel_err(pg_temp.r(1)), 'not_found', 'cancelling someone else''s request is not_found');
select pg_temp.as_user(5);
select is(pg_temp.cancel_err(pg_temp.r(1)), 'not_found', 'the business owner cannot cancel a customer''s request');
select is(pg_temp.cancel_err('00000000-0000-0000-0069-0000000fffff'), 'not_found', 'cancelling an unknown request is the same not_found');
select pg_temp.as_user(1);
select is(pg_temp.cancel_err(pg_temp.r(11)), 'invalid_transition', 'a pending request past its expires_at cannot be cancelled');
select is(pg_temp.cancel_err(pg_temp.r(2)), 'invalid_transition', 'an accepted request cannot be cancelled');
select is(pg_temp.cancel_err(pg_temp.r(3)), 'invalid_transition', 'a completed request cannot be cancelled');
select is(pg_temp.cancel_err(pg_temp.r(4)), 'invalid_transition', 'a declined request cannot be cancelled');
select is(pg_temp.cancel_err(pg_temp.r(5)), 'invalid_transition', 'an expired request cannot be cancelled');
select is(pg_temp.cancel_err(pg_temp.r(6)), 'invalid_transition', 'a cancelled request cannot be cancelled again');
select is(pg_temp.cancel_err(pg_temp.r(7)), 'invalid_transition', 'a no_show request cannot be cancelled');
reset role;
select is((select status from public.pickup_requests where id = pg_temp.r(1)), 'pending', 'the refused cancels left the pending request pending');
select is((select status from public.pickup_requests where id = pg_temp.r(11)), 'pending', 'and the overdue request unchanged');
set local role authenticated;
select pg_temp.as_user(1);
select is(public.cancel_pickup_request(pg_temp.r(12)) ->> 'status', 'cancelled', 'the customer cancels their own pending request');
select is(pg_temp.cancel_err(pg_temp.r(12)), 'invalid_transition', 'cancelling twice is invalid_transition');
reset role;
select is((select status || '/' || coalesce(responded_at::text, 'null') from public.pickup_requests where id = pg_temp.r(12)), 'cancelled/null',
  'a customer cancel stores cancelled and leaves responded_at empty');

-- ── 13. The accepted-request address ────────────────────────────────────────
set local role authenticated;
select pg_temp.as_user(1);
select is(public.get_my_pickup_address(pg_temp.r(2)), '{"formatted_address": "2 Secret Rd, Homeville"}'::jsonb,
  'the customer reads the cook''s exact address at accepted');
select is(pg_temp.keys(public.get_my_pickup_address(pg_temp.r(2))), array['formatted_address'], 'the address answer has only formatted_address');
select is(public.get_my_pickup_address(pg_temp.r(3)) ->> 'formatted_address', '2 Secret Rd, Homeville', 'and at completed');
select is(public.get_my_pickup_address(pg_temp.r(1)), null, 'no address while pending');
select is(public.get_my_pickup_address(pg_temp.r(4)), null, 'no address when declined');
select is(public.get_my_pickup_address(pg_temp.r(5)), null, 'no address when expired');
select is(public.get_my_pickup_address(pg_temp.r(6)), null, 'no address when cancelled');
select is(public.get_my_pickup_address(pg_temp.r(7)), null, 'no address when no_show');
select is(public.get_my_pickup_address(pg_temp.r(11)), null, 'no address for a pending request past its expiry');
select is(public.get_my_pickup_address(pg_temp.r(10)), null, 'no address for a restaurant request (its address is public)');
select is(public.get_my_pickup_address(pg_temp.r(8)) ->> 'formatted_address', '16 Secret Rd, Staleville',
  'an accepted customer still gets the address when the cook''s data is over 30 days old');
select is(public.get_my_pickup_address(pg_temp.r(9)) ->> 'formatted_address', '17 Secret Rd, Fourville', 'the address of an accepted request on a listed cook');
select is(public.get_my_pickup_address('00000000-0000-0000-0069-0000000fffff'), null, 'no address for an unknown request');
select pg_temp.as_user(2);
select is(public.get_my_pickup_address(pg_temp.r(2)), null, 'another customer gets no address for someone else''s accepted request');
select pg_temp.as_user(6);
select is(public.get_my_pickup_address(pg_temp.r(2)), null, 'the owner of another business gets no address');
select pg_temp.as_user(5);
select is(public.get_my_pickup_address(pg_temp.r(2)), null, 'even the cook gets nothing from the customer''s address function');
select pg_temp.as_user(7);
select is(public.get_my_pickup_address(pg_temp.r(2)), null, 'an outsider gets no address');
reset role;
update public.businesses set is_listed = false where id = pg_temp.b(17);
set local role authenticated;
select pg_temp.as_user(1);
select is(public.get_my_pickup_address(pg_temp.r(9)), null, 'no address once the cook is no longer listed');
reset role;

-- ── 14. Nothing private leaks ───────────────────────────────────────────────
set local role authenticated;
select pg_temp.as_user(1);
select ok(
  (select position('place_id' in t) = 0 and position('map_lat' in t) = 0 and position('map_lng' in t) = 0
      and position('Secret Rd' in t) = 0 and position('71.987654' in t) = 0 and position('101.123456' in t) = 0
      and position('customer_id' in t) = 0 and position('idempotency_key' in t) = 0 and position('responded_at' in t) = 0
     from (select public.list_my_pickup_requests()::text || public.get_my_pickup_request(pg_temp.r(2))::text
                  || public.cancel_pickup_request(pg_temp.r(1))::text t) s),
  'list, get and cancel contain no place_id, map point, exact coordinate, address, customer_id, idempotency_key or responded_at');
select ok(
  (select position('place_id' in t) = 0 and position('map_lat' in t) = 0 and position('Secret Rd' in t) = 0 and position('71.987654' in t) = 0
     from (select (res.j)::text t from res where label = 'c') s),
  'a submit answer for a homemade cook contains no place_id, map point, address or exact coordinate');
select ok(position('71.987654' in public.get_my_pickup_address(pg_temp.r(2))::text) = 0
      and position('place_id' in public.get_my_pickup_address(pg_temp.r(2))::text) = 0,
  'the address answer contains no coordinates or place_id');
reset role;

-- ── 8b. The expiry job (last among the status tests: it sweeps the overdue fixtures) ──
select private.expire_pickup_requests();
select is((select status from public.pickup_requests where id = pg_temp.r(60)), 'expired', 'a pending request with expires_at = now() expires');
select is((select status from public.pickup_requests where id = pg_temp.r(61)), 'pending', 'a pending request with one second left stays pending');
select is((select status from public.pickup_requests where id = pg_temp.r(67)), 'expired', 'a pending request an hour overdue expires');
select is(
  (select array_agg(status order by id) from public.pickup_requests where id between pg_temp.r(62) and pg_temp.r(66)),
  array['accepted', 'declined', 'cancelled', 'completed', 'no_show'],
  'accepted, declined, cancelled, completed and no_show are left alone, even past their expires_at');
select private.expire_pickup_requests();
select is(
  (select array_agg(status order by id) from public.pickup_requests where customer_id = pg_temp.u(36)),
  array['expired', 'pending', 'accepted', 'declined', 'cancelled', 'completed', 'no_show', 'expired'],
  'a second run changes nothing');

-- ── 15. Cascades ────────────────────────────────────────────────────────────
select is((select count(*)::int from public.pickup_requests where customer_id = pg_temp.u(38)), 2, 'fixture: the cascade customer has two requests');
delete from public.businesses where id = pg_temp.b(30);
select is((select array_agg(id) from public.pickup_requests where customer_id = pg_temp.u(38)), array[pg_temp.r(200)],
  'deleting a business removes its requests only');
delete from auth.users where id = pg_temp.u(38);
select is((select count(*)::int from public.pickup_requests where customer_id = pg_temp.u(38)), 0, 'deleting a customer removes their requests');

select * from finish();
rollback;
