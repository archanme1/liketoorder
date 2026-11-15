-- Spec 14: activity grid (PR 1) -- get_my_food_log_activity and list_my_food_logs_on. The function
-- allowlist lives in the 05 file.
--
-- This file is ASCII only (it needs no special character; any would be built with chr()).
-- Rows are inserted as postgres with chosen local_date and created_at inside the table's UTC date
-- +-1 check. Dates are relative to T, today in UTC at the transaction's now(), and calls use the
-- zone 'UTC' unless a zone is under test, so nothing sleeps and nothing depends on the session zone.
-- Each streak scenario has its own user so the cases cannot interfere; seeded rows of other
-- accounts cannot change any count here, because both functions read only auth.uid()'s rows.
begin;
select plan(78);

-- -- Helpers (pg_temp) -------------------------------------------------------
-- Ids: users 00000000-0000-0000-0014-<n>; logs ...-0514-<n>.
create function pg_temp.u(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0014-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.lid(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0514-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.t() returns date language sql stable as $$ select (now() at time zone 'UTC')::date $$;
create function pg_temp.y() returns int language sql stable as $$ select extract(year from pg_temp.t())::int $$;
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
-- The dates of an activity's days, in the order returned.
create function pg_temp.dates(j jsonb) returns date[] language sql immutable as $$
  select coalesce(array_agg((e->>'date')::date order by o), array[]::date[])
    from jsonb_array_elements(j->'days') with ordinality as x(e, o);
$$;
-- The ids of a day list, in the order returned.
create function pg_temp.ids(j jsonb) returns uuid[] language sql immutable as $$
  select coalesce(array_agg((e->>'id')::uuid order by o), array[]::uuid[])
    from jsonb_array_elements(j->'items') with ordinality as x(e, o);
$$;

-- Superuser fixture: one log. created_at defaults to noon UTC on the local date (inside the check).
create function pg_temp.log(p_n int, p_author int, p_date date, p_at timestamptz default null,
                            p_cuisine text default 'IT', p_public boolean default true,
                            p_status text default 'ready', p_desc text default null) returns void
language plpgsql as $$
begin
  insert into public.food_logs (id, author_id, cuisine_code, description, is_public, local_date, path, status, created_at)
  values (pg_temp.lid(p_n), pg_temp.u(p_author), p_cuisine, p_desc, p_public, p_date,
          pg_temp.u(p_author)::text || '/' || pg_temp.lid(p_n)::text || '.jpg', p_status,
          coalesce(p_at, (p_date + time '12:00') at time zone 'UTC'));
end $$;

-- -- Fixtures (as postgres) ---------------------------------------------------
-- 1 owner   2 second user   3 outsider   4 today run   5 yesterday run   6 broken run
-- 7 private-only run   8 long run across a year   9 New Year   10 sixty rows   11 future date
insert into auth.users (id, email)
select pg_temp.u(n), 'grid14_' || n || '@example.test' from generate_series(1, 11) n;
update public.profiles set username = 'grid14_' || right(id::text, 2)
 where id in (select pg_temp.u(n) from generate_series(1, 11) n);

-- 1: late night (local T-3, created 03:30 UTC on T-2), a pending row, a private and a public row
-- on one date, and an ordered day (two rows at the same time, then id order; one pending).
select pg_temp.log(101, 1, pg_temp.t() - 3, ((pg_temp.t() - 2) + time '03:30') at time zone 'UTC');
select pg_temp.log(102, 1, pg_temp.t() - 5, p_status => 'pending');
select pg_temp.log(103, 1, pg_temp.t() - 7, p_public => true);
select pg_temp.log(104, 1, pg_temp.t() - 7, p_public => false);
select pg_temp.log(105, 1, pg_temp.t() - 10, ((pg_temp.t() - 10) + time '10:00') at time zone 'UTC');
select pg_temp.log(106, 1, pg_temp.t() - 10, ((pg_temp.t() - 10) + time '08:00') at time zone 'UTC',
                   p_public => false, p_desc => 'Late lunch');
select pg_temp.log(107, 1, pg_temp.t() - 10, ((pg_temp.t() - 10) + time '08:00') at time zone 'UTC');
select pg_temp.log(108, 1, pg_temp.t() - 10, ((pg_temp.t() - 10) + time '07:00') at time zone 'UTC',
                   p_status => 'pending');
-- 2: a public and a private log on T-4.
select pg_temp.log(201, 2, pg_temp.t() - 4, p_cuisine => 'JP', p_public => true);
select pg_temp.log(202, 2, pg_temp.t() - 4, p_cuisine => 'JP', p_public => false);
-- 4: T, T-1, T-2 with repeated and neutral cuisines, plus a pending JP row.
select pg_temp.log(401, 4, pg_temp.t(), p_cuisine => 'IT');
select pg_temp.log(402, 4, pg_temp.t(), p_cuisine => 'street-food');
select pg_temp.log(403, 4, pg_temp.t() - 1, p_cuisine => 'IT');
select pg_temp.log(404, 4, pg_temp.t() - 1, p_cuisine => 'fusion');
select pg_temp.log(405, 4, pg_temp.t() - 2, p_cuisine => 'other');
select pg_temp.log(406, 4, pg_temp.t(), p_cuisine => 'JP', p_status => 'pending');
-- 5: T-1, T-2 (nothing today yet).
select pg_temp.log(501, 5, pg_temp.t() - 1);
select pg_temp.log(502, 5, pg_temp.t() - 2);
-- 6: T, then a missed day, then T-2, T-3.
select pg_temp.log(601, 6, pg_temp.t());
select pg_temp.log(602, 6, pg_temp.t() - 2);
select pg_temp.log(603, 6, pg_temp.t() - 3);
-- 7: T-1, T-2, T-3, all private.
select pg_temp.log(701, 7, pg_temp.t() - 1, p_public => false);
select pg_temp.log(702, 7, pg_temp.t() - 2, p_public => false);
select pg_temp.log(703, 7, pg_temp.t() - 3, p_public => false);
-- 8: Dec 30 (Y-2) to Jan 2 (Y-1), a gap, then Mar 1 and Mar 2 (Y-1).
select pg_temp.log(801, 8, make_date(pg_temp.y() - 2, 12, 30));
select pg_temp.log(802, 8, make_date(pg_temp.y() - 2, 12, 31));
select pg_temp.log(803, 8, make_date(pg_temp.y() - 1, 1, 1));
select pg_temp.log(804, 8, make_date(pg_temp.y() - 1, 1, 2));
select pg_temp.log(805, 8, make_date(pg_temp.y() - 1, 3, 1));
select pg_temp.log(806, 8, make_date(pg_temp.y() - 1, 3, 2));
-- 9: the day before and the day of Jan 1, in UTC.
select pg_temp.log(901, 9, make_date(pg_temp.y() - 1, 12, 31));
select pg_temp.log(902, 9, make_date(pg_temp.y(), 1, 1));
-- 10: 60 ready rows on T-6, one minute apart.
select pg_temp.log(1000 + n, 10, pg_temp.t() - 6, ((pg_temp.t() - 6) + time '00:00') at time zone 'UTC' + n * interval '1 minute')
  from generate_series(1, 60) n;
-- 11: one log dated T+1, made now (inside the check), which is after today in Pacific/Pago_Pago.
select pg_temp.log(1101, 11, pg_temp.t() + 1, now());

-- -- 1. Signatures and grants -------------------------------------------------
select ok(to_regprocedure('public.get_my_food_log_activity(text, integer)') is not null,
  'get_my_food_log_activity(text, integer) exists');
select ok(to_regprocedure('public.list_my_food_logs_on(date)') is not null,
  'list_my_food_logs_on(date) exists');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('get_my_food_log_activity', 'list_my_food_logs_on')),
  2, 'each of the two functions exists once (no overloads)');
