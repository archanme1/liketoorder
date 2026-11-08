-- Spec 10 (PR 1): seller request inbox backend — respond_to_request, mark_request_outcome,
-- list_business_requests (text keyset cursor), get_business_request, count_waiting_requests,
-- the address snapshot, the shared request object, and that outsiders see and change nothing.
-- Own fixtures, one rolled-back transaction. now() is frozen inside it, so boundary fixtures use
-- now() exactly. Calls that are expected to fail go through helpers that return the error text, so a
-- broken function turns a NAMED assertion red instead of aborting the file.
begin;
select plan(247);

-- ── Helpers (pg_temp) ───────────────────────────────────────────────────────
-- Ids:  users 00000000-0000-0000-0010-<n>   businesses …-0410-<n>   requests …-0610-<n>   keys …-0710-<n>
create function pg_temp.u(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0010-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.b(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0410-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.r(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0610-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.k(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0710-' || lpad(n::text, 12, '0'))::uuid $$;

create function pg_temp.as_user(n int) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', pg_temp.u(n)), true);
end $$;

create function pg_temp.keys(j jsonb) returns text[] language sql immutable as $$
  select coalesce(array_agg(k order by k collate "C"), array[]::text[]) from jsonb_object_keys(j) k;
$$;

create function pg_temp.cron_field(p_name text, p_field text) returns text language plpgsql as $$
declare r text;
begin
  if to_regclass('cron.job') is null then return null; end if;
  execute format('select %I::text from cron.job where jobname = $1', p_field) into r using p_name;
  return r;
end $$;

-- One fixture request: pickup and expiry are offsets from now(); snap is the stored address snapshot.
create function pg_temp.mk(n int, biz int, cust int, st text, pickup interval, exp interval,
                           snap text default null, created timestamptz default null)
returns void language sql as $$
  insert into public.pickup_requests (id, business_id, customer_id, status, pickup_at, order_text, idempotency_key,
                                      expires_at, accepted_address, created_at)
  values (pg_temp.r(n), pg_temp.b(biz), pg_temp.u(cust), st, now() + pickup, 'fixture', pg_temp.k(n),
          now() + exp, snap, coalesce(created, now()));
$$;

-- Reads of the closed table for assertions (security definer, so they work while impersonating).
create function pg_temp.st(n int) returns text language sql security definer set search_path = '' as $$
  select status from public.pickup_requests where id = pg_temp.r(n); $$;
create function pg_temp.snap(n int) returns text language sql security definer set search_path = '' as $$
  select accepted_address from public.pickup_requests where id = pg_temp.r(n); $$;
create function pg_temp.responded(n int) returns timestamptz language sql security definer set search_path = '' as $$
  select responded_at from public.pickup_requests where id = pg_temp.r(n); $$;

-- Error-returning wrappers: 'OK' or the error message.
create function pg_temp.resp(n int, decision text) returns text language plpgsql as $$
begin perform public.respond_to_request(pg_temp.r(n), decision); return 'OK';
exception when others then return sqlerrm; end $$;
create function pg_temp.outc(n int, o text) returns text language plpgsql as $$
begin perform public.mark_request_outcome(pg_temp.r(n), o); return 'OK';
exception when others then return sqlerrm; end $$;
create function pg_temp.cancel_err(n int) returns text language plpgsql as $$
begin perform public.cancel_pickup_request(pg_temp.r(n)); return 'OK';
exception when others then return sqlerrm; end $$;
create function pg_temp.list_err(p_status text, p_before text) returns text language plpgsql as $$
begin perform public.list_business_requests(p_status, p_before); return 'OK';
exception when others then return sqlerrm; end $$;
-- Result of a function, or { "error": message }.
create function pg_temp.resp_j(n int, decision text) returns jsonb language plpgsql as $$
begin return public.respond_to_request(pg_temp.r(n), decision);
exception when others then return jsonb_build_object('error', sqlerrm); end $$;
create function pg_temp.outc_j(n int, o text) returns jsonb language plpgsql as $$
begin return public.mark_request_outcome(pg_temp.r(n), o);
exception when others then return jsonb_build_object('error', sqlerrm); end $$;
create function pg_temp.list_j(p_status text default null, p_before text default null) returns jsonb language plpgsql as $$
begin return public.list_business_requests(p_status, p_before);
exception when others then return jsonb_build_object('error', sqlerrm); end $$;
create function pg_temp.get_j(n int) returns jsonb language plpgsql as $$
begin return public.get_business_request(pg_temp.r(n));
exception when others then return jsonb_build_object('error', sqlerrm); end $$;
create function pg_temp.count_j() returns jsonb language plpgsql as $$
begin return public.count_waiting_requests();
exception when others then return jsonb_build_object('error', sqlerrm); end $$;
create function pg_temp.addr_j(n int) returns jsonb language plpgsql as $$
begin return coalesce(public.get_my_pickup_address(pg_temp.r(n)), jsonb_build_object('none', true));
exception when others then return jsonb_build_object('error', sqlerrm); end $$;

-- ids of the requests in a list answer, in order
create function pg_temp.ids_of(j jsonb) returns jsonb language sql immutable as $$
  select coalesce(jsonb_agg(e -> 'id' order by ord), '[]'::jsonb) from jsonb_array_elements(j -> 'requests') with ordinality t(e, ord);
$$;

-- Walks every page (at most 10) of the caller's list with the cursor each page returned.
-- Never raises: { ids, sizes, last_cursor } or { error }.
create function pg_temp.page_all(p_status text default null) returns jsonb language plpgsql as $$
declare v jsonb; cur text := null; ids jsonb := '[]'::jsonb; sizes jsonb := '[]'::jsonb; i int := 0;
begin
  loop
    i := i + 1;
    v := public.list_business_requests(p_status, cur);
    ids := ids || pg_temp.ids_of(v);
    sizes := sizes || to_jsonb(jsonb_array_length(v -> 'requests'));
    cur := v ->> 'next_cursor';
    exit when cur is null or i >= 10;
  end loop;
  return jsonb_build_object('ids', ids, 'sizes', sizes, 'last_cursor', cur);
exception when others then return jsonb_build_object('error', sqlerrm);
end $$;

-- Expected order of a business's requests (superuser/security definer), optionally filtered by display status.
create function pg_temp.expected_ids(biz int, disp text default null) returns jsonb
language sql security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(r.id) order by r.created_at desc, r.id desc), '[]'::jsonb)
    from public.pickup_requests r
   where r.business_id = pg_temp.b(biz)
     and (disp is null or (case when r.status = 'pending' and r.expires_at <= now() then 'expired' else r.status end) = disp);
$$;

-- Customer-side wrappers: the result, or { "error": message }.
create function pg_temp.sub_j(p_biz int, p_key int, p_text text) returns jsonb language plpgsql as $$
begin return public.submit_pickup_request(pg_temp.b(p_biz), pg_temp.k(p_key), now() + interval '2 hours', null, p_text, null);
exception when others then return jsonb_build_object('error', sqlerrm); end $$;
create function pg_temp.myget_j(p_id uuid) returns jsonb language plpgsql as $$
begin return public.get_my_pickup_request(p_id) -> 'request';
exception when others then return jsonb_build_object('error', sqlerrm); end $$;
create function pg_temp.mylist_j() returns jsonb language plpgsql as $$
begin return public.list_my_pickup_requests();
exception when others then return jsonb_build_object('error', sqlerrm); end $$;
create function pg_temp.mycancel_j(p_id uuid) returns jsonb language plpgsql as $$
begin return public.cancel_pickup_request(p_id);
exception when others then return jsonb_build_object('error', sqlerrm); end $$;

-- The lock clause for real: comments are stripped, then the row select must end in `for update`
-- and come before the first update of the table.
create function pg_temp.locks_first(p_fn regprocedure, p_filter text) returns boolean language sql as $$
  with d as (select regexp_replace(regexp_replace(pg_get_functiondef(p_fn), '/\*.*?\*/', '', 'g'), '--[^\n]*', '', 'g') as t),
       m as (select t, (regexp_match(t, '(' || p_filter || '\s+for update)'))[1] as clause from d)
  select coalesce(clause is not null
                  and position(clause in t) < position('update public.pickup_requests' in t), false)
    from m;
$$;

create function pg_temp.rowsig(n int) returns jsonb language sql security definer set search_path = '' as $$
  select to_jsonb(r) - 'accepted_address' from public.pickup_requests r where r.id = pg_temp.r(n); $$;

create temp table res (label text primary key, j jsonb);
grant all on res to public;

-- ── Fixtures (as postgres) ──────────────────────────────────────────────────
-- Users:  1 C1 (display name "Cust One")   2 C2 (no display name)   3 outsider (no business)   4 R1 owner
--         5 H1 owner   6 R2 owner   7 owner of unlisted B4   8 owner of stale B5   9 owner of unlisted home B6
--         10 paging owner B7   11 paging owner B8   12 owner of home B9 (no location row)   13 submitter customer
--         14 count/filter owner B10
-- Businesses: 1 Resto One   2 Home One   3 Resto Two   4 Unlisted Resto   5 Stale Resto (31 d)   6 Unlisted Home
--         7 Paging 123   8 Paging 100   9 Home no location   10 count/filter
insert into auth.users (id, email)
select pg_temp.u(n), 'p10_' || n || '@example.test' from generate_series(1, 14) n;
update public.profiles set username = 'p10_' || right(id::text, 3) where id::text like '00000000-0000-0000-0010-%';
update public.profiles set display_name = 'Cust One' where id = pg_temp.u(1);
-- Seller mode: off for the owners of the unlisted businesses (7 and 9), on for the others.
update public.profiles set is_seller = (id not in (pg_temp.u(7), pg_temp.u(9)))
 where id in (select pg_temp.u(n) from generate_series(4, 12) n);

insert into public.businesses (id, owner_id, type, name, cuisine_code, map_lat, map_lng, public_address, is_listed, currency_code) values
  (pg_temp.b(1),  pg_temp.u(4),  'restaurant', 'Resto One',       'IT', 71.1, 101.1, '1 Main St, Tromso', true,  'CAD'),
  (pg_temp.b(2),  pg_temp.u(5),  'homemade',   'Home One',        'IT', 71.2, 101.2, null,                true,  'CAD'),
  (pg_temp.b(3),  pg_temp.u(6),  'restaurant', 'Resto Two',       'IT', 71.3, 101.3, '3 Main St',         true,  null),
  (pg_temp.b(4),  pg_temp.u(7),  'restaurant', 'Unlisted Resto',  'IT', 71.4, 101.4, '4 Main St',         false, null),
  (pg_temp.b(5),  pg_temp.u(8),  'restaurant', 'Stale Resto',     'IT', 71.5, 101.5, '5 Main St',         true,  null),
  (pg_temp.b(6),  pg_temp.u(9),  'homemade',   'Unlisted Home',   'IT', 71.6, 101.6, null,                false, null),
  (pg_temp.b(7),  pg_temp.u(10), 'restaurant', 'Paging 123',      'IT', 71.7, 101.7, '7 Main St',         true,  null),
  (pg_temp.b(8),  pg_temp.u(11), 'restaurant', 'Paging 100',      'IT', 71.8, 101.8, '8 Main St',         true,  null),
  (pg_temp.b(9),  pg_temp.u(12), 'homemade',   'Home No Place',   'IT', 71.9, 101.9, null,                true,  null),
  (pg_temp.b(10), pg_temp.u(14), 'restaurant', 'Count Resto',     'IT', 72.0, 102.0, '10 Main St',        true,  null);
insert into public.business_locations (business_id, place_id, formatted_address, lat, lng, resolved_at, place_status) values
  (pg_temp.b(1), 'q1', '1 Main St, Tromso',        71.1,      101.1,      now() - interval '1 day',   'ok'),
  (pg_temp.b(2), 'q2', '2 Secret Rd, Homeville',   71.987654, 101.123456, now() - interval '1 day',   'ok'),
  (pg_temp.b(3), 'q3', '3 Main St',                71.3,      101.3,      now() - interval '1 day',   'ok'),
  (pg_temp.b(4), 'q4', '4 Main St',                71.4,      101.4,      now() - interval '1 day',   'ok'),
  (pg_temp.b(5), 'q5', '5 Main St',                71.5,      101.5,      now() - interval '31 days', 'ok'),
  (pg_temp.b(6), 'q6', '6 Secret Rd, Hiddenville', 71.6,      101.6,      now() - interval '1 day',   'ok'),
  (pg_temp.b(7), 'q7', '7 Main St',                71.7,      101.7,      now() - interval '1 day',   'ok'),
  (pg_temp.b(8), 'q8', '8 Main St',                71.8,      101.8,      now() - interval '1 day',   'ok'),
  (pg_temp.b(10), 'q10', '10 Main St',             72.0,      102.0,      now() - interval '1 day',   'ok');
-- B9 (homemade) deliberately has no business_locations row.
insert into public.menu_items (id, business_id, name, description, price_minor, is_available, position)
values ('00000000-0000-0000-0510-000000000001', pg_temp.b(1), 'Soup', null, 850, true, 1);

-- Requests by C1 (user 1) unless noted. Offsets: pickup, expiry.
-- Ownership attacks (never changed by a successful call)
select pg_temp.mk(10, 1, 1, 'pending',  interval '2 hours', interval '30 minutes');
select pg_temp.mk(70, 1, 2, 'pending',  interval '2 hours', interval '30 minutes');          -- C2: no display name
-- Restaurant accept / decline / double taps
select pg_temp.mk(11, 1, 1, 'pending',  interval '2 hours', interval '30 minutes');
select pg_temp.mk(12, 1, 1, 'pending',  interval '2 hours', interval '30 minutes');
select pg_temp.mk(13, 1, 1, 'pending',  interval '2 hours', interval '30 minutes');          -- double accept
select pg_temp.mk(14, 1, 1, 'pending',  interval '2 hours', interval '0 seconds');          -- expires exactly now
select pg_temp.mk(15, 1, 1, 'pending',  interval '2 hours', interval '-1 minute');          -- past expiry, cron has not run
select pg_temp.mk(16, 1, 1, 'pending',  interval '2 hours', interval '1 second');           -- one second left
-- Sources that cannot be answered
select pg_temp.mk(17, 1, 1, 'declined',  interval '2 hours', interval '30 minutes');
select pg_temp.mk(18, 1, 1, 'expired',   interval '2 hours', interval '-1 minute');
select pg_temp.mk(19, 1, 1, 'cancelled', interval '2 hours', interval '30 minutes');
select pg_temp.mk(20, 1, 1, 'accepted',  interval '2 hours', interval '30 minutes');
select pg_temp.mk(21, 1, 1, 'completed', interval '-1 hour', interval '-2 hours');
select pg_temp.mk(22, 1, 1, 'no_show',   interval '-1 hour', interval '-2 hours');
-- Outcomes
select pg_temp.mk(30, 1, 1, 'accepted', interval '0 seconds', interval '-30 minutes');      -- pickup exactly now
select pg_temp.mk(31, 1, 1, 'accepted', interval '1 second',  interval '-30 minutes');      -- one second early
select pg_temp.mk(32, 1, 1, 'accepted', interval '-1 hour',   interval '-2 hours');
select pg_temp.mk(33, 1, 1, 'accepted', interval '-1 hour',   interval '-2 hours');
select pg_temp.mk(34, 1, 1, 'accepted', interval '-1 hour',   interval '-2 hours');         -- double tap on an outcome
select pg_temp.mk(35, 1, 1, 'pending',  interval '-1 hour',   interval '-2 hours');         -- pending with a past pickup
select pg_temp.mk(36, 1, 1, 'declined', interval '-1 hour',   interval '-2 hours');
select pg_temp.mk(37, 1, 1, 'completed', interval '-1 hour',  interval '-2 hours');
select pg_temp.mk(38, 1, 1, 'accepted', interval '-1 hour',   interval '-2 hours');         -- other seller attacks
update public.pickup_requests set responded_at = now() - interval '3 hours' where id in (pg_temp.r(32), pg_temp.r(33), pg_temp.r(34));
-- Homemade B2
select pg_temp.mk(40, 2, 1, 'pending',  interval '3 hours', interval '30 minutes');         -- accept: snapshot
select pg_temp.mk(41, 2, 1, 'pending',  interval '3 hours', interval '30 minutes');         -- decline: no snapshot
select pg_temp.mk(42, 2, 1, 'accepted', interval '3 hours', interval '30 minutes');         -- accepted before spec 10: no snapshot
select pg_temp.mk(43, 2, 1, 'accepted', interval '-25 hours', interval '-26 hours', '2 Secret Rd, Homeville');
select pg_temp.mk(44, 2, 1, 'completed', interval '-23 hours', interval '-24 hours', '2 Secret Rd, Homeville');
select pg_temp.mk(45, 2, 1, 'no_show',  interval '-1 hour',  interval '-2 hours', '2 Secret Rd, Homeville');
select pg_temp.mk(46, 2, 1, 'pending',  interval '3 hours', interval '30 minutes');
select pg_temp.mk(47, 2, 1, 'cancelled', interval '3 hours', interval '30 minutes');
select pg_temp.mk(48, 2, 1, 'expired',  interval '3 hours', interval '-1 minute');
select pg_temp.mk(49, 2, 1, 'declined', interval '3 hours', interval '30 minutes');
-- Unlisted homemade B6, homemade without a location row B9
select pg_temp.mk(50, 6, 1, 'pending',  interval '3 hours', interval '30 minutes');
select pg_temp.mk(51, 9, 1, 'pending',  interval '3 hours', interval '30 minutes');
-- Unlisted restaurant B4 and stale restaurant B5: already-sent requests
select pg_temp.mk(52, 4, 1, 'pending',  interval '3 hours', interval '30 minutes');
select pg_temp.mk(53, 4, 1, 'accepted', interval '-1 hour', interval '-2 hours');
select pg_temp.mk(54, 5, 1, 'pending',  interval '3 hours', interval '30 minutes');
select pg_temp.mk(55, 5, 1, 'accepted', interval '-1 hour', interval '-2 hours');
select pg_temp.mk(56, 4, 1, 'pending',  interval '3 hours', interval '30 minutes');
select pg_temp.mk(57, 5, 1, 'pending',  interval '3 hours', interval '30 minutes');
-- Races
select pg_temp.mk(60, 1, 1, 'pending',  interval '3 hours', interval '30 minutes');         -- customer cancels, then seller answers
select pg_temp.mk(61, 1, 1, 'pending',  interval '3 hours', interval '30 minutes');         -- seller accepts, then customer cancels
select pg_temp.mk(62, 1, 1, 'pending',  interval '3 hours', interval '30 minutes');         -- seller declines, then customer cancels
-- Count / filter business B10: 3 live pending, 1 pending past expiry, accepted, declined, expired(stored)
select pg_temp.mk(80, 10, 1, 'pending',  interval '3 hours', interval '30 minutes');
select pg_temp.mk(81, 10, 1, 'pending',  interval '3 hours', interval '31 minutes');
select pg_temp.mk(82, 10, 1, 'pending',  interval '3 hours', interval '32 minutes');
select pg_temp.mk(83, 10, 1, 'pending',  interval '3 hours', interval '-1 minute');
select pg_temp.mk(84, 10, 1, 'accepted', interval '3 hours', interval '30 minutes');
select pg_temp.mk(85, 10, 1, 'declined', interval '3 hours', interval '30 minutes');
select pg_temp.mk(86, 10, 1, 'expired',  interval '3 hours', interval '-5 minutes');
-- Paging B7: 123 rows. 120 share ONE created_at (with microseconds), 3 are newer. 60 of the tied rows are live pending.
-- Request numbers 1000.. (B7) and 2000.. (B8); keys are k(n).
create temp table paging_t (t timestamptz);
insert into paging_t values (date_trunc('second', now()) - interval '1 hour' + interval '123456 microseconds');
select pg_temp.mk(1000 + n, 7, 1, case when n <= 60 then 'pending' else 'cancelled' end,
                  interval '1 day', interval '1 hour', null, (select t from paging_t))
  from generate_series(1, 120) n;
select pg_temp.mk(1200 + n, 7, 1, 'cancelled', interval '1 day', interval '1 hour', null, (select t + n * interval '1 second' from paging_t))
  from generate_series(1, 3) n;
-- Paging B8: exactly 100 rows sharing one created_at
select pg_temp.mk(2000 + n, 8, 1, 'cancelled', interval '1 day', interval '1 hour', null, (select t from paging_t))
  from generate_series(1, 100) n;
-- Cron fixtures
-- Snapshot retention (homemade B2, snapshots set): around the 24-hour line, now() is frozen so it is exact.
select pg_temp.mk(100, 2, 1, 'accepted',  interval '-25 hours', interval '-26 hours', '2 Secret Rd, Homeville');
select pg_temp.mk(101, 2, 1, 'completed', interval '-25 hours', interval '-26 hours', '2 Secret Rd, Homeville');
select pg_temp.mk(102, 2, 1, 'no_show',   interval '-25 hours', interval '-26 hours', '2 Secret Rd, Homeville');
select pg_temp.mk(103, 2, 1, 'accepted',  interval '-23 hours', interval '-24 hours', '2 Secret Rd, Homeville');
select pg_temp.mk(104, 2, 1, 'accepted',  interval '-24 hours', interval '-25 hours', '2 Secret Rd, Homeville');   -- exactly 24 h
select pg_temp.mk(105, 2, 1, 'accepted',  interval '-23 hours 59 minutes 59 seconds', interval '-25 hours', '2 Secret Rd, Homeville');
update public.pickup_requests set responded_at = now() - interval '27 hours' where id between pg_temp.r(100) and pg_temp.r(105);
select pg_temp.mk(90, 1, 1, 'accepted', interval '3 hours', interval '-1 hour');
select pg_temp.mk(91, 1, 1, 'pending',  interval '3 hours', interval '-1 hour');

-- ── 1. Function privileges ──────────────────────────────────────────────────
select is(
  (select coalesce(array_agg(p.proname::text order by p.proname::text), array[]::text[])
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('respond_to_request', 'mark_request_outcome', 'list_business_requests', 'get_business_request', 'count_waiting_requests')
      and has_function_privilege('authenticated', p.oid, 'execute')),
  array['count_waiting_requests', 'get_business_request', 'list_business_requests', 'mark_request_outcome', 'respond_to_request'],
  'authenticated can execute all five seller functions');
select is_empty(
  $$ select p.proname::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('respond_to_request', 'mark_request_outcome', 'list_business_requests', 'get_business_request', 'count_waiting_requests')
        and (has_function_privilege('anon', p.oid, 'execute')
             or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0)) $$,
  'anon and PUBLIC can execute none of the five seller functions');
select ok(not has_function_privilege('anon', 'private.pickup_request_json(uuid, timestamptz, boolean)', 'execute')
      and not has_function_privilege('authenticated', 'private.pickup_request_json(uuid, timestamptz, boolean)', 'execute')
      and not has_function_privilege('service_role', 'private.pickup_request_json(uuid, timestamptz, boolean)', 'execute'),
  'private.pickup_request_json is executable by none of anon, authenticated, service_role');
select is_empty(
  $$ select p.oid::regprocedure::text from pg_proc p
      where p.oid in ('public.respond_to_request(uuid, text)'::regprocedure,
                      'public.mark_request_outcome(uuid, text)'::regprocedure,
                      'public.list_business_requests(text, text)'::regprocedure,
                      'public.get_business_request(uuid)'::regprocedure,
                      'public.count_waiting_requests()'::regprocedure,
                      'private.pickup_request_json(uuid, timestamptz, boolean)'::regprocedure)
        and (not p.prosecdef or p.proconfig is distinct from array['search_path=""']) $$,
  'all six new functions are security definer with an empty search_path');
select ok(not has_table_privilege('anon', 'public.pickup_requests', 'SELECT, INSERT, UPDATE, DELETE, REFERENCES')
      and not has_table_privilege('authenticated', 'public.pickup_requests', 'SELECT, INSERT, UPDATE, DELETE, REFERENCES'),
  'anon and authenticated hold no table privilege on pickup_requests');
select ok(not has_column_privilege('anon', 'public.pickup_requests', 'accepted_address', 'SELECT, INSERT, UPDATE, REFERENCES')
      and not has_column_privilege('authenticated', 'public.pickup_requests', 'accepted_address', 'SELECT, INSERT, UPDATE, REFERENCES'),
  'no API role has any privilege on accepted_address');
select ok((select relrowsecurity from pg_class where oid = 'public.pickup_requests'::regclass)
      and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'pickup_requests'),
  'pickup_requests has RLS on and no policy');

