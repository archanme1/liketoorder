-- Spec 11 (PR 1): table requests backend - the closed table_requests table, function privileges,
-- submit rules and limits, expiry, get/cancel, kind-aware respond_to_request and
-- mark_request_outcome, mark_arrived (window edges, once only, check order), the merged keyset
-- lists, the request-object key sets, and that outsiders see and change nothing.
-- Own fixtures, one rolled-back transaction. now() is frozen inside it, so boundary fixtures use
-- now() exactly (the arrival window edges are exact). Calls that are expected to fail go through
-- helpers that return the error text, so a broken function turns a NAMED assertion red instead of
-- aborting the file. Hidden characters are built with chr(), never typed.
begin;
select plan(352);

-- -- Helpers (pg_temp) -------------------------------------------------------
-- Ids:  users 00000000-0000-0000-0012-<n>   businesses ...-0412-<n>   table requests ...-0612-<n>
--       keys ...-0712-<n>                      pickup requests ...-0812-<n>
create function pg_temp.u(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0012-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.b(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0412-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.r(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0612-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.k(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0712-' || lpad(n::text, 12, '0'))::uuid $$;
-- One id space for both kinds in the paging fixtures, so rows that share a created_at alternate
-- between pickup and table when ordered by id.
create function pg_temp.sid(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0912-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.pr(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0812-' || lpad(n::text, 12, '0'))::uuid $$;

create function pg_temp.as_user(n int) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', pg_temp.u(n)), true);
end $$;
create function pg_temp.as_nobody() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"authenticated"}', true);
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

-- One table fixture. tat = table time and exp = expiry, both offsets from now(); exp defaults to
-- the earlier of tat and one day, which always satisfies expires_at <= table_at.
create function pg_temp.mk(n int, biz int, cust int, st text, tat interval, exp interval default null,
                           created timestamptz default null, rnote text default null, reason text default null,
                           arrived timestamptz default null, note text default null)
returns void language sql as $$
  insert into public.table_requests (id, business_id, customer_id, status, table_at, party_size, note, decline_reason,
                                     response_note, expires_at, responded_at, arrived_at, idempotency_key, created_at)
  values (pg_temp.r(n), pg_temp.b(biz), pg_temp.u(cust), st, now() + tat, 4, note, reason, rnote,
          now() + coalesce(exp, least(tat, interval '1 day')),
          case when st in ('accepted', 'declined', 'completed', 'no_show') then now() end,
          arrived, pg_temp.k(n), coalesce(created, now()));
$$;
-- One pickup fixture (the pickup time is a day away, so any expiry up to a day satisfies the check).
create function pg_temp.mkp(n int, biz int, cust int, st text, exp interval, created timestamptz default null)
returns void language sql as $$
  insert into public.pickup_requests (id, business_id, customer_id, status, pickup_at, order_text, idempotency_key, expires_at, created_at)
  values (pg_temp.pr(n), pg_temp.b(biz), pg_temp.u(cust), st, now() + interval '1 day', 'fixture', pg_temp.k(n),
          now() + exp, coalesce(created, now()));
$$;

-- Reads of the closed tables for assertions (security definer, so they work while impersonating).
create function pg_temp.st(n int) returns text language sql security definer set search_path = '' as $$
  select status from public.table_requests where id = pg_temp.r(n); $$;
create function pg_temp.pst(n int) returns text language sql security definer set search_path = '' as $$
  select status from public.pickup_requests where id = pg_temp.pr(n); $$;
create function pg_temp.arr(n int) returns timestamptz language sql security definer set search_path = '' as $$
  select arrived_at from public.table_requests where id = pg_temp.r(n); $$;
-- status | reason | note | answered-now, with '-' for null
create function pg_temp.sig(n int) returns text language sql security definer set search_path = '' as $$
  select status || '|' || coalesce(decline_reason, '-') || '|' || coalesce(response_note, '-') || '|'
         || coalesce((responded_at = now())::text, 'false')
    from public.table_requests where id = pg_temp.r(n); $$;
create function pg_temp.untouched(n int) returns boolean language sql security definer set search_path = '' as $$
  select status = 'pending' and decline_reason is null and response_note is null and responded_at is null
    from public.table_requests where id = pg_temp.r(n); $$;
create function pg_temp.cnt(p_uid uuid) returns int language sql security definer set search_path = '' as $$
  select count(*)::int from public.table_requests where customer_id = p_uid; $$;
create function pg_temp.clear_t(p_uid uuid) returns void language sql security definer set search_path = '' as $$
  delete from public.table_requests where customer_id = p_uid; $$;

-- A table submit that returns 'OK' (the customer's rows are cleared again) or the error message.
create function pg_temp.try_sub(p_biz uuid, p_at timestamptz, p_party int, p_note text default null)
returns text language plpgsql as $$
begin
  perform public.submit_table_request(p_biz, gen_random_uuid(), p_at, p_party, p_note);
  perform pg_temp.clear_t(auth.uid());
  return 'OK';
exception when others then return sqlerrm; end $$;
-- A table submit that returns the request, or { "error": message }.
create function pg_temp.sub_j(p_biz uuid, p_key uuid, p_at timestamptz, p_party int, p_note text default null)
returns jsonb language plpgsql as $$
begin return public.submit_table_request(p_biz, p_key, p_at, p_party, p_note);
exception when others then return jsonb_build_object('error', sqlerrm); end $$;

-- Error-returning wrappers: 'OK' or the error message.
create function pg_temp.resp(n int, decision text, reason text default null, note text default null, kind text default 'table')
returns text language plpgsql as $$
begin perform public.respond_to_request(pg_temp.r(n), decision, reason, note, kind); return 'OK';
exception when others then return sqlerrm; end $$;
create function pg_temp.resp_j(n int, decision text, reason text default null, note text default null)
returns jsonb language plpgsql as $$
begin return public.respond_to_request(pg_temp.r(n), decision, reason, note, 'table');
exception when others then return jsonb_build_object('error', sqlerrm); end $$;
create function pg_temp.resp_p(n int, decision text, reason text default null, kind text default 'pickup')
returns text language plpgsql as $$
begin perform public.respond_to_request(pg_temp.pr(n), decision, reason, null, kind); return 'OK';
exception when others then return sqlerrm; end $$;
create function pg_temp.outc(n int, o text, kind text default 'table') returns text language plpgsql as $$
begin perform public.mark_request_outcome(pg_temp.r(n), o, kind); return 'OK';
exception when others then return sqlerrm; end $$;
create function pg_temp.cancel_t(n int) returns text language plpgsql as $$
begin perform public.cancel_table_request(pg_temp.r(n)); return 'OK';
exception when others then return sqlerrm; end $$;
create function pg_temp.arrive(n int) returns text language plpgsql as $$
begin perform public.mark_arrived(pg_temp.r(n)); return 'OK';
exception when others then return sqlerrm; end $$;
create function pg_temp.arrive_j(n int) returns jsonb language plpgsql as $$
begin return public.mark_arrived(pg_temp.r(n));
exception when others then return jsonb_build_object('error', sqlerrm); end $$;
create function pg_temp.count_waiting() returns jsonb language plpgsql as $$
begin return public.count_waiting_requests();
exception when others then return jsonb_build_object('error', sqlerrm); end $$;
create function pg_temp.get_my(p_id uuid) returns jsonb language plpgsql as $$
begin return public.get_my_table_request(p_id);
exception when others then return jsonb_build_object('error', sqlerrm); end $$;
create function pg_temp.get_biz(p_id uuid) returns jsonb language plpgsql as $$
begin return public.get_business_request(p_id);
exception when others then return jsonb_build_object('error', sqlerrm); end $$;
create function pg_temp.my_list(p_before text default null) returns jsonb language plpgsql as $$
begin return public.list_my_requests(p_before);
exception when others then return jsonb_build_object('error', sqlerrm); end $$;
create function pg_temp.biz_list(p_status text default null, p_before text default null) returns jsonb language plpgsql as $$
begin return public.list_business_requests(p_status, p_before);
exception when others then return jsonb_build_object('error', sqlerrm); end $$;
create function pg_temp.my_list_err(p_before text) returns text language plpgsql as $$
begin perform public.list_my_requests(p_before); return 'OK';
exception when others then return sqlerrm; end $$;
create function pg_temp.biz_list_err(p_status text, p_before text) returns text language plpgsql as $$
begin perform public.list_business_requests(p_status, p_before); return 'OK';
exception when others then return sqlerrm; end $$;

-- Walks every page (at most 10) of the caller's list with the cursor each page returned.
-- Never raises: { ids, sizes, last_cursor } or { error }.
create function pg_temp.walk(p_which text, p_status text default null) returns jsonb language plpgsql as $$
declare cur text; v jsonb; ids text[] := '{}'; sizes int[] := '{}'; i int := 0;
begin
  loop
    i := i + 1;
    exit when i > 10;
    v := case p_which when 'my' then public.list_my_requests(cur) else public.list_business_requests(p_status, cur) end;
    sizes := sizes || jsonb_array_length(v -> 'requests');
    ids := ids || array(select x ->> 'id' from jsonb_array_elements(v -> 'requests') x);
    cur := v ->> 'next_cursor';
    exit when cur is null;
  end loop;
  return jsonb_build_object('ids', to_jsonb(ids), 'sizes', to_jsonb(sizes), 'last_cursor', cur);
exception when others then return jsonb_build_object('error', sqlerrm); end $$;

-- Runs one statement and always rolls it back. 'OK' if it was accepted, else the violated
-- constraint's name, else "<sqlstate>: <message>".
create function pg_temp.try(p_sql text) returns text language plpgsql as $$
declare c text;
begin
  begin
    execute p_sql;
    raise exception using errcode = 'P0099', message = '__accepted__';
  exception when others then
    if sqlstate = 'P0099' then return 'OK'; end if;
    get stacked diagnostics c = constraint_name;
    return coalesce(nullif(c, ''), sqlstate || ': ' || sqlerrm);
  end;
end $$;
create function pg_temp.upd(n int, set_clause text) returns text language sql as $$
  select pg_temp.try('update public.table_requests set ' || set_clause || ' where id = ' || quote_literal(pg_temp.r(n)::text) || '::uuid');
$$;

-- The lock clause for real (as specs 10 and 10b): comments are stripped, then the row select must end
-- in `for update` and come before the first update of the table.
create function pg_temp.locks_first(p_fn regprocedure, p_filter text, p_table text) returns boolean language sql as $$
  with d as (select regexp_replace(regexp_replace(pg_get_functiondef(p_fn), '/\*.*?\*/', '', 'g'), '--[^\n]*', '', 'g') as t),
       m as (select t, (regexp_match(t, '(' || p_filter || '\s+for update)'))[1] as clause from d)
  select coalesce(clause is not null and position(clause in t) < position('update public.' || p_table in t), false)
    from m;
$$;

-- -- Fixtures (as postgres) --------------------------------------------------
-- Users:  1 C1 (fixture requests)   2 C2   3 no username   4 owner b1   5 owner b2   6 owner b3   7 outsider
--         8 owner b8   9 owner b9   10 owner b10   14/15/16 owners b14/b15/b16   20 rate limit   21 pending limit
--         22 validation   23 idempotency   24 one pending per business   25 expiry job   26 key sets
--         27 caps (pickup full)   41 caps (table full)   28 paging 123   29 paging 100   33 mixed list   40 rate boundary
--         50..55 owners of b30..b35
-- Businesses:  1 restaurant accepts tables   2 restaurant that does not accept   3 homemade   8 unlisted restaurant (accepts)
--   9 stale 31 d restaurant (accepts)   10 second restaurant (accepts)   14, 15, 16 restaurants (accepts)   30..35 restaurants (accept)
insert into auth.users (id, email)
select pg_temp.u(n), 'p11_' || n || '@example.test'
  from unnest(array[1,2,3,4,5,6,7,8,9,10,14,15,16,20,21,22,23,24,25,26,27,28,29,30,31,32,33,40,41,50,51,52,53,54,55]) n;
update public.profiles set username = 'p11_' || right(id::text, 3) where id::text like '00000000-0000-0000-0012-%';
update public.profiles set username = null where id = pg_temp.u(3);

insert into public.businesses (id, owner_id, type, name, cuisine_code, map_lat, map_lng, public_address, is_listed, accepts_table_requests) values
  (pg_temp.b(1),  pg_temp.u(4),  'restaurant', 'Table One',     'IT', 61.1, 91.1, '1 Main St',  true,  true),
  (pg_temp.b(2),  pg_temp.u(5),  'restaurant', 'No Tables',     'IT', 61.2, 91.2, '2 Main St',  true,  false),
  (pg_temp.b(3),  pg_temp.u(6),  'homemade',   'Home Three',    'IT', 61.3, 91.3, null,         true,  false),
  (pg_temp.b(8),  pg_temp.u(8),  'restaurant', 'Unlisted Tbl',  'IT', 61.4, 91.4, '8 Main St',  false, true),
  (pg_temp.b(9),  pg_temp.u(9),  'restaurant', 'Stale Tbl',     'IT', 61.5, 91.5, '9 Main St',  true,  true),
  (pg_temp.b(10), pg_temp.u(10), 'restaurant', 'Table Ten',     'IT', 61.6, 91.6, '10 Main St', true,  true),
  (pg_temp.b(14), pg_temp.u(14), 'restaurant', 'Table 14',      'IT', 61.7, 91.7, '14 Main St', true,  true),
  (pg_temp.b(15), pg_temp.u(15), 'restaurant', 'Table 15',      'IT', 61.8, 91.8, '15 Main St', true,  true),
  (pg_temp.b(16), pg_temp.u(16), 'restaurant', 'Table 16',      'IT', 61.9, 91.9, '16 Main St', true,  true);
insert into public.businesses (id, owner_id, type, name, cuisine_code, map_lat, map_lng, public_address, is_listed, accepts_table_requests)
select pg_temp.b(30 + i), pg_temp.u(50 + i), 'restaurant', 'Table ' || (30 + i), 'IT', 62.0 + i / 10.0, 92.0, (30 + i) || ' Main St', true, true
  from generate_series(0, 5) i;
insert into public.business_locations (business_id, place_id, formatted_address, lat, lng, resolved_at, place_status)
select b.id, 'p11_' || right(b.id::text, 3), b.public_address, b.map_lat, b.map_lng,
       case when b.id = pg_temp.b(9) then now() - interval '31 days' else now() - interval '1 day' end, 'ok'
  from public.businesses b
 where b.type = 'restaurant' and b.id::text like '00000000-0000-0000-0412-%';

create temp table res (label text primary key, j jsonb);
grant all on res to public;

-- -- 1. The closed table: RLS, no policy, no grant ---------------------------
select ok((select relrowsecurity from pg_class where oid = 'public.table_requests'::regclass), 'table_requests has row level security on');
select is((select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'table_requests'), 0, 'table_requests has no policy');
select is_empty(
  $$ select r || ':' || p from unnest(array['anon', 'authenticated']) r, unnest(array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger']) p
      where has_table_privilege(r, 'public.table_requests', p) $$,
  'anon and authenticated hold no privilege on table_requests');
select is_empty(
  $$ select r || ':' || a.attname || ':' || p from unnest(array['anon', 'authenticated']) r,
            pg_attribute a, unnest(array['select', 'insert', 'update', 'references']) p
      where a.attrelid = 'public.table_requests'::regclass and a.attnum > 0 and not a.attisdropped
        and has_column_privilege(r, 'public.table_requests', a.attname, p) $$,
  'anon and authenticated hold no column privilege on table_requests');
set local role authenticated;
select pg_temp.as_user(1);
select throws_ok($$ select count(*) from public.table_requests $$, '42501', null, 'authenticated cannot read table_requests');
select throws_ok($$ update public.table_requests set status = 'accepted' $$, '42501', null, 'authenticated cannot update table_requests');
select throws_ok($$ delete from public.table_requests $$, '42501', null, 'authenticated cannot delete from table_requests');
select throws_ok($$ insert into public.table_requests (customer_id, business_id, idempotency_key, table_at, party_size, expires_at)
                    values ('00000000-0000-0000-0012-000000000001', '00000000-0000-0000-0412-000000000001', gen_random_uuid(), now() + interval '2 hours', 2, now() + interval '1 hour') $$,
  '42501', null, 'authenticated cannot insert into table_requests');
reset role;
set local role anon;
select throws_ok($$ select count(*) from public.table_requests $$, '42501', null, 'anon cannot read table_requests');
reset role;

-- Table checks, each by the name of the violated constraint (rolled back every time).
select pg_temp.mk(1, 1, 1, 'pending',  interval '3 hours');
select pg_temp.mk(2, 1, 1, 'declined', interval '3 hours', null, null, 'x', 'other');
select pg_temp.mk(3, 1, 1, 'accepted', interval '3 hours');
select is(pg_temp.upd(1, 'party_size = 0'),  'table_requests_party_size_check', 'a party of 0 is refused by the table');
select is(pg_temp.upd(1, 'party_size = 21'), 'table_requests_party_size_check', 'a party of 21 is refused by the table');
select is(pg_temp.upd(1, 'party_size = 20'), 'OK', 'a party of 20 is accepted by the table');
select is(pg_temp.upd(1, 'party_size = 1'),  'OK', 'a party of 1 is accepted by the table');
select is(pg_temp.upd(1, $$status = 'bogus'$$), 'table_requests_status_check', 'an unknown status is refused');
select is(pg_temp.upd(1, 'expires_at = table_at + interval ''1 second'''), 'table_requests_expiry_order', 'an expiry after the table time is refused');
select is(pg_temp.upd(1, 'expires_at = table_at'), 'OK', 'an expiry equal to the table time is accepted');
select is(pg_temp.upd(1, $$decline_reason = 'too_busy'$$), 'table_requests_reason_on_declined', 'a reason on a pending row is refused');
select is(pg_temp.upd(2, $$decline_reason = 'sold_out'$$), 'table_requests_decline_reason_check', 'a pickup reason is not a table reason');
select is(pg_temp.upd(2, $$decline_reason = 'fully_booked', response_note = null$$), 'OK', 'fully_booked without a note is a table reason');
select is(pg_temp.upd(1, $$response_note = 'hello'$$), 'table_requests_note_on_answered', 'a response note on a pending row is refused');
select is(pg_temp.upd(2, 'response_note = null'), 'table_requests_other_has_note', 'an other decline without its text is refused');
select is(pg_temp.upd(2, $$decline_reason = 'too_busy'$$), 'table_requests_declined_note_is_other', 'a fixed reason on a declined row with a note is refused');
select is(pg_temp.upd(2, 'decline_reason = null'), 'table_requests_declined_note_is_other', 'a declined row with a note and a NULL reason is refused (IS NOT DISTINCT FROM)');
select is(pg_temp.upd(1, 'arrived_at = now()'), 'table_requests_arrived_status', 'arrived_at on a pending row is refused');
select is(pg_temp.upd(3, 'arrived_at = now()'), 'OK', 'arrived_at on an accepted row is accepted');
select is(pg_temp.upd(3, $$status = 'completed', arrived_at = now()$$), 'OK', 'arrived_at on a completed row is accepted');
select is(pg_temp.upd(1, 'note = repeat(''a'', 300)'), 'OK', 'a 300 character note is accepted by the table');
select is(pg_temp.upd(1, 'note = ''a'''), 'OK', 'a 1 character note is accepted by the table');
select is(pg_temp.upd(3, 'response_note = ''a'''), 'OK', 'a 1 character response note is accepted by the table');
select is(pg_temp.upd(1, 'note = repeat(''a'', 301)'), 'table_requests_note_check', 'a 301 character note is refused by the table');
select is(pg_temp.upd(1, $$note = ' padded'$$), 'table_requests_note_check', 'a note with a leading space is refused by the table');
select is(pg_temp.upd(3, 'response_note = repeat(''a'', 201)'), 'table_requests_response_note_check', 'a 201 character response note is refused by the table');
select is_empty(
  $$ select c from unnest(array[1, 127, 133, 8203, 8205, 8234, 8238, 8294, 8297, 65279]) c
      where pg_temp.upd(1, 'note = ' || quote_literal('a' || chr(c) || 'b')) is distinct from 'table_requests_note_check' $$,
  'every hidden-character class is refused in note by the table');
select is(pg_temp.try($$ insert into public.table_requests (customer_id, business_id, idempotency_key, table_at, party_size, expires_at)
                         values (pg_temp.u(1), pg_temp.b(1), pg_temp.k(1), now() + interval '2 hours', 2, now() + interval '1 hour') $$),
  'table_requests_idem', 'the same customer and key twice is refused by the table');

-- -- 2. Function privileges --------------------------------------------------
select is(
  (select coalesce(array_agg(p.proname::text order by p.proname::text), array[]::text[])
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('submit_table_request', 'cancel_table_request', 'get_my_table_request', 'mark_arrived', 'list_my_requests')
      and has_function_privilege('authenticated', p.oid, 'execute')),
  array['cancel_table_request', 'get_my_table_request', 'list_my_requests', 'mark_arrived', 'submit_table_request'],
  'authenticated can execute all five new table functions');
select is_empty(
  $$ select p.proname::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('submit_table_request', 'cancel_table_request', 'get_my_table_request', 'mark_arrived', 'list_my_requests',
                          'respond_to_request', 'mark_request_outcome', 'list_business_requests', 'get_business_request', 'count_waiting_requests')
        and (has_function_privilege('anon', p.oid, 'execute')
             or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0)) $$,
  'anon and PUBLIC can execute none of the table and request functions');
select ok(not has_function_privilege('anon', 'private.table_request_json(uuid, timestamptz, boolean)', 'execute')
      and not has_function_privilege('authenticated', 'private.table_request_json(uuid, timestamptz, boolean)', 'execute')
      and not has_function_privilege('service_role', 'private.table_request_json(uuid, timestamptz, boolean)', 'execute'),
  'private.table_request_json is executable by none of anon, authenticated, service_role');
select ok(not has_function_privilege('anon', 'private.table_request_expiry(timestamptz, timestamptz)', 'execute')
      and not has_function_privilege('authenticated', 'private.table_request_expiry(timestamptz, timestamptz)', 'execute')
      and not has_function_privilege('service_role', 'private.table_request_expiry(timestamptz, timestamptz)', 'execute'),
  'private.table_request_expiry is executable by none of anon, authenticated, service_role');
select ok(not has_function_privilege('anon', 'private.expire_pickup_requests()', 'execute')
      and not has_function_privilege('authenticated', 'private.expire_pickup_requests()', 'execute')
      and not has_function_privilege('service_role', 'private.expire_pickup_requests()', 'execute'),
  'private.expire_pickup_requests is still executable by none of anon, authenticated, service_role');
select is_empty(
  $$ select p.oid::regprocedure::text from pg_proc p
      where p.oid in ('public.submit_table_request(uuid, uuid, timestamptz, integer, text)'::regprocedure,
                      'public.cancel_table_request(uuid)'::regprocedure,
                      'public.get_my_table_request(uuid)'::regprocedure,
                      'public.mark_arrived(uuid)'::regprocedure,
                      'public.list_my_requests(text)'::regprocedure,
                      'public.respond_to_request(uuid, text, text, text, text)'::regprocedure,
                      'public.mark_request_outcome(uuid, text, text)'::regprocedure,
                      'private.table_request_json(uuid, timestamptz, boolean)'::regprocedure,
                      'private.table_request_expiry(timestamptz, timestamptz)'::regprocedure)
        and (not p.prosecdef or p.proconfig is distinct from array['search_path=""']) $$,
  'all new and changed functions are security definer with an empty search_path');
set local role anon;
select throws_ok($$ select public.submit_table_request('00000000-0000-0000-0412-000000000001', gen_random_uuid(), now() + interval '2 hours', 2) $$, '42501', null, 'anon cannot call submit_table_request');
select throws_ok($$ select public.cancel_table_request('00000000-0000-0000-0612-000000000001') $$, '42501', null, 'anon cannot call cancel_table_request');
select throws_ok($$ select public.get_my_table_request('00000000-0000-0000-0612-000000000001') $$, '42501', null, 'anon cannot call get_my_table_request');
select throws_ok($$ select public.mark_arrived('00000000-0000-0000-0612-000000000003') $$, '42501', null, 'anon cannot call mark_arrived');
select throws_ok($$ select public.list_my_requests() $$, '42501', null, 'anon cannot call list_my_requests');
select throws_ok($$ select public.respond_to_request('00000000-0000-0000-0612-000000000001', 'accepted', null, null, 'table') $$, '42501', null, 'anon cannot call respond_to_request');
select throws_ok($$ select public.mark_request_outcome('00000000-0000-0000-0612-000000000003', 'completed', 'table') $$, '42501', null, 'anon cannot call mark_request_outcome');
reset role;
select pg_temp.as_nobody();
select throws_ok($$ select public.submit_table_request(pg_temp.b(1), gen_random_uuid(), now() + interval '2 hours', 2) $$, 'P0001', 'not_signed_in', 'no user: submit is not_signed_in');
select throws_ok($$ select public.cancel_table_request(pg_temp.r(1)) $$, 'P0001', 'not_signed_in', 'no user: cancel is not_signed_in');
select throws_ok($$ select public.get_my_table_request(pg_temp.r(1)) $$, 'P0001', 'not_signed_in', 'no user: get is not_signed_in');
select throws_ok($$ select public.mark_arrived(pg_temp.r(3)) $$, 'P0001', 'not_signed_in', 'no user: mark_arrived is not_signed_in');
select throws_ok($$ select public.list_my_requests() $$, 'P0001', 'not_signed_in', 'no user: list_my_requests is not_signed_in');

-- -- 3. One overload each; the old pickup list is gone (PR 2) --------------
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'respond_to_request'), 1, 'exactly one respond_to_request exists');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'mark_request_outcome'), 1, 'exactly one mark_request_outcome exists');
select ok(to_regprocedure('public.respond_to_request(uuid, text, text, text)') is null, 'the old four-argument respond_to_request is gone');
select ok(to_regprocedure('public.mark_request_outcome(uuid, text)') is null, 'the old two-argument mark_request_outcome is gone');
select is((select pronargdefaults::int from pg_proc where oid = 'public.respond_to_request(uuid, text, text, text, text)'::regprocedure),
  3, 'respond_to_request: reason, note and kind default');
select is((select pronargdefaults::int from pg_proc where oid = 'public.mark_request_outcome(uuid, text, text)'::regprocedure),
  1, 'mark_request_outcome: kind defaults');
select is((select pronargs::int from pg_proc where oid = 'public.mark_arrived(uuid)'::regprocedure), 1, 'mark_arrived takes only the request id (no location, no client time)');
select ok(to_regprocedure('public.list_my_pickup_requests(timestamptz)') is null, 'list_my_pickup_requests is dropped in PR 2');
select ok(pg_temp.locks_first('public.respond_to_request(uuid, text, text, text, text)'::regprocedure, 't\.business_id = v_b\.id', 'table_requests'),
  'respond_to_request locks the table row before it updates it');
select ok(pg_temp.locks_first('public.mark_request_outcome(uuid, text, text)'::regprocedure, 't\.business_id = v_biz', 'table_requests'),
  'mark_request_outcome locks the table row before it updates it');
select ok(pg_temp.locks_first('public.cancel_table_request(uuid)'::regprocedure, 't\.customer_id = v_uid', 'table_requests'),
  'cancel_table_request locks the row before it updates it');
select ok(pg_temp.locks_first('public.mark_arrived(uuid)'::regprocedure, 't\.customer_id = v_uid', 'table_requests'),
  'mark_arrived locks the row before it updates it');

-- -- 4. Submit: happy path, replay, refusals ---------------------------------
select pg_temp.as_user(22);
insert into res select 'sub1', pg_temp.sub_j(pg_temp.b(1), pg_temp.k(9001), now() + interval '2 hours', 4, E'  Window seat \n');
select is((select j ->> 'status' from res where label = 'sub1'), 'pending', 'a new table request is pending');
select is((select j ->> 'display_status' from res where label = 'sub1'), 'pending', 'and its display status is pending, never accepted');
select is((select j ->> 'kind' from res where label = 'sub1'), 'table', 'and its kind is table');
select is((select (j ->> 'party_size')::int from res where label = 'sub1'), 4, 'the party size is stored');
select is((select j ->> 'note' from res where label = 'sub1'), 'Window seat', 'the note is trimmed');
select is((select (j ->> 'table_at')::timestamptz from res where label = 'sub1'), now() + interval '2 hours', 'the table time is stored');
select is((select (j ->> 'created_at')::timestamptz from res where label = 'sub1'), now(), 'created_at is the server clock');
select is((select (j ->> 'expires_at')::timestamptz from res where label = 'sub1'), now() + interval '2 hours',
  'expires_at is the table time when that is within 24 hours');
select is((select j ->> 'business_name' from res where label = 'sub1'), 'Table One', 'the business name is joined in');
insert into res select 'sub_far', pg_temp.sub_j(pg_temp.b(10), pg_temp.k(9002), now() + interval '3 days', 2);
select is((select (j ->> 'expires_at')::timestamptz from res where label = 'sub_far'), now() + interval '24 hours',
  'expires_at is 24 hours after the request when the table time is further away');
select is(pg_temp.cnt(pg_temp.u(22)), 2, 'two requests are stored');
-- Replay: the same key returns the same request, unchanged, even with a different payload.
insert into res select 'sub1_again', pg_temp.sub_j(pg_temp.b(10), pg_temp.k(9001), now() + interval '5 hours', 9, 'different');
select is((select j ->> 'id' from res where label = 'sub1_again'), (select j ->> 'id' from res where label = 'sub1'), 'the same key returns the same request');
select is((select (j ->> 'party_size')::int from res where label = 'sub1_again'), 4, 'and it is unchanged');
select is(pg_temp.cnt(pg_temp.u(22)), 2, 'and no new row is stored');
insert into res select 'sub1_bad', pg_temp.sub_j(pg_temp.b(1), pg_temp.k(9001), now() + interval '2 hours', 99);
select is((select j ->> 'id' from res where label = 'sub1_bad'), (select j ->> 'id' from res where label = 'sub1'), 'a replay is answered before the party size is checked');
select pg_temp.clear_t(pg_temp.u(22));

-- Refusals: nothing is written.
select is(pg_temp.try_sub(pg_temp.b(3),  now() + interval '2 hours', 2), 'business_unavailable', 'a homemade business is refused');
select is(pg_temp.try_sub(pg_temp.b(2),  now() + interval '2 hours', 2), 'business_unavailable', 'a restaurant that does not accept tables is refused');
select is(pg_temp.try_sub(pg_temp.b(8),  now() + interval '2 hours', 2), 'business_unavailable', 'an unlisted restaurant is refused');
select is(pg_temp.try_sub(pg_temp.b(9),  now() + interval '2 hours', 2), 'business_unavailable', 'a restaurant whose place is stale (31 days) is refused');
select is(pg_temp.try_sub('00000000-0000-0000-0412-0000000fffff', now() + interval '2 hours', 2), 'business_unavailable', 'an unknown business is refused');
select is(pg_temp.try_sub(null, now() + interval '2 hours', 2), 'business_unavailable', 'a null business is refused');
select pg_temp.as_user(4);
select is(pg_temp.try_sub(pg_temp.b(1), now() + interval '2 hours', 2), 'own_business', 'a request to the caller''s own business is refused');
select pg_temp.as_user(3);
select is(pg_temp.try_sub(pg_temp.b(1), now() + interval '2 hours', 2), 'profile_incomplete', 'a caller without a username is refused');
select pg_temp.as_user(22);
select throws_ok($$ select public.submit_table_request(pg_temp.b(1), null, now() + interval '2 hours', 2) $$, 'P0001', 'invalid_input', 'a null idempotency key is invalid_input');
select is(pg_temp.try_sub(pg_temp.b(1), null, 2), 'invalid_table_time', 'a null table time is refused');
select is(pg_temp.try_sub(pg_temp.b(1), now() + interval '2 hours', null), 'invalid_party_size', 'a null party size is refused');
select is(pg_temp.try_sub(pg_temp.b(1), now() + interval '2 hours', 0), 'invalid_party_size', 'a party of 0 is refused');
select is(pg_temp.try_sub(pg_temp.b(1), now() + interval '2 hours', 1), 'OK', 'a party of 1 is accepted');
select is(pg_temp.try_sub(pg_temp.b(1), now() + interval '2 hours', 20), 'OK', 'a party of 20 is accepted');
select is(pg_temp.try_sub(pg_temp.b(1), now() + interval '2 hours', 21), 'invalid_party_size', 'a party of 21 is refused');
select is(pg_temp.try_sub(pg_temp.b(1), now() + interval '2 hours', -1), 'invalid_party_size', 'a negative party is refused');
select is(pg_temp.try_sub(pg_temp.b(1), now() + interval '2 hours', 100000), 'invalid_party_size', 'a very large party is refused');
select is(pg_temp.try_sub(pg_temp.b(1), now() + interval '29 minutes', 2), 'invalid_table_time', 'a table time 29 minutes ahead is refused');
select is(pg_temp.try_sub(pg_temp.b(1), now() + interval '30 minutes' - interval '1 second', 2), 'invalid_table_time', 'a table time one second under 30 minutes is refused');
select is(pg_temp.try_sub(pg_temp.b(1), now() + interval '30 minutes', 2), 'OK', 'a table time exactly 30 minutes ahead is accepted');
select is(pg_temp.try_sub(pg_temp.b(1), now() + interval '30 days', 2), 'OK', 'a table time exactly 30 days ahead is accepted');
select is(pg_temp.try_sub(pg_temp.b(1), now() + interval '30 days' + interval '1 second', 2), 'invalid_table_time', 'a table time one second past 30 days is refused');
select is(pg_temp.try_sub(pg_temp.b(1), now() - interval '1 hour', 2), 'invalid_table_time', 'a table time in the past is refused');
select is(pg_temp.try_sub(pg_temp.b(1), now() + interval '2 hours', 2, 'a'), 'OK', 'a 1 character note is accepted');
select is(pg_temp.try_sub(pg_temp.b(1), now() + interval '2 hours', 2, repeat('a', 300)), 'OK', 'a 300 character note is accepted');
select is(pg_temp.try_sub(pg_temp.b(1), now() + interval '2 hours', 2, repeat('a', 301)), 'invalid_text', 'a 301 character note is refused');
select is(pg_temp.try_sub(pg_temp.b(1), now() + interval '2 hours', 2, E'line one\nline two'), 'OK', 'a note with a newline is accepted');
select is(pg_temp.try_sub(pg_temp.b(1), now() + interval '2 hours', 2, '   '), 'OK', 'a blank note counts as no note');
select is_empty(
  $$ select c from unnest(array[1, 127, 133, 8203, 8205, 8234, 8238, 8294, 8297, 65279]) c
      where pg_temp.try_sub(pg_temp.b(1), now() + interval '2 hours', 2, 'a' || chr(c) || 'b') is distinct from 'invalid_text' $$,
  'every hidden-character class is refused in the note');
select is(pg_temp.cnt(pg_temp.u(22)), 0, 'no refusal left a row behind');

-- Pending cap: 5 pending in total, 1 per business.
select pg_temp.as_user(21);
select is_empty(
  $$ select i from generate_series(0, 4) i
      where pg_temp.sub_j(pg_temp.b(30 + i), pg_temp.k(9100 + i), now() + interval '2 hours', 2) ? 'error' $$,
  'five pending table requests to five businesses are accepted');
select is(pg_temp.sub_j(pg_temp.b(35), pg_temp.k(9105), now() + interval '2 hours', 2) ->> 'error', 'too_many_pending', 'the sixth pending request is refused');
select is(pg_temp.cnt(pg_temp.u(21)), 5, 'and nothing was written for it');
select pg_temp.as_user(24);
select is(pg_temp.sub_j(pg_temp.b(1), pg_temp.k(9200), now() + interval '2 hours', 2) ? 'error', false, 'one pending request to a business is accepted');
select is(pg_temp.sub_j(pg_temp.b(1), pg_temp.k(9201), now() + interval '3 hours', 2) ->> 'error', 'too_many_pending', 'a second pending request to the same business is refused');
select is(pg_temp.sub_j(pg_temp.b(10), pg_temp.k(9202), now() + interval '3 hours', 2) ? 'error', false, 'a pending request to another business is accepted');
-- A pending row past its expires_at does not count.
select pg_temp.mk(4000, 30, 24, 'pending', interval '-1 hour', interval '-1 hour');
select is(pg_temp.sub_j(pg_temp.b(30), pg_temp.k(9203), now() + interval '2 hours', 2) ? 'error', false, 'an expired pending row does not count toward the cap');
-- Rate limit: 10 an hour; cancelled and expired rows count; rows an hour old do not.
select pg_temp.as_user(20);
select pg_temp.mk(3000 + i, 30 + (i % 6), 20, 'cancelled', interval '3 hours', interval '2 hours', now() - i * interval '1 minute') from generate_series(1, 10) i;
select is(pg_temp.sub_j(pg_temp.b(1), pg_temp.k(9300), now() + interval '2 hours', 2) ->> 'error', 'rate_limited', 'the 11th request in an hour is refused');
select pg_temp.as_user(40);
select pg_temp.mk(3100 + i, 30 + (i % 6), 40, 'cancelled', interval '3 hours', interval '2 hours', now() - i * interval '1 minute') from generate_series(1, 9) i;
select pg_temp.mk(3200 + i, 30 + (i % 6), 40, 'cancelled', interval '3 hours', interval '2 hours', now() - interval '1 hour') from generate_series(1, 5) i;
select is(pg_temp.sub_j(pg_temp.b(1), pg_temp.k(9301), now() + interval '2 hours', 2) ? 'error', false, 'the 10th request in an hour is accepted (rows exactly an hour old do not count)');
select is(pg_temp.sub_j(pg_temp.b(10), pg_temp.k(9302), now() + interval '2 hours', 2) ->> 'error', 'rate_limited', 'and the next one is rate_limited');

-- Pickup and table limits are independent.
select pg_temp.as_user(27);
select pg_temp.mkp(5000 + i, 30 + i, 27, 'pending', interval '20 minutes') from generate_series(0, 4) i;
select is(pg_temp.sub_j(pg_temp.b(1), pg_temp.k(9400), now() + interval '2 hours', 2) ? 'error', false, 'five pending pickups do not block a table request');
select pg_temp.as_user(41);
select pg_temp.mk(5100 + i, 30 + i, 41, 'pending', interval '3 hours', interval '2 hours') from generate_series(0, 4) i;
select is((public.submit_pickup_request(pg_temp.b(1), pg_temp.k(9401), now() + interval '2 hours', null, 'soup', null) ->> 'status'), 'pending',
  'five pending table requests do not block a pickup request');
select pg_temp.as_user(20);
select is((public.submit_pickup_request(pg_temp.b(1), pg_temp.k(9402), now() + interval '2 hours', null, 'soup', null) ->> 'status'), 'pending',
  'ten table requests in an hour do not rate-limit pickup');
select pg_temp.as_user(23);
select pg_temp.mkp(5400 + i, 30 + (i % 6), 23, 'cancelled', interval '20 minutes', now() - i * interval '1 minute') from generate_series(1, 10) i;
select is(pg_temp.sub_j(pg_temp.b(1), pg_temp.k(9403), now() + interval '2 hours', 2) ? 'error', false,
  'ten pickup rows in an hour do not rate-limit a table request');

-- Expired pending rows stay out of the 5-total count; the other kind at the same business does not block.
select pg_temp.as_user(30);
select pg_temp.mk(5500 + i, 30 + i, 30, 'pending', interval '1 hour', interval '-1 minute') from generate_series(0, 4) i;
select is(pg_temp.sub_j(pg_temp.b(1), pg_temp.k(9600), now() + interval '2 hours', 2) ? 'error', false,
  'five expired pending rows do not count toward the 5-total cap');
select pg_temp.as_user(31);
select pg_temp.mkp(5600, 1, 31, 'pending', interval '20 minutes');
select is(pg_temp.sub_j(pg_temp.b(1), pg_temp.k(9601), now() + interval '2 hours', 2) ? 'error', false,
  'a pending pickup at a business does not block a table request to the same business');
select pg_temp.as_user(32);
select is(pg_temp.sub_j(pg_temp.b(10), pg_temp.k(9602), now() + interval '2 hours', 2) ? 'error', false, 'a table request to a business is accepted');
select is((public.submit_pickup_request(pg_temp.b(10), pg_temp.k(9603), now() + interval '2 hours', null, 'soup', null) ->> 'status'), 'pending',
  'and a pending table request at a business does not block a pickup request to the same business');

-- -- 5. Expiry ---------------------------------------------------------------
select is(private.table_request_expiry(now() + interval '1 hour', now()), now() + interval '1 hour', 'the expiry is the table time when it is within 24 hours');
select is(private.table_request_expiry(now() + interval '3 days', now()), now() + interval '24 hours', 'the expiry is 24 hours after the request otherwise');
select is(private.pickup_request_expiry(now() + interval '3 days', now()), now() + interval '30 minutes', 'the pickup expiry helper is unchanged: 30 minutes');
select is(pg_temp.cron_field('pickup-requests-expire', 'schedule'), '* * * * *', 'the expiry job is still scheduled every minute');
select is(pg_temp.cron_field('pickup-requests-expire', 'command'), 'select private.expire_pickup_requests()', 'and still runs the same function');
select pg_temp.mk(500, 10, 25, 'pending',   interval '1 day', interval '0 seconds');            -- exactly due: expires
select pg_temp.mk(501, 10, 25, 'pending',   interval '1 day', interval '1 second');             -- one second left: stays
select pg_temp.mk(502, 10, 25, 'accepted',  interval '1 day', interval '-1 hour');
select pg_temp.mk(503, 10, 25, 'declined',  interval '1 day', interval '-1 hour');
select pg_temp.mk(504, 10, 25, 'cancelled', interval '1 day', interval '-1 hour');
select pg_temp.mk(505, 10, 25, 'completed', interval '1 day', interval '-1 hour');
select pg_temp.mk(506, 10, 25, 'no_show',   interval '1 day', interval '-1 hour');
select pg_temp.mk(507, 10, 25, 'pending',   interval '1 day', interval '-1 hour');
select pg_temp.mkp(520, 10, 25, 'pending', interval '0 seconds');
select pg_temp.mkp(521, 10, 25, 'pending', interval '1 second');
insert into public.pickup_requests (id, business_id, customer_id, status, pickup_at, order_text, idempotency_key, expires_at, accepted_address)
values (pg_temp.pr(530), pg_temp.b(10), pg_temp.u(25), 'accepted', now() - interval '24 hours', 'x', pg_temp.k(530), now() - interval '24 hours', '1 Secret Rd'),
       (pg_temp.pr(531), pg_temp.b(10), pg_temp.u(25), 'accepted', now() - interval '24 hours' + interval '1 second', 'x', pg_temp.k(531), now() - interval '24 hours' + interval '1 second', '2 Secret Rd');
select pg_temp.as_user(25);
select is(pg_temp.get_my(pg_temp.r(507)) -> 'request' ->> 'display_status', 'expired', 'before the job runs, a pending request past expires_at shows expired');
select is(pg_temp.get_my(pg_temp.r(507)) -> 'request' ->> 'status', 'pending', 'and its stored status is still pending');
select is(pg_temp.get_my(pg_temp.r(501)) -> 'request' ->> 'display_status', 'pending', 'a pending request with a second left shows pending');
select private.expire_pickup_requests();
select is(pg_temp.st(500), 'expired', 'the job expires a table request that is exactly due');
select is(pg_temp.st(501), 'pending', 'and leaves one with a second left');
select is(pg_temp.st(507), 'expired', 'and expires an older pending one');
select is(array[pg_temp.st(502), pg_temp.st(503), pg_temp.st(504), pg_temp.st(505), pg_temp.st(506)],
  array['accepted', 'declined', 'cancelled', 'completed', 'no_show'], 'and touches no answered or closed table request');
select is(pg_temp.pst(520), 'expired', 'the job still expires a pickup request that is exactly due');
select is(pg_temp.pst(521), 'pending', 'and still leaves a pickup request with a second left');
select is((select accepted_address from public.pickup_requests where id = pg_temp.pr(530)), null, 'the job still clears a pickup address snapshot at 24 hours');
select is((select accepted_address from public.pickup_requests where id = pg_temp.pr(531)), '2 Secret Rd', 'and keeps one a second short of 24 hours');

-- -- 6. Get and cancel -------------------------------------------------------
select pg_temp.mk(400, 1, 1, 'pending',   interval '3 hours', interval '2 hours');
select pg_temp.mk(401, 1, 1, 'pending',   interval '3 hours', interval '2 hours');
select pg_temp.mk(402, 1, 1, 'accepted',  interval '3 hours');
select pg_temp.mk(403, 1, 1, 'declined',  interval '3 hours', null, null, null, 'too_busy');
select pg_temp.mk(404, 1, 1, 'pending',   interval '1 hour', interval '-1 minute');
select pg_temp.mk(405, 1, 2, 'pending',   interval '3 hours', interval '2 hours');
select pg_temp.as_user(1);
select is(pg_temp.keys(pg_temp.get_my(pg_temp.r(400))), array['request', 'server_now'], 'the get answer has exactly request and server_now');
select is(pg_temp.get_my(pg_temp.r(400)) -> 'request' ->> 'id', pg_temp.r(400)::text, 'a customer reads their own request');
select is((pg_temp.get_my(pg_temp.r(400)) ->> 'server_now')::timestamptz, now(), 'get returns the server''s clock');
select is(jsonb_typeof(pg_temp.get_my('00000000-0000-0000-0612-0000000fffff') -> 'request'), 'null', 'an unknown id gives request null');
select is(jsonb_typeof(pg_temp.get_my(pg_temp.r(405)) -> 'request'), 'null', 'someone else''s request gives request null, identical to unknown');
select pg_temp.as_user(4);
select is(jsonb_typeof(pg_temp.get_my(pg_temp.r(400)) -> 'request'), 'null', 'the restaurant''s owner cannot read it through the customer function');
select pg_temp.as_user(1);
select is(pg_temp.cancel_t(400), 'OK', 'a customer cancels a pending request');
select is(pg_temp.st(400), 'cancelled', 'and it is cancelled');
select is(pg_temp.cancel_t(400), 'invalid_transition', 'a second cancel is invalid_transition');
select is(pg_temp.cancel_t(402), 'invalid_transition', 'cancel after acceptance is invalid_transition (not allowed in v1)');
select is(pg_temp.cancel_t(403), 'invalid_transition', 'cancel of a declined request is invalid_transition');
select is(pg_temp.cancel_t(404), 'invalid_transition', 'cancel of a pending request past its expiry is invalid_transition');
select is(pg_temp.st(404), 'pending', 'and it is left as it was');
select is(pg_temp.cancel_t(405), 'not_found', 'cancel of someone else''s request is not_found');
select is(pg_temp.cancel_t(999999), 'not_found', 'cancel of an unknown id is not_found, the same');
select is(pg_temp.st(405), 'pending', 'and someone else''s request is unchanged');
select pg_temp.as_user(4);
select is(pg_temp.cancel_t(401), 'not_found', 'the restaurant''s owner cannot cancel a customer''s request');
select is(pg_temp.st(401), 'pending', 'and it is unchanged');

-- -- 7. Respond (table) ------------------------------------------------------
select pg_temp.mk(n, 1, 1, 'pending', interval '3 hours', interval '2 hours') from generate_series(100, 140) n;
select pg_temp.mk(150, 10, 1, 'pending', interval '3 hours', interval '2 hours');   -- another restaurant's
select pg_temp.mk(151, 1, 1, 'pending', interval '1 hour', interval '-1 minute');   -- pending past expiry
select pg_temp.mkp(160, 1, 1, 'pending', interval '30 minutes');                    -- a pickup request at the same business
select pg_temp.as_user(4);
select is(pg_temp.resp(100, 'accepted'), 'OK', 'the owner accepts a table request');
select is(pg_temp.sig(100), 'accepted|-|-|true', 'accept stores no reason and no note, and the answer time');
select is(pg_temp.resp(101, 'accepted', null, E'  Window table \n'), 'OK', 'the owner accepts with a note');
select is(pg_temp.sig(101), 'accepted|-|Window table|true', 'the accept note is stored trimmed');
select is(pg_temp.resp_j(102, 'declined', 'fully_booked') ->> 'decline_reason', 'fully_booked', 'decline fully_booked is stored');
select is(pg_temp.resp(103, 'declined', 'closed_then'), 'OK', 'decline closed_then');
select is(pg_temp.resp(104, 'declined', 'too_busy'), 'OK', 'decline too_busy');
select is(pg_temp.resp(105, 'declined', 'time_not_possible'), 'OK', 'decline time_not_possible');
select is(pg_temp.resp(106, 'declined', 'other', 'Closed for a private event'), 'OK', 'decline other with its text');
select is(array[pg_temp.sig(102), pg_temp.sig(103), pg_temp.sig(104), pg_temp.sig(105), pg_temp.sig(106)],
  array['declined|fully_booked|-|true', 'declined|closed_then|-|true', 'declined|too_busy|-|true', 'declined|time_not_possible|-|true',
        'declined|other|Closed for a private event|true'], 'each of the five reasons is stored as sent');
-- Refusals leave the row pending (row 110 takes every one).
select is(pg_temp.resp(110, 'declined'), 'decline_reason_required', 'a decline without a reason is decline_reason_required');
select is(pg_temp.resp(110, 'declined', '   '), 'decline_reason_required', 'a blank reason is decline_reason_required');
select is(pg_temp.resp(110, 'declined', 'bogus'), 'invalid_input', 'an unknown reason is invalid_input');
select is(pg_temp.resp(110, 'declined', 'sold_out'), 'invalid_input', 'a pickup reason (sold_out) with table is invalid_input');
select is(pg_temp.resp(110, 'declined', 'cannot_prepare'), 'invalid_input', 'a pickup reason (cannot_prepare) with table is invalid_input');
select is(pg_temp.resp(110, 'declined', ' too_busy'), 'invalid_input', 'a reason with a leading space is not trimmed into a match');
select is(pg_temp.resp(110, 'declined', 'TOO_BUSY'), 'invalid_input', 'a reason in capitals is not folded into a match');
select is(pg_temp.resp(110, 'declined', chr(160) || chr(12288)), 'decline_reason_required', 'a reason of only no-break and ideographic spaces is decline_reason_required');
select is(pg_temp.resp(110, 'declined', 'other', chr(160) || chr(12288)), 'decline_reason_required', 'other with a note of only no-break and ideographic spaces is decline_reason_required');
select is(pg_temp.resp(110, 'declined', 'other'), 'decline_reason_required', 'other without text is decline_reason_required');
select is(pg_temp.resp(110, 'declined', 'other', '   '), 'decline_reason_required', 'other with a blank note is decline_reason_required');
select is(pg_temp.resp(110, 'declined', 'too_busy', 'a note'), 'invalid_input', 'a fixed reason with a note is invalid_input');
select is(pg_temp.resp(110, 'declined', 'other', repeat('a', 201)), 'invalid_text', 'other with 201 characters is invalid_text');
select is(pg_temp.resp(110, 'accepted', null, repeat('a', 201)), 'invalid_text', 'an accept note of 201 characters is invalid_text');
select is(pg_temp.resp(110, 'accepted', 'too_busy'), 'invalid_input', 'an accept with a reason is invalid_input');
select is(pg_temp.resp(110, 'maybe'), 'invalid_input', 'an unknown decision is invalid_input');
select is(pg_temp.resp(110, null), 'invalid_input', 'a null decision is invalid_input');
select is(pg_temp.resp(110, 'accepted', null, null, 'bogus'), 'invalid_input', 'an unknown kind is invalid_input');
select is(pg_temp.resp(110, 'accepted', null, null, null), 'invalid_input', 'a null kind is invalid_input');
select is_empty(
  $$ select c from unnest(array[1, 127, 133, 8203, 8205, 8234, 8238, 8294, 8297, 65279]) c
      where pg_temp.resp(110, 'accepted', null, 'a' || chr(c) || 'b') is distinct from 'invalid_text' $$,
  'every hidden-character class is refused in an accept note');
select ok(pg_temp.untouched(110), 'and the request stayed pending after every refusal');
select is(pg_temp.resp(111, 'accepted', null, repeat('a', 200)), 'OK', 'a 200 character accept note is accepted');
select is(pg_temp.resp(113, 'accepted', null, chr(160) || 'x' || chr(12288)), 'OK', 'an accept note padded with no-break and ideographic spaces is accepted');
select is(pg_temp.sig(113), 'accepted|-|x|true', 'and it is stored trimmed of those spaces');
select is(pg_temp.resp(114, 'accepted', null, 'a'), 'OK', 'a 1 character accept note is accepted');
select is(pg_temp.sig(114), 'accepted|-|a|true', 'and it is stored');
select is(pg_temp.resp(100, 'declined', 'too_busy'), 'invalid_transition', 'a second answer is invalid_transition');
select is(pg_temp.sig(100), 'accepted|-|-|true', 'and the first answer stands');
select is(pg_temp.resp(151, 'accepted'), 'invalid_transition', 'answering a pending request past its expiry is invalid_transition');
select is(pg_temp.st(151), 'pending', 'and it is left as it was');
-- Another seller, a customer, and the other kind.
select is(pg_temp.resp(150, 'accepted'), 'not_found', 'the owner of another restaurant gets not_found for this request');
select ok(pg_temp.untouched(150), 'and the request stays pending');
select is(pg_temp.resp(120, 'accepted', null, null, 'pickup'), 'not_found', 'a table request answered as pickup is not_found');
select is(pg_temp.resp_p(160, 'accepted', null, 'table'), 'not_found', 'a pickup request answered as table is not_found');
select is(pg_temp.pst(160), 'pending', 'and the pickup request is unchanged');
select is(pg_temp.resp(999999, 'accepted'), 'not_found', 'an unknown id is not_found');
select pg_temp.as_user(10);
select is(pg_temp.resp(120, 'accepted'), 'not_found', 'another seller cannot answer the request');
select ok(pg_temp.untouched(120), 'and it stays pending');
select pg_temp.as_user(7);
select is(pg_temp.resp(120, 'accepted'), 'not_found', 'a customer with no business gets not_found');
select pg_temp.as_user(1);
select is(pg_temp.resp(120, 'accepted'), 'not_found', 'the customer cannot answer their own request');
select ok(pg_temp.untouched(120), 'and it stays pending');
select pg_temp.as_nobody();
select throws_ok($$ select public.respond_to_request(pg_temp.r(120), 'accepted', null, null, 'table') $$, 'P0001', 'not_signed_in', 'no user: respond is not_signed_in');
-- An old app build sends no kind and gets pickup.
select pg_temp.as_user(4);
select is(public.respond_to_request(pg_temp.pr(160), 'accepted') ->> 'status', 'accepted', 'a call without p_kind still answers a pickup request');
select is(pg_temp.resp_p(160, 'accepted', null, 'pickup'), 'invalid_transition', 'and the pickup rules still apply');
select pg_temp.mkp(161, 1, 1, 'pending', interval '30 minutes');
select is(pg_temp.resp_p(161, 'declined', 'fully_booked'), 'invalid_input', 'a table reason (fully_booked) with pickup is invalid_input');
select is(pg_temp.resp_p(161, 'declined', 'sold_out'), 'OK', 'a pickup reason with pickup still works');
select is(public.respond_to_request(pg_temp.r(112), 'accepted', p_kind := 'table') ->> 'status', 'accepted', 'p_kind can be passed by name');
-- Respond versus cancel, both ways.
select pg_temp.as_user(1);
select is(pg_temp.cancel_t(130), 'OK', 'race: the customer cancels first');
select pg_temp.as_user(4);
select is(pg_temp.resp(130, 'accepted'), 'invalid_transition', 'race: the seller then loses');
select is(pg_temp.resp(131, 'accepted'), 'OK', 'race: the seller accepts first');
select pg_temp.as_user(1);
select is(pg_temp.cancel_t(131), 'invalid_transition', 'race: the customer then loses');
select is(array[pg_temp.st(130), pg_temp.st(131)], array['cancelled', 'accepted'], 'race: each first move stands');

-- -- 8. Completed and no-show ------------------------------------------------
select pg_temp.mk(200, 1, 1, 'accepted', interval '-1 hour');
select pg_temp.mk(201, 1, 1, 'accepted', interval '0 seconds');
select pg_temp.mk(202, 1, 1, 'accepted', interval '1 second', interval '1 second');
select pg_temp.mk(203, 1, 1, 'pending',  interval '-1 hour', interval '-1 hour');
select pg_temp.mk(204, 1, 1, 'accepted', interval '-1 hour');
select pg_temp.mk(205, 1, 1, 'accepted', interval '-1 hour');
select pg_temp.mk(206, 10, 1, 'accepted', interval '-1 hour');
select pg_temp.mk(207, 1, 1, 'declined', interval '-1 hour', null, null, null, 'too_busy');
select pg_temp.as_user(4);
select is(pg_temp.outc(200, 'completed'), 'OK', 'an accepted table request is marked completed after the table time');
select is(pg_temp.st(200), 'completed', 'and it is completed');
select is(pg_temp.outc(201, 'no_show'), 'OK', 'a table time of exactly now is already past: no_show is allowed');
select is(pg_temp.st(201), 'no_show', 'and it is no_show');
select is(pg_temp.outc(202, 'completed'), 'invalid_transition', 'a table time one second away is invalid_transition');
select is(pg_temp.outc(203, 'completed'), 'invalid_transition', 'a pending request is invalid_transition');
select is(pg_temp.outc(207, 'completed'), 'invalid_transition', 'a declined request is invalid_transition');
select is(pg_temp.outc(200, 'no_show'), 'invalid_transition', 'a second outcome is invalid_transition');
select is(pg_temp.outc(204, 'maybe'), 'invalid_input', 'an unknown outcome is invalid_input');
select is(pg_temp.outc(204, 'completed', 'bogus'), 'invalid_input', 'an unknown kind is invalid_input');
select is(pg_temp.outc(204, 'completed', 'pickup'), 'not_found', 'a table request marked as pickup is not_found');
select is(pg_temp.outc(206, 'completed'), 'not_found', 'another restaurant''s request is not_found');
select is(pg_temp.st(206), 'accepted', 'and it is unchanged');
select pg_temp.as_user(10);
select is(pg_temp.outc(205, 'completed'), 'not_found', 'another seller cannot mark the outcome');
select pg_temp.as_user(1);
select is(pg_temp.outc(205, 'completed'), 'not_found', 'the customer cannot mark the outcome');
select is(pg_temp.st(205), 'accepted', 'and it is unchanged');

-- -- 9. mark_arrived ---------------------------------------------------------
-- now() is frozen, so the window edges are exact. Customer 1 owns these accepted rows.
select pg_temp.mk(300, 1, 1, 'accepted', interval '2 hours');                      -- exactly 2 h before: allowed
select pg_temp.mk(301, 1, 1, 'accepted', interval '2 hours 1 second');             -- 2 h + 1 s before: too early
select pg_temp.mk(302, 1, 1, 'accepted', interval '-4 hours');                     -- exactly 4 h after: allowed
select pg_temp.mk(303, 1, 1, 'accepted', interval '-4 hours -1 second');           -- 4 h + 1 s after: too late
select pg_temp.mk(304, 1, 1, 'accepted', interval '0 seconds');                    -- at the table time
select pg_temp.mk(305, 1, 1, 'accepted', interval '-5 hours', null, null, null, null, now() - interval '5 hours'); -- arrived, window closed
select pg_temp.mk(306, 1, 1, 'pending',  interval '-5 hours', interval '-5 hours'); -- pending, outside the window
select pg_temp.mk(307, 1, 1, 'pending',  interval '1 hour', interval '1 hour');     -- pending, inside the window
select pg_temp.mk(308, 1, 1, 'declined', interval '1 hour', null, null, null, 'too_busy');
select pg_temp.mk(309, 1, 2, 'accepted', interval '1 hour');                       -- another customer's
select pg_temp.mk(310, 1, 1, 'accepted', interval '1 hour');
select pg_temp.mk(311, 1, 1, 'completed', interval '-1 hour');
select pg_temp.as_user(1);
select is(pg_temp.arrive(300), 'OK', 'arrival is allowed exactly 2 hours before the table time');
select is(pg_temp.arrive(301), 'arrival_window', 'arrival one second earlier is arrival_window');
select is(pg_temp.arrive(302), 'OK', 'arrival is allowed exactly 4 hours after the table time');
select is(pg_temp.arrive(303), 'arrival_window', 'arrival one second later is arrival_window');
select is(pg_temp.arrive(304), 'OK', 'arrival at the table time is allowed');
select is(pg_temp.arr(300), now(), 'arrived_at is the server clock');
select is(pg_temp.arr(301), null, 'a refused arrival leaves arrived_at null');
select is(pg_temp.st(300), 'accepted', 'the request is still accepted after arrival');
select is(pg_temp.arrive(300), 'already_arrived', 'a second tap is already_arrived');
select is(pg_temp.arrive(305), 'already_arrived', 'check order: a second tap after the window closed is already_arrived, not arrival_window');
select is(pg_temp.arrive(306), 'invalid_transition', 'check order: a pending request outside the window is invalid_transition');
select is(pg_temp.arrive(307), 'invalid_transition', 'a pending request inside the window is invalid_transition');
select is(pg_temp.arr(307), null, 'and a pending request is not marked arrived');
select is(pg_temp.arrive(308), 'invalid_transition', 'a declined request is invalid_transition');
select is(pg_temp.arrive(311), 'invalid_transition', 'a completed request is invalid_transition');
select is(pg_temp.arrive(309), 'not_found', 'check order: another customer''s accepted request in the window is not_found');
select is(pg_temp.arrive(999999), 'not_found', 'an unknown id is not_found, the same');
select is(pg_temp.arr(309), null, 'and the other customer''s request is not marked');
select pg_temp.as_user(4);
select is(pg_temp.arrive(310), 'not_found', 'the restaurant''s owner cannot mark a customer arrived');
select pg_temp.as_user(7);
select is(pg_temp.arrive(310), 'not_found', 'an outsider cannot mark a request arrived');
select is(pg_temp.arr(310), null, 'and it is unchanged');
select pg_temp.as_user(1);
insert into res select 'arrive_j', pg_temp.arrive_j(310);
select is((select j ->> 'arrived_at' from res where label = 'arrive_j')::timestamptz, now(), 'mark_arrived returns the customer object with arrived_at');
select is(pg_temp.keys((select j from res where label = 'arrive_j')),
  array['arrived_at', 'business_id', 'business_name', 'business_type', 'created_at', 'decline_reason', 'display_status', 'expires_at', 'id', 'kind',
        'note', 'party_size', 'response_note', 'status', 'table_at'], 'and it has exactly the 15 customer keys');
select is(pg_temp.get_my(pg_temp.r(310)) -> 'request' ->> 'arrived_at' is not null, true, 'the customer''s get shows arrived_at');
select pg_temp.as_user(4);
select is((pg_temp.get_biz(pg_temp.r(310)) -> 'request' ->> 'arrived_at')::timestamptz, now(), 'the seller''s object shows arrived_at');
select is(pg_temp.get_biz(pg_temp.r(309)) -> 'request' ->> 'arrived_at', null, 'and shows null for a request that has not arrived');
select is(pg_temp.outc(300, 'completed'), 'invalid_transition', 'a table time two hours away cannot be completed yet, even after arrival');

-- -- 10. Lists ---------------------------------------------------------------
-- A mixed list for customer 33, newest first.
select pg_temp.mkp(701, 1, 33, 'pending', interval '20 minutes', now() - interval '1 minute');
select pg_temp.mk(702, 1, 33, 'pending', interval '3 hours', interval '2 hours', now() - interval '2 minutes');
select pg_temp.mkp(703, 1, 33, 'accepted', interval '20 minutes', now() - interval '3 minutes');
select pg_temp.mk(704, 1, 33, 'accepted', interval '3 hours', null, now() - interval '4 minutes');
select pg_temp.as_user(33);
select is(pg_temp.keys(pg_temp.my_list()), array['next_cursor', 'requests', 'server_now'], 'the list answer has exactly requests, next_cursor and server_now');
select is((pg_temp.my_list() ->> 'server_now')::timestamptz, now(), 'the list returns the server''s clock');
select is((select array_agg((x ->> 'id') order by ord) from jsonb_array_elements(pg_temp.my_list() -> 'requests') with ordinality t(x, ord)),
  array[pg_temp.pr(701)::text, pg_temp.r(702)::text, pg_temp.pr(703)::text, pg_temp.r(704)::text], 'pickup and table rows are merged newest first');
select is((select array_agg((x ->> 'kind') order by ord) from jsonb_array_elements(pg_temp.my_list() -> 'requests') with ordinality t(x, ord)),
  array['pickup', 'table', 'pickup', 'table'], 'and each row carries its kind');
select is(pg_temp.my_list() -> 'next_cursor', 'null'::jsonb, 'a short list has no cursor');
select pg_temp.as_user(2);
select is((select array_agg(x ->> 'id') from jsonb_array_elements(pg_temp.my_list() -> 'requests') x), array[pg_temp.r(405)::text, pg_temp.r(309)::text],
  'another customer''s list holds only their own requests');
select pg_temp.as_user(7);
select is(pg_temp.my_list() -> 'requests', '[]'::jsonb, 'a customer with no requests gets an empty array');
select pg_temp.as_user(4);
select is(pg_temp.my_list() -> 'requests', '[]'::jsonb, 'a restaurant owner''s customer list holds no customer requests');
-- The merged list shows both kinds, each with kind.
select pg_temp.as_user(33);
select is((select array_agg(x ->> 'kind' order by x ->> 'kind') from jsonb_array_elements(public.list_my_requests() -> 'requests') x),
  array['pickup', 'pickup', 'table', 'table'],
  'list_my_requests lists this customer''s pickup and table rows, each with kind');

-- Paging: customer 28 / business 14 holds 123 rows (120 share one created_at, kinds alternating by id); customer 29 / business 15 holds 100.
insert into public.pickup_requests (id, business_id, customer_id, status, pickup_at, order_text, idempotency_key, expires_at, created_at)
select pg_temp.sid(1000 + n), pg_temp.b(14), pg_temp.u(28), 'cancelled', now() + interval '1 day', 'paging', pg_temp.k(1000 + n), now() + interval '1 hour',
       case when n <= 120 then now() - interval '1 hour' else now() - (n - 120) * interval '1 minute' end
  from generate_series(1, 123) n where n % 2 = 1;
insert into public.table_requests (id, business_id, customer_id, status, table_at, party_size, expires_at, idempotency_key, created_at)
select pg_temp.sid(1000 + n), pg_temp.b(14), pg_temp.u(28), 'cancelled', now() + interval '1 day', 2, now() + interval '1 hour', pg_temp.k(1000 + n),
       case when n <= 120 then now() - interval '1 hour' else now() - (n - 120) * interval '1 minute' end
  from generate_series(1, 123) n where n % 2 = 0;
insert into public.pickup_requests (id, business_id, customer_id, status, pickup_at, order_text, idempotency_key, expires_at, created_at)
select pg_temp.sid(2000 + n), pg_temp.b(15), pg_temp.u(29), 'cancelled', now() + interval '1 day', 'paging', pg_temp.k(2000 + n), now() + interval '1 hour', now() - interval '2 hours'
  from generate_series(1, 100) n where n % 2 = 1;
insert into public.table_requests (id, business_id, customer_id, status, table_at, party_size, expires_at, idempotency_key, created_at)
select pg_temp.sid(2000 + n), pg_temp.b(15), pg_temp.u(29), 'cancelled', now() + interval '1 day', 2, now() + interval '1 hour', pg_temp.k(2000 + n), now() - interval '2 hours'
  from generate_series(1, 100) n where n % 2 = 0;

create function pg_temp.expected_ids(p_cust uuid) returns text[] language sql as $$
  select array_agg(id::text order by created_at desc, id desc)
    from (select id, created_at from public.pickup_requests where customer_id = p_cust
          union all select id, created_at from public.table_requests where customer_id = p_cust) x;
$$;
create function pg_temp.expected_biz_ids(p_biz uuid) returns text[] language sql as $$
  select array_agg(id::text order by created_at desc, id desc)
    from (select id, created_at from public.pickup_requests where business_id = p_biz
          union all select id, created_at from public.table_requests where business_id = p_biz) x;
$$;

select pg_temp.as_user(28);
insert into res select 'w_my123', pg_temp.walk('my');
select is((select j -> 'sizes' from res where label = 'w_my123'), '[50, 50, 23]'::jsonb, 'Sent, 123 rows (120 tied, mixed kinds): pages of 50, 50 and 23');
select is((select array_agg(x order by o) from jsonb_array_elements_text((select j -> 'ids' from res where label = 'w_my123')) with ordinality t(x, o)), pg_temp.expected_ids(pg_temp.u(28)),
  'Sent, 123 rows: every row once, in (created_at, id) order, no skip and no repeat');
select is((select count(distinct x)::int from jsonb_array_elements_text((select j -> 'ids' from res where label = 'w_my123')) x), 123, 'Sent, 123 rows: 123 distinct ids');
select is((select j ->> 'last_cursor' from res where label = 'w_my123'), null, 'Sent, 123 rows: the last page has no cursor');
insert into res select 'my_first', pg_temp.my_list();
select ok((select j ->> 'next_cursor' from res where label = 'my_first') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z\|[0-9a-f-]{36}$',
  'the cursor is text: UTC time with six microsecond digits, a bar, the id');
select is((select jsonb_typeof(j -> 'next_cursor') from res where label = 'my_first'), 'string', 'the cursor is a JSON string');
select is((select j ->> 'next_cursor' from res where label = 'my_first'),
  (select to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') || '|' || id::text
     from (select id, created_at from public.pickup_requests where customer_id = pg_temp.u(28)
           union all select id, created_at from public.table_requests where customer_id = pg_temp.u(28)) x
    order by created_at desc, id desc offset 49 limit 1),
  'the first cursor is the 50th row''s own created_at and id');
select is(jsonb_array_length((select j -> 'requests' from res where label = 'my_first')), 50, 'a page holds 50 rows');
select ok((select bool_and(q.kind is distinct from q.prev)
             from (select x ->> 'kind' as kind, lag(x ->> 'kind') over (order by ord) as prev
                     from jsonb_array_elements(pg_temp.my_list((select j ->> 'next_cursor' from res where label = 'my_first')) -> 'requests')
                          with ordinality t(x, ord)) q
            where q.prev is not null),
  'the tied rows alternate between pickup and table, so the page edges at 50 and 100 cross a kind change');
select pg_temp.as_user(29);
insert into res select 'w_my100', pg_temp.walk('my');
select is((select j -> 'sizes' from res where label = 'w_my100'), '[50, 50]'::jsonb, 'Sent, exactly 100 rows: two pages of 50');
select is((select j ->> 'last_cursor' from res where label = 'w_my100'), null, 'Sent, exactly 100 rows: no empty third page and no cursor on the last');
select is((select array_agg(x order by o) from jsonb_array_elements_text((select j -> 'ids' from res where label = 'w_my100')) with ordinality t(x, o)), pg_temp.expected_ids(pg_temp.u(29)),
  'Sent, exactly 100 rows: every row once, in order');
select pg_temp.as_user(14);
insert into res select 'w_biz123', pg_temp.walk('biz');
select is((select j -> 'sizes' from res where label = 'w_biz123'), '[50, 50, 23]'::jsonb, 'Received, 123 rows (120 tied, mixed kinds): pages of 50, 50 and 23');
select is((select array_agg(x order by o) from jsonb_array_elements_text((select j -> 'ids' from res where label = 'w_biz123')) with ordinality t(x, o)), pg_temp.expected_biz_ids(pg_temp.b(14)),
  'Received, 123 rows: every row once, in (created_at, id) order, no skip and no repeat');
select is((select count(distinct x)::int from jsonb_array_elements_text((select j -> 'ids' from res where label = 'w_biz123')) x), 123, 'Received, 123 rows: 123 distinct ids');
select is((select j ->> 'last_cursor' from res where label = 'w_biz123'), null, 'Received, 123 rows: the last page has no cursor');
select pg_temp.as_user(15);
insert into res select 'w_biz100', pg_temp.walk('biz');
select is((select j -> 'sizes' from res where label = 'w_biz100'), '[50, 50]'::jsonb, 'Received, exactly 100 rows: two pages of 50, no empty third page');
select is((select j ->> 'last_cursor' from res where label = 'w_biz100'), null, 'Received, exactly 100 rows: no cursor on the last page');
-- Malformed cursors.
select pg_temp.as_user(28);
select is(pg_temp.my_list_err('now|00000000-0000-0000-0000-000000000001'), 'invalid_input', 'my list: cursor "now|id" is refused');
select is(pg_temp.my_list_err('2026-01-01T00:00:00.123456Z|not-a-uuid'), 'invalid_input', 'my list: a non-uuid id is refused');
select is(pg_temp.my_list_err('2026-01-01T00:00:00.123456Z'), 'invalid_input', 'my list: a cursor with no id is refused');
select is(pg_temp.my_list_err(''), 'invalid_input', 'my list: an empty cursor is refused');
select is(pg_temp.my_list_err('2026-13-45T25:61:61.123456Z|00000000-0000-0000-0000-000000000001'), 'invalid_input', 'my list: an impossible date is refused');
select is(pg_temp.my_list_err('2026-01-01T00:00:00.123Z|00000000-0000-0000-0000-000000000001'), 'invalid_input', 'my list: millisecond precision is refused');
select is(pg_temp.my_list_err('2026-01-01T00:00:00.123456Z|00000000-0000-0000-0000-000000000001|extra'), 'invalid_input', 'my list: an extra segment is refused');
select is(pg_temp.my_list_err('2026-01-01T00:00:00.123456Z|00000000-0000-0000-0000-00000000000G'), 'invalid_input', 'my list: a non-hex id is refused');
select is(pg_temp.my_list_err('2026-01-01T00:00:00.123456Z|00000000-0000-0000-0000-000000000001'), 'OK', 'my list: a well-formed cursor is accepted');
select pg_temp.as_user(14);
select is(pg_temp.biz_list_err(null, 'now|00000000-0000-0000-0000-000000000001'), 'invalid_input', 'business list: a malformed cursor is refused');
select is(pg_temp.biz_list_err('bogus', null), 'invalid_input', 'business list: an unknown status filter is refused');

-- The seller list with filters and the waiting count: business 16, owner 16.
select pg_temp.mk(600, 16, 1, 'pending',  interval '3 hours', interval '2 hours', now() - interval '1 minute');
select pg_temp.mk(601, 16, 1, 'pending',  interval '3 hours', interval '2 hours', now() - interval '2 minutes');
select pg_temp.mk(602, 16, 1, 'pending',  interval '3 hours', interval '2 hours', now() - interval '3 minutes');
select pg_temp.mk(603, 16, 1, 'pending',  interval '1 hour', interval '-1 minute', now() - interval '4 minutes');
select pg_temp.mkp(610, 16, 1, 'pending', interval '20 minutes', now() - interval '5 minutes');
select pg_temp.mkp(611, 16, 1, 'pending', interval '20 minutes', now() - interval '6 minutes');
select pg_temp.mkp(612, 16, 1, 'pending', interval '-1 minute', now() - interval '7 minutes');
select pg_temp.mk(604, 16, 1, 'accepted', interval '3 hours', null, now() - interval '8 minutes');
select pg_temp.as_user(16);
select is((select array_agg(x ->> 'id') from jsonb_array_elements(pg_temp.biz_list('waiting') -> 'requests') x),
  array[pg_temp.r(600)::text, pg_temp.r(601)::text, pg_temp.r(602)::text, pg_temp.pr(610)::text, pg_temp.pr(611)::text],
  'Waiting holds the unexpired pending requests of both kinds, newest first');
select is((pg_temp.count_waiting() ->> 'waiting')::int, 5, 'the waiting count covers both kinds (3 table + 2 pickup, expired ones left out)');
select is((select array_agg(x ->> 'id') from jsonb_array_elements(pg_temp.biz_list('expired') -> 'requests') x),
  array[pg_temp.r(603)::text, pg_temp.pr(612)::text], 'the expired filter holds pending requests past their expiry, both kinds');
select is((select array_agg(x ->> 'id') from jsonb_array_elements(pg_temp.biz_list('accepted') -> 'requests') x), array[pg_temp.r(604)::text],
  'the accepted filter holds the accepted table request');
select is(jsonb_array_length(pg_temp.biz_list() -> 'requests'), 8, 'the unfiltered list holds all eight');
select is((select array_agg(x ->> 'kind') from jsonb_array_elements(pg_temp.biz_list() -> 'requests') x where (x ->> 'id') = pg_temp.r(603)::text), array['table'],
  'and a table row says table');
select pg_temp.as_user(7);
select is(pg_temp.biz_list() -> 'requests', '[]'::jsonb, 'a caller with no business gets an empty seller list');
select is((pg_temp.count_waiting() ->> 'waiting')::int, 0, 'and a waiting count of 0');
select pg_temp.as_user(4);
select is((select count(*)::int from jsonb_array_elements(pg_temp.biz_list() -> 'requests') x where (x ->> 'id') in (pg_temp.r(600)::text, pg_temp.r(601)::text)), 0,
  'another owner''s list holds none of business 16''s requests');
-- get_business_request covers both kinds and stays identical for strangers.
select pg_temp.as_user(16);
select is(pg_temp.get_biz(pg_temp.r(600)) -> 'request' ->> 'kind', 'table', 'get_business_request returns a table request');
select is(pg_temp.get_biz(pg_temp.pr(610)) -> 'request' ->> 'kind', 'pickup', 'get_business_request returns a pickup request');
select is((pg_temp.get_biz(pg_temp.r(600)) ->> 'server_now')::timestamptz, now(), 'and the server''s clock');
select pg_temp.as_user(4);
select is(jsonb_typeof(pg_temp.get_biz(pg_temp.r(600)) -> 'request'), 'null', 'another owner gets request null for a table request');
select is(jsonb_typeof(pg_temp.get_biz(pg_temp.r(999999)) -> 'request'), 'null', 'an unknown id gives request null, the same');
select pg_temp.as_user(1);
select is(jsonb_typeof(pg_temp.get_biz(pg_temp.r(600)) -> 'request'), 'null', 'the customer gets request null through the seller function');

-- -- 11. Request objects: key sets and forbidden keys ------------------------
select pg_temp.as_user(26);
insert into res select 'k_t_submit', pg_temp.sub_j(pg_temp.b(1), pg_temp.k(9500), now() + interval '2 hours', 3, 'note');
insert into res select 'k_t_get', pg_temp.get_my((select (j ->> 'id')::uuid from res where label = 'k_t_submit')) -> 'request';
insert into res select 'k_t_list', pg_temp.my_list() -> 'requests' -> 0;
insert into res select 'k_t_cancel', public.cancel_table_request((select (j ->> 'id')::uuid from res where label = 'k_t_submit'));
select pg_temp.mk(800, 31, 26, 'pending', interval '3 hours', interval '2 hours');
select pg_temp.mkp(801, 31, 26, 'pending', interval '20 minutes');
select pg_temp.as_user(51);
insert into res select 'k_s_listkeys', pg_temp.biz_list();
insert into res select 'k_s_get', pg_temp.get_biz(pg_temp.r(800)) -> 'request';
insert into res select 'k_s_list', (select x from jsonb_array_elements(pg_temp.biz_list() -> 'requests') x where (x ->> 'id') = pg_temp.r(800)::text);
insert into res select 'k_s_resp', pg_temp.resp_j(800, 'accepted');
insert into res select 'k_ps_get', pg_temp.get_biz(pg_temp.pr(801)) -> 'request';
insert into res select 'k_ps_list', (select x from jsonb_array_elements(pg_temp.biz_list() -> 'requests') x where (x ->> 'id') = pg_temp.pr(801)::text);
insert into res select 'k_ps_resp', public.respond_to_request(pg_temp.pr(801), 'accepted');
select pg_temp.as_user(26);
insert into res select 'k_pc_submit', public.submit_pickup_request(pg_temp.b(10), pg_temp.k(9501), now() + interval '2 hours', null, 'soup', null);
insert into res select 'k_pc_get', public.get_my_pickup_request((select (j ->> 'id')::uuid from res where label = 'k_pc_submit')) -> 'request';
insert into res select 'k_pc_cancel', public.cancel_pickup_request((select (j ->> 'id')::uuid from res where label = 'k_pc_submit'));
insert into res select 'k_pc_oldlist', public.list_my_requests() -> 'requests' -> 0;
select is(pg_temp.keys((select j from res where label = 'k_t_submit')),
  array['arrived_at', 'business_id', 'business_name', 'business_type', 'created_at', 'decline_reason', 'display_status', 'expires_at', 'id', 'kind',
        'note', 'party_size', 'response_note', 'status', 'table_at'], 'a table submit returns exactly the 15 customer keys');
select is(pg_temp.keys((select j from res where label = 'k_t_get')), pg_temp.keys((select j from res where label = 'k_t_submit')), 'the table get has the same keys');
select is(pg_temp.keys((select j from res where label = 'k_t_list')), pg_temp.keys((select j from res where label = 'k_t_submit')), 'the table list row has the same keys');
select is(pg_temp.keys((select j from res where label = 'k_t_cancel')), pg_temp.keys((select j from res where label = 'k_t_submit')), 'table cancel returns the same keys');
select is(pg_temp.keys((select j from res where label = 'k_s_get')),
  array['arrived_at', 'business_id', 'business_name', 'business_type', 'created_at', 'customer_name', 'decline_reason', 'display_status', 'expires_at', 'id',
        'kind', 'note', 'party_size', 'responded_at', 'response_note', 'status', 'table_at'], 'the seller table object has exactly the 17 keys');
select is(pg_temp.keys((select j from res where label = 'k_s_list')), pg_temp.keys((select j from res where label = 'k_s_get')), 'the seller list row has the same 17 keys');
select is(pg_temp.keys((select j from res where label = 'k_s_resp')), pg_temp.keys((select j from res where label = 'k_s_get')), 'respond_to_request (table) returns the same 17 keys');
select is(pg_temp.keys((select j from res where label = 'k_pc_submit')),
  array['business_id', 'business_name', 'business_type', 'created_at', 'currency_code', 'decline_reason', 'display_status', 'expires_at', 'id', 'items',
        'kind', 'note', 'order_text', 'pickup_at', 'response_note', 'status'], 'a pickup submit returns exactly the 16 customer keys');
select is(pg_temp.keys((select j from res where label = 'k_pc_get')), pg_temp.keys((select j from res where label = 'k_pc_submit')), 'the pickup get has the same 16 keys');
select is(pg_temp.keys((select j from res where label = 'k_pc_cancel')), pg_temp.keys((select j from res where label = 'k_pc_submit')), 'pickup cancel has the same 16 keys');
select is(pg_temp.keys((select j from res where label = 'k_pc_oldlist')), pg_temp.keys((select j from res where label = 'k_pc_submit')), 'the list_my_requests pickup row has the same 16 keys');
select is(pg_temp.keys((select j from res where label = 'k_ps_get')),
  array['business_id', 'business_name', 'business_type', 'created_at', 'currency_code', 'customer_name', 'decline_reason', 'display_status', 'expires_at',
        'id', 'items', 'kind', 'note', 'order_text', 'pickup_at', 'responded_at', 'response_note', 'status'], 'the seller pickup object has exactly the 18 keys');
select is(pg_temp.keys((select j from res where label = 'k_ps_list')), pg_temp.keys((select j from res where label = 'k_ps_get')), 'the seller pickup list row has the same 18 keys');
select is(pg_temp.keys((select j from res where label = 'k_ps_resp')), pg_temp.keys((select j from res where label = 'k_ps_get')), 'respond_to_request (pickup) returns the same 18 keys');
select is((select j ->> 'kind' from res where label = 'k_pc_submit'), 'pickup', 'a pickup object says pickup');
select is_empty(
  $$ select r.label || ':' || k from res r, jsonb_object_keys(r.j) k
      where r.label like 'k\_%' and k in ('accepted_address', 'place_id', 'lat', 'lng', 'map_lat', 'map_lng', 'customer_id', 'owner_id', 'email',
                                           'idempotency_key', 'updated_at', 'formatted_address') $$,
  'no request object holds an address, a place id, coordinates, a customer id, an owner id or an email');
select is_empty(
  $$ select r.label from res r where r.label in ('k_s_get', 'k_s_list', 'k_s_resp', 'k_s_listkeys', 'k_ps_get', 'k_ps_list', 'k_ps_resp')
        and position(pg_temp.u(26)::text in r.j::text) > 0 $$,
  'and the seller view never contains the customer''s id');
select is(pg_temp.keys((select j from res where label = 'k_s_listkeys')), array['next_cursor', 'requests', 'server_now'], 'the seller list answer has exactly requests, next_cursor and server_now');

-- -- 12. Outsiders see and change nothing ------------------------------------
select pg_temp.mk(900, 1, 1, 'accepted', interval '1 hour');
select pg_temp.mk(901, 1, 1, 'pending', interval '3 hours', interval '2 hours');
select pg_temp.as_user(2);
select is(pg_temp.arrive(900), 'not_found', 'another customer cannot mark arrival');
select is(pg_temp.cancel_t(901), 'not_found', 'another customer cannot cancel');
select is(jsonb_typeof(pg_temp.get_my(pg_temp.r(901)) -> 'request'), 'null', 'another customer cannot read');
select is(pg_temp.resp(901, 'accepted'), 'not_found', 'another customer cannot answer');
select is(pg_temp.outc(900, 'completed'), 'not_found', 'another customer cannot mark an outcome');
select is(jsonb_typeof(pg_temp.get_biz(pg_temp.r(901)) -> 'request'), 'null', 'another customer cannot read through the seller function');
select is((select count(*)::int from jsonb_array_elements(pg_temp.my_list() -> 'requests') x where (x ->> 'id') in (pg_temp.r(900)::text, pg_temp.r(901)::text)), 0,
  'another customer''s list holds neither');
select pg_temp.as_user(10);
select is(pg_temp.arrive(900), 'not_found', 'another seller cannot mark arrival');
select is(pg_temp.cancel_t(901), 'not_found', 'another seller cannot cancel');
select is(pg_temp.resp(901, 'accepted'), 'not_found', 'another seller cannot answer');
select is(pg_temp.outc(900, 'completed'), 'not_found', 'another seller cannot mark an outcome');
select is((select count(*)::int from jsonb_array_elements(pg_temp.biz_list() -> 'requests') x where (x ->> 'id') in (pg_temp.r(900)::text, pg_temp.r(901)::text)), 0,
  'another seller''s list holds neither');
select is(array[pg_temp.st(900), pg_temp.st(901)], array['accepted', 'pending'], 'both requests are exactly as they were');
select is(pg_temp.arr(900), null, 'and nothing was marked arrived');
-- Deleting a business removes its table requests.
select pg_temp.mk(950, 35, 1, 'pending', interval '3 hours', interval '2 hours');
delete from public.businesses where id = pg_temp.b(35);
select is((select count(*)::int from public.table_requests where id = pg_temp.r(950)), 0, 'deleting a business removes its table requests');

select * from finish();
rollback;
