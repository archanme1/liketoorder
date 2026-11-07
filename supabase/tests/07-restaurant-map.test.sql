-- Spec 07 (PR 1): restaurant map backend — freshness guard, bounding-box pins, details,
-- guest/user rate limit, refresh claim/apply, cleanup, map_status, extensions and cron.
begin;
select plan(215);

-- Cron-job lookup that reports null (instead of aborting the file) when pg_cron is missing.
create function pg_temp.cron_schedule(p_name text) returns text language plpgsql as $$
declare r text;
begin
  if to_regclass('cron.job') is null then return null; end if;
  execute 'select schedule from cron.job where jobname = $1' into r using p_name;
  return r;
end $$;

-- ── Fixtures (as postgres) ──────────────────────────────────────────────────
-- Users:      00000000-0000-0000-0007-<n>      Businesses: 00000000-0000-0000-0017-<n>   (n = 12 digits)
--  1 R1   restaurant, resolved 1 day ago     (70.10, 100.10) menu, photos, currency CAD
--  2 R29  restaurant, resolved 29 days ago   (70.11, 100.11) one item, one photo
--  3 R31  restaurant, resolved 31 days ago   (70.12, 100.12)
--  4 HM   homemade, location, map point      (70.13, 100.13)
--  5 UL   restaurant, unlisted               (70.14, 100.14)
--  6 NL   restaurant, no location, no map point
--  7 NF   restaurant, place_status not_found (70.15, 100.15)
--  8 O    outsider, no business
--  9 HD   homemade, resolved 27 days ago     (62.00, 10.00)
-- 10 PO   restaurant at the pole             (89.5, 5.0)
-- 11 EA   restaurant east of the date line   (60.1, 179.9)     12 WE  west of it (60.2, -179.9)
-- 101..130 claim fixtures, resolved 26 days + i minutes ago     1001..1501 cap fixtures (501 rows)
insert into auth.users (id, email)
select ('00000000-0000-0000-0007-' || lpad(n::text, 12, '0'))::uuid, 'm' || n || '@example.test'
  from (select generate_series(1, 12) union all select generate_series(101, 130)
        union all select generate_series(1001, 1501)) g(n);

insert into public.businesses (id, owner_id, type, name, cuisine_code, accepts_table_requests,
                               map_lat, map_lng, public_address, is_listed, currency_code) values
  ('00000000-0000-0000-0017-000000000001', '00000000-0000-0000-0007-000000000001', 'restaurant', 'Fresh One', 'IT', true,
   70.10, 100.10, '1 Fresh St, Tromso', true, 'CAD'),
  ('00000000-0000-0000-0017-000000000002', '00000000-0000-0000-0007-000000000002', 'restaurant', 'Day Twenty Nine', 'IT', false,
   70.11, 100.11, '29 Old St, Tromso', true, null),
  ('00000000-0000-0000-0017-000000000003', '00000000-0000-0000-0007-000000000003', 'restaurant', 'Day Thirty One', 'IT', false,
   70.12, 100.12, '31 Old St, Tromso', true, null),
  ('00000000-0000-0000-0017-000000000004', '00000000-0000-0000-0007-000000000004', 'homemade', 'Home Kitchen', 'IT', false,
   70.13, 100.13, null, true, null),
  ('00000000-0000-0000-0017-000000000005', '00000000-0000-0000-0007-000000000005', 'restaurant', 'Unlisted Place', 'IT', false,
   70.14, 100.14, '5 Hidden St, Tromso', false, null),
  ('00000000-0000-0000-0017-000000000006', '00000000-0000-0000-0007-000000000006', 'restaurant', 'No Address Yet', 'IT', false,
   null, null, null, true, null),
  ('00000000-0000-0000-0017-000000000007', '00000000-0000-0000-0007-000000000007', 'restaurant', 'Gone From Google', 'IT', false,
   70.15, 100.15, '7 Gone St, Tromso', true, null),
  ('00000000-0000-0000-0017-000000000009', '00000000-0000-0000-0007-000000000009', 'homemade', 'Due Kitchen', 'IT', false,
   62.0, 10.0, null, true, null),
  ('00000000-0000-0000-0017-000000000010', '00000000-0000-0000-0007-000000000010', 'restaurant', 'Polar Cafe', 'IT', false,
   89.5, 5.0, '1 Pole Rd', true, null),
  ('00000000-0000-0000-0017-000000000011', '00000000-0000-0000-0007-000000000011', 'restaurant', 'East Pin', 'IT', false,
   60.1, 179.9, '1 East Rd', true, null),
  ('00000000-0000-0000-0017-000000000012', '00000000-0000-0000-0007-000000000012', 'restaurant', 'West Pin', 'IT', false,
   60.2, -179.9, '1 West Rd', true, null);

insert into public.business_locations (business_id, place_id, formatted_address, lat, lng, resolved_at, place_status) values
  ('00000000-0000-0000-0017-000000000001', 'pR1',  '1 Fresh St, Tromso',  70.10, 100.10, now() - interval '1 day',   'ok'),
  ('00000000-0000-0000-0017-000000000002', 'pR29', '29 Old St, Tromso',   70.11, 100.11, now() - interval '29 days', 'ok'),
  ('00000000-0000-0000-0017-000000000003', 'pR31', '31 Old St, Tromso',   70.12, 100.12, now() - interval '31 days', 'ok'),
  ('00000000-0000-0000-0017-000000000004', 'pHM',  '4 Home St, Tromso',   70.1301, 100.1301, now() - interval '1 day', 'ok'),
  ('00000000-0000-0000-0017-000000000005', 'pUL',  '5 Hidden St, Tromso', 70.14, 100.14, now() - interval '1 day',   'ok'),
  ('00000000-0000-0000-0017-000000000007', 'pNF',  '7 Gone St, Tromso',   70.15, 100.15, now() - interval '1 day',   'not_found'),
  ('00000000-0000-0000-0017-000000000009', 'pHD',  '9 Due St, Oslo',      62.0001, 10.0001, now() - interval '27 days', 'ok'),
  ('00000000-0000-0000-0017-000000000010', 'pPO',  '1 Pole Rd',           89.5, 5.0, now(), 'ok'),
  ('00000000-0000-0000-0017-000000000011', 'pEA',  '1 East Rd',           60.1, 179.9, now(), 'ok'),
  ('00000000-0000-0000-0017-000000000012', 'pWE',  '1 West Rd',           60.2, -179.9, now(), 'ok');

-- Claim fixtures: 30 restaurants due for refresh (26 days + i minutes old).
insert into public.businesses (id, owner_id, type, name, cuisine_code, map_lat, map_lng, public_address)
select ('00000000-0000-0000-0017-' || lpad((100 + i)::text, 12, '0'))::uuid,
       ('00000000-0000-0000-0007-' || lpad((100 + i)::text, 12, '0'))::uuid,
       'restaurant', 'Claim ' || i, 'IT', -60 + i * 0.001, 10, 'Claim St ' || i
  from generate_series(1, 30) i;
insert into public.business_locations (business_id, place_id, formatted_address, lat, lng, resolved_at)
select ('00000000-0000-0000-0017-' || lpad((100 + i)::text, 12, '0'))::uuid,
       'pC' || i, 'Claim St ' || i, -60 + i * 0.001, 10, now() - interval '26 days' - i * interval '1 minute'
  from generate_series(1, 30) i;

-- Cap fixtures: 501 fresh restaurants in one small box (lat -50..-49.7, lng -100..-99.7).
insert into public.businesses (id, owner_id, type, name, cuisine_code, map_lat, map_lng, public_address)
select ('00000000-0000-0000-0017-' || lpad((1000 + i)::text, 12, '0'))::uuid,
       ('00000000-0000-0000-0007-' || lpad((1000 + i)::text, 12, '0'))::uuid,
       'restaurant', 'Cap ' || i, 'IT', -50 + i * 0.0005, -100 + i * 0.0005, 'Cap St ' || i
  from generate_series(1, 501) i;