select is_empty(
  $$ select p.oid::regprocedure::text from pg_proc p
      where p.oid in ('public.get_my_food_log_activity(text, integer)'::regprocedure,
                      'public.list_my_food_logs_on(date)'::regprocedure)
        and (not p.prosecdef or p.proconfig is distinct from array['search_path=""']
             or p.provolatile is distinct from 's' or p.prorettype is distinct from 'jsonb'::regtype) $$,
  'both functions are stable security definer with an empty search_path and return jsonb');
select ok(has_function_privilege('authenticated', 'public.get_my_food_log_activity(text, integer)', 'execute')
      and has_function_privilege('authenticated', 'public.list_my_food_logs_on(date)', 'execute'),
  'authenticated can execute both functions');
select is_empty(
  $$ select p.oid::regprocedure::text from pg_proc p
      where p.oid in ('public.get_my_food_log_activity(text, integer)'::regprocedure,
                      'public.list_my_food_logs_on(date)'::regprocedure)
        and (has_function_privilege('anon', p.oid, 'execute')
             or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0)) $$,
  'anon and PUBLIC can execute neither function');

-- -- 2. Source checks -----------------------------------------------------------
select ok(pg_get_functiondef('public.get_my_food_log_activity(text, integer)'::regprocedure) like '%make_date(extract(year from v_today)::int, 1, 1)%'
      and pg_get_functiondef('public.get_my_food_log_activity(text, integer)'::regprocedure) not like '%date\_trunc%',
  'the year starts at make_date(<year of today>, 1, 1), never date_trunc (session-zone free)');