-- ── 2. No direct table access, for the owner too ────────────────────────────
set local role authenticated;
select pg_temp.as_user(4);       -- the business owner
select throws_ok($$ select * from public.pickup_requests $$, '42501', null, 'the business owner cannot select the table');
select throws_ok($$ select accepted_address from public.pickup_requests $$, '42501', null, 'the business owner cannot select accepted_address');
select throws_ok($$ insert into public.pickup_requests (business_id, customer_id, pickup_at, expires_at, idempotency_key, order_text)
                    values (pg_temp.b(1), pg_temp.u(1), now() + interval '1 hour', now() + interval '30 minutes', gen_random_uuid(), 'x') $$,
  '42501', null, 'the business owner cannot insert a request');
select throws_ok($$ update public.pickup_requests set status = 'accepted' where id = pg_temp.r(10) $$, '42501', null, 'the owner cannot update status');
select throws_ok($$ update public.pickup_requests set accepted_address = 'x' where id = pg_temp.r(10) $$, '42501', null, 'the owner cannot update accepted_address');
select throws_ok($$ update public.pickup_requests set expires_at = now() + interval '2 hours' where id = pg_temp.r(10) $$, '42501', null, 'the owner cannot update expires_at');
select throws_ok($$ update public.pickup_requests set business_id = pg_temp.b(3) where id = pg_temp.r(10) $$, '42501', null, 'the owner cannot update business_id');
select throws_ok($$ update public.pickup_requests set customer_id = pg_temp.u(4) where id = pg_temp.r(10) $$, '42501', null, 'the owner cannot update customer_id');
select throws_ok($$ delete from public.pickup_requests where id = pg_temp.r(10) $$, '42501', null, 'the owner cannot delete a request');
select pg_temp.as_user(1);       -- the customer
select throws_ok($$ update public.pickup_requests set accepted_address = 'x' where id = pg_temp.r(10) $$, '42501', null, 'the customer cannot update accepted_address');
select throws_ok($$ select accepted_address from public.pickup_requests $$, '42501', null, 'the customer cannot select accepted_address');
select throws_ok($$ update public.pickup_requests set status = 'accepted' where id = pg_temp.r(10) $$, '42501', null, 'the customer cannot update status');
select throws_ok($$ insert into public.pickup_requests (business_id, customer_id, pickup_at, expires_at, idempotency_key, order_text)
                    values (pg_temp.b(1), pg_temp.u(1), now() + interval '1 hour', now() + interval '30 minutes', gen_random_uuid(), 'x') $$,
  '42501', null, 'the customer cannot insert a request');