insert into public.business_locations (business_id, place_id, formatted_address, lat, lng)
select ('00000000-0000-0000-0017-' || lpad((1000 + i)::text, 12, '0'))::uuid,
       'pK' || i, 'Cap St ' || i, -50 + i * 0.0005, -100 + i * 0.0005
  from generate_series(1, 501) i;

-- R1: menu and photos for the details function.
insert into public.menu_items (id, business_id, name, description, price_minor, is_available, position) values
  ('00000000-0000-0000-0027-000000000002', '00000000-0000-0000-0017-000000000001', 'Soup', 'Hot', 850, false, 2),
  ('00000000-0000-0000-0027-000000000001', '00000000-0000-0000-0017-000000000001', 'Bread', null, 450, true, 1),
  ('00000000-0000-0000-0027-000000000003', '00000000-0000-0000-0017-000000000002', 'Rice', null, null, true, 1);
insert into public.business_photos (id, business_id, kind, status, position, path) values
  ('00000000-0000-0000-0037-000000000001', '00000000-0000-0000-0017-000000000001', 'cover', 'ready', null,
   '00000000-0000-0000-0017-000000000001/00000000-0000-0000-0037-000000000001.jpg'),
  ('00000000-0000-0000-0037-000000000002', '00000000-0000-0000-0017-000000000001', 'gallery', 'ready', 1,
   '00000000-0000-0000-0017-000000000001/00000000-0000-0000-0037-000000000002.jpg'),
  ('00000000-0000-0000-0037-000000000003', '00000000-0000-0000-0017-000000000001', 'gallery', 'pending', 2,
   '00000000-0000-0000-0017-000000000001/00000000-0000-0000-0037-000000000003.jpg'),
  ('00000000-0000-0000-0037-000000000004', '00000000-0000-0000-0017-000000000002', 'cover', 'ready', null,
   '00000000-0000-0000-0017-000000000002/00000000-0000-0000-0037-000000000004.jpg');

delete from public.map_rate_limits;    -- dev data must not count toward the limits below

-- ── Extensions and cron jobs (fail with a clear message if one is missing) ──
select ok(exists (select 1 from pg_extension where extname = 'pg_cron'),
  'pg_cron is installed (enable the pg_cron extension on this database)');
select ok(exists (select 1 from pg_extension where extname = 'pg_net'),
  'pg_net is installed (enable the pg_net extension on this database)');
select ok(exists (select 1 from pg_extension where extname = 'supabase_vault'),
  'supabase_vault is installed (enable the Vault extension on this database)');
select is(pg_temp.cron_schedule('places-refresh'), '0 */6 * * *', 'the refresh job runs every 6 hours (UTC)');
select is(pg_temp.cron_schedule('map-rate-limits-cleanup'), '0 * * * *', 'rate-limit cleanup runs hourly');
select is(pg_temp.cron_schedule('places-refresh-quota-cleanup'), '30 3 * * *', 'refresh-quota cleanup runs daily at 03:30 UTC');

-- invoke_places_refresh does nothing, and does not fail, when the vault secrets are absent.
delete from vault.secrets where name in ('places_refresh_url', 'places_refresh_secret');
select lives_ok($$ select private.invoke_places_refresh() $$,
  'invoke_places_refresh is a quiet no-op without the vault secrets');

-- ── RLS and table privileges ────────────────────────────────────────────────
select ok((select relrowsecurity from pg_class where oid = 'public.map_rate_limits'::regclass),
  'RLS is enabled on map_rate_limits');
select ok((select relrowsecurity from pg_class where oid = 'public.places_refresh_quota'::regclass),
  'RLS is enabled on places_refresh_quota');
select table_privs_are('public', 'map_rate_limits', 'anon', array[]::text[], 'anon has no privileges on map_rate_limits');
select table_privs_are('public', 'map_rate_limits', 'authenticated', array[]::text[],
  'authenticated has no privileges on map_rate_limits');
select table_privs_are('public', 'places_refresh_quota', 'anon', array[]::text[],
  'anon has no privileges on places_refresh_quota');
select table_privs_are('public', 'places_refresh_quota', 'authenticated', array[]::text[],
  'authenticated has no privileges on places_refresh_quota');
select ok(not has_any_column_privilege('anon', 'public.map_rate_limits', 'SELECT, INSERT, UPDATE, REFERENCES'),
  'anon has no column privileges on map_rate_limits');
select ok(not has_any_column_privilege('authenticated', 'public.places_refresh_quota', 'SELECT, INSERT, UPDATE, REFERENCES'),
  'authenticated has no column privileges on places_refresh_quota');
select column_privs_are('public', 'business_locations', 'place_status', 'anon', array[]::text[],
  'anon has no privilege on business_locations.place_status');
select column_privs_are('public', 'business_locations', 'place_status', 'authenticated', array[]::text[],
  'authenticated has no privilege on business_locations.place_status');
select column_privs_are('public', 'business_locations', 'refresh_attempted_at', 'anon', array[]::text[],
  'anon has no privilege on business_locations.refresh_attempted_at');
select column_privs_are('public', 'business_locations', 'refresh_attempted_at', 'authenticated', array[]::text[],
  'authenticated has no privilege on business_locations.refresh_attempted_at');

-- ── Function privileges ─────────────────────────────────────────────────────
select ok(has_function_privilege('anon',
  'public.map_restaurants_in_bounds(double precision, double precision, double precision, double precision)', 'execute'),
  'anon can execute map_restaurants_in_bounds');
select ok(has_function_privilege('authenticated',
  'public.map_restaurants_in_bounds(double precision, double precision, double precision, double precision)', 'execute'),
  'authenticated can execute map_restaurants_in_bounds');
select ok(has_function_privilege('anon', 'public.get_restaurant_details(uuid)', 'execute'),
  'anon can execute get_restaurant_details');
select ok(has_function_privilege('authenticated', 'public.get_restaurant_details(uuid)', 'execute'),
  'authenticated can execute get_restaurant_details');
select ok(not has_function_privilege('anon', 'public.claim_places_refresh_batch(integer)', 'execute')
      and not has_function_privilege('authenticated', 'public.claim_places_refresh_batch(integer)', 'execute'),
  'anon and authenticated cannot execute claim_places_refresh_batch');
select ok(not has_function_privilege('anon',
        'public.apply_places_refresh(uuid, text, double precision, double precision)', 'execute')
      and not has_function_privilege('authenticated',
        'public.apply_places_refresh(uuid, text, double precision, double precision)', 'execute'),
  'anon and authenticated cannot execute apply_places_refresh');
select ok(has_function_privilege('service_role', 'public.claim_places_refresh_batch(integer)', 'execute')
      and has_function_privilege('service_role',
        'public.apply_places_refresh(uuid, text, double precision, double precision)', 'execute'),
  'service_role can execute claim_places_refresh_batch and apply_places_refresh');
select is_empty(
  $$ select p.oid::regprocedure::text
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'private'
        and p.proname in ('restaurant_is_fresh', 'consume_map_quota', 'caller_ip', 'cleanup_map_rate_limits',
                          'cleanup_places_refresh_quota', 'invoke_places_refresh')
        and (has_function_privilege('anon', p.oid, 'execute')
             or has_function_privilege('authenticated', p.oid, 'execute')
             or has_function_privilege('service_role', p.oid, 'execute')) $$,
  'no private map function is executable by anon, authenticated or service_role');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and p.proname in ('restaurant_is_fresh', 'consume_map_quota', 'caller_ip', 'cleanup_map_rate_limits',
                        'cleanup_places_refresh_quota', 'invoke_places_refresh')
      and p.prosecdef and p.proconfig = array['search_path=""']),
  6, 'the six private map functions are security definer with an empty search_path');
