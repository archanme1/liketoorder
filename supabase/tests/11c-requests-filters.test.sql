-- Spec 11c: requests filters - list_my_requests(p_before, p_status) and list_business_requests(p_status,
-- p_before) with one filter contract: null (All), 'pending' (alias 'waiting'), 'accepted' (accepted,
-- completed, no_show), 'declined'; anything else is invalid_input. Overloads and privileges, the rows
-- each filter returns (literal expected ids), refused values, the app on main, keyset paging under
-- every filter (ties, mixed kinds, non-matching rows on the same timestamp, exactly 100 rows), and that
-- outsiders see nothing. Own fixtures, one rolled-back transaction; now() is frozen inside it.
-- Calls go through helpers that return { error } or the error text, so a broken function turns a
-- NAMED assertion red instead of aborting the file.
begin;
select plan(98);

-- -- Helpers (pg_temp) -------------------------------------------------------
-- Ids:  users 00000000-0000-0000-0c11-<n>   businesses ...-0c12-<n>   pickup requests ...-0c13-<n>
--       table requests ...-0c14-<n>          paging rows (both kinds) ...-0c15-<n>
create function pg_temp.u(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0c11-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.b(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0c12-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.p(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0c13-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.t(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0c14-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.s(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0c15-' || lpad(n::text, 12, '0'))::uuid $$;

create function pg_temp.as_user(n int) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', pg_temp.u(n)), true);
end $$;
create function pg_temp.as_nobody() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"authenticated"}', true);
end $$;

-- One request of either kind. exp is the expiry offset from now(); the request time is a day away,
-- so any expiry up to a day satisfies the expiry-order checks.
create function pg_temp.mkx(p_id uuid, p_biz uuid, p_cust uuid, p_kind text, p_status text, p_exp interval, p_created timestamptz)
returns void language plpgsql as $$
begin
  if p_kind = 'table' then
    insert into public.table_requests (id, business_id, customer_id, status, table_at, party_size, expires_at, responded_at, idempotency_key, created_at)
    values (p_id, p_biz, p_cust, p_status, now() + interval '1 day', 2, now() + p_exp,
            case when p_status in ('accepted', 'declined', 'completed', 'no_show') then now() end, p_id, p_created);
  else
    insert into public.pickup_requests (id, business_id, customer_id, status, pickup_at, order_text, expires_at, responded_at, idempotency_key, created_at)
    values (p_id, p_biz, p_cust, p_status, now() + interval '1 day', 'fixture', now() + p_exp,
            case when p_status in ('accepted', 'declined', 'completed', 'no_show') then now() end, p_id, p_created);
  end if;
end $$;

-- Results, or { "error": message }.
create function pg_temp.my_j(p_before text default null, p_status text default null) returns jsonb language plpgsql as $$
begin return public.list_my_requests(p_before, p_status);
exception when others then return jsonb_build_object('error', sqlerrm); end $$;
create function pg_temp.biz_j(p_status text default null, p_before text default null) returns jsonb language plpgsql as $$
begin return public.list_business_requests(p_status, p_before);
exception when others then return jsonb_build_object('error', sqlerrm); end $$;
-- The calls the app on main makes, each the result or { "error": message }.
create function pg_temp.old_my_named() returns jsonb language plpgsql as $$
begin return public.list_my_requests(p_before => null);
exception when others then return jsonb_build_object('error', sqlerrm); end $$;
create function pg_temp.old_my_positional() returns jsonb language plpgsql as $$
begin return public.list_my_requests(public.list_my_requests() ->> 'next_cursor');
exception when others then return jsonb_build_object('error', sqlerrm); end $$;
create function pg_temp.old_biz_noargs() returns jsonb language plpgsql as $$
begin return public.list_business_requests();
exception when others then return jsonb_build_object('error', sqlerrm); end $$;
-- 'OK' or the error message.
create function pg_temp.my_err(p_status text) returns text language plpgsql as $$
begin perform public.list_my_requests(null, p_status); return 'OK';
exception when others then return sqlerrm; end $$;
create function pg_temp.biz_err(p_status text) returns text language plpgsql as $$
begin perform public.list_business_requests(p_status, null); return 'OK';
exception when others then return sqlerrm; end $$;

-- The ids of a list answer, in order ('{}' for an error).
create function pg_temp.ids(j jsonb) returns text[] language sql immutable as $$
  select coalesce(array_agg(x ->> 'id' order by o), array[]::text[])
    from jsonb_array_elements(coalesce(j -> 'requests', '[]'::jsonb)) with ordinality t(x, o);
$$;

-- Walks every page (at most 12) with the cursor each page returned, under one filter.
-- Never raises: { ids, sizes, last_cursor } or { error }.
create function pg_temp.walk(p_which text, p_status text default null) returns jsonb language plpgsql as $$
declare cur text; v jsonb; ids text[] := '{}'; sizes int[] := '{}'; i int := 0;
begin
  loop
    i := i + 1;
    exit when i > 12;
    v := case p_which when 'my' then public.list_my_requests(cur, p_status) else public.list_business_requests(p_status, cur) end;
    sizes := sizes || jsonb_array_length(v -> 'requests');
    ids := ids || pg_temp.ids(v);
    cur := v ->> 'next_cursor';
    exit when cur is null;
  end loop;
  return jsonb_build_object('ids', to_jsonb(ids), 'sizes', to_jsonb(sizes), 'last_cursor', cur);
exception when others then return jsonb_build_object('error', sqlerrm); end $$;

-- The expected ids from the tables themselves (security definer, so it reads while impersonating):
-- one customer's (p_col 'customer') or business's rows, optionally after a cursor, under a filter.
create function pg_temp.exp_ids(p_col text, p_who uuid, p_status text default null,
                                p_before_at timestamptz default null, p_before_id uuid default null)
returns text[] language sql security definer set search_path = '' as $$
  select coalesce(array_agg(x.id::text order by x.created_at desc, x.id desc), array[]::text[])
    from (select id, created_at, status, expires_at, customer_id, business_id from public.pickup_requests
          union all
          select id, created_at, status, expires_at, customer_id, business_id from public.table_requests) x
   where (case p_col when 'customer' then x.customer_id else x.business_id end) = p_who
     and (p_before_at is null or (x.created_at, x.id) < (p_before_at, p_before_id))
     and case p_status
           when 'pending'  then x.status = 'pending' and x.expires_at > now()
           when 'accepted' then x.status in ('accepted', 'completed', 'no_show')
           when 'declined' then x.status = 'declined'
           else true
         end;
$$;

-- -- Fixtures ----------------------------------------------------------------
-- Users:  1 customer C1 (sends only to B1)   2 outsider customer C2 (sends to B2)   3 owner of B1
--         4 owner of B2   5 no business, no requests   6 owns B3 and sends to B2   7 paging customer (B4)
--         8 owner of B4   9 paging customer (B5)   10 owner of B5   11 sends to B3   12 customer (B6)   13 owner of B6
insert into auth.users (id, email)
select pg_temp.u(n), 'p11c_' || n || '@example.test' from generate_series(1, 13) n;
update public.profiles set username = 'p11c_' || right(id::text, 3) where id::text like '00000000-0000-0000-0c11-%';

insert into public.businesses (id, owner_id, type, name, cuisine_code, map_lat, map_lng, public_address, is_listed, accepts_table_requests)
select pg_temp.b(n), pg_temp.u(o), 'restaurant', 'Filter ' || n, 'IT', 63.0 + n / 10.0, 93.0, n || ' Filter St', true, true
  from (values (1, 3), (2, 4), (3, 6), (4, 8), (5, 10), (6, 13)) v(n, o);

-- C1 to B1: every state of both kinds. Minutes ago (smaller is newer), ties broken by id desc
-- (table ids ...-0c14- sort after pickup ids ...-0c13-, so a tied table row comes first).
--   1 t1 p1 pending live      2 p2 pending past expiry   3 t2 pending past expiry   4 p3 accepted   5 t3 accepted
--   6 t4 p4 completed         7 p5 no_show   8 t5 no_show   9 t6 p6 declined   10 p7 cancelled   11 t7 cancelled
--   12 p8 expired             13 t8 expired
select pg_temp.mkx(case k when 'pickup' then pg_temp.p(n) else pg_temp.t(n) end, pg_temp.b(1), pg_temp.u(1), k, st, ex,
                   now() - m * interval '1 minute')
  from (values
    ('pickup', 1, 'pending',   interval '1 hour',    1), ('table', 1, 'pending',   interval '1 hour',    1),
    ('pickup', 2, 'pending',   interval '-1 minute', 2), ('table', 2, 'pending',   interval '-1 minute', 3),
    ('pickup', 3, 'accepted',  interval '1 hour',    4), ('table', 3, 'accepted',  interval '1 hour',    5),
    ('pickup', 4, 'completed', interval '1 hour',    6), ('table', 4, 'completed', interval '1 hour',    6),
    ('pickup', 5, 'no_show',   interval '1 hour',    7), ('table', 5, 'no_show',   interval '1 hour',    8),
    ('pickup', 6, 'declined',  interval '1 hour',    9), ('table', 6, 'declined',  interval '1 hour',    9),
    ('pickup', 7, 'cancelled', interval '1 hour',   10), ('table', 7, 'cancelled', interval '1 hour',   11),
    ('pickup', 8, 'expired',   interval '-1 minute',12), ('table', 8, 'expired',   interval '-1 minute',13)
  ) v(k, n, st, ex, m);

-- Outsider rows: C2 to B2, user 6 (an owner) to B2 as a customer, user 11 to B3.
select pg_temp.mkx(pg_temp.p(20), pg_temp.b(2), pg_temp.u(2), 'pickup', 'pending',  interval '1 hour', now() - interval '1 minute');
select pg_temp.mkx(pg_temp.t(21), pg_temp.b(2), pg_temp.u(2), 'table',  'declined', interval '1 hour', now() - interval '2 minutes');
select pg_temp.mkx(pg_temp.p(22), pg_temp.b(2), pg_temp.u(6), 'pickup', 'accepted', interval '1 hour', now() - interval '3 minutes');
select pg_temp.mkx(pg_temp.p(23), pg_temp.b(3), pg_temp.u(11), 'pickup', 'pending', interval '1 hour', now() - interval '4 minutes');
-- C12 to B6: one pending request whose expiry is exactly now.
select pg_temp.mkx(pg_temp.p(30), pg_temp.b(6), pg_temp.u(12), 'pickup', 'pending', interval '0', now() - interval '5 minutes');

-- Paging, C7 to B4. Classes (last id digit): 1 pending live, 2 accepted / completed / no_show, 3 declined,
-- and on the same tied timestamp the rows no filter but All returns: 4 cancelled, 5 expired,
-- 6 pending past expiry. Ids k*10 + class interleave the classes; the kind alternates with k.
-- 123 rows per class: 120 share created_at, 3 are newer. All: 369 + 120 = 489 rows.
select pg_temp.mkx(pg_temp.s(k * 10 + c), pg_temp.b(4), pg_temp.u(7),
                   case when k % 2 = 0 then 'table' else 'pickup' end,
                   case c when 1 then 'pending' when 2 then (array['accepted', 'completed', 'no_show'])[1 + k % 3]
                          when 3 then 'declined' when 4 then 'cancelled' when 5 then 'expired' else 'pending' end,
                   case when c in (5, 6) then interval '-1 minute' else interval '1 hour' end,
                   case when k <= 120 then now() - interval '1 hour' else now() - (k - 120) * interval '1 minute' end)
  from generate_series(1, 123) k, generate_series(1, 3) c;
select pg_temp.mkx(pg_temp.s(k * 10 + c), pg_temp.b(4), pg_temp.u(7),
                   case when k % 2 = 0 then 'table' else 'pickup' end,
                   case c when 4 then 'cancelled' when 5 then 'expired' else 'pending' end,
                   interval '-1 minute', now() - interval '1 hour')
  from generate_series(1, 40) k, generate_series(4, 6) c;
-- Paging, C9 to B5: exactly 100 per class, all on one timestamp, with 30 non-matching rows on it too.
select pg_temp.mkx(pg_temp.s(5000 + k * 10 + c), pg_temp.b(5), pg_temp.u(9),
                   case when k % 2 = 0 then 'table' else 'pickup' end,
                   case c when 1 then 'pending' when 2 then (array['accepted', 'completed', 'no_show'])[1 + k % 3]
                          when 3 then 'declined' when 4 then 'cancelled' when 5 then 'expired' else 'pending' end,
                   case when c in (5, 6) then interval '-1 minute' else interval '1 hour' end,
                   now() - interval '2 hours')
  from generate_series(1, 100) k, generate_series(1, 3) c;
select pg_temp.mkx(pg_temp.s(5000 + k * 10 + c), pg_temp.b(5), pg_temp.u(9),
                   case when k % 2 = 0 then 'table' else 'pickup' end,
                   case c when 4 then 'cancelled' when 5 then 'expired' else 'pending' end,
                   interval '-1 minute', now() - interval '2 hours')
  from generate_series(1, 10) k, generate_series(4, 6) c;

create temp table res (label text primary key, j jsonb);
grant all on res to public;

-- -- 1. One overload of each, security definer, privileges ------------------
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'list_my_requests'),
  1, 'exactly one list_my_requests exists');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'list_business_requests'),
  1, 'exactly one list_business_requests exists');