select throws_ok($$ delete from public.pickup_requests where id = pg_temp.r(10) $$, '42501', null, 'the customer cannot delete a request');
select pg_temp.as_user(3);       -- an outsider
select throws_ok($$ select * from public.pickup_requests $$, '42501', null, 'an outsider cannot select the table');
select throws_ok($$ update public.pickup_requests set status = 'accepted' where id = pg_temp.r(10) $$, '42501', null, 'an outsider cannot update status');
select throws_ok($$ insert into public.pickup_requests (business_id, customer_id, pickup_at, expires_at, idempotency_key, order_text)
                    values (pg_temp.b(1), pg_temp.u(3), now() + interval '1 hour', now() + interval '30 minutes', gen_random_uuid(), 'x') $$,
  '42501', null, 'an outsider cannot insert a request');
select throws_ok($$ delete from public.pickup_requests where id = pg_temp.r(10) $$, '42501', null, 'an outsider cannot delete a request');
reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok($$ select accepted_address from public.pickup_requests $$, '42501', null, 'anon cannot select accepted_address');
select throws_ok($$ update public.pickup_requests set accepted_address = 'x' $$, '42501', null, 'anon cannot update accepted_address');
select throws_ok($$ select public.respond_to_request(pg_temp.r(10), 'accepted') $$, '42501', null, 'anon cannot call respond_to_request');
select throws_ok($$ select public.mark_request_outcome(pg_temp.r(10), 'completed') $$, '42501', null, 'anon cannot call mark_request_outcome');
select throws_ok($$ select public.list_business_requests() $$, '42501', null, 'anon cannot call list_business_requests');
select throws_ok($$ select public.get_business_request(pg_temp.r(10)) $$, '42501', null, 'anon cannot call get_business_request');
select throws_ok($$ select public.count_waiting_requests() $$, '42501', null, 'anon cannot call count_waiting_requests');
reset role;