select ok(
  (select p.prosecdef and p.proconfig @> array['search_path=""', 'statement_timeout=3s']
     from pg_proc p where p.oid =
       'public.map_restaurants_in_bounds(double precision, double precision, double precision, double precision)'::regprocedure),
  'map_restaurants_in_bounds is security definer with an empty search_path and a 3 s statement_timeout');
select ok(
  (select p.prosecdef and p.proconfig @> array['search_path=""', 'statement_timeout=3s']
     from pg_proc p where p.oid = 'public.get_restaurant_details(uuid)'::regprocedure),
  'get_restaurant_details is security definer with an empty search_path and a 3 s statement_timeout');
select ok(
  (select bool_and(p.prosecdef and p.proconfig = array['search_path=""'])
     from pg_proc p where p.oid in (
       'public.claim_places_refresh_batch(integer)'::regprocedure,
       'public.apply_places_refresh(uuid, text, double precision, double precision)'::regprocedure)),
  'claim and apply are security definer with an empty search_path');

-- ── Anonymous guest: closed tables, private helpers ─────────────────────────
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
set local request.headers = '{"x-forwarded-for":"198.51.100.1"}';

select throws_ok($$ select * from public.map_rate_limits $$, '42501', null, 'anon cannot read map_rate_limits');
select throws_ok($$ select * from public.places_refresh_quota $$, '42501', null, 'anon cannot read places_refresh_quota');
select throws_ok($$ select place_status from public.business_locations $$, '42501', null,
  'anon cannot read place_status');
select throws_ok($$ select refresh_attempted_at from public.business_locations $$, '42501', null,
  'anon cannot read refresh_attempted_at');
select throws_ok($$ select resolved_at from public.business_locations $$, '42501', null,
  'anon cannot read resolved_at');
select throws_ok($$ select * from public.business_locations $$, '42501', null,
  'anon cannot read business_locations (exact address and coordinates)');
select throws_ok($$ select map_lat from public.businesses $$, '42501', null,
  'anon cannot read businesses.map_lat (the map point comes only through the map functions)');
select throws_ok($$ select map_lng from public.businesses $$, '42501', null,
  'anon cannot read businesses.map_lng');
select throws_ok($$ select public_address from public.businesses $$, '42501', null,
  'anon cannot read businesses.public_address (the Google address comes only through get_restaurant_details)');
select throws_ok($$ select map_lat, map_lng, public_address from public.businesses where id = '00000000-0000-0000-0017-000000000001' $$,
  '42501', null, 'anon cannot read the Google columns of one known restaurant either');
select lives_ok($$ select id, type, name, cuisine_code, accepts_table_requests, currency_code from public.businesses $$,
  'anon can still read the listing columns that do not come from Google');
select throws_ok($$ select private.restaurant_is_fresh('00000000-0000-0000-0017-000000000001') $$, '42501', null,
  'anon cannot call private.restaurant_is_fresh');
select throws_ok($$ select private.caller_ip() $$, '42501', null,
  'anon cannot call private.caller_ip');
select throws_ok($$ select private.consume_map_quota('pins') $$, '42501', null,
  'anon cannot call private.consume_map_quota');
select throws_ok($$ select private.cleanup_map_rate_limits() $$, '42501', null,
  'anon cannot call private.cleanup_map_rate_limits');
select throws_ok($$ select private.cleanup_places_refresh_quota() $$, '42501', null,
  'anon cannot call private.cleanup_places_refresh_quota');
select throws_ok($$ select private.invoke_places_refresh() $$, '42501', null,
  'anon cannot call private.invoke_places_refresh');
select throws_ok($$ select * from public.claim_places_refresh_batch(5) $$, '42501', null,
  'anon cannot call claim_places_refresh_batch');
select throws_ok(
  $$ select public.apply_places_refresh('00000000-0000-0000-0017-000000000001', 'not_found', null, null) $$,
  '42501', null, 'anon cannot call apply_places_refresh');

-- ── Pins: freshness, hidden causes, shape (anon, box around the fixtures) ───
select is(
  (select array_agg(p ->> 'id' order by p ->> 'id')
     from jsonb_array_elements(public.map_restaurants_in_bounds(70, 71, 100, 101) -> 'pins') p),
  array['00000000-0000-0000-0017-000000000001', '00000000-0000-0000-0017-000000000002'],
  'the box returns exactly the fresh restaurants (1 and 29 days old)');
select is(
  (select count(*)::int from jsonb_array_elements(public.map_restaurants_in_bounds(70, 71, 100, 101) -> 'pins') p
    where p ->> 'id' = '00000000-0000-0000-0017-000000000003'),
  0, 'a restaurant resolved 31 days ago is not returned');
select is(
  (select count(*)::int from jsonb_array_elements(public.map_restaurants_in_bounds(70, 71, 100, 101) -> 'pins') p
    where p ->> 'id' = '00000000-0000-0000-0017-000000000004'),
  0, 'a homemade business is never returned');
select is(
  (select count(*)::int from jsonb_array_elements(public.map_restaurants_in_bounds(70, 71, 100, 101) -> 'pins') p
    where p ->> 'id' = '00000000-0000-0000-0017-000000000005'),
  0, 'an unlisted restaurant is not returned');
select is(
  (select count(*)::int from jsonb_array_elements(public.map_restaurants_in_bounds(-90, 90, 100, 101) -> 'pins') p
    where p ->> 'id' = '00000000-0000-0000-0017-000000000006'),
  0, 'a restaurant with no saved address is not returned');
select is(
  (select count(*)::int from jsonb_array_elements(public.map_restaurants_in_bounds(70, 71, 100, 101) -> 'pins') p
    where p ->> 'id' = '00000000-0000-0000-0017-000000000007'),
  0, 'a place Google no longer knows (not_found) is not returned');
select is(
  (select array_agg(k order by k collate "C") from jsonb_object_keys(public.map_restaurants_in_bounds(70, 71, 100, 101)) k),
  array['capped', 'pins', 'too_large'], 'the pins answer has exactly capped, pins and too_large');
select is(
  (select array_agg(k order by k collate "C")
     from jsonb_object_keys((public.map_restaurants_in_bounds(70, 71, 100, 101) -> 'pins') -> 0) k),
  array['cuisine_code', 'id', 'lat', 'lng', 'name'], 'a pin has exactly id, name, cuisine_code, lat and lng');
select ok(
  position('place_id' in public.map_restaurants_in_bounds(70, 71, 100, 101)::text) = 0
  and position('Tromso' in public.map_restaurants_in_bounds(70, 71, 100, 101)::text) = 0
  and position('resolved_at' in public.map_restaurants_in_bounds(70, 71, 100, 101)::text) = 0
  and position('place_status' in public.map_restaurants_in_bounds(70, 71, 100, 101)::text) = 0,
  'pins carry no place_id, address, resolved_at or place_status');
select results_eq(
  $$ select (p ->> 'lat')::float8, (p ->> 'lng')::float8, p ->> 'name', p ->> 'cuisine_code'
       from jsonb_array_elements(public.map_restaurants_in_bounds(70, 71, 100, 101) -> 'pins') p
      where p ->> 'id' = '00000000-0000-0000-0017-000000000001' $$,
  $$ values (70.10::float8, 100.10::float8, 'Fresh One'::text, 'IT'::text) $$,
  'a pin carries the public map point, name and cuisine');
select is(
  (select jsonb_array_length(public.map_restaurants_in_bounds(70.10, 70.10, 100.10, 100.10) -> 'pins')),
  1, 'a zero-size box returns what sits exactly there');

