-- Spec 15: activity grid cuisine view (PR 1) -- get_my_food_log_cuisine_days. The function
-- allowlist lives in the 05 file; spec 14's functions keep their own file, unedited.
--
-- This file is ASCII only (it needs no special character; any would be built with chr()).
-- Rows are inserted as postgres with chosen local_date and created_at inside the table's UTC date
-- +-1 check. Dates are relative to T, today in UTC at the transaction's now(), and calls use the
-- zone 'UTC' unless a zone is under test, so nothing sleeps and nothing depends on the session zone.
-- Seeded rows of other accounts cannot change any result here, because the function reads only
-- auth.uid()'s rows.
begin;
select plan(58);

-- -- Helpers (pg_temp) -------------------------------------------------------
-- Ids: users 00000000-0000-0000-0015-<n>; logs ...-0515-<n>.
create function pg_temp.u(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0015-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.lid(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0515-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.t() returns date language sql stable as $$ select (now() at time zone 'UTC')::date $$;
create function pg_temp.as_user(n int) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', pg_temp.u(n)), true);
end $$;
create function pg_temp.as_nobody() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"authenticated"}', true);
end $$;
-- The function under test, zone 'UTC' and 17 weeks unless given.
create function pg_temp.cd(w int default 17, z text default 'UTC') returns jsonb language sql volatile as $$
  select public.get_my_food_log_cuisine_days(z, w);
$$;
create function pg_temp.keys(j jsonb) returns text[] language sql immutable as $$
  select coalesce(array_agg(k order by k collate "C"), array[]::text[]) from jsonb_object_keys(j) k;
$$;
-- The dates of a result's days, in the order returned.
create function pg_temp.dates(j jsonb) returns date[] language sql immutable as $$
  select coalesce(array_agg((e->>'date')::date order by o), array[]::date[])
    from jsonb_array_elements(j->'days') with ordinality as x(e, o);
$$;
-- One day of a result, or null when the date is absent.
create function pg_temp.day(j jsonb, d date) returns jsonb language sql immutable as $$
  select e from jsonb_array_elements(j->'days') e where (e->>'date')::date = d;
$$;
-- A result's days as { date, count } pairs, in the order returned (the activity function's shape).
create function pg_temp.dc(j jsonb) returns jsonb language sql immutable as $$
  select coalesce(jsonb_agg(jsonb_build_object('date', e->'date', 'count', e->'count') order by o), '[]'::jsonb)
    from jsonb_array_elements(j->'days') with ordinality as x(e, o);
$$;
-- An expected day.
create function pg_temp.e(d date, n int, c int, code text) returns jsonb language sql immutable as $$
  select jsonb_build_object('date', d, 'count', n, 'cuisines', c, 'cuisine', code);
$$;

-- Superuser fixture: one log. created_at defaults to noon UTC on the local date (inside the check).
create function pg_temp.log(p_n int, p_author int, p_date date, p_at timestamptz default null,
                            p_cuisine text default 'IT', p_public boolean default true,
                            p_status text default 'ready') returns void
language plpgsql as $$
begin
  insert into public.food_logs (id, author_id, cuisine_code, is_public, local_date, path, status, created_at)
  values (pg_temp.lid(p_n), pg_temp.u(p_author), p_cuisine, p_public, p_date,
          pg_temp.u(p_author)::text || '/' || pg_temp.lid(p_n)::text || '.jpg', p_status,
          coalesce(p_at, (p_date + time '12:00') at time zone 'UTC'));
end $$;

-- -- Fixtures (as postgres) ---------------------------------------------------
-- 1 owner   2 second user   3 outsider (no rows)   4 range edge   5 future date   6 order
insert into auth.users (id, email)
select pg_temp.u(n), 'grid15_' || n || '@example.test' from generate_series(1, 6) n;
update public.profiles set username = 'grid15_' || right(id::text, 2)
 where id in (select pg_temp.u(n) from generate_series(1, 6) n);