select ok(to_regprocedure('public.list_my_requests(text, text)') is not null, 'list_my_requests(text, text) exists');
select ok(to_regprocedure('public.list_my_requests(text)') is null, 'the old list_my_requests(text) is gone');
select ok((select proargnames = array['p_before', 'p_status'] and pronargdefaults = 2
             from pg_proc where oid = to_regprocedure('public.list_my_requests(text, text)')),
  'list_my_requests takes p_before then p_status, both defaulting to null');
select is_empty(
  $$ select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('list_my_requests', 'list_business_requests')
        and (not p.prosecdef or p.proconfig is distinct from array['search_path=""']) $$,
  'both list functions are security definer with an empty search_path');
select ok(has_function_privilege('authenticated', to_regprocedure('public.list_my_requests(text, text)'), 'execute')
      and has_function_privilege('authenticated', 'public.list_business_requests(text, text)', 'execute'),
  'authenticated can execute both list functions');
select is_empty(
  $$ select p.proname::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('list_my_requests', 'list_business_requests')
        and (has_function_privilege('anon', p.oid, 'execute')
             or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0)) $$,
  'anon and PUBLIC can execute neither list function');

-- -- 2. What each filter returns (C1 / B1) ----------------------------------
set local role authenticated;
select pg_temp.as_user(1);
insert into res select 'm_all',  pg_temp.my_j();
insert into res select 'm_pend', pg_temp.my_j(null, 'pending');
insert into res select 'm_wait', pg_temp.my_j(null, 'waiting');
insert into res select 'm_acc',  pg_temp.my_j(null, 'accepted');
insert into res select 'm_dec',  pg_temp.my_j(null, 'declined');
select pg_temp.as_user(3);
insert into res select 'b_all',  pg_temp.biz_j();
insert into res select 'b_pend', pg_temp.biz_j('pending');
insert into res select 'b_wait', pg_temp.biz_j('waiting');
insert into res select 'b_acc',  pg_temp.biz_j('accepted');
insert into res select 'b_dec',  pg_temp.biz_j('declined');
reset role;