-- ── Pins: bounds rules ──────────────────────────────────────────────────────
select throws_ok($$ select public.map_restaurants_in_bounds(null, 71, 100, 101) $$, 'P0001', 'invalid_bounds',
  'a null bound raises invalid_bounds');
select throws_ok($$ select public.map_restaurants_in_bounds(70, 71, 100, null) $$, 'P0001', 'invalid_bounds',
  'a null longitude bound raises invalid_bounds');
select throws_ok($$ select public.map_restaurants_in_bounds('NaN'::float8, 71, 100, 101) $$, 'P0001', 'invalid_bounds',
  'NaN raises invalid_bounds');
select throws_ok($$ select public.map_restaurants_in_bounds(70, 'Infinity'::float8, 100, 101) $$, 'P0001', 'invalid_bounds',
  'infinity raises invalid_bounds');
select throws_ok($$ select public.map_restaurants_in_bounds(70, 71, '-Infinity'::float8, 101) $$, 'P0001', 'invalid_bounds',
  'minus infinity raises invalid_bounds');
select throws_ok($$ select public.map_restaurants_in_bounds(71, 70, 100, 101) $$, 'P0001', 'invalid_bounds',
  'an inverted latitude range raises invalid_bounds');
select is(
  (select array_agg(p ->> 'id') from jsonb_array_elements(public.map_restaurants_in_bounds(89, 100, 0, 10) -> 'pins') p),
  array['00000000-0000-0000-0017-000000000010'],
  'latitude beyond 90 is clamped: the polar restaurant is found');
select is((public.map_restaurants_in_bounds(89, 100, 0, 10) ->> 'too_large')::boolean, false,
  'a clamped box is not too large');
select lives_ok($$ select public.map_restaurants_in_bounds(-100, -95, 0, 10) $$,
  'latitude below -90 is clamped, not an error');
select is((public.map_restaurants_in_bounds(0, 91, 0, 10) ->> 'too_large')::boolean, true,
  'a latitude span over 90 is too_large');
select is((public.map_restaurants_in_bounds(0, 90, 0, 90) ->> 'too_large')::boolean, false,
  'a span of exactly 90 in both directions is allowed');
select is((public.map_restaurants_in_bounds(0, 10, 0, 91) ->> 'too_large')::boolean, true,
  'a longitude span over 90 is too_large');
select is(public.map_restaurants_in_bounds(-90, 90, -180, 180),
  '{"pins": [], "capped": false, "too_large": true}'::jsonb, 'the whole world is too_large with no pins');
select is(public.map_restaurants_in_bounds(0, 10, 10, -10),
  '{"pins": [], "capped": false, "too_large": true}'::jsonb,
  'min_lng above max_lng wraps (span 340), so it is too_large rather than a huge crossing box');
select is(
  (select array_agg(p ->> 'name' order by p ->> 'name')
     from jsonb_array_elements(public.map_restaurants_in_bounds(60, 61, 170, -170) -> 'pins') p),
  array['East Pin', 'West Pin'], 'a box crossing the 180 line returns pins on both sides');
select is(
  (select array_agg(p ->> 'name' order by p ->> 'name')
     from jsonb_array_elements(public.map_restaurants_in_bounds(60, 61, 179, 181) -> 'pins') p),
  array['East Pin', 'West Pin'], 'a longitude past 180 is wrapped into [-180, 180)');
select is(
  (select array_agg(p ->> 'name')
     from jsonb_array_elements(public.map_restaurants_in_bounds(60, 61, 179.5, 180) -> 'pins') p),
  array['East Pin'], 'a box ending on the 180 line returns only the east side');
select is(
  (select array_agg(p ->> 'name')
     from jsonb_array_elements(public.map_restaurants_in_bounds(60, 61, -179.95, -179.85) -> 'pins') p),
  array['West Pin'], 'a plain box west of the line returns only the west side');

-- ── Pins: cap ───────────────────────────────────────────────────────────────
select is(jsonb_array_length(public.map_restaurants_in_bounds(-51, -49, -101, -99) -> 'pins'), 500,
  '501 fresh restaurants in the box: 500 pins are returned');
select is((public.map_restaurants_in_bounds(-51, -49, -101, -99) ->> 'capped')::boolean, true,
  '501 fresh restaurants in the box: capped is true');
select is(
  (select max(p ->> 'id') from jsonb_array_elements(public.map_restaurants_in_bounds(-51, -49, -101, -99) -> 'pins') p),
  '00000000-0000-0000-0017-000000001500',   -- fixtures 1001..1501: the 500 smallest ids end at 1500
  'the capped answer is the 500 smallest ids (stable)');
reset role;
delete from public.businesses where id = '00000000-0000-0000-0017-000000001501';
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
set local request.headers = '{"x-forwarded-for":"198.51.100.1"}';
select is(jsonb_array_length(public.map_restaurants_in_bounds(-51, -49, -101, -99) -> 'pins'), 500,
  'exactly 500 fresh restaurants: 500 pins are returned');
select is((public.map_restaurants_in_bounds(-51, -49, -101, -99) ->> 'capped')::boolean, false,
  'exactly 500 fresh restaurants: capped is false');

-- ── Details ─────────────────────────────────────────────────────────────────
select is(
  (select array_agg(k order by k collate "C")
     from jsonb_object_keys(public.get_restaurant_details('00000000-0000-0000-0017-000000000001')) k),
  array['accepts_table_requests', 'cuisine_code', 'currency_code', 'id', 'items', 'name', 'photos', 'place_id',
        'public_address'],
  'details has exactly the documented keys');
select results_eq(
  $$ select d ->> 'name', d ->> 'cuisine_code', d ->> 'public_address', d ->> 'place_id', d ->> 'currency_code',
            (d ->> 'accepts_table_requests')::boolean
       from (select public.get_restaurant_details('00000000-0000-0000-0017-000000000001') d) s $$,
  $$ values ('Fresh One'::text, 'IT'::text, '1 Fresh St, Tromso'::text, 'pR1'::text, 'CAD'::text, true) $$,
  'details returns the public fields, place_id and the business currency');
select is(
  (select array_agg(i ->> 'name' order by (i ->> 'position')::int)
     from jsonb_array_elements(public.get_restaurant_details('00000000-0000-0000-0017-000000000001') -> 'items') i),
  array['Bread', 'Soup'], 'items come back ordered by position');
select results_eq(
  $$ select (i ->> 'price_minor')::int, (i ->> 'is_available')::boolean
       from jsonb_array_elements(public.get_restaurant_details('00000000-0000-0000-0017-000000000001') -> 'items') i
      order by (i ->> 'position')::int $$,
  $$ values (450, true), (850, false) $$, 'items carry price and availability (a sold-out item is still listed)');
select is(
  (select array_agg(k order by k collate "C")
     from jsonb_object_keys((public.get_restaurant_details('00000000-0000-0000-0017-000000000001') -> 'items') -> 0) k),
  array['description', 'id', 'is_available', 'name', 'position', 'price_minor'], 'an item has exactly the documented keys');
select is(jsonb_array_length(public.get_restaurant_details('00000000-0000-0000-0017-000000000001') -> 'photos'), 2,
  'only ready photos are returned (the pending one is not)');
select is(
  (select array_agg(k order by k collate "C")
     from jsonb_object_keys((public.get_restaurant_details('00000000-0000-0000-0017-000000000001') -> 'photos') -> 0) k),
  array['id', 'kind', 'menu_item_id', 'path', 'position'], 'a photo has exactly the documented keys');