select ok(pg_get_functiondef('public.list_my_food_logs_on(date)'::regprocedure)
            like '%A local_date is within the UTC date +/-1 of created_at (food_logs_local_date_near), so one date''s uploads all started within 72 hours, and begin_food_log_upload allows 20 starts per rolling 24 hours: at most 60. If that cap or that check changes, change this limit.%',
  'the day list carries the limit comment');

-- -- 3. anon ------------------------------------------------------------------------
set local role anon;
select throws_ok($$ select public.get_my_food_log_activity('UTC', 17) $$, '42501', null, 'anon cannot execute get_my_food_log_activity');
select throws_ok($$ select public.list_my_food_logs_on(current_date) $$, '42501', null, 'anon cannot execute list_my_food_logs_on');
reset role;

-- -- 4. Inputs and their order ---------------------------------------------------------
set local role authenticated;
select pg_temp.as_user(3);
select throws_ok($$ select public.get_my_food_log_activity('UTC', null) $$, 'P0001', 'invalid_input', 'null weeks give invalid_input');
select throws_ok($$ select public.get_my_food_log_activity('UTC', 0) $$, 'P0001', 'invalid_input', '0 weeks give invalid_input');
select throws_ok($$ select public.get_my_food_log_activity('UTC', 54) $$, 'P0001', 'invalid_input', '54 weeks give invalid_input');
select lives_ok($$ select public.get_my_food_log_activity('UTC', 1) $$, '1 week is accepted');
select lives_ok($$ select public.get_my_food_log_activity('UTC', 53) $$, '53 weeks are accepted');
select throws_ok($$ select public.get_my_food_log_activity(null, 17) $$, 'P0001', 'invalid_time_zone', 'a null zone gives invalid_time_zone');
select throws_ok($$ select public.get_my_food_log_activity('', 17) $$, 'P0001', 'invalid_time_zone', 'an empty zone gives invalid_time_zone');
select throws_ok($$ select public.get_my_food_log_activity('Mars/Olympus', 17) $$, 'P0001', 'invalid_time_zone', 'an unknown zone gives invalid_time_zone');
select throws_ok($$ select public.get_my_food_log_activity(null, null) $$, 'P0001', 'invalid_input', 'weeks are checked before the zone (null, null)');
select throws_ok($$ select public.get_my_food_log_activity('Mars/Olympus', 0) $$, 'P0001', 'invalid_input', 'weeks are checked before the zone (unknown zone, 0 weeks)');
select throws_ok($$ select public.list_my_food_logs_on(null) $$, 'P0001', 'invalid_input', 'a null date gives invalid_input');

-- -- 5. Range ---------------------------------------------------------------------------------
-- from is a Sunday, from <= today, and the range holds 7 * weeks - (6 - dow(today)) days.
select ok((select extract(dow from (j->>'from')::date) = 0 and (j->>'from')::date <= (j->>'today')::date
                  and (j->>'today')::date - (j->>'from')::date + 1 = 7 * w - (6 - extract(dow from (j->>'today')::date)::int)
             from (select public.get_my_food_log_activity('UTC', w) as j) x),
  format('the %s-week range starts on a Sunday and holds 7 * %s - (6 - dow(today)) days', w, w))
  from unnest(array[1, 17, 53]) w;
select is((public.get_my_food_log_activity('UTC', 17)->>'today')::date, pg_temp.t(), 'today is the server''s date in the zone');