create function pg_temp.lit(p_names text[]) returns text[] language sql immutable as $$
  select array_agg(case left(x, 1) when 'p' then pg_temp.p(substr(x, 2)::int) else pg_temp.t(substr(x, 2)::int) end::text order by o)
    from unnest(p_names) with ordinality u(x, o);
$$;
select is(pg_temp.ids((select j from res where label = 'm_all')),
  pg_temp.lit(array['t1','p1','p2','t2','p3','t3','t4','p4','p5','t5','t6','p6','p7','t7','p8','t8']),
  'Sent All: every row of every status, both kinds, newest first (ties by id)');
select is(pg_temp.ids((select j from res where label = 'm_pend')), pg_temp.lit(array['t1','p1']),
  'Sent Pending: only pending rows not yet past expires_at');
select is(pg_temp.ids((select j from res where label = 'm_wait')), pg_temp.lit(array['t1','p1']),
  'Sent waiting (alias): the same rows as Pending');
select is(pg_temp.ids((select j from res where label = 'm_acc')), pg_temp.lit(array['p3','t3','t4','p4','p5','t5']),
  'Sent Accepted: accepted, completed and no_show, both kinds');
select is(pg_temp.ids((select j from res where label = 'm_dec')), pg_temp.lit(array['t6','p6']),
  'Sent Declined: declined only');