select ok(
  public.get_restaurant_details('00000000-0000-0000-0017-000000000001') ->> 'lat' is null
  and public.get_restaurant_details('00000000-0000-0000-0017-000000000001') ->> 'lng' is null
  and position('resolved_at' in public.get_restaurant_details('00000000-0000-0000-0017-000000000001')::text) = 0
  and position('place_status' in public.get_restaurant_details('00000000-0000-0000-0017-000000000001')::text) = 0
  and position('70.1' in public.get_restaurant_details('00000000-0000-0000-0017-000000000001')::text) = 0
  and position('map_status' in public.get_restaurant_details('00000000-0000-0000-0017-000000000001')::text) = 0,
  'details has no coordinates, resolved_at, place_status or map_status');
select is(public.get_restaurant_details('00000000-0000-0000-0017-000000000002') ->> 'name', 'Day Twenty Nine',
  'a restaurant resolved 29 days ago has details');
select is(public.get_restaurant_details('00000000-0000-0000-0017-000000000003'), null,
  'details is null for a restaurant resolved 31 days ago');
select is(public.get_restaurant_details('00000000-0000-0000-0017-000000000004'), null, 'details is null for homemade');
select is(public.get_restaurant_details('00000000-0000-0000-0017-000000000005'), null, 'details is null for unlisted');
select is(public.get_restaurant_details('00000000-0000-0000-0017-000000000006'), null,
  'details is null for a restaurant with no location');
select is(public.get_restaurant_details('00000000-0000-0000-0017-000000000007'), null,
  'details is null for a place that was not found');
select is(public.get_restaurant_details('00000000-0000-0000-0017-0000000fffff'), null, 'details is null for a random uuid');
select is(public.get_restaurant_details(null), null, 'details is null for a null id');

-- ── Signed-in outsider: same answers, same closed tables ────────────────────
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0007-000000000008","role":"authenticated"}';
set local request.headers = '{"x-forwarded-for":"198.51.100.2"}';

select throws_ok($$ select * from public.map_rate_limits $$, '42501', null, 'outsider cannot read map_rate_limits');
select throws_ok($$ select * from public.places_refresh_quota $$, '42501', null,
  'outsider cannot read places_refresh_quota');
select throws_ok($$ select place_status, refresh_attempted_at, resolved_at from public.business_locations $$, '42501', null,
  'outsider cannot read place_status, refresh_attempted_at or resolved_at');
select throws_ok($$ select * from public.claim_places_refresh_batch(5) $$, '42501', null,
  'outsider cannot call claim_places_refresh_batch');
select throws_ok(
  $$ select public.apply_places_refresh('00000000-0000-0000-0017-000000000001', 'not_found', null, null) $$,
  '42501', null, 'outsider cannot call apply_places_refresh');
select throws_ok($$ select private.consume_map_quota('pins') $$, '42501', null,
  'outsider cannot call private.consume_map_quota');
select throws_ok($$ select private.invoke_places_refresh() $$, '42501', null,
  'outsider cannot call private.invoke_places_refresh');
select is(
  (select array_agg(p ->> 'id' order by p ->> 'id')
     from jsonb_array_elements(public.map_restaurants_in_bounds(70, 71, 100, 101) -> 'pins') p),
  array['00000000-0000-0000-0017-000000000001', '00000000-0000-0000-0017-000000000002'],
  'a signed-in outsider gets the same pins');
select is(public.get_restaurant_details('00000000-0000-0000-0017-000000000003'), null,
  'a signed-in outsider gets null for a stale restaurant');
select is(public.get_my_business(), null, 'an outsider has no business, so no map_status');
select throws_ok($$ select map_lat from public.businesses $$, '42501', null,
  'a signed-in outsider cannot read businesses.map_lat');
select throws_ok($$ select map_lng from public.businesses $$, '42501', null,
  'a signed-in outsider cannot read businesses.map_lng');
select throws_ok($$ select public_address from public.businesses $$, '42501', null,
  'a signed-in outsider cannot read businesses.public_address');
select throws_ok($$ select map_lat, map_lng, public_address from public.businesses where id = '00000000-0000-0000-0017-000000000001' $$,
  '42501', null, 'a signed-in outsider cannot read the Google columns of one known restaurant either');
select lives_ok($$ select id, type, name, cuisine_code, accepts_table_requests, currency_code from public.businesses $$,
  'a signed-in outsider can still read the listing columns that do not come from Google');
select throws_ok($$ select public.business_owner_view('00000000-0000-0000-0007-000000000001') $$, '42501', null,
  'an outsider cannot call business_owner_view to read another owner''s map_status');

-- ── map_status for owners ───────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0007-000000000001","role":"authenticated"}';
select results_eq(
  $$ select (v ->> 'map_lat')::float8, (v ->> 'map_lng')::float8, v ->> 'public_address'
       from (select public.get_my_business() as v) s $$,
  $$ values (70.10::float8, 100.10::float8, '1 Fresh St, Tromso'::text) $$,
  'the owner view still returns the map point and the address');
select throws_ok($$ select map_lat from public.businesses where owner_id = '00000000-0000-0000-0007-000000000001' $$,
  '42501', null, 'even the owner reads the map point through the owner view, not the table');
select is(public.get_my_business() ->> 'map_status', 'visible', 'map_status is visible for a fresh restaurant');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0007-000000000002","role":"authenticated"}';
select is(public.get_my_business() ->> 'map_status', 'visible', 'map_status is visible at 29 days');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0007-000000000003","role":"authenticated"}';
select is(public.get_my_business() ->> 'map_status', 'needs_refresh',
  'map_status is needs_refresh once the coordinates are over 30 days old');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0007-000000000007","role":"authenticated"}';
select is(public.get_my_business() ->> 'map_status', 'place_not_found', 'map_status is place_not_found for a not_found place');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0007-000000000004","role":"authenticated"}';
select is(public.get_my_business() ->> 'map_status', 'visible', 'map_status is visible for a fresh homemade business (spec 08)');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0007-000000000006","role":"authenticated"}';
select is(jsonb_typeof(public.get_my_business() -> 'map_status'), 'null',
  'map_status is null for a restaurant that has no saved address');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0007-000000000001","role":"authenticated"}';
select ok(position('place_status' in public.get_my_business()::text) = 0
      and position('resolved_at' in public.get_my_business()::text) = 0,
  'the owner view exposes the three-word map_status only, never place_status or resolved_at');
reset role;
update public.business_locations set resolved_at = now() - interval '40 days'
 where business_id = '00000000-0000-0000-0017-000000000007';
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0007-000000000007","role":"authenticated"}';
select is(public.get_my_business() ->> 'map_status', 'place_not_found',
  'place_not_found wins over needs_refresh when both are true');
reset role;
update public.business_locations set resolved_at = now() - interval '1 day'
 where business_id = '00000000-0000-0000-0017-000000000007';

-- ── The exact 30-day boundary: hidden at 30 days, visible one second inside ─
-- now() is frozen inside the test transaction, so resolved_at can sit exactly on the line.
update public.business_locations set resolved_at = now() - interval '30 days'
 where business_id = '00000000-0000-0000-0017-000000000002';
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
set local request.headers = '{"x-forwarded-for":"198.51.100.20"}';
select is(
  (select count(*)::int from jsonb_array_elements(public.map_restaurants_in_bounds(70, 71, 100, 101) -> 'pins') p
    where p ->> 'id' = '00000000-0000-0000-0017-000000000002'),
  0, 'a restaurant resolved exactly 30 days ago is not returned');
select is(public.get_restaurant_details('00000000-0000-0000-0017-000000000002'), null,
  'details is null for a restaurant resolved exactly 30 days ago');
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0007-000000000002","role":"authenticated"}';
select is(public.get_my_business() ->> 'map_status', 'needs_refresh',
  'map_status is needs_refresh at exactly 30 days (the same line that hides the pin)');