-- 1: T one country (plus a pending JP that must not make it mixed); T-1 the same country twice, one
-- public and one private; T-2 two countries; T-3 a neutral cuisine plus a country; T-4 one neutral
-- cuisine; T-6 late night (local T-6, created 03:30 UTC on T-5); T-8 a pending row only.
select pg_temp.log(101, 1, pg_temp.t(), p_cuisine => 'IT');
select pg_temp.log(102, 1, pg_temp.t(), p_cuisine => 'JP', p_status => 'pending');
select pg_temp.log(103, 1, pg_temp.t() - 1, p_cuisine => 'IT', p_public => true);
select pg_temp.log(104, 1, pg_temp.t() - 1, p_cuisine => 'IT', p_public => false);
select pg_temp.log(105, 1, pg_temp.t() - 2, p_cuisine => 'IT');
select pg_temp.log(106, 1, pg_temp.t() - 2, p_cuisine => 'JP');
select pg_temp.log(107, 1, pg_temp.t() - 3, p_cuisine => 'street-food');
select pg_temp.log(108, 1, pg_temp.t() - 3, p_cuisine => 'IT');
select pg_temp.log(109, 1, pg_temp.t() - 4, p_cuisine => 'fusion');
select pg_temp.log(110, 1, pg_temp.t() - 6, ((pg_temp.t() - 5) + time '03:30') at time zone 'UTC', p_cuisine => 'MX');
select pg_temp.log(111, 1, pg_temp.t() - 8, p_cuisine => 'JP', p_status => 'pending');
-- 2: a public and a private MX log on the owner's T-1, and one MX log on T-5, a date the owner lacks.
select pg_temp.log(201, 2, pg_temp.t() - 1, p_cuisine => 'MX', p_public => true);
select pg_temp.log(202, 2, pg_temp.t() - 1, p_cuisine => 'MX', p_public => false);
select pg_temp.log(203, 2, pg_temp.t() - 5, p_cuisine => 'MX');
-- 4: one log on the first day of the 1-week range (its Sunday) and one the day before.
select pg_temp.log(401, 4, pg_temp.t() - extract(dow from pg_temp.t())::int);
select pg_temp.log(402, 4, pg_temp.t() - extract(dow from pg_temp.t())::int - 1);
-- 5: one log dated T+1, made now (inside the check), which is after today in Pacific/Pago_Pago.
select pg_temp.log(501, 5, pg_temp.t() + 1, now());
-- 6: logs inserted out of date order (T first, then a scrambled order, two rows on some dates), so
-- the days come out ascending only if the function orders them.
select pg_temp.log(600 + k::int, 6, pg_temp.t() - d, p_cuisine => case when k % 3 = 0 then 'JP' else 'IT' end)
  from unnest(array[0, 2, 4, 9, 1, 7, 3, 12, 5, 10, 4, 9, 0]) with ordinality as x(d, k);

-- -- 1. Signature and grants (6) ------------------------------------------------
select ok(to_regprocedure('public.get_my_food_log_cuisine_days(text, integer)') is not null,
  'get_my_food_log_cuisine_days(text, integer) exists');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'get_my_food_log_cuisine_days'),
  1, 'get_my_food_log_cuisine_days exists once (no overloads)');
select is_empty(
  $$ select p.oid::regprocedure::text from pg_proc p
      where p.oid = 'public.get_my_food_log_cuisine_days(text, integer)'::regprocedure
        and (not p.prosecdef or p.proconfig is distinct from array['search_path=""']
             or p.provolatile is distinct from 's' or p.prorettype is distinct from 'jsonb'::regtype) $$,
  'the function is stable security definer with an empty search_path and returns jsonb');
select ok(has_function_privilege('authenticated', 'public.get_my_food_log_cuisine_days(text, integer)', 'execute'),
  'authenticated can execute the function');
select is_empty(
  $$ select p.oid::regprocedure::text from pg_proc p
      where p.oid = 'public.get_my_food_log_cuisine_days(text, integer)'::regprocedure
        and (has_function_privilege('anon', p.oid, 'execute')
             or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0)) $$,
  'anon and PUBLIC cannot execute the function');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('get_my_food_log_activity', 'list_my_food_logs_on')),
  2, 'spec 14''s two functions still exist once each');

-- -- 2. anon (1) --------------------------------------------------------------------
set local role anon;
select throws_ok($$ select public.get_my_food_log_cuisine_days('UTC', 17) $$, '42501', null,
  'anon cannot execute get_my_food_log_cuisine_days');
reset role;