select is(pg_temp.ids((select j from res where label = 'b_all')),
  pg_temp.lit(array['t1','p1','p2','t2','p3','t3','t4','p4','p5','t5','t6','p6','p7','t7','p8','t8']),
  'Received All: every row of every status, both kinds, newest first (ties by id)');
select is(pg_temp.ids((select j from res where label = 'b_pend')), pg_temp.lit(array['t1','p1']),
  'Received Pending: only pending rows not yet past expires_at');
select is(pg_temp.ids((select j from res where label = 'b_wait')), pg_temp.lit(array['t1','p1']),
  'Received waiting (alias): the same rows as Pending');
select is(pg_temp.ids((select j from res where label = 'b_acc')), pg_temp.lit(array['p3','t3','t4','p4','p5','t5']),
  'Received Accepted: accepted, completed and no_show, both kinds');
select is(pg_temp.ids((select j from res where label = 'b_dec')), pg_temp.lit(array['t6','p6']),
  'Received Declined: declined only');
select ok((select bool_and((x ->> 'kind') = case when x ->> 'id' like '00000000-0000-0000-0c14-%' then 'table' else 'pickup' end)
                  and count(*) = 28
             from res r, jsonb_array_elements(r.j -> 'requests') x where r.label like 'm\_%'),
  'Sent: every row under every filter carries the kind of its table');