-- Table checks on the new column (as postgres)
select throws_ok($$ update public.pickup_requests set accepted_address = 'x' where id = pg_temp.r(10) $$, '23514', null,
  'a pending request cannot hold an address snapshot');
select throws_ok($$ update public.pickup_requests set accepted_address = '' where id = pg_temp.r(20) $$, '23514', null,
  'an empty address snapshot is refused');
select throws_ok($$ update public.pickup_requests set accepted_address = repeat('x', 301) where id = pg_temp.r(20) $$, '23514', null,
  'a 301-character address snapshot is refused');
select lives_ok($$ update public.pickup_requests set accepted_address = 'ok' where id = pg_temp.r(20) $$, 'an accepted request can hold a snapshot');
update public.pickup_requests set accepted_address = null where id = pg_temp.r(20);

-- ── 3. Not signed in ────────────────────────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select is(pg_temp.resp(10, 'accepted'), 'not_signed_in', 'respond with no user is not_signed_in');
select is(pg_temp.outc(30, 'completed'), 'not_signed_in', 'outcome with no user is not_signed_in');
select is(pg_temp.list_err(null, null), 'not_signed_in', 'list with no user is not_signed_in');
select is(pg_temp.get_j(10) ->> 'error', 'not_signed_in', 'get with no user is not_signed_in');
select is(pg_temp.count_j() ->> 'error', 'not_signed_in', 'count with no user is not_signed_in');
reset role;

-- ── 4. Ownership: nobody else can read or answer another business's request ─
-- Reference answer for an unknown id, then every kind of outsider on a real request (r10 pending, r38 accepted past pickup).
set local role authenticated;
select pg_temp.as_user(6);       -- seller of a different business (B3)
select is(pg_temp.resp(10, 'accepted'), 'not_found', 'another seller cannot accept someone else''s request');
select is(pg_temp.resp(10, 'declined'), 'not_found', 'another seller cannot decline someone else''s request');
select is(pg_temp.resp(999999, 'accepted'), pg_temp.resp(10, 'accepted'), 'and the error is identical to an unknown id');
select is(pg_temp.outc(38, 'completed'), 'not_found', 'another seller cannot mark someone else''s request completed');
select is(pg_temp.outc(38, 'no_show'), 'not_found', 'another seller cannot mark someone else''s request no-show');
select is(pg_temp.outc(999999, 'completed'), pg_temp.outc(38, 'completed'), 'and the outcome error is identical to an unknown id');
select is(pg_temp.get_j(10), jsonb_build_object('server_now', pg_temp.get_j(999999) -> 'server_now', 'request', null),
  'another seller gets request: null from get_business_request');