-- -- 6. Today follows the zone -------------------------------------------------------------
select is((public.get_my_food_log_activity('Pacific/Kiritimati', 1)->>'today')::date, (now() at time zone 'Pacific/Kiritimati')::date,
  'today follows Pacific/Kiritimati');
select is((public.get_my_food_log_activity('Pacific/Pago_Pago', 1)->>'today')::date, (now() at time zone 'Pacific/Pago_Pago')::date,
  'today follows Pacific/Pago_Pago');
select isnt(public.get_my_food_log_activity('Pacific/Kiritimati', 1)->'today', public.get_my_food_log_activity('Pacific/Pago_Pago', 1)->'today',
  'the two zones (25 hours apart) give different todays at one instant');

-- -- 7. days ---------------------------------------------------------------------------------
select pg_temp.as_user(1);
select ok(pg_temp.t() - 3 = any(pg_temp.dates(public.get_my_food_log_activity('UTC', 17)))
      and not (pg_temp.t() - 2 = any(pg_temp.dates(public.get_my_food_log_activity('UTC', 17)))),
  'days count by local_date: the late-night upload is on its local day, not its UTC day');
select ok(not (pg_temp.t() - 5 = any(pg_temp.dates(public.get_my_food_log_activity('UTC', 17)))),
  'a pending upload is not counted');
select is((select e->'count' from jsonb_array_elements(public.get_my_food_log_activity('UTC', 17)->'days') e
            where (e->>'date')::date = pg_temp.t() - 7),
  '2'::jsonb, 'private and public uploads count alike');
select is(public.get_my_food_log_activity('UTC', 17)->'days',
  jsonb_build_array(jsonb_build_object('date', pg_temp.t() - 10, 'count', 3),
                    jsonb_build_object('date', pg_temp.t() - 7, 'count', 2),
                    jsonb_build_object('date', pg_temp.t() - 3, 'count', 1)),
  'days: only days with uploads, ready rows only, ascending, with their counts');
select is_empty(
  $$ select e from jsonb_array_elements(public.get_my_food_log_activity('UTC', 1)->'days') e
      where (e->>'date')::date < (public.get_my_food_log_activity('UTC', 1)->>'from')::date
         or (e->>'date')::date > (public.get_my_food_log_activity('UTC', 1)->>'today')::date $$,
  'days hold nothing before from or after today');
select ok(not (pg_temp.t() - 7 = any(pg_temp.dates(public.get_my_food_log_activity('UTC', 1))))
      and not (pg_temp.t() - 10 = any(pg_temp.dates(public.get_my_food_log_activity('UTC', 1)))),
  'a 1-week range leaves out older days');

-- -- 8. Streaks -------------------------------------------------------------------------------
select pg_temp.as_user(4);
select is(public.get_my_food_log_activity('UTC', 17)->'stats'->'current_streak', '3'::jsonb,
  'current streak: today logged gives the run that includes today');
select is(public.get_my_food_log_activity('UTC', 17)->'stats'->'longest_streak', '3'::jsonb, 'longest streak of the today run');
select pg_temp.as_user(5);
select is(public.get_my_food_log_activity('UTC', 17)->'stats'->'current_streak', '2'::jsonb,
  'current streak: today not logged but yesterday logged gives the run ending yesterday');
select pg_temp.as_user(2);
select is(public.get_my_food_log_activity('UTC', 17)->'stats'->'current_streak', '0'::jsonb,
  'current streak: neither today nor yesterday logged gives 0');
select pg_temp.as_user(6);
select is(public.get_my_food_log_activity('UTC', 17)->'stats'->'current_streak', '1'::jsonb,
  'current streak: one missed day resets it (today only)');
select is(public.get_my_food_log_activity('UTC', 17)->'stats'->'longest_streak', '2'::jsonb,
  'longest streak: the run before the missed day');
select pg_temp.as_user(7);
select is(public.get_my_food_log_activity('UTC', 17)->'stats'->'current_streak', '3'::jsonb,
  'a run made only of private uploads counts (current)');
select is(public.get_my_food_log_activity('UTC', 17)->'stats'->'longest_streak', '3'::jsonb,
  'a run made only of private uploads counts (longest)');