-- -- 3. Inputs and their order (10) ---------------------------------------------------
set local role authenticated;
select pg_temp.as_user(3);
select throws_ok($$ select public.get_my_food_log_cuisine_days('UTC', null) $$, 'P0001', 'invalid_input', 'null weeks give invalid_input');
select throws_ok($$ select public.get_my_food_log_cuisine_days('UTC', 0) $$, 'P0001', 'invalid_input', '0 weeks give invalid_input');
select throws_ok($$ select public.get_my_food_log_cuisine_days('UTC', 54) $$, 'P0001', 'invalid_input', '54 weeks give invalid_input');
select lives_ok($$ select public.get_my_food_log_cuisine_days('UTC', 1) $$, '1 week is accepted');
select lives_ok($$ select public.get_my_food_log_cuisine_days('UTC', 53) $$, '53 weeks are accepted');
select throws_ok($$ select public.get_my_food_log_cuisine_days(null, 17) $$, 'P0001', 'invalid_time_zone', 'a null zone gives invalid_time_zone');
select throws_ok($$ select public.get_my_food_log_cuisine_days('', 17) $$, 'P0001', 'invalid_time_zone', 'an empty zone gives invalid_time_zone');
select throws_ok($$ select public.get_my_food_log_cuisine_days('Mars/Olympus', 17) $$, 'P0001', 'invalid_time_zone', 'an unknown zone gives invalid_time_zone');
select throws_ok($$ select public.get_my_food_log_cuisine_days(null, null) $$, 'P0001', 'invalid_input', 'weeks are checked before the zone (null, null)');
select throws_ok($$ select public.get_my_food_log_cuisine_days('Mars/Olympus', 0) $$, 'P0001', 'invalid_input', 'weeks are checked before the zone (unknown zone, 0 weeks)');

-- -- 4. Range parity with the activity function (10) ------------------------------------------
select is(jsonb_build_object('today', pg_temp.cd(w, z)->'today', 'from', pg_temp.cd(w, z)->'from'),
          jsonb_build_object('today', public.get_my_food_log_activity(z, w)->'today',
                             'from', public.get_my_food_log_activity(z, w)->'from'),
  format('today and from equal get_my_food_log_activity''s (%s, %s weeks)', z, w))
  from unnest(array['UTC', 'Pacific/Kiritimati', 'Pacific/Pago_Pago']) z cross join unnest(array[1, 17, 53]) w;
select is((pg_temp.cd()->>'today')::date, pg_temp.t(), 'today is the server''s date in the zone');

-- -- 5. What a day shows (owner, 17 weeks) (7) -----------------------------------------------------
select pg_temp.as_user(1);
select is(pg_temp.cd()->'days',
  jsonb_build_array(pg_temp.e(pg_temp.t() - 6, 1, 1, 'MX'),
                    pg_temp.e(pg_temp.t() - 4, 1, 1, 'fusion'),
                    pg_temp.e(pg_temp.t() - 3, 2, 2, null),
                    pg_temp.e(pg_temp.t() - 2, 2, 2, null),
                    pg_temp.e(pg_temp.t() - 1, 2, 1, 'IT'),
                    pg_temp.e(pg_temp.t(), 1, 1, 'IT')),
  'days: only days with ready uploads, ascending, with count, cuisines and cuisine');
select is(pg_temp.day(pg_temp.cd(), pg_temp.t() - 6), pg_temp.e(pg_temp.t() - 6, 1, 1, 'MX'),
  'one country code gives that code and 1 cuisine');
select is(jsonb_build_object('cuisine', pg_temp.day(pg_temp.cd(), pg_temp.t() - 1)->'cuisine',
                             'cuisines', pg_temp.day(pg_temp.cd(), pg_temp.t() - 1)->'cuisines'),
  '{"cuisine": "IT", "cuisines": 1}'::jsonb,
  'the same code twice gives that code and 1 cuisine (count distinct), not the globe');
select is(pg_temp.day(pg_temp.cd(), pg_temp.t() - 2), pg_temp.e(pg_temp.t() - 2, 2, 2, null),
  'two country codes give a null cuisine and 2 cuisines');
select is(pg_temp.day(pg_temp.cd(), pg_temp.t() - 3), pg_temp.e(pg_temp.t() - 3, 2, 2, null),
  'a neutral code plus a country code give a null cuisine and 2 cuisines');
select is(pg_temp.day(pg_temp.cd(), pg_temp.t() - 4), pg_temp.e(pg_temp.t() - 4, 1, 1, 'fusion'),
  'one neutral code gives that code and 1 cuisine');
select is(pg_temp.day(pg_temp.cd(), pg_temp.t() - 1)->'count', '2'::jsonb,
  'private and public uploads count alike');

-- -- 6. Count parity with the activity function (3) ------------------------------------------------
select is(pg_temp.dc(pg_temp.cd()), public.get_my_food_log_activity('UTC', 17)->'days',
  'the owner''s dates and counts equal the activity function''s');
select pg_temp.as_user(2);
select is(pg_temp.dc(pg_temp.cd()), public.get_my_food_log_activity('UTC', 17)->'days',
  'the second user''s dates and counts equal the activity function''s');
select pg_temp.as_user(4);
select is(pg_temp.dc(pg_temp.cd()), public.get_my_food_log_activity('UTC', 17)->'days',
  'the range-edge user''s dates and counts equal the activity function''s');