select is(pg_temp.get_j(10) -> 'request', pg_temp.get_j(999999) -> 'request', 'identical to an unknown id');
select is(jsonb_array_length(pg_temp.list_j() -> 'requests'), 0, 'another seller''s list holds none of B1''s requests');
select is(pg_temp.count_j() ->> 'waiting', '0', 'another seller counts none of B1''s waiting requests');
select pg_temp.as_user(1);       -- the requesting customer
select is(pg_temp.resp(10, 'accepted'), 'not_found', 'the requesting customer cannot answer their own request');
select is(pg_temp.outc(38, 'completed'), 'not_found', 'the customer cannot mark an outcome');
select is(pg_temp.get_j(10) -> 'request', 'null'::jsonb, 'the customer gets request: null from get_business_request');
select is(pg_temp.list_j() -> 'requests', '[]'::jsonb, 'the customer has no business: empty list');
select pg_temp.as_user(3);       -- an outsider with no business
select is(pg_temp.resp(10, 'accepted'), 'not_found', 'an outsider cannot accept');
select is(pg_temp.outc(38, 'no_show'), 'not_found', 'an outsider cannot mark an outcome');
select is(pg_temp.list_j(), jsonb_build_object('server_now', pg_temp.list_j() -> 'server_now', 'requests', '[]'::jsonb, 'next_cursor', null),
  'no business: empty list and no cursor');
select is(pg_temp.count_j() ->> 'waiting', '0', 'no business: zero waiting');
select is(pg_temp.get_j(10) -> 'request', 'null'::jsonb, 'no business: request null');
reset role;
select is(pg_temp.st(10), 'pending', 'r10 is still pending after every outside attempt');
select is(pg_temp.st(38), 'accepted', 'r38 is still accepted after every outside attempt');

-- ── 5. Invalid input ────────────────────────────────────────────────────────
set local role authenticated;
select pg_temp.as_user(4);
select is(pg_temp.resp(10, 'accept'), 'invalid_input', 'an unknown decision is invalid_input');
select is(pg_temp.resp(10, 'ACCEPTED'), 'invalid_input', 'decision case matters');
select is(pg_temp.resp(10, null), 'invalid_input', 'a null decision is invalid_input');
select is(pg_temp.resp(10, ''), 'invalid_input', 'an empty decision is invalid_input');
select is(pg_temp.resp(10, 'completed'), 'invalid_input', 'an outcome is not a decision');
select is(pg_temp.outc(30, 'accepted'), 'invalid_input', 'a decision is not an outcome');
select is(pg_temp.outc(30, 'done'), 'invalid_input', 'an unknown outcome is invalid_input');
select is(pg_temp.outc(30, null), 'invalid_input', 'a null outcome is invalid_input');
select is(pg_temp.outc(30, 'No_Show'), 'invalid_input', 'outcome case matters');
select is(pg_temp.list_err('bogus', null), 'invalid_input', 'an unknown status filter is invalid_input');
select is(pg_temp.list_err('ACCEPTED', null), 'invalid_input', 'status filter case matters');
select is(pg_temp.list_err('', null), 'invalid_input', 'an empty status filter is invalid_input');
reset role;
select is(pg_temp.st(10), 'pending', 'invalid input changed nothing');

-- ── 6. Answer a pending request: restaurant ─────────────────────────────────
set local role authenticated;
select pg_temp.as_user(4);
insert into res select 'acc11', pg_temp.resp_j(11, 'accepted');
select is((select j ->> 'status' from res where label = 'acc11'), 'accepted', 'accept returns the new status (the helper sees the update made in the same call)');
select is((select j ->> 'display_status' from res where label = 'acc11'), 'accepted', 'and the new display status');
select isnt((select j ->> 'responded_at' from res where label = 'acc11'), null, 'responded_at is set');
insert into res select 'dec12', pg_temp.resp_j(12, 'declined');
select is((select j ->> 'status' from res where label = 'dec12'), 'declined', 'decline returns the new status');
reset role;
select is(pg_temp.st(11), 'accepted', 'the restaurant request is stored accepted');
select is(pg_temp.snap(11), null, 'accepting a restaurant request stores no address');
select is(pg_temp.responded(11), now(), 'responded_at is the server time');
select is(pg_temp.st(12), 'declined', 'the declined request is stored declined');
select is(pg_temp.snap(12), null, 'declining stores no address');

-- ── 7. Double tap: the second call is calm and changes nothing ──────────────
set local role authenticated;
select pg_temp.as_user(4);
insert into res select 'dt1', pg_temp.resp_j(13, 'accepted');
insert into res select 'dt2', pg_temp.resp_j(13, 'accepted');
insert into res select 'dt3', pg_temp.resp_j(13, 'declined');
select is((select j ->> 'status' from res where label = 'dt1'), 'accepted', 'double tap: the first accept works');
select is((select j ->> 'error' from res where label = 'dt2'), 'invalid_transition', 'double tap: the same decision again is invalid_transition');
select is((select j ->> 'error' from res where label = 'dt3'), 'invalid_transition', 'double tap: the opposite decision is invalid_transition too');
reset role;
select is(pg_temp.st(13), 'accepted', 'double tap: the row stays accepted (an accepted request cannot be flipped to declined)');
set local role authenticated;
select pg_temp.as_user(4);
insert into res select 'od1', pg_temp.outc_j(34, 'completed');
insert into res select 'od2', pg_temp.outc_j(34, 'completed');
insert into res select 'od3', pg_temp.outc_j(34, 'no_show');
select is((select j ->> 'status' from res where label = 'od1'), 'completed', 'double tap on an outcome: the first call works');
select is((select j ->> 'error' from res where label = 'od2'), 'invalid_transition', 'double tap on an outcome: the same outcome again is invalid_transition');
select is((select j ->> 'error' from res where label = 'od3'), 'invalid_transition', 'double tap on an outcome: the other outcome is invalid_transition');
reset role;
select is(pg_temp.st(34), 'completed', 'double tap on an outcome: the row stays completed');

-- ── 8. Expiry boundaries ────────────────────────────────────────────────────
set local role authenticated;
select pg_temp.as_user(4);
select is(pg_temp.resp(14, 'accepted'), 'invalid_transition', 'a request expiring exactly now cannot be accepted');
select is(pg_temp.resp(14, 'declined'), 'invalid_transition', 'nor declined');
select is(pg_temp.resp(15, 'accepted'), 'invalid_transition', 'a pending request past expires_at cannot be accepted before the cron has run');
select is(pg_temp.get_j(15) -> 'request' ->> 'status', 'pending', 'it is still stored pending (the cron has not run)');
select is(pg_temp.get_j(15) -> 'request' ->> 'display_status', 'expired', 'but the seller sees it as expired');
select is(pg_temp.resp(16, 'accepted'), 'OK', 'a request with one second left can be accepted');
reset role;
select is(pg_temp.st(14), 'pending', 'the boundary request is unchanged');
select is(pg_temp.st(15), 'pending', 'the past-expiry request is unchanged');
select is(pg_temp.st(16), 'accepted', 'the one-second request is accepted');