select pg_temp.as_user(8);
select is(public.get_my_food_log_activity('UTC', 17)->'stats'->'longest_streak', '4'::jsonb,
  'longest streak: the 4-day run across a year boundary beats the 2-day run after a gap');
select is(public.get_my_food_log_activity('UTC', 17)->'stats'->'current_streak', '0'::jsonb,
  'an old run is not a current streak');

-- -- 9. New Year (total_this_year) -----------------------------------------------------------------
select pg_temp.as_user(9);
select is(public.get_my_food_log_activity('UTC', 17)->'stats'->'total_this_year', '1'::jsonb,
  'total this year: the Jan 1 upload counts and the Dec 31 upload does not');
set local timezone = 'Pacific/Kiritimati';
select is(public.get_my_food_log_activity('UTC', 17)->'stats'->'total_this_year', '1'::jsonb,
  'total this year is the same under the session zone Pacific/Kiritimati');
set local timezone = 'Pacific/Pago_Pago';
select is(public.get_my_food_log_activity('UTC', 17)->'stats'->'total_this_year', '1'::jsonb,
  'total this year is the same under the session zone Pacific/Pago_Pago');
set local timezone = 'UTC';
select is(public.get_my_food_log_activity('UTC', 17)->'stats'->'longest_streak', '2'::jsonb,
  'the streak continues across Dec 31 and Jan 1 while the yearly total restarts');

-- -- 10. Cuisines tried ------------------------------------------------------------------------
select pg_temp.as_user(4);
select is(public.get_my_food_log_activity('UTC', 17)->'stats'->'cuisines_tried', '4'::jsonb,
  'cuisines tried: IT counts once, the neutral street-food, fusion and other count, the pending JP does not');
select is(public.get_my_food_log_activity('UTC', 17)->'stats'->'total_this_year',
  to_jsonb((select count(*)::int from unnest(array[pg_temp.t(), pg_temp.t(), pg_temp.t() - 1, pg_temp.t() - 1, pg_temp.t() - 2]) d
             where d >= make_date(pg_temp.y(), 1, 1))),
  'total this year counts ready uploads of this calendar year (the pending one excluded)');

-- -- 11. A date after today ---------------------------------------------------------------------
select pg_temp.as_user(11);
select ok((public.get_my_food_log_activity('Pacific/Pago_Pago', 17)->>'today')::date < pg_temp.t() + 1,
  'fixture: the T+1 log is after today in Pacific/Pago_Pago');
select is(public.get_my_food_log_activity('Pacific/Pago_Pago', 17)->'days', '[]'::jsonb,
  'a log dated after today is not in days');
select is(public.get_my_food_log_activity('Pacific/Pago_Pago', 17)->'stats',
  '{"total_this_year": 0, "current_streak": 0, "longest_streak": 0, "cuisines_tried": 0}'::jsonb,
  'a log dated after today counts in no stat');

-- -- 12. list_my_food_logs_on ------------------------------------------------------------------------
select pg_temp.as_user(1);
select is(pg_temp.ids(public.list_my_food_logs_on(pg_temp.t() - 10)), array[pg_temp.lid(106), pg_temp.lid(107), pg_temp.lid(105)],
  'the day list holds the date''s ready rows, oldest first (created_at, then id); the pending row is absent');
select is(pg_temp.ids(public.list_my_food_logs_on(pg_temp.t() - 3)), array[pg_temp.lid(101)],
  'the day list goes by local_date (the late-night upload is on its local day)');
select is(public.list_my_food_logs_on(pg_temp.t() - 2), '{"items": []}'::jsonb,
  'a date with no upload gives { items: [] } (the late-night upload is not on its UTC day)');
select is(public.list_my_food_logs_on(pg_temp.t() - 5), '{"items": []}'::jsonb, 'a date with only a pending row gives no item');
select is((public.list_my_food_logs_on(pg_temp.t() - 10)->'items'->0),
  jsonb_build_object('id', pg_temp.lid(106), 'cuisine_code', 'IT', 'description', 'Late lunch', 'is_public', false,
                     'local_date', pg_temp.t() - 10,
                     'created_at', ((pg_temp.t() - 10) + time '08:00') at time zone 'UTC',
                     'path', pg_temp.u(1)::text || '/' || pg_temp.lid(106)::text || '.jpg', 'is_mine', true),
  'an item is spec 13''s 8-key log object with the caller''s own path');