select ok((select bool_and((x ->> 'kind') = case when x ->> 'id' like '00000000-0000-0000-0c14-%' then 'table' else 'pickup' end)
                  and count(*) = 28
             from res r, jsonb_array_elements(r.j -> 'requests') x where r.label like 'b\_%'),
  'Received: every row under every filter carries the kind of its table');
select is_empty(
  $$ select x ->> 'id' from res r, jsonb_array_elements(r.j -> 'requests') x
      where r.label in ('m_pend', 'm_wait', 'm_acc', 'm_dec')
        and x ->> 'id' = any (pg_temp.lit(array['p2','t2','p7','t7','p8','t8'])) $$,
  'Sent: cancelled, expired and pending-past-expiry rows appear under All only');
select is_empty(
  $$ select x ->> 'id' from res r, jsonb_array_elements(r.j -> 'requests') x
      where r.label in ('b_pend', 'b_wait', 'b_acc', 'b_dec')
        and x ->> 'id' = any (pg_temp.lit(array['p2','t2','p7','t7','p8','t8'])) $$,
  'Received: cancelled, expired and pending-past-expiry rows appear under All only');
select is(pg_temp.ids((select j from res where label = 'm_all')),  pg_temp.ids((select j from res where label = 'b_all')),  'both functions agree under All');
select is(pg_temp.ids((select j from res where label = 'm_pend')), pg_temp.ids((select j from res where label = 'b_pend')), 'both functions agree under Pending');
select is(pg_temp.ids((select j from res where label = 'm_wait')), pg_temp.ids((select j from res where label = 'b_wait')), 'both functions agree under waiting');
select is(pg_temp.ids((select j from res where label = 'm_acc')),  pg_temp.ids((select j from res where label = 'b_acc')),  'both functions agree under Accepted');
select is(pg_temp.ids((select j from res where label = 'm_dec')),  pg_temp.ids((select j from res where label = 'b_dec')),  'both functions agree under Declined');

-- -- 3. Refused values, signed-out callers -----------------------------------
set local role authenticated;
select pg_temp.as_user(1);
select is(pg_temp.my_err('expired'),   'invalid_input', 'Sent: expired is refused');
select is(pg_temp.my_err('cancelled'), 'invalid_input', 'Sent: cancelled is refused');
select is(pg_temp.my_err('completed'), 'invalid_input', 'Sent: completed is refused');
select is(pg_temp.my_err('no_show'),   'invalid_input', 'Sent: no_show is refused');
select is(pg_temp.my_err('bogus'),     'invalid_input', 'Sent: an unknown filter is refused');
select is(pg_temp.my_err('ACCEPTED'),  'invalid_input', 'Sent: filter case matters (ACCEPTED)');
select is(pg_temp.my_err('Pending'),   'invalid_input', 'Sent: filter case matters (Pending)');
select is(pg_temp.my_err(''),          'invalid_input', 'Sent: an empty filter is refused');
select pg_temp.as_user(3);
select is(pg_temp.biz_err('expired'),   'invalid_input', 'Received: expired is refused');
select is(pg_temp.biz_err('cancelled'), 'invalid_input', 'Received: cancelled is refused');
select is(pg_temp.biz_err('completed'), 'invalid_input', 'Received: completed is refused');
select is(pg_temp.biz_err('no_show'),   'invalid_input', 'Received: no_show is refused');
select is(pg_temp.biz_err('bogus'),     'invalid_input', 'Received: an unknown filter is refused');
select is(pg_temp.biz_err('ACCEPTED'),  'invalid_input', 'Received: filter case matters (ACCEPTED)');
select is(pg_temp.biz_err('Pending'),   'invalid_input', 'Received: filter case matters (Pending)');
select is(pg_temp.biz_err(''),          'invalid_input', 'Received: an empty filter is refused');
select pg_temp.as_user(5);
select is(pg_temp.biz_err('bogus'), 'invalid_input', 'Received: a bad filter is refused even for a caller with no business');
select pg_temp.as_nobody();
select is(pg_temp.my_err('pending'),  'not_signed_in', 'Sent: no user is not_signed_in, with a filter');
select is(pg_temp.biz_err('pending'), 'not_signed_in', 'Received: no user is not_signed_in, with a filter');
reset role;