-- ── 9. Transitions from every other status ──────────────────────────────────
set local role authenticated;
select pg_temp.as_user(4);
select is(pg_temp.resp(17, 'accepted'), 'invalid_transition', 'a declined request cannot be accepted');
select is(pg_temp.resp(18, 'accepted'), 'invalid_transition', 'an expired request cannot be accepted');
select is(pg_temp.resp(19, 'accepted'), 'invalid_transition', 'a cancelled request cannot be accepted');
select is(pg_temp.resp(20, 'declined'), 'invalid_transition', 'an accepted request cannot be declined');
select is(pg_temp.resp(21, 'accepted'), 'invalid_transition', 'a completed request cannot be answered');
select is(pg_temp.resp(22, 'declined'), 'invalid_transition', 'a no-show request cannot be answered');
select is(pg_temp.outc(35, 'completed'), 'invalid_transition', 'a pending request cannot be marked completed');
select is(pg_temp.outc(36, 'no_show'), 'invalid_transition', 'a declined request cannot be marked no-show');
select is(pg_temp.outc(37, 'no_show'), 'invalid_transition', 'a completed request cannot be re-marked');
select is(pg_temp.outc(18, 'completed'), 'invalid_transition', 'an expired request cannot be marked');
select is(pg_temp.outc(19, 'completed'), 'invalid_transition', 'a cancelled request cannot be marked');
select is(pg_temp.outc(20, 'completed'), 'invalid_transition', 'an accepted request before its pickup time cannot be marked');
select is(pg_temp.outc(31, 'completed'), 'invalid_transition', 'one second before the pickup time it cannot be marked');
select is(pg_temp.outc(30, 'completed'), 'OK', 'exactly at the pickup time it can be marked');
insert into res select 'o32', pg_temp.outc_j(32, 'completed');
insert into res select 'o33', pg_temp.outc_j(33, 'no_show');
select is((select j ->> 'status' from res where label = 'o32'), 'completed', 'the outcome result shows completed');
select is((select j ->> 'status' from res where label = 'o33'), 'no_show', 'the outcome result shows no_show');
reset role;
select is(pg_temp.st(30), 'completed', 'the boundary outcome is stored');
select is(pg_temp.st(31), 'accepted', 'the early request is unchanged');
select is(pg_temp.st(32), 'completed', 'completed is stored');
select is(pg_temp.st(33), 'no_show', 'no_show is stored');
select is(pg_temp.responded(32), now() - interval '3 hours', 'an outcome leaves responded_at as it was');
select is(pg_temp.st(17), 'declined', 'refused answers changed nothing (declined)');
select is(pg_temp.st(20), 'accepted', 'refused answers changed nothing (accepted)');
select is(pg_temp.st(35), 'pending', 'refused outcomes changed nothing (pending)');

-- ── 10. Homemade: the address snapshot ──────────────────────────────────────
set local role authenticated;
select pg_temp.as_user(5);
select is(pg_temp.resp(40, 'accepted'), 'OK', 'the cook accepts a homemade request');
select is(pg_temp.resp(41, 'declined'), 'OK', 'the cook declines a homemade request');
reset role;
select is(pg_temp.snap(40), '2 Secret Rd, Homeville', 'accepting stores the cook''s address at that moment');
select is(pg_temp.snap(41), null, 'declining stores no address');
set local role authenticated;
select pg_temp.as_user(1);
select is(pg_temp.addr_j(40), '{"formatted_address": "2 Secret Rd, Homeville"}'::jsonb, 'the customer reads the snapshot');
reset role;
update public.business_locations set formatted_address = '99 New Rd, Newville' where business_id = pg_temp.b(2);
set local role authenticated;
select pg_temp.as_user(1);
select is(pg_temp.addr_j(40) ->> 'formatted_address', '2 Secret Rd, Homeville',
  'after the cook moves, the customer still sees the address from the time of acceptance');
select is(pg_temp.addr_j(42) ->> 'formatted_address', '99 New Rd, Newville',
  'a row accepted before spec 10 (no snapshot) falls back to the current address');
select is(pg_temp.addr_j(44) ->> 'formatted_address', '2 Secret Rd, Homeville', 'a completed request 23 hours after pickup still gets the snapshot');
select is(pg_temp.addr_j(43), '{"none": true}'::jsonb, 'an accepted request 25 hours after pickup gets nothing');
select is(pg_temp.addr_j(45), '{"none": true}'::jsonb, 'no_show gets nothing, even with a snapshot');
select is(pg_temp.addr_j(41), '{"none": true}'::jsonb, 'declined gets nothing');
select is(pg_temp.addr_j(46), '{"none": true}'::jsonb, 'pending gets nothing');
select is(pg_temp.addr_j(47), '{"none": true}'::jsonb, 'cancelled gets nothing');
select is(pg_temp.addr_j(48), '{"none": true}'::jsonb, 'expired gets nothing');
select is(pg_temp.addr_j(11), '{"none": true}'::jsonb, 'an accepted restaurant request gets nothing');
select is(pg_temp.keys(pg_temp.addr_j(40)), array['formatted_address'], 'the address answer has only formatted_address');
select pg_temp.as_user(2);
select is(pg_temp.addr_j(40), '{"none": true}'::jsonb, 'another customer gets no address');
select pg_temp.as_user(6);
select is(pg_temp.addr_j(40), '{"none": true}'::jsonb, 'another seller gets no address');
select pg_temp.as_user(5);
select is(pg_temp.addr_j(40), '{"none": true}'::jsonb, 'even the cook gets nothing from the customer''s address function');
select pg_temp.as_user(3);
select is(pg_temp.addr_j(40), '{"none": true}'::jsonb, 'an outsider gets no address');
reset role;

-- ── 11. No location row, unlisted, stale, seller mode off ───────────────────
select ok(not (select is_seller from public.profiles where id = pg_temp.u(7))
      and not (select is_seller from public.profiles where id = pg_temp.u(9))
      and (select is_seller from public.profiles where id = pg_temp.u(8)),
  'seller mode is off for the unlisted sellers (7 and 9) and on for the stale seller (8)');
set local role authenticated;
select pg_temp.as_user(12);       -- homemade cook with no business_locations row
select is(pg_temp.resp(51, 'accepted'), 'OK', 'accepting is not blocked when the location row is missing');
select pg_temp.as_user(1);
select is(pg_temp.addr_j(51), '{"none": true}'::jsonb, 'the customer then gets no address');
reset role;
select is(pg_temp.snap(51), null, 'and no snapshot was stored');
insert into public.business_locations (business_id, place_id, formatted_address, lat, lng, resolved_at, place_status)
values (pg_temp.b(9), 'q9', '9 Late Rd, Latetown', 71.9, 101.9, now(), 'ok');
set local role authenticated;
select pg_temp.as_user(1);
select is(pg_temp.addr_j(51), '{"none": true}'::jsonb,
  'a location saved after the accept is never shown: the request was answered, so there is no fallback to the live address');
reset role;
set local role authenticated;
select pg_temp.as_user(9);        -- unlisted homemade cook (seller mode off)
select is(pg_temp.list_j() -> 'requests' -> 0 ->> 'id', pg_temp.r(50)::text, 'an unlisted cook still sees the requests already sent');
select is(pg_temp.get_j(50) -> 'request' ->> 'id', pg_temp.r(50)::text, 'and can open one');
select is(pg_temp.count_j() ->> 'waiting', '1', 'and sees the waiting count');
select is(pg_temp.resp(50, 'accepted'), 'OK', 'and can accept it');
reset role;
select is(pg_temp.snap(50), '6 Secret Rd, Hiddenville', 'the snapshot is stored for an unlisted cook');
set local role authenticated;
select pg_temp.as_user(1);
select is(pg_temp.addr_j(50), '{"none": true}'::jsonb, 'the customer sees no address while the cook is unlisted (the is_listed gate stays)');
reset role;
update public.businesses set is_listed = true where id = pg_temp.b(6);
set local role authenticated;
select pg_temp.as_user(1);
select is(pg_temp.addr_j(50) ->> 'formatted_address', '6 Secret Rd, Hiddenville', 'once the cook is listed again the snapshot shows');
select pg_temp.as_user(7);        -- unlisted restaurant
select is(pg_temp.resp(52, 'accepted'), 'OK', 'an unlisted restaurant can accept an already-sent request');
select is(pg_temp.resp(56, 'declined'), 'OK', 'and decline one');
select is(pg_temp.outc(53, 'completed'), 'OK', 'and mark an outcome');
select is(jsonb_array_length(pg_temp.list_j() -> 'requests'), 3, 'and sees its requests');
select is(pg_temp.get_j(53) -> 'request' ->> 'status', 'completed', 'and opens one');
select pg_temp.as_user(8);        -- stale restaurant (31 days)
select is(pg_temp.resp(54, 'accepted'), 'OK', 'a stale restaurant can accept an already-sent request');
select is(pg_temp.resp(57, 'declined'), 'OK', 'and decline one');
select is(pg_temp.outc(55, 'no_show'), 'OK', 'and mark an outcome');
select is(jsonb_array_length(pg_temp.list_j() -> 'requests'), 3, 'and sees its requests');
select is(pg_temp.get_j(55) -> 'request' ->> 'status', 'no_show', 'and opens one');
-- New requests to those businesses are still refused (spec 09).
select pg_temp.as_user(13);
select throws_ok($$ select public.submit_pickup_request(pg_temp.b(4), gen_random_uuid(), now() + interval '1 hour', null, 'x', null) $$,
  'P0001', 'business_unavailable', 'a new request to the unlisted restaurant is still refused');