select pg_temp.as_user(10);
select is(jsonb_array_length(public.list_my_food_logs_on(pg_temp.t() - 6)->'items'), 60,
  '60 ready rows on one date are all returned (the pinned limit, Decision 13)');
select is(pg_temp.ids(public.list_my_food_logs_on(pg_temp.t() - 6)),
  (select array_agg(pg_temp.lid(1000 + n) order by n) from generate_series(1, 60) n),
  'the 60 rows come oldest first');

-- -- 13. Exact key sets -------------------------------------------------------------------------------
select pg_temp.as_user(1);
select is(pg_temp.keys(public.get_my_food_log_activity('UTC', 17)), array['days', 'from', 'stats', 'today'],
  'the activity object has exactly days, from, stats, today');
select is(pg_temp.keys(public.get_my_food_log_activity('UTC', 17)->'stats'),
  array['cuisines_tried', 'current_streak', 'longest_streak', 'total_this_year'],
  'stats has exactly the four stats');
select is(pg_temp.keys(public.get_my_food_log_activity('UTC', 17)->'days'->0), array['count', 'date'],
  'a days item has exactly date and count');
select is(pg_temp.keys(public.list_my_food_logs_on(pg_temp.t() - 10)), array['items'], 'the day object has exactly items');
select is_empty(
  $$ select e from jsonb_array_elements(public.list_my_food_logs_on(pg_temp.t() - 10)->'items') e
      where pg_temp.keys(e) is distinct from array['created_at', 'cuisine_code', 'description', 'id', 'is_mine',
                                                   'is_public', 'local_date', 'path'] $$,
  'every item has exactly the 8 keys');

-- -- 14. Outsiders and callers without a user id ------------------------------------------------------
select pg_temp.as_user(2);
select is(pg_temp.ids(public.list_my_food_logs_on(pg_temp.t() - 4)), array[pg_temp.lid(201), pg_temp.lid(202)],
  'fixture: the second user sees their own public and private logs on T-4');
select pg_temp.as_user(3);
select is(public.get_my_food_log_activity('UTC', 53)->'days', '[]'::jsonb,
  'an outsider''s activity holds none of the other users'' days');
select is(public.get_my_food_log_activity('UTC', 53)->'stats',
  '{"total_this_year": 0, "current_streak": 0, "longest_streak": 0, "cuisines_tried": 0}'::jsonb,
  'an outsider''s stats count none of the other users'' uploads');
select is(public.list_my_food_logs_on(pg_temp.t() - 4), '{"items": []}'::jsonb,
  'the second user''s public and private logs on T-4 give the outsider an empty day list');
select is(public.list_my_food_logs_on(pg_temp.t() - 10), '{"items": []}'::jsonb,
  'the owner''s logs on T-10 give the outsider an empty day list');
select pg_temp.as_user(1);
select is(public.list_my_food_logs_on(pg_temp.t() - 4), '{"items": []}'::jsonb,
  'the second user''s public log on T-4 gives the owner an empty day list');
select ok(not (pg_temp.t() - 4 = any(pg_temp.dates(public.get_my_food_log_activity('UTC', 17)))),
  'the owner''s activity holds none of the second user''s days');
select pg_temp.as_nobody();
select is(public.get_my_food_log_activity('UTC', 17)->'days', '[]'::jsonb, 'a caller without a user id gets no days');
select is(public.get_my_food_log_activity('UTC', 17)->'stats',
  '{"total_this_year": 0, "current_streak": 0, "longest_streak": 0, "cuisines_tried": 0}'::jsonb,
  'a caller without a user id gets every stat 0');
select is(pg_temp.keys(public.get_my_food_log_activity('UTC', 17)), array['days', 'from', 'stats', 'today'],
  'a caller without a user id gets the same key set');
select is((public.get_my_food_log_activity('UTC', 17)->>'today')::date, pg_temp.t(),
  'a caller without a user id still gets the server''s today');
select is(public.list_my_food_logs_on(pg_temp.t() - 10), '{"items": []}'::jsonb,
  'a caller without a user id gets an empty day list');
select throws_ok($$ select public.get_my_food_log_activity('UTC', 0) $$, 'P0001', 'invalid_input',
  'a caller without a user id still gets the input checks');

select * from finish();
rollback;