reset role;
update public.business_locations set resolved_at = now() - interval '30 days' + interval '1 second'
 where business_id = '00000000-0000-0000-0017-000000000002';
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select is(
  (select count(*)::int from jsonb_array_elements(public.map_restaurants_in_bounds(70, 71, 100, 101) -> 'pins') p
    where p ->> 'id' = '00000000-0000-0000-0017-000000000002'),
  1, 'a restaurant resolved one second inside the 30 days is returned');
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0007-000000000002","role":"authenticated"}';
select is(public.get_my_business() ->> 'map_status', 'visible', 'and its map_status is visible');
reset role;
update public.business_locations set resolved_at = now() - interval '29 days'
 where business_id = '00000000-0000-0000-0017-000000000002';

-- ── Rate limit: guests by IP ────────────────────────────────────────────────
delete from public.map_rate_limits;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
set local request.headers = '{"x-forwarded-for":"198.51.100.10, 10.0.0.1"}';
select lives_ok($$ select count(public.map_restaurants_in_bounds(70, 71, 100, 101)) from generate_series(1, 120) $$,
  'a guest can make 120 pins calls in a minute');
select throws_ok($$ select public.map_restaurants_in_bounds(70, 71, 100, 101) $$, 'P0001', 'rate_limited',
  'the 121st pins call from the same IP raises rate_limited');
select throws_ok($$ select public.map_restaurants_in_bounds(0, 1, 0, 1) $$, 'P0001', 'rate_limited',
  'the same IP stays limited whatever the box');
set local request.headers = '{"x-forwarded-for":"198.51.100.11"}';
select lives_ok($$ select public.map_restaurants_in_bounds(70, 71, 100, 101) $$,
  'a different IP is unaffected');
reset role;
select is((select calls from public.map_rate_limits where caller_key = 'ip:198.51.100.10' and kind = 'pins'), 120,
  'only the first address of x-forwarded-for is the key, and refused calls leave the count at the limit');
select is((select calls from public.map_rate_limits where caller_key = 'guest:all' and kind = 'pins'), 121,
  'every accepted guest call counts toward guest:all (120 + 1)');

set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
set local request.headers = '{"x-forwarded-for":"198.51.100.12"}';
select lives_ok($$ select count(public.get_restaurant_details('00000000-0000-0000-0017-000000000001')) from generate_series(1, 30) $$,
  'a guest can make 30 details calls in a minute');
select throws_ok($$ select public.get_restaurant_details('00000000-0000-0000-0017-000000000001') $$, 'P0001', 'rate_limited',
  'the 31st details call from the same IP raises rate_limited');
select lives_ok($$ select public.map_restaurants_in_bounds(70, 71, 100, 101) $$,
  'details and pins are counted separately');

-- ── Rate limit: a guest with no readable IP ─────────────────────────────────
reset role;
delete from public.map_rate_limits;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
set local request.headers = '{}';
select lives_ok($$ select public.map_restaurants_in_bounds(70, 71, 100, 101) $$, 'a guest with no forwarded header is served');
set local request.headers = '{"x-forwarded-for":"not-an-address"}';
select lives_ok($$ select public.map_restaurants_in_bounds(70, 71, 100, 101) $$, 'a guest with an unparseable address is served');
set local request.headers = 'this is not json';
select lives_ok($$ select public.map_restaurants_in_bounds(70, 71, 100, 101) $$, 'a guest with a broken headers value is served');
reset role;
select is((select count(*)::int from public.map_rate_limits where caller_key like 'ip:%'), 0,
  'a guest with no readable IP creates no per-IP row');
select is((select calls from public.map_rate_limits where caller_key = 'guest:all' and kind = 'pins'), 3,
  'a guest with no readable IP is counted against the guest ceiling only');

-- ── The guest address is read in one place: private.caller_ip() ─────────────
set local request.headers = '{"x-forwarded-for":"198.51.100.5, 10.0.0.1"}';
select is(private.caller_ip(), '198.51.100.5'::inet, 'caller_ip is the first x-forwarded-for value');
set local request.headers = '{"x-forwarded-for":" 2001:db8::1 "}';
select is(private.caller_ip(), '2001:db8::1'::inet, 'caller_ip accepts an IPv6 address and trims spaces');
set local request.headers = '{}';
select is(private.caller_ip(), null, 'caller_ip is null without the header');
set local request.headers = '{"x-forwarded-for":"not-an-address"}';
select is(private.caller_ip(), null, 'caller_ip is null for a value that is not an address');
set local request.headers = 'this is not json';
select is(private.caller_ip(), null, 'caller_ip is null for a headers value that is not JSON');

-- A new minute starts a new count: last minute's calls do not count now.
insert into public.map_rate_limits (caller_key, kind, window_start, calls)
values ('ip:198.51.100.80', 'pins', date_trunc('minute', now(), 'UTC') - interval '1 minute', 120);
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
set local request.headers = '{"x-forwarded-for":"198.51.100.80"}';
select lives_ok($$ select public.map_restaurants_in_bounds(70, 71, 100, 101) $$,
  'an IP that used its 120 calls in the previous minute is served in the next one');
reset role;
select is((select calls from public.map_rate_limits
            where caller_key = 'ip:198.51.100.80' and window_start = date_trunc('minute', now(), 'UTC')), 1,
  'the new minute starts at 1');
select is((select calls from public.map_rate_limits
            where caller_key = 'ip:198.51.100.80' and window_start = date_trunc('minute', now(), 'UTC') - interval '1 minute'), 120,
  'and the previous minute''s count is left as it was');

-- ── Rate limit: global guest ceiling ────────────────────────────────────────
insert into public.map_rate_limits (caller_key, kind, window_start, calls)
values ('guest:all', 'pins', date_trunc('minute', now(), 'UTC'), 2000)
on conflict (caller_key, kind, window_start) do update set calls = 2000;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
set local request.headers = '{"x-forwarded-for":"198.51.100.99"}';
select throws_ok($$ select public.map_restaurants_in_bounds(70, 71, 100, 101) $$, 'P0001', 'rate_limited',
  'once guests together are over 2,000 pins calls, a guest on a fresh IP gets rate_limited');
set local request.headers = '{}';
select throws_ok($$ select public.map_restaurants_in_bounds(70, 71, 100, 101) $$, 'P0001', 'rate_limited',
  'a guest with no readable IP gets rate_limited too');
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0007-000000000008","role":"authenticated"}';
select lives_ok($$ select public.map_restaurants_in_bounds(70, 71, 100, 101) $$,
  'a signed-in user is unaffected by the guest ceiling');
reset role;
select is((select count(*)::int from public.map_rate_limits where caller_key = 'ip:198.51.100.99'), 0,
  'refused guest calls create no per-IP row');
select is((select calls from public.map_rate_limits where caller_key = 'guest:all' and kind = 'pins'), 2000,
  'signed-in calls do not count toward the guest ceiling');
insert into public.map_rate_limits (caller_key, kind, window_start, calls)
values ('guest:all', 'details', date_trunc('minute', now(), 'UTC'), 600);
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
set local request.headers = '{"x-forwarded-for":"198.51.100.98"}';
select throws_ok($$ select public.get_restaurant_details('00000000-0000-0000-0017-000000000001') $$, 'P0001', 'rate_limited',
  'the guest ceiling for details is 600 a minute');

-- ── Rate limit: signed-in users by user id ──────────────────────────────────
reset role;
delete from public.map_rate_limits;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0007-000000000008","role":"authenticated"}';
set local request.headers = '{"x-forwarded-for":"198.51.100.50"}';
select lives_ok($$ select count(public.map_restaurants_in_bounds(70, 71, 100, 101)) from generate_series(1, 120) $$,
  'a signed-in user can make 120 pins calls in a minute');
select throws_ok($$ select public.map_restaurants_in_bounds(70, 71, 100, 101) $$, 'P0001', 'rate_limited',
  'the 121st pins call from the same user raises rate_limited');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0007-000000000001","role":"authenticated"}';