select throws_ok($$ select public.submit_pickup_request(pg_temp.b(5), gen_random_uuid(), now() + interval '1 hour', null, 'x', null) $$,
  'P0001', 'business_unavailable', 'a new request to the stale restaurant is still refused');
reset role;

-- ── 12. Races: the loser gets invalid_transition and changes nothing ────────
set local role authenticated;
select pg_temp.as_user(1);
select is(pg_temp.cancel_err(60), 'OK', 'the customer cancels first');
select pg_temp.as_user(4);
select is(pg_temp.resp(60, 'accepted'), 'invalid_transition', 'the seller then loses: invalid_transition');
select is(pg_temp.resp(61, 'accepted'), 'OK', 'the seller accepts first');
select is(pg_temp.resp(62, 'declined'), 'OK', 'the seller declines first');
select pg_temp.as_user(1);
select is(pg_temp.cancel_err(61), 'invalid_transition', 'the customer then loses against an accept');
select is(pg_temp.cancel_err(62), 'invalid_transition', 'and against a decline');
reset role;
select is(pg_temp.st(60), 'cancelled', 'cancelled stays cancelled');
select is(pg_temp.st(61), 'accepted', 'accepted stays accepted');
select is(pg_temp.st(62), 'declined', 'declined stays declined');
select ok(pg_temp.locks_first('public.respond_to_request(uuid, text)'::regprocedure, 'r\.business_id = v_b\.id'),
  'respond_to_request locks the row (the business filter is followed by for update) before it updates');
select ok(pg_temp.locks_first('public.mark_request_outcome(uuid, text)'::regprocedure, 'r\.business_id = v_biz'),
  'mark_request_outcome locks the row (the business filter is followed by for update) before it updates');
select ok(pg_temp.locks_first('public.cancel_pickup_request(uuid)'::regprocedure, 'r\.customer_id = v_uid'),
  'cancel_pickup_request locks the row (the same lock, so exactly one side wins)');

-- ── 13. The list: cursor, ties, filters ─────────────────────────────────────
set local role authenticated;
select pg_temp.as_user(10);       -- B7: 123 rows, 120 sharing one created_at
insert into res select 'p7', pg_temp.page_all();
insert into res select 'p7_first', pg_temp.list_j();
insert into res select 'p7w', pg_temp.page_all('waiting');
select pg_temp.as_user(11);       -- B8: exactly 100 rows sharing one created_at
insert into res select 'p8', pg_temp.page_all();
reset role;
select is((select j -> 'sizes' from res where label = 'p7'), '[50, 50, 23]'::jsonb, 'ties: three pages of 50, 50 and 23');
select is((select jsonb_array_length(j -> 'ids') from res where label = 'p7'), 123, 'ties: 123 rows come back in total');
select is((select count(distinct v) from res, jsonb_array_elements_text(j -> 'ids') v where label = 'p7'), 123::bigint, 'ties: no row repeated across pages');
select is((select j -> 'ids' from res where label = 'p7'), pg_temp.expected_ids(7), 'ties: every row, in (created_at, id) descending order');
select is((select j ->> 'last_cursor' from res where label = 'p7'), null, 'ties: the last page has no cursor');
select ok((select j ->> 'next_cursor' from res where label = 'p7_first') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z\|[0-9a-f-]{36}$',
  'the cursor is text: UTC time with six microsecond digits, a bar, the id');