-- -- 4. The app on main keeps working ------------------------------------------
set local role authenticated;
select pg_temp.as_user(1);
select is(pg_temp.ids(pg_temp.old_my_named()), pg_temp.ids((select j from res where label = 'm_all')),
  'old app: list_my_requests with only p_before (named) lists every row');
select is(pg_temp.ids((select j from res where label = 'm_wait')), pg_temp.ids((select j from res where label = 'm_pend')),
  'old app: waiting on list_my_requests gives the Pending rows');
select pg_temp.as_user(3);
select is(pg_temp.ids(pg_temp.old_biz_noargs()), pg_temp.ids((select j from res where label = 'b_all')),
  'old app: list_business_requests with no arguments lists every row');
select is(pg_temp.ids(pg_temp.biz_j('waiting')), pg_temp.ids((select j from res where label = 'b_pend')),
  'old app: list_business_requests(waiting) gives the Pending rows');
select pg_temp.as_user(7);
select is(pg_temp.ids(pg_temp.old_my_positional()),
  (pg_temp.exp_ids('customer', pg_temp.u(7)))[51:100],
  'old app: a positional list_my_requests(cursor) reads page 2 of All');
reset role;

-- -- 5. Paging under every filter ------------------------------------------------
set local role authenticated;
select pg_temp.as_user(7);
insert into res select 'w_my_pend', pg_temp.walk('my', 'pending');
insert into res select 'w_my_acc',  pg_temp.walk('my', 'accepted');
insert into res select 'w_my_dec',  pg_temp.walk('my', 'declined');
insert into res select 'w_my_all',  pg_temp.walk('my');
insert into res select 'x_acc1',    pg_temp.my_j(null, 'accepted');
insert into res select 'x_dec2',    pg_temp.my_j((select j ->> 'next_cursor' from res where label = 'x_acc1'), 'declined');
select pg_temp.as_user(8);
insert into res select 'w_biz_pend', pg_temp.walk('biz', 'pending');
insert into res select 'w_biz_acc',  pg_temp.walk('biz', 'accepted');
insert into res select 'w_biz_dec',  pg_temp.walk('biz', 'declined');
insert into res select 'w_biz_all',  pg_temp.walk('biz');
select pg_temp.as_user(9);
insert into res select 'h_my_pend', pg_temp.walk('my', 'pending');
insert into res select 'h_my_acc',  pg_temp.walk('my', 'accepted');
insert into res select 'h_my_dec',  pg_temp.walk('my', 'declined');
select pg_temp.as_user(10);
insert into res select 'h_biz_pend', pg_temp.walk('biz', 'pending');
insert into res select 'h_biz_acc',  pg_temp.walk('biz', 'accepted');
insert into res select 'h_biz_dec',  pg_temp.walk('biz', 'declined');
reset role;

create function pg_temp.walked(p_label text) returns text[] language sql as $$
  select coalesce(array_agg(x order by o), array[]::text[])
    from res, jsonb_array_elements_text(j -> 'ids') with ordinality t(x, o) where label = p_label;
$$;