select lives_ok($$ select public.map_restaurants_in_bounds(70, 71, 100, 101) $$,
  'another signed-in user from the same IP is unaffected');
reset role;
select is((select count(*)::int from public.map_rate_limits where caller_key like 'ip:%' or caller_key = 'guest:all'), 0,
  'signed-in calls create no IP or guest rows');

-- ── The public functions never delete rate-limit rows ───────────────────────
insert into public.map_rate_limits (caller_key, kind, window_start, calls)
values ('ip:192.0.2.1', 'pins', now() - interval '2 hours', 5);
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
set local request.headers = '{"x-forwarded-for":"198.51.100.60"}';
select lives_ok($$ select public.map_restaurants_in_bounds(70, 71, 100, 101) $$, 'a pins call runs');
select lives_ok($$ select public.get_restaurant_details('00000000-0000-0000-0017-000000000001') $$, 'a details call runs');
reset role;
select is((select count(*)::int from public.map_rate_limits where caller_key = 'ip:192.0.2.1'), 1,
  'neither public function deletes old rate-limit rows');

-- ── Cleanup ─────────────────────────────────────────────────────────────────
delete from public.map_rate_limits;
delete from public.places_refresh_quota;
insert into public.map_rate_limits (caller_key, kind, window_start, calls) values
  ('ip:192.0.2.2', 'pins', now() - interval '2 hours', 5),
  ('ip:192.0.2.3', 'pins', now() - interval '30 minutes', 5);
insert into public.places_refresh_quota (day, calls) values
  ((now() at time zone 'UTC')::date - 31, 40),
  ((now() at time zone 'UTC')::date - 10, 40);
select private.cleanup_map_rate_limits();
select is((select array_agg(caller_key order by caller_key) from public.map_rate_limits),
  array['ip:192.0.2.3'], 'hourly cleanup deletes rate-limit rows older than an hour and keeps newer ones');
select is((select count(*)::int from public.places_refresh_quota), 2,
  'hourly cleanup leaves places_refresh_quota alone');
select private.cleanup_places_refresh_quota();
select is((select array_agg(day order by day) from public.places_refresh_quota),
  array[(now() at time zone 'UTC')::date - 10], 'daily cleanup deletes quota rows older than 30 days and keeps newer ones');
select is((select count(*)::int from public.map_rate_limits), 1, 'daily cleanup leaves map_rate_limits alone');

-- ── Claim ───────────────────────────────────────────────────────────────────
-- Everything that is not a fixture counts as just tried, so local dev data cannot be claimed.
delete from public.places_refresh_quota;
update public.business_locations set refresh_attempted_at = now()
 where business_id::text not like '00000000-0000-0000-0017-%';
update public.business_locations set refresh_attempted_at = now()
 where business_id in ('00000000-0000-0000-0017-000000000002', '00000000-0000-0000-0017-000000000003');
create temp table places_before as select count(*)::int as n from public.places_rate_limits;

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
create temp table claimed1 as select * from public.claim_places_refresh_batch(100);
select is((select count(*)::int from claimed1), 25, 'a claim returns at most 25 rows');
reset role;
select is((select calls from public.places_refresh_quota where day = (now() at time zone 'UTC')::date), 25,
  'the quota is charged for the rows returned');
select is((select type from claimed1 where business_id = '00000000-0000-0000-0017-000000000009'), 'homemade',
  'homemade rows are claimed too, with their type');
select is((select count(*)::int from claimed1 where business_id::text between '00000000-0000-0000-0017-000000000107'
                                                                         and '00000000-0000-0000-0017-000000000130'), 24,
  'the oldest rows come first: the homemade row (27 days) and claim fixtures 30 down to 7');
select is((select count(*)::int from public.business_locations
            where refresh_attempted_at is not null
              and business_id in (select business_id from claimed1)), 25, 'claimed rows are stamped');
select is((select count(*)::int from public.business_locations
            where refresh_attempted_at is not null
              and business_id::text between '00000000-0000-0000-0017-000000000101' and '00000000-0000-0000-0017-000000000106'), 0,
  'rows that were not returned are not stamped');
select is((select count(*)::int from claimed1 where business_id in
            ('00000000-0000-0000-0017-000000000002', '00000000-0000-0000-0017-000000000003')), 0,
  'rows tried within the last day are skipped');
select is((select n from places_before), (select count(*)::int from public.places_rate_limits),
  'claiming uses its own quota table, not places_rate_limits');

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is((select count(*)::int from public.claim_places_refresh_batch(100)), 6,
  'the next claim returns the remaining 6 due rows');
select is((select count(*)::int from public.claim_places_refresh_batch(100)), 0, 'nothing due: the next claim returns no rows');
select is((select count(*)::int from public.claim_places_refresh_batch(0)), 0, 'a batch of 0 returns no rows');
select is((select count(*)::int from public.claim_places_refresh_batch(null)), 0, 'a null batch returns no rows');
reset role;
select is((select calls from public.places_refresh_quota where day = (now() at time zone 'UTC')::date), 31,
  'the quota counts rows actually claimed');

-- A row tried two days ago is due again; the daily quota stops the claim.
update public.business_locations set refresh_attempted_at = now() - interval '2 days'
 where business_id::text between '00000000-0000-0000-0017-000000000101' and '00000000-0000-0000-0017-000000000130';
update public.places_refresh_quota set calls = 98 where day = (now() at time zone 'UTC')::date;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is((select count(*)::int from public.claim_places_refresh_batch(25)), 2,
  'rows tried more than a day ago are due again, and only what is left of the 100 calls is claimed');
select is((select count(*)::int from public.claim_places_refresh_batch(25)), 0,
  'at 100 calls for the UTC day, nothing more is claimed even with rows due');
reset role;
select is((select calls from public.places_refresh_quota where day = (now() at time zone 'UTC')::date), 100,
  'the quota stops at 100');

-- ── Apply ───────────────────────────────────────────────────────────────────
update public.business_locations set refresh_attempted_at = now()
 where business_id in ('00000000-0000-0000-0017-000000000002', '00000000-0000-0000-0017-000000000003',
                       '00000000-0000-0000-0017-000000000009');
create temp table resolved_before as
select business_id, resolved_at from public.business_locations
 where business_id in ('00000000-0000-0000-0017-000000000003', '00000000-0000-0000-0017-000000000009');
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok(
  $$ select public.apply_places_refresh('00000000-0000-0000-0017-000000000003', 'ok', 70.1201, 100.1201) $$,
  'apply ok succeeds for a restaurant with a claim outstanding');
select lives_ok(
  $$ select public.apply_places_refresh('00000000-0000-0000-0017-000000000009', 'ok', 62.0101, 10.0101) $$,
  'apply ok succeeds for a homemade business');
reset role;
select results_eq(
  $$ select b.map_lat, b.map_lng, l.lat, l.lng, l.place_status
       from public.businesses b join public.business_locations l on l.business_id = b.id
      where b.id = '00000000-0000-0000-0017-000000000003' $$,
  $$ values (70.1201::float8, 100.1201::float8, 70.1201::float8, 100.1201::float8, 'ok'::text) $$,
  'apply ok moves a restaurant''s location and its public map point');
select ok((select l.resolved_at > r.resolved_at from public.business_locations l join resolved_before r using (business_id)
            where l.business_id = '00000000-0000-0000-0017-000000000003'),
  'apply ok moves resolved_at forward (a restaurant was 31 days old, now fresh)');
select results_eq(
  $$ select b.map_lat, b.map_lng, l.lat, l.lng
       from public.businesses b join public.business_locations l on l.business_id = b.id
      where b.id = '00000000-0000-0000-0017-000000000009' $$,
  $$ values (62.0::float8, 10.0::float8, 62.0101::float8, 10.0101::float8) $$,
  'apply ok leaves a homemade public map point exactly as it was and updates only the exact location');