-- -- 7. Rows, range and order (9) ---------------------------------------------------------------------------
select pg_temp.as_user(1);
select ok(pg_temp.t() - 6 = any(pg_temp.dates(pg_temp.cd()))
      and not (pg_temp.t() - 5 = any(pg_temp.dates(pg_temp.cd()))),
  'days count by local_date: the late-night upload is on its local day, not its UTC day');
select ok(not (pg_temp.t() - 8 = any(pg_temp.dates(pg_temp.cd()))),
  'a pending upload is not counted');
select is(pg_temp.day(pg_temp.cd(), pg_temp.t()), pg_temp.e(pg_temp.t(), 1, 1, 'IT'),
  'a pending upload of another cuisine does not make the day mixed');
select is_empty(
  $$ select e from jsonb_array_elements(pg_temp.cd(1)->'days') e
      where (e->>'date')::date < (pg_temp.cd(1)->>'from')::date
         or (e->>'date')::date > (pg_temp.cd(1)->>'today')::date $$,
  'days hold nothing before from or after today');
select pg_temp.as_user(4);
select is(pg_temp.dates(pg_temp.cd(1)), array[pg_temp.t() - extract(dow from pg_temp.t())::int],
  'a log on from (the range''s first Sunday) is in a 1-week range, and the day before is not');
select is(pg_temp.dates(pg_temp.cd(2)),
  array[pg_temp.t() - extract(dow from pg_temp.t())::int - 1, pg_temp.t() - extract(dow from pg_temp.t())::int],
  'a 2-week range holds both');
select pg_temp.as_user(5);
select ok((pg_temp.cd(17, 'Pacific/Pago_Pago')->>'today')::date < pg_temp.t() + 1,
  'fixture: the T+1 log is after today in Pacific/Pago_Pago');
select is(pg_temp.cd(17, 'Pacific/Pago_Pago')->'days', '[]'::jsonb,
  'a log dated after today is not in days');
select pg_temp.as_user(6);
select is(pg_temp.dates(pg_temp.cd()),
  (select array_agg(distinct d order by d) from unnest(pg_temp.dates(pg_temp.cd())) d),
  'days come strictly ascending by date, though their rows were inserted newest date first');

-- -- 8. Exact key sets (5) -------------------------------------------------------------------------
select pg_temp.as_user(1);
select is(pg_temp.keys(pg_temp.cd()), array['days', 'from', 'today'],
  'the object has exactly days, from, today');
select is(pg_temp.keys(pg_temp.cd()->'days'->0), array['count', 'cuisine', 'cuisines', 'date'],
  'a days item has exactly count, cuisine, cuisines, date');
select is_empty(
  $$ select e from jsonb_array_elements(pg_temp.cd()->'days') e
      where pg_temp.keys(e) is distinct from array['count', 'cuisine', 'cuisines', 'date'] $$,
  'every days item has exactly the four keys');
select ok((pg_temp.day(pg_temp.cd(), pg_temp.t() - 2) ? 'cuisine')
      and pg_temp.day(pg_temp.cd(), pg_temp.t() - 2)->'cuisine' = 'null'::jsonb,
  'a mixed day carries the cuisine key as JSON null');
select pg_temp.as_nobody();
select is(pg_temp.keys(pg_temp.cd()), array['days', 'from', 'today'],
  'a caller without a user id gets the same key set');

-- -- 9. Outsiders and callers without a user id (7) ----------------------------------------------------
select pg_temp.as_user(2);
select is(pg_temp.cd()->'days',
  jsonb_build_array(pg_temp.e(pg_temp.t() - 5, 1, 1, 'MX'), pg_temp.e(pg_temp.t() - 1, 2, 1, 'MX')),
  'fixture: the second user sees their own public and private MX logs');
select pg_temp.as_user(1);
select is(pg_temp.day(pg_temp.cd(), pg_temp.t() - 1), pg_temp.e(pg_temp.t() - 1, 2, 1, 'IT'),
  'two users on one date: the owner''s day holds none of the second user''s public or private MX');
select ok(not (pg_temp.t() - 5 = any(pg_temp.dates(pg_temp.cd()))),
  'the owner''s days hold no date that only the second user has');
select pg_temp.as_user(3);
select is(pg_temp.cd(53)->'days', '[]'::jsonb,
  'an outsider''s cuisine days hold none of the other users'' days, public or private');
select pg_temp.as_nobody();
select is(pg_temp.cd()->'days', '[]'::jsonb, 'a caller without a user id gets no days');
select is((pg_temp.cd()->>'today')::date, pg_temp.t(), 'a caller without a user id still gets the server''s today');
select throws_ok($$ select public.get_my_food_log_cuisine_days('UTC', 0) $$, 'P0001', 'invalid_input',
  'a caller without a user id still gets the input checks');

select * from finish();
rollback;