-- 123 matching rows (120 tied, kinds alternating, non-matching rows interleaved on the same timestamp).
select is((select j -> 'sizes' from res where label = 'w_my_pend'), '[50, 50, 23]'::jsonb, 'Sent Pending, 123 rows: pages of 50, 50 and 23');
select is(pg_temp.walked('w_my_pend'), pg_temp.exp_ids('customer', pg_temp.u(7), 'pending'), 'Sent Pending, 123 rows: every row once, in (created_at, id) order');
select is((select count(distinct x)::int from res, jsonb_array_elements_text(j -> 'ids') x where label = 'w_my_pend'), 123, 'Sent Pending, 123 rows: 123 distinct ids');
select is((select j ->> 'last_cursor' from res where label = 'w_my_pend'), null, 'Sent Pending, 123 rows: no cursor on the last page');
select is((select j -> 'sizes' from res where label = 'w_my_acc'), '[50, 50, 23]'::jsonb, 'Sent Accepted, 123 rows: pages of 50, 50 and 23');
select is(pg_temp.walked('w_my_acc'), pg_temp.exp_ids('customer', pg_temp.u(7), 'accepted'), 'Sent Accepted, 123 rows: every row once, in (created_at, id) order');
select is((select count(distinct x)::int from res, jsonb_array_elements_text(j -> 'ids') x where label = 'w_my_acc'), 123, 'Sent Accepted, 123 rows: 123 distinct ids');
select is((select j ->> 'last_cursor' from res where label = 'w_my_acc'), null, 'Sent Accepted, 123 rows: no cursor on the last page');
select is((select j -> 'sizes' from res where label = 'w_my_dec'), '[50, 50, 23]'::jsonb, 'Sent Declined, 123 rows: pages of 50, 50 and 23');
select is(pg_temp.walked('w_my_dec'), pg_temp.exp_ids('customer', pg_temp.u(7), 'declined'), 'Sent Declined, 123 rows: every row once, in (created_at, id) order');
select is((select count(distinct x)::int from res, jsonb_array_elements_text(j -> 'ids') x where label = 'w_my_dec'), 123, 'Sent Declined, 123 rows: 123 distinct ids');
select is((select j ->> 'last_cursor' from res where label = 'w_my_dec'), null, 'Sent Declined, 123 rows: no cursor on the last page');
select is((select j -> 'sizes' from res where label = 'w_biz_pend'), '[50, 50, 23]'::jsonb, 'Received Pending, 123 rows: pages of 50, 50 and 23');
select is(pg_temp.walked('w_biz_pend'), pg_temp.exp_ids('business', pg_temp.b(4), 'pending'), 'Received Pending, 123 rows: every row once, in (created_at, id) order');
select is((select count(distinct x)::int from res, jsonb_array_elements_text(j -> 'ids') x where label = 'w_biz_pend'), 123, 'Received Pending, 123 rows: 123 distinct ids');
select is((select j ->> 'last_cursor' from res where label = 'w_biz_pend'), null, 'Received Pending, 123 rows: no cursor on the last page');
select is((select j -> 'sizes' from res where label = 'w_biz_acc'), '[50, 50, 23]'::jsonb, 'Received Accepted, 123 rows: pages of 50, 50 and 23');
select is(pg_temp.walked('w_biz_acc'), pg_temp.exp_ids('business', pg_temp.b(4), 'accepted'), 'Received Accepted, 123 rows: every row once, in (created_at, id) order');
select is((select count(distinct x)::int from res, jsonb_array_elements_text(j -> 'ids') x where label = 'w_biz_acc'), 123, 'Received Accepted, 123 rows: 123 distinct ids');
select is((select j ->> 'last_cursor' from res where label = 'w_biz_acc'), null, 'Received Accepted, 123 rows: no cursor on the last page');
select is((select j -> 'sizes' from res where label = 'w_biz_dec'), '[50, 50, 23]'::jsonb, 'Received Declined, 123 rows: pages of 50, 50 and 23');
select is(pg_temp.walked('w_biz_dec'), pg_temp.exp_ids('business', pg_temp.b(4), 'declined'), 'Received Declined, 123 rows: every row once, in (created_at, id) order');
select is((select count(distinct x)::int from res, jsonb_array_elements_text(j -> 'ids') x where label = 'w_biz_dec'), 123, 'Received Declined, 123 rows: 123 distinct ids');
select is((select j ->> 'last_cursor' from res where label = 'w_biz_dec'), null, 'Received Declined, 123 rows: no cursor on the last page');
select is(pg_temp.walked('w_my_all'), pg_temp.exp_ids('customer', pg_temp.u(7)), 'Sent All, 489 rows: every row once, in order, across ten pages');
select is(pg_temp.walked('w_biz_all'), pg_temp.exp_ids('business', pg_temp.b(4)), 'Received All, 489 rows: every row once, in order, across ten pages');
-- Exactly 100 matching rows: two pages, no empty third page.
select is((select j -> 'sizes' from res where label = 'h_my_pend'), '[50, 50]'::jsonb, 'Sent Pending, exactly 100 rows: two pages of 50, no empty third page');
select is(pg_temp.walked('h_my_pend'), pg_temp.exp_ids('customer', pg_temp.u(9), 'pending'), 'Sent Pending, exactly 100 rows: every row once, in order');
select is((select j -> 'sizes' from res where label = 'h_my_acc'), '[50, 50]'::jsonb, 'Sent Accepted, exactly 100 rows: two pages of 50, no empty third page');
select is(pg_temp.walked('h_my_acc'), pg_temp.exp_ids('customer', pg_temp.u(9), 'accepted'), 'Sent Accepted, exactly 100 rows: every row once, in order');
select is((select j -> 'sizes' from res where label = 'h_my_dec'), '[50, 50]'::jsonb, 'Sent Declined, exactly 100 rows: two pages of 50, no empty third page');
select is(pg_temp.walked('h_my_dec'), pg_temp.exp_ids('customer', pg_temp.u(9), 'declined'), 'Sent Declined, exactly 100 rows: every row once, in order');
select is((select j -> 'sizes' from res where label = 'h_biz_pend'), '[50, 50]'::jsonb, 'Received Pending, exactly 100 rows: two pages of 50, no empty third page');
select is(pg_temp.walked('h_biz_pend'), pg_temp.exp_ids('business', pg_temp.b(5), 'pending'), 'Received Pending, exactly 100 rows: every row once, in order');
select is((select j -> 'sizes' from res where label = 'h_biz_acc'), '[50, 50]'::jsonb, 'Received Accepted, exactly 100 rows: two pages of 50, no empty third page');
select is(pg_temp.walked('h_biz_acc'), pg_temp.exp_ids('business', pg_temp.b(5), 'accepted'), 'Received Accepted, exactly 100 rows: every row once, in order');
select is((select j -> 'sizes' from res where label = 'h_biz_dec'), '[50, 50]'::jsonb, 'Received Declined, exactly 100 rows: two pages of 50, no empty third page');
select is(pg_temp.walked('h_biz_dec'), pg_temp.exp_ids('business', pg_temp.b(5), 'declined'), 'Received Declined, exactly 100 rows: every row once, in order');
-- The cursor does not depend on the filter.
select is(pg_temp.ids((select j from res where label = 'x_dec2')),
  (pg_temp.exp_ids('customer', pg_temp.u(7), 'declined',
                   split_part((select j ->> 'next_cursor' from res where label = 'x_acc1'), '|', 1)::timestamptz,
                   split_part((select j ->> 'next_cursor' from res where label = 'x_acc1'), '|', 2)::uuid))[1:50],
  'an Accepted cursor used under Declined continues with the Declined rows after it');