select ok((select l.resolved_at > r.resolved_at from public.business_locations l join resolved_before r using (business_id)
            where l.business_id = '00000000-0000-0000-0017-000000000009'),
  'apply ok moves a homemade resolved_at forward');
select is((select count(*)::int from public.business_locations
            where business_id in ('00000000-0000-0000-0017-000000000003', '00000000-0000-0000-0017-000000000009')
              and refresh_attempted_at is not null), 0,
  'apply ok uses up the claim: refresh_attempted_at is cleared');
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
set local request.headers = '{"x-forwarded-for":"198.51.100.70"}';
select is(
  (select count(*)::int from jsonb_array_elements(public.map_restaurants_in_bounds(70, 71, 100, 101) -> 'pins') p
    where p ->> 'id' = '00000000-0000-0000-0017-000000000003'),
  1, 'the restaurant that was 31 days old appears again after apply ok');
select is(public.get_restaurant_details('00000000-0000-0000-0017-000000000003') ->> 'name', 'Day Thirty One',
  'its details are available again too');
reset role;

-- The same claim cannot be applied twice: the second result finds no claim and changes nothing.
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select public.apply_places_refresh('00000000-0000-0000-0017-000000000003', 'ok', 5, 5);
select public.apply_places_refresh('00000000-0000-0000-0017-000000000003', 'not_found', null, null);
reset role;
select results_eq(
  $$ select b.map_lat, b.map_lng, l.lat, l.lng, l.place_status
       from public.businesses b join public.business_locations l on l.business_id = b.id
      where b.id = '00000000-0000-0000-0017-000000000003' $$,
  $$ values (70.1201::float8, 100.1201::float8, 70.1201::float8, 100.1201::float8, 'ok'::text) $$,
  'a second apply for the same claim is a no-op: nothing moves and the place is not hidden');

-- A result for a row with no claim outstanding (or a missing row) changes nothing.
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok($$ select public.apply_places_refresh('00000000-0000-0000-0017-000000000001', 'ok', 1, 1) $$,
  'apply with no claim outstanding is a quiet no-op');
select lives_ok($$ select public.apply_places_refresh('00000000-0000-0000-0017-0000000fffff', 'not_found', null, null) $$,
  'apply for a missing row is a quiet no-op');
reset role;
select results_eq(
  $$ select map_lat, map_lng from public.businesses where id = '00000000-0000-0000-0017-000000000001' $$,
  $$ values (70.10::float8, 100.10::float8) $$, 'a result without a claim did not move the restaurant');

-- not_found hides the place and keeps every row.
create temp table rows_before as
select (select count(*) from public.businesses where id = '00000000-0000-0000-0017-000000000002')
     + (select count(*) from public.business_locations where business_id = '00000000-0000-0000-0017-000000000002')
     + (select count(*) from public.menu_items where business_id = '00000000-0000-0000-0017-000000000002')
     + (select count(*) from public.business_photos where business_id = '00000000-0000-0000-0017-000000000002') as n;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok($$ select public.apply_places_refresh('00000000-0000-0000-0017-000000000002', 'not_found', null, null) $$,
  'apply not_found succeeds');
select throws_ok($$ select public.apply_places_refresh('00000000-0000-0000-0017-000000000002', 'closed', null, null) $$,
  'P0001', 'invalid_outcome', 'an unknown outcome raises invalid_outcome');
select throws_ok($$ select public.apply_places_refresh('00000000-0000-0000-0017-000000000002', 'ok', null, null) $$,
  'P0001', 'invalid_coordinates', 'apply ok without coordinates raises invalid_coordinates');
reset role;
select is((select place_status from public.business_locations where business_id = '00000000-0000-0000-0017-000000000002'),
  'not_found', 'apply not_found sets place_status');
select is((select refresh_attempted_at from public.business_locations where business_id = '00000000-0000-0000-0017-000000000002'),
  null, 'apply not_found uses up the claim: refresh_attempted_at is cleared');
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select public.apply_places_refresh('00000000-0000-0000-0017-000000000002', 'ok', 1, 1);
reset role;
select results_eq(
  $$ select l.place_status, l.lat, b.map_lat from public.business_locations l join public.businesses b on b.id = l.business_id
      where l.business_id = '00000000-0000-0000-0017-000000000002' $$,
  $$ values ('not_found'::text, 70.11::float8, 70.11::float8) $$,
  'a second apply after not_found is a no-op: the place stays hidden and does not move');
select is(
  (select (select count(*) from public.businesses where id = '00000000-0000-0000-0017-000000000002')
        + (select count(*) from public.business_locations where business_id = '00000000-0000-0000-0017-000000000002')
        + (select count(*) from public.menu_items where business_id = '00000000-0000-0000-0017-000000000002')
        + (select count(*) from public.business_photos where business_id = '00000000-0000-0000-0017-000000000002')),
  (select n from rows_before), 'not_found deletes nothing: business, location, menu and photo rows all remain');
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
set local request.headers = '{"x-forwarded-for":"198.51.100.71"}';
select is(
  (select count(*)::int from jsonb_array_elements(public.map_restaurants_in_bounds(70, 71, 100, 101) -> 'pins') p
    where p ->> 'id' = '00000000-0000-0000-0017-000000000002'),
  0, 'a not_found place leaves the pins');
select is(public.get_restaurant_details('00000000-0000-0000-0017-000000000002'), null,
  'a not_found place has no details');
reset role;

-- ── Saving a new address brings a hidden place back ─────────────────────────
update public.business_locations set refresh_attempted_at = now()
 where business_id = '00000000-0000-0000-0017-000000000007';
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok(
  $$ select public.set_business_location('00000000-0000-0000-0007-000000000007', 'pNF2', '8 New St, Tromso', 70.16, 100.16) $$,
  'the owner of a not_found place saves a new address');
reset role;
select results_eq(
  $$ select place_status, refresh_attempted_at is null from public.business_locations
      where business_id = '00000000-0000-0000-0017-000000000007' $$,
  $$ values ('ok'::text, true) $$, 'a new address resets place_status to ok and clears the outstanding claim');
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
set local request.headers = '{"x-forwarded-for":"198.51.100.72"}';
select is(
  (select count(*)::int from jsonb_array_elements(public.map_restaurants_in_bounds(70, 71, 100, 101) -> 'pins') p
    where p ->> 'id' = '00000000-0000-0000-0017-000000000007'),
  1, 'the place is back on the map');
reset role;
-- The same reset for a homemade owner.
update public.business_locations set place_status = 'not_found', refresh_attempted_at = now()
 where business_id = '00000000-0000-0000-0017-000000000009';
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok(
  $$ select public.set_business_location('00000000-0000-0000-0007-000000000009', 'pHD2', '9 New Due St, Oslo', 62.5, 10.5) $$,
  'a homemade owner saves a new address');
reset role;
select results_eq(
  $$ select place_status, refresh_attempted_at is null from public.business_locations
      where business_id = '00000000-0000-0000-0017-000000000009' $$,
  $$ values ('ok'::text, true) $$, 'for homemade too, a new address resets place_status and clears the claim');
-- A refresh claimed for the old address can no longer overwrite the new one.
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok($$ select public.apply_places_refresh('00000000-0000-0000-0017-000000000007', 'ok', 1, 1) $$,
  'a late result for the old address is accepted quietly');
reset role;
select results_eq(
  $$ select map_lat, map_lng from public.businesses where id = '00000000-0000-0000-0017-000000000007' $$,
  $$ values (70.16::float8, 100.16::float8) $$, 'and it does not overwrite the new address');

select * from finish();
rollback;