select is((select jsonb_typeof(j -> 'next_cursor') from res where label = 'p7_first'), 'string', 'the cursor is a JSON string');
select is((select j ->> 'next_cursor' from res where label = 'p7_first'),
          to_char((select t from paging_t) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') || '|' || (select (j -> 'requests' -> 49 ->> 'id') from res where label = 'p7_first'),
  'the first cursor is the 50th row''s own created_at (microseconds kept) and id');
select is((select j -> 'sizes' from res where label = 'p7w'), '[50, 10]'::jsonb, 'waiting filter pages across the tie: 50 then 10');
select is((select j -> 'ids' from res where label = 'p7w'), pg_temp.expected_ids(7, 'pending'), 'waiting filter: the 60 live pending rows, no skip, no repeat, in order');
select is((select j -> 'sizes' from res where label = 'p8'), '[50, 50]'::jsonb, 'exactly 100 rows: two pages, no empty third page');
select is((select j ->> 'last_cursor' from res where label = 'p8'), null, 'exactly 100 rows: the second page has no cursor');
select is((select j -> 'ids' from res where label = 'p8'), pg_temp.expected_ids(8), 'exactly 100 rows: all rows in order');

-- Malformed cursors
set local role authenticated;
select pg_temp.as_user(10);
select is(pg_temp.list_err(null, 'now|00000000-0000-0000-0000-000000000001'), 'invalid_input', 'cursor "now|id" is refused');
select is(pg_temp.list_err(null, 'infinity|00000000-0000-0000-0000-000000000001'), 'invalid_input', 'cursor "infinity|id" is refused');
select is(pg_temp.list_err(null, 'epoch|00000000-0000-0000-0000-000000000001'), 'invalid_input', 'cursor "epoch|id" is refused');
select is(pg_temp.list_err(null, '2026-01-01T00:00:00.123456Z|00000000-0000-0000-0000-000000000001|extra'), 'invalid_input', 'a cursor with an extra segment is refused');
select is(pg_temp.list_err(null, '2026-01-01T00:00:00.123456Z|not-a-uuid'), 'invalid_input', 'a cursor with a non-uuid id is refused');
select is(pg_temp.list_err(null, '2026-01-01T00:00:00.123456Z'), 'invalid_input', 'a cursor with no id is refused');
select is(pg_temp.list_err(null, ''), 'invalid_input', 'an empty cursor is refused');
select is(pg_temp.list_err(null, '2026-13-45T25:61:61.123456Z|00000000-0000-0000-0000-000000000001'), 'invalid_input', 'a cursor with an impossible date is refused');
select is(pg_temp.list_err(null, '2026-01-01T00:00:00.123Z|00000000-0000-0000-0000-000000000001'), 'invalid_input', 'a cursor with millisecond precision is refused');
select is(pg_temp.list_err(null, '2026-01-01T00:00:00.123456Z|00000000-0000-0000-0000-00000000000G'), 'invalid_input', 'a cursor id with a non-hex character is refused');
select is(pg_temp.list_err(null, ' 2026-01-01T00:00:00.123456Z|00000000-0000-0000-0000-000000000001'), 'invalid_input', 'a cursor with a leading space is refused');
select is(pg_temp.list_err(null, '2026-01-01T00:00:00.123456Z|00000000-0000-0000-0000-000000000001'), 'OK', 'a well-formed cursor is accepted');
reset role;

-- Filters on B10: 3 live pending, 1 pending past expiry, accepted, declined, stored expired
set local role authenticated;
select pg_temp.as_user(14);
insert into res select 'f_all', pg_temp.page_all();
insert into res select 'f_wait', pg_temp.page_all('waiting');
insert into res select 'f_pend', pg_temp.page_all('pending');
insert into res select 'f_exp', pg_temp.page_all('expired');
insert into res select 'f_acc', pg_temp.page_all('accepted');
insert into res select 'f_dec', pg_temp.page_all('declined');
insert into res select 'f_none', pg_temp.page_all('completed');
select is(pg_temp.count_j() ->> 'waiting', '3', 'count_waiting_requests counts live pending requests only (not the one past expiry)');
reset role;
select is((select jsonb_array_length(j -> 'ids') from res where label = 'f_all'), 7, 'all: 7 requests');
select is((select j -> 'ids' from res where label = 'f_all'), pg_temp.expected_ids(10), 'all: newest first');
select is((select j -> 'ids' from res where label = 'f_wait'), pg_temp.expected_ids(10, 'pending'), 'waiting: the 3 live pending requests');
select is((select jsonb_array_length(j -> 'ids') from res where label = 'f_wait'), 3, 'waiting excludes the pending request past expires_at');
select is((select j -> 'ids' from res where label = 'f_pend'), pg_temp.expected_ids(10, 'pending'), 'pending behaves like waiting');
select is((select j -> 'ids' from res where label = 'f_exp'), pg_temp.expected_ids(10, 'expired'), 'expired includes the pending request past expires_at and the stored expired one');
select is((select jsonb_array_length(j -> 'ids') from res where label = 'f_exp'), 2, 'expired: 2 requests');
select is((select jsonb_array_length(j -> 'ids') from res where label = 'f_acc'), 1, 'accepted: 1 request');
select is((select jsonb_array_length(j -> 'ids') from res where label = 'f_dec'), 1, 'declined: 1 request');
select is((select jsonb_array_length(j -> 'ids') from res where label = 'f_none'), 0, 'completed: none');

-- ── 14. Request objects: exact key sets ─────────────────────────────────────
set local role authenticated;
select pg_temp.as_user(13);       -- a customer with no fixtures
insert into res select 'c_submit', pg_temp.sub_j(1, 5000, 'soup please');
insert into res select 'c_get', pg_temp.myget_j((select (j ->> 'id')::uuid from res where label = 'c_submit'));
insert into res select 'c_list', (pg_temp.mylist_j() -> 'requests' -> 0);
insert into res select 'c_cancel', pg_temp.mycancel_j((select (j ->> 'id')::uuid from res where label = 'c_submit'));
select pg_temp.as_user(4);
insert into res select 's_get', pg_temp.get_j(10) -> 'request';
insert into res select 's_list', (pg_temp.list_j() -> 'requests' -> 0);
insert into res select 's_resp', pg_temp.get_j(11) -> 'request';
insert into res select 's_listkeys', pg_temp.list_j();
insert into res select 's_count', pg_temp.count_j();
reset role;
select is(pg_temp.keys((select j from res where label = 'c_submit')),
  array['business_id', 'business_name', 'business_type', 'created_at', 'currency_code', 'display_status', 'expires_at', 'id',
        'items', 'note', 'order_text', 'pickup_at', 'status'], 'submit returns exactly the 13 spec 09 keys');
select is(pg_temp.keys((select j from res where label = 'c_get')), pg_temp.keys((select j from res where label = 'c_submit')), 'get returns the same keys');
select is(pg_temp.keys((select j from res where label = 'c_list')), pg_temp.keys((select j from res where label = 'c_submit')), 'list returns the same keys');
select is(pg_temp.keys((select j from res where label = 'c_cancel')), pg_temp.keys((select j from res where label = 'c_submit')), 'cancel returns the same keys');
select is((select j ->> 'status' from res where label = 'c_cancel'), 'cancelled', 'cancel returns the new status');
select is(pg_temp.keys((select j from res where label = 's_get')),
  array['business_id', 'business_name', 'business_type', 'created_at', 'currency_code', 'customer_name', 'display_status', 'expires_at', 'id',
        'items', 'note', 'order_text', 'pickup_at', 'responded_at', 'status'], 'the seller object is the 13 keys plus customer_name and responded_at');
select is(pg_temp.keys((select j from res where label = 's_list')), pg_temp.keys((select j from res where label = 's_get')), 'the seller list rows have the same keys as the seller get');
select is(pg_temp.keys((select j from res where label = 's_listkeys')), array['next_cursor', 'requests', 'server_now'], 'the seller list answer has exactly requests, next_cursor and server_now');
select is(pg_temp.keys((select j from res where label = 's_count')), array['server_now', 'waiting'], 'the count answer has exactly server_now and waiting');

-- ── 15. Privacy ─────────────────────────────────────────────────────────────
set local role authenticated;
select pg_temp.as_user(5);        -- the cook: requests with a stored snapshot, and the live address now differs
insert into res select 'h_list', pg_temp.list_j();
insert into res select 'h_get', pg_temp.get_j(40);
insert into res select 'h_resp', pg_temp.resp_j(46, 'accepted');
select pg_temp.as_user(4);
insert into res select 's_c2', pg_temp.get_j(70) -> 'request';
select pg_temp.as_user(1);
insert into res select 'c_get40', pg_temp.myget_j(pg_temp.r(40));
insert into res select 'c_list40', pg_temp.mylist_j();
reset role;
select is((select j ->> 'customer_name' from res where label = 's_get'), 'Cust One', 'customer_name is the display name');
select is((select j ->> 'customer_name' from res where label = 's_c2'), 'p10_002', 'customer_name falls back to the username when there is no display name');
select is_empty(
  $$ select r.label, w from res r, unnest(array['place_id', 'map_lat', 'map_lng', 'customer_id', 'example.test', 'accepted_address',
                                               'Secret Rd', 'New Rd', 'formatted_address', 'coordinates']) w
      where r.label in ('s_get', 's_list', 's_resp', 's_listkeys', 'h_list', 'h_get', 'h_resp', 'acc11', 'dec12', 'o32', 'o33')
        and position(lower(w) in lower(r.j::text)) > 0 $$,
  'no seller response holds a place_id, a coordinate, the customer''s id or email, or an address');
select is_empty(
  $$ select r.label, w from res r, unnest(array['place_id', 'map_lat', 'map_lng', 'customer_id', 'example.test', 'accepted_address',
                                               'Secret Rd', 'New Rd', 'formatted_address', 'customer_name', 'responded_at']) w
      where r.label in ('c_submit', 'c_get', 'c_list', 'c_cancel', 'c_get40', 'c_list40')
        and position(lower(w) in lower(r.j::text)) > 0 $$,
  'no customer response holds an address, a snapshot, a seller-only key or a private id');
select is((select j ->> 'status' from res where label = 'h_resp'), 'accepted', 'the cook''s accept result shows accepted (for the leak check above)');
select is((select j -> 'customer_id' from res where label = 's_get'), null, 'the seller object has no customer_id key');

-- ── 16. The expiry job leaves answered requests alone ───────────────────────
select is(pg_temp.cron_field('pickup-requests-expire', 'schedule'), '* * * * *', 'the expiry job is still scheduled every minute');
insert into res select 'rs' || n, pg_temp.rowsig(n) from unnest(array[100, 101, 102, 103, 104, 105]) n;
select private.expire_pickup_requests();
select is(pg_temp.st(90), 'accepted', 'the expiry job leaves an accepted request alone, even past expires_at');
select is(pg_temp.st(91), 'expired', 'and expires a pending one past expires_at');
select is(pg_temp.snap(100), null, 'the snapshot of an accepted request is cleared more than 24 hours after pickup');
select is(pg_temp.snap(101), null, 'and of a completed one');
select is(pg_temp.snap(102), null, 'and of a no-show');
select is(pg_temp.snap(104), null, 'and at exactly 24 hours, where the read window has closed');
select is(pg_temp.snap(43), null, 'and the older accepted fixture of this file');
select is(pg_temp.snap(103), '2 Secret Rd, Homeville', 'a snapshot 23 hours after pickup is kept');
select is(pg_temp.snap(105), '2 Secret Rd, Homeville', 'and one second inside the window');
select is_empty($$ select b.label from res b where b.label ~ '^rs[0-9]+$' and b.j is distinct from pg_temp.rowsig(substr(b.label, 3)::int) $$,
  'clearing the snapshot changes no other column of any row');
select is(pg_temp.st(100) || pg_temp.st(101) || pg_temp.st(102), 'acceptedcompletedno_show', 'and leaves the statuses alone');
set local role authenticated;
select pg_temp.as_user(1);
select is(pg_temp.addr_j(100), '{"none": true}'::jsonb, 'after the window the customer''s address read is null (and the fallback cannot bring the live address back)');
select is(pg_temp.addr_j(103) ->> 'formatted_address', '2 Secret Rd, Homeville', 'inside the window the address is still shown');
reset role;
select is(pg_temp.st(10), 'pending', 'the untouched pending request is still pending at the end');

select * from finish();
rollback;