-- -- 6. Outsiders --------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_user(2);
insert into res select 'o_c2_' || coalesce(f, 'all'), pg_temp.my_j(null, f) from unnest(array[null, 'pending', 'waiting', 'accepted', 'declined']) f;
select pg_temp.as_user(4);
insert into res select 'o_b2_' || coalesce(f, 'all'), pg_temp.biz_j(f) from unnest(array[null, 'pending', 'waiting', 'accepted', 'declined']) f;
select pg_temp.as_user(5);
insert into res select 'o_none_' || coalesce(f, 'all'), pg_temp.biz_j(f) from unnest(array[null, 'pending', 'waiting', 'accepted', 'declined']) f;
select pg_temp.as_user(6);
insert into res select 'o_both_sent', pg_temp.my_j();
insert into res select 'o_both_recv', pg_temp.biz_j();
reset role;
select ok((select count(*) = 5 and bool_and(j ? 'requests')
                  and not bool_or(pg_temp.ids(j) && pg_temp.exp_ids('customer', pg_temp.u(1)))
                  and bool_or(cardinality(pg_temp.ids(j)) > 0)
             from res where label like 'o\_c2\_%'),
  'another customer sees none of C1''s requests under any filter (and does see their own)');
select ok((select count(*) = 5 and bool_and(j ? 'requests')
                  and not bool_or(pg_temp.ids(j) && pg_temp.exp_ids('business', pg_temp.b(1)))
                  and bool_or(cardinality(pg_temp.ids(j)) > 0)
             from res where label like 'o\_b2\_%'),
  'another business sees none of B1''s requests under any filter (and does see its own)');
select ok((select count(*) = 5 and bool_and(j -> 'requests' = '[]'::jsonb) from res where label like 'o\_none\_%'),
  'a caller with no business gets an empty Received list under every filter');
select is(pg_temp.ids((select j from res where label = 'o_both_sent')), array[pg_temp.p(22)::text],
  'an owner''s Sent list holds only what they sent as a customer');
select is(pg_temp.ids((select j from res where label = 'o_both_recv')), array[pg_temp.p(23)::text],
  'an owner''s Received list holds only requests to their business');
set local role anon;
select throws_ok($$ select public.list_my_requests(null, 'pending') $$, '42501', null, 'anon cannot call list_my_requests with a filter');
select throws_ok($$ select public.list_business_requests('pending') $$, '42501', null, 'anon cannot call list_business_requests with a filter');
reset role;

-- -- 7. The expiry edge --------------------------------------------------------------
set local role authenticated;
select pg_temp.as_user(12);
select ok(pg_temp.ids(pg_temp.my_j()) = array[pg_temp.p(30)::text]
          and pg_temp.ids(pg_temp.my_j(null, 'pending')) = array[]::text[],
  'a pending request whose expires_at is exactly now is not Pending (it shows under All)');
reset role;

select * from finish();
rollback;
