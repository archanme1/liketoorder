-- Spec 08 (PR 1): homemade map backend — freshness guard, bounding-box pins, details, own rate-limit
-- counters, owner map_status for homemade, photo visibility, and that the box rules match restaurants.
begin;
select plan(136);

-- ── Helpers (pg_temp) ───────────────────────────────────────────────────────
-- A pins answer with ids removed, so a homemade answer and a restaurant answer for mirrored
-- fixtures can be compared. Errors come back as text, so both functions can be compared on them too.
create function pg_temp.shape(j jsonb) returns jsonb language sql as $$
  select jsonb_build_object(
           'too_large', j -> 'too_large',
           'capped', j -> 'capped',
           'pins', (select coalesce(jsonb_agg(jsonb_build_object('name', p ->> 'name', 'lat', p -> 'lat', 'lng', p -> 'lng')
                                              order by p ->> 'name'), '[]'::jsonb)
                      from jsonb_array_elements(j -> 'pins') p));
$$;
create function pg_temp.run(p_homemade boolean, a float8, b float8, c float8, d float8) returns text
language plpgsql as $$
declare j jsonb;
begin
  if p_homemade then j := public.map_homemade_in_bounds(a, b, c, d);
  else j := public.map_restaurants_in_bounds(a, b, c, d);
  end if;
  return pg_temp.shape(j)::text;
exception when others then
  return 'ERR:' || sqlerrm;
end $$;

-- ── Fixtures (as postgres) ──────────────────────────────────────────────────
-- Users: 00000000-0000-0000-0008-<n>   Homemade: 00000000-0000-0000-0018-<n>   Restaurants: …-0019-<n>
--  1 H1  homemade, real set_business_location path, resolved 1 day ago, exact (71.123456, 101.654321)
--  2 H29 homemade, resolved 29 days ago (71.13, 101.60)      3 H31 homemade, 31 days ago (71.14, 101.61)
--  4 UL  homemade, unlisted (71.15, 101.62)                  5 NF  homemade, place_status not_found (71.16, 101.63)
--  6 NM  homemade, no map point, fresh ok location row       7 R1  restaurant, fresh (71.17, 101.64)
--  8 outsider, no business                                   9 user for the equivalence runs
-- 13 NL  homemade, no map point and no location row (the owner whose map_status is null)
-- 10 P / 11 E / 12 W: homemade at the pole and either side of the date line; 0019-10/11/12 are restaurant twins
--    at the same points with the same names. 1001..1501: 501 homemade cap fixtures; 0019-1001..1501: restaurant twins.
insert into auth.users (id, email)
select ('00000000-0000-0000-0008-' || lpad(n::text, 12, '0'))::uuid, 'h' || n || '@example.test'
  from (select generate_series(1, 13) union all select generate_series(20, 22)
        union all select generate_series(1001, 1501) union all select generate_series(2001, 2501)) g(n);

insert into public.businesses (id, owner_id, type, name, cuisine_code, map_lat, map_lng, public_address, is_listed, currency_code) values
  ('00000000-0000-0000-0018-000000000001', '00000000-0000-0000-0008-000000000001', 'homemade', 'Home One', 'IT',
   null, null, null, true, 'CAD'),
  ('00000000-0000-0000-0018-000000000002', '00000000-0000-0000-0008-000000000002', 'homemade', 'Home Twenty Nine', 'IT',
   71.13, 101.60, null, true, null),
  ('00000000-0000-0000-0018-000000000003', '00000000-0000-0000-0008-000000000003', 'homemade', 'Home Thirty One', 'IT',
   71.14, 101.61, null, true, null),
  ('00000000-0000-0000-0018-000000000004', '00000000-0000-0000-0008-000000000004', 'homemade', 'Unlisted Kitchen', 'IT',
   71.15, 101.62, null, false, null),
  ('00000000-0000-0000-0018-000000000005', '00000000-0000-0000-0008-000000000005', 'homemade', 'Gone Kitchen', 'IT',
   71.16, 101.63, null, true, null),
  ('00000000-0000-0000-0018-000000000006', '00000000-0000-0000-0008-000000000006', 'homemade', 'No Address Kitchen', 'IT',
   null, null, null, true, null),
  ('00000000-0000-0000-0018-000000000007', '00000000-0000-0000-0008-000000000007', 'restaurant', 'Fresh Restaurant', 'IT',
   71.17, 101.64, '7 Resto St, Tromso', true, 'CAD'),
  ('00000000-0000-0000-0018-000000000013', '00000000-0000-0000-0008-000000000013', 'homemade', 'No Location Kitchen', 'IT',
   null, null, null, true, null),
  ('00000000-0000-0000-0018-000000000010', '00000000-0000-0000-0008-000000000010', 'homemade', 'Polar Pin', 'IT',
   89.5, 5.0, null, true, null),
  ('00000000-0000-0000-0018-000000000011', '00000000-0000-0000-0008-000000000011', 'homemade', 'East Pin', 'IT',
   60.1, 179.9, null, true, null),
  ('00000000-0000-0000-0018-000000000012', '00000000-0000-0000-0008-000000000012', 'homemade', 'West Pin', 'IT',
   60.2, -179.9, null, true, null),
  ('00000000-0000-0000-0019-000000000010', '00000000-0000-0000-0008-000000000020', 'restaurant', 'Polar Pin', 'IT',
   89.5, 5.0, '1 Pole Rd', true, null),
  ('00000000-0000-0000-0019-000000000011', '00000000-0000-0000-0008-000000000021', 'restaurant', 'East Pin', 'IT',
   60.1, 179.9, '1 East Rd', true, null),
  ('00000000-0000-0000-0019-000000000012', '00000000-0000-0000-0008-000000000022', 'restaurant', 'West Pin', 'IT',
   60.2, -179.9, '1 West Rd', true, null);

insert into public.business_locations (business_id, place_id, formatted_address, lat, lng, resolved_at, place_status) values
  ('00000000-0000-0000-0018-000000000002', 'pH29', '29 Secret Rd, Tromso', 71.1301, 101.6001, now() - interval '29 days', 'ok'),
  ('00000000-0000-0000-0018-000000000003', 'pH31', '31 Secret Rd, Tromso', 71.1401, 101.6101, now() - interval '31 days', 'ok'),
  ('00000000-0000-0000-0018-000000000004', 'pUL',  '4 Secret Rd, Tromso',  71.1501, 101.6201, now() - interval '1 day',   'ok'),
  ('00000000-0000-0000-0018-000000000005', 'pNF',  '5 Secret Rd, Tromso',  71.1601, 101.6301, now() - interval '1 day',   'not_found'),
  ('00000000-0000-0000-0018-000000000006', 'pNM',  '6 Secret Rd, Tromso',  71.1701, 101.6401, now() - interval '1 day',   'ok'),
  ('00000000-0000-0000-0018-000000000007', 'pR1',  '7 Resto St, Tromso',   71.17, 101.64,     now() - interval '1 day',   'ok'),
  ('00000000-0000-0000-0018-000000000010', 'pP',   '1 Secret Rd, Oslo',    89.5001, 5.0001,   now(), 'ok'),
  ('00000000-0000-0000-0018-000000000011', 'pE',   '1 Secret Rd, East',    60.1001, 179.9001, now(), 'ok'),
  ('00000000-0000-0000-0018-000000000012', 'pW',   '1 Secret Rd, West',    60.2001, -179.9001, now(), 'ok'),
  ('00000000-0000-0000-0019-000000000010', 'pRP',  '1 Pole Rd',            89.5, 5.0, now(), 'ok'),
  ('00000000-0000-0000-0019-000000000011', 'pRE',  '1 East Rd',            60.1, 179.9, now(), 'ok'),
  ('00000000-0000-0000-0019-000000000012', 'pRW',  '1 West Rd',            60.2, -179.9, now(), 'ok');

-- Cap fixtures: 501 fresh homemade and 501 fresh restaurants in one small box (lat -50..-49.7, lng -100..-99.7).
insert into public.businesses (id, owner_id, type, name, cuisine_code, map_lat, map_lng, public_address)
select ('00000000-0000-0000-0018-' || lpad((1000 + i)::text, 12, '0'))::uuid,
       ('00000000-0000-0000-0008-' || lpad((1000 + i)::text, 12, '0'))::uuid,
       'homemade', 'Cap ' || lpad(i::text, 4, '0'), 'IT', -50 + i * 0.0005, -100 + i * 0.0005, null
  from generate_series(1, 501) i;
insert into public.business_locations (business_id, place_id, formatted_address, lat, lng)
select ('00000000-0000-0000-0018-' || lpad((1000 + i)::text, 12, '0'))::uuid,
       'pHK' || i, 'Cap St ' || i, -50 + i * 0.0005, -100 + i * 0.0005
  from generate_series(1, 501) i;
insert into public.businesses (id, owner_id, type, name, cuisine_code, map_lat, map_lng, public_address)
select ('00000000-0000-0000-0019-' || lpad((1000 + i)::text, 12, '0'))::uuid,
       ('00000000-0000-0000-0008-' || lpad((2000 + i)::text, 12, '0'))::uuid,
       'restaurant', 'Cap ' || lpad(i::text, 4, '0'), 'IT', -50 + i * 0.0005, -100 + i * 0.0005, 'Cap St ' || i
  from generate_series(1, 501) i;
insert into public.business_locations (business_id, place_id, formatted_address, lat, lng)
select ('00000000-0000-0000-0019-' || lpad((1000 + i)::text, 12, '0'))::uuid,
       'pRK' || i, 'Cap St ' || i, -50 + i * 0.0005, -100 + i * 0.0005
  from generate_series(1, 501) i;

-- H1 goes through the real path, so the 200-500 m shift is real. Then it is 1 day old.
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select public.set_business_location('00000000-0000-0000-0008-000000000001', 'pH1', '1 Secret Rd, Tromso', 71.123456, 101.654321);
reset role;
update public.business_locations set resolved_at = now() - interval '1 day'
 where business_id = '00000000-0000-0000-0018-000000000001';

insert into public.menu_items (id, business_id, name, description, price_minor, is_available, position) values
  ('00000000-0000-0000-0028-000000000002', '00000000-0000-0000-0018-000000000001', 'Soup', 'Hot', 850, false, 2),
  ('00000000-0000-0000-0028-000000000001', '00000000-0000-0000-0018-000000000001', 'Bread', null, 450, true, 1),
  ('00000000-0000-0000-0028-000000000003', '00000000-0000-0000-0018-000000000002', 'Rice', null, null, true, 1);
insert into public.business_photos (id, business_id, kind, status, position, path) values
  ('00000000-0000-0000-0038-000000000001', '00000000-0000-0000-0018-000000000001', 'cover', 'ready', null,
   '00000000-0000-0000-0018-000000000001/00000000-0000-0000-0038-000000000001.jpg'),
  ('00000000-0000-0000-0038-000000000002', '00000000-0000-0000-0018-000000000001', 'gallery', 'ready', 1,
   '00000000-0000-0000-0018-000000000001/00000000-0000-0000-0038-000000000002.jpg'),
  ('00000000-0000-0000-0038-000000000003', '00000000-0000-0000-0018-000000000001', 'gallery', 'pending', 2,
   '00000000-0000-0000-0018-000000000001/00000000-0000-0000-0038-000000000003.jpg'),
  ('00000000-0000-0000-0038-000000000004', '00000000-0000-0000-0018-000000000002', 'cover', 'ready', null,
   '00000000-0000-0000-0018-000000000002/00000000-0000-0000-0038-000000000004.jpg'),
  ('00000000-0000-0000-0038-000000000005', '00000000-0000-0000-0018-000000000004', 'cover', 'ready', null,
   '00000000-0000-0000-0018-000000000004/00000000-0000-0000-0038-000000000005.jpg'),
  ('00000000-0000-0000-0038-000000000006', '00000000-0000-0000-0018-000000000003', 'cover', 'ready', null,
   '00000000-0000-0000-0018-000000000003/00000000-0000-0000-0038-000000000006.jpg');
insert into storage.objects (bucket_id, name, metadata)
select 'business-media', business_id::text || '/' || id::text || '.jpg', '{"mimetype":"image/jpeg","size":1000}'::jsonb
  from public.business_photos
 where id between '00000000-0000-0000-0038-000000000001' and '00000000-0000-0000-0038-000000000006';

delete from public.map_rate_limits;    -- dev data must not count toward the limits below

-- ── Function privileges ─────────────────────────────────────────────────────
select ok(has_function_privilege('anon',
  'public.map_homemade_in_bounds(double precision, double precision, double precision, double precision)', 'execute'),
  'anon can execute map_homemade_in_bounds');
select ok(has_function_privilege('authenticated',
  'public.map_homemade_in_bounds(double precision, double precision, double precision, double precision)', 'execute'),
  'authenticated can execute map_homemade_in_bounds');
select ok(has_function_privilege('anon', 'public.get_homemade_details(uuid)', 'execute'),
  'anon can execute get_homemade_details');
select ok(has_function_privilege('authenticated', 'public.get_homemade_details(uuid)', 'execute'),
  'authenticated can execute get_homemade_details');
select ok(not has_function_privilege('anon', 'private.homemade_is_fresh(uuid)', 'execute')
      and not has_function_privilege('authenticated', 'private.homemade_is_fresh(uuid)', 'execute')
      and not has_function_privilege('service_role', 'private.homemade_is_fresh(uuid)', 'execute'),
  'private.homemade_is_fresh is executable by none of anon, authenticated, service_role');
select ok(
  (select p.prosecdef and p.proconfig @> array['search_path=""', 'statement_timeout=3s']
     from pg_proc p where p.oid =
       'public.map_homemade_in_bounds(double precision, double precision, double precision, double precision)'::regprocedure),
  'map_homemade_in_bounds is security definer with an empty search_path and a 3 s statement_timeout');
select ok(
  (select p.prosecdef and p.proconfig @> array['search_path=""', 'statement_timeout=3s']
     from pg_proc p where p.oid = 'public.get_homemade_details(uuid)'::regprocedure),
  'get_homemade_details is security definer with an empty search_path and a 3 s statement_timeout');
select ok(
  (select p.prosecdef and p.proconfig = array['search_path=""']
     from pg_proc p where p.oid = 'private.homemade_is_fresh(uuid)'::regprocedure),
  'private.homemade_is_fresh is security definer with an empty search_path');
select ok(exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'businesses_homemade_map_idx'),
  'the homemade bounding-box index exists');

-- ── Rate-limit kinds (check constraint) ─────────────────────────────────────
select is((select count(*)::int from pg_constraint
            where conrelid = 'public.map_rate_limits'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%kind%'),
  1, 'map_rate_limits has exactly one check constraint on kind');
select lives_ok(
  $$ insert into public.map_rate_limits (caller_key, kind, window_start, calls)
     values ('t:1', 'pins', now(), 1), ('t:1', 'details', now(), 1),
            ('t:1', 'homemade_pins', now(), 1), ('t:1', 'homemade_details', now(), 1) $$,
  'the four kinds are accepted');
select throws_ok($$ insert into public.map_rate_limits (caller_key, kind, window_start, calls) values ('t:2', 'bogus', now(), 1) $$,
  '23514', null, 'any other kind is refused by the check constraint');
select throws_ok($$ select private.consume_map_quota('bogus') $$, 'P0001', 'invalid_kind',
  'an unknown kind still raises invalid_kind');
delete from public.map_rate_limits;

-- ── Anonymous guest: closed tables and private helpers ──────────────────────
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
set local request.headers = '{"x-forwarded-for":"198.51.100.1"}';

select throws_ok($$ select * from public.business_locations $$, '42501', null,
  'anon cannot read business_locations (exact address and coordinates)');
select throws_ok($$ select lat, lng from public.business_locations $$, '42501', null, 'anon cannot read the exact coordinates');
select throws_ok($$ select place_id from public.business_locations $$, '42501', null, 'anon cannot read place_id');
select throws_ok($$ select resolved_at from public.business_locations $$, '42501', null, 'anon cannot read resolved_at');
select throws_ok($$ select place_status from public.business_locations $$, '42501', null, 'anon cannot read place_status');
select throws_ok($$ select map_lat from public.businesses $$, '42501', null, 'anon cannot read businesses.map_lat');
select throws_ok($$ select map_lng from public.businesses $$, '42501', null, 'anon cannot read businesses.map_lng');
select throws_ok($$ select public_address from public.businesses $$, '42501', null, 'anon cannot read businesses.public_address');
select throws_ok($$ select * from public.map_rate_limits $$, '42501', null, 'anon cannot read map_rate_limits');
select throws_ok($$ select private.homemade_is_fresh('00000000-0000-0000-0018-000000000001') $$, '42501', null,
  'anon cannot call private.homemade_is_fresh');

-- ── Pins: freshness, hidden causes, shape ───────────────────────────────────
select is(
  (select array_agg(p ->> 'id' order by p ->> 'id')
     from jsonb_array_elements(public.map_homemade_in_bounds(71, 71.3, 101.5, 101.8) -> 'pins') p),
  array['00000000-0000-0000-0018-000000000001', '00000000-0000-0000-0018-000000000002'],
  'the box returns exactly the fresh homemade cooks (1 and 29 days old)');
select is(
  (select count(*)::int from jsonb_array_elements(public.map_homemade_in_bounds(71, 71.3, 101.5, 101.8) -> 'pins') p
    where p ->> 'id' = '00000000-0000-0000-0018-000000000003'),
  0, 'a cook resolved 31 days ago is not returned');
select is(
  (select count(*)::int from jsonb_array_elements(public.map_homemade_in_bounds(71, 71.3, 101.5, 101.8) -> 'pins') p
    where p ->> 'id' = '00000000-0000-0000-0018-000000000004'),
  0, 'an unlisted cook is not returned');
select is(
  (select count(*)::int from jsonb_array_elements(public.map_homemade_in_bounds(71, 71.3, 101.5, 101.8) -> 'pins') p
    where p ->> 'id' = '00000000-0000-0000-0018-000000000005'),
  0, 'a place Google no longer knows (not_found) is not returned');
select is(
  (select count(*)::int from jsonb_array_elements(public.map_homemade_in_bounds(-90, 90, -45, 45) -> 'pins') p
    where p ->> 'id' = '00000000-0000-0000-0018-000000000006'),
  0, 'a cook with no map point is not returned');
select is(
  (select count(*)::int from jsonb_array_elements(public.map_homemade_in_bounds(71, 71.3, 101.5, 101.8) -> 'pins') p
    where p ->> 'id' = '00000000-0000-0000-0018-000000000007'),
  0, 'a restaurant is never returned by the homemade pins');
select is(
  (select array_agg(k order by k collate "C") from jsonb_object_keys(public.map_homemade_in_bounds(71, 71.3, 101.5, 101.8)) k),
  array['capped', 'pins', 'too_large'], 'the pins answer has exactly capped, pins and too_large');
select is(
  (select array_agg(k order by k collate "C")
     from jsonb_object_keys((public.map_homemade_in_bounds(71, 71.3, 101.5, 101.8) -> 'pins') -> 0) k),
  array['cuisine_code', 'id', 'lat', 'lng', 'name'], 'a pin has exactly id, name, cuisine_code, lat and lng');
select ok(
  (select position('place_id' in t) = 0 and position('Secret' in t) = 0 and position('resolved_at' in t) = 0
      and position('place_status' in t) = 0 and position('71.123456' in t) = 0 and position('101.654321' in t) = 0
     from (select public.map_homemade_in_bounds(71, 71.3, 101.5, 101.8)::text t) s),
  'pins carry no place_id, address, resolved_at, place_status or exact coordinate');
select is(
  (select array_agg(p ->> 'id') from jsonb_array_elements(public.map_restaurants_in_bounds(71, 71.3, 101.5, 101.8) -> 'pins') p),
  array['00000000-0000-0000-0018-000000000007'],
  'the restaurant pins in the same box hold the restaurant only: no homemade cook (unchanged spec 07 behaviour)');

-- ── Pins: bounds rules ──────────────────────────────────────────────────────
select throws_ok($$ select public.map_homemade_in_bounds(null, 71, 100, 101) $$, 'P0001', 'invalid_bounds',
  'a null bound raises invalid_bounds');
select throws_ok($$ select public.map_homemade_in_bounds(70, 71, 100, null) $$, 'P0001', 'invalid_bounds',
  'a null longitude bound raises invalid_bounds');
select throws_ok($$ select public.map_homemade_in_bounds('NaN'::float8, 71, 100, 101) $$, 'P0001', 'invalid_bounds',
  'NaN raises invalid_bounds');
select throws_ok($$ select public.map_homemade_in_bounds(70, 'Infinity'::float8, 100, 101) $$, 'P0001', 'invalid_bounds',
  'infinity raises invalid_bounds');
select throws_ok($$ select public.map_homemade_in_bounds(71, 70, 100, 101) $$, 'P0001', 'invalid_bounds',
  'an inverted latitude range raises invalid_bounds');
select is(
  (select array_agg(p ->> 'name') from jsonb_array_elements(public.map_homemade_in_bounds(89, 100, 0, 10) -> 'pins') p),
  array['Polar Pin'], 'latitude beyond 90 is clamped: the polar cook is found, and the polar restaurant is not');
select lives_ok($$ select public.map_homemade_in_bounds(-100, -95, 0, 10) $$, 'latitude below -90 is clamped, not an error');
select is((public.map_homemade_in_bounds(0, 91, 0, 10) ->> 'too_large')::boolean, true, 'a latitude span over 90 is too_large');
select is((public.map_homemade_in_bounds(0, 90, 0, 90) ->> 'too_large')::boolean, false, 'a span of exactly 90 is allowed');
select is(public.map_homemade_in_bounds(-90, 90, -180, 180), '{"pins": [], "capped": false, "too_large": true}'::jsonb,
  'the whole world is too_large with no pins');
select is(
  (select array_agg(p ->> 'name' order by p ->> 'name')
     from jsonb_array_elements(public.map_homemade_in_bounds(60, 61, 170, -170) -> 'pins') p),
  array['East Pin', 'West Pin'], 'a box crossing the 180 line returns the homemade cooks on both sides, once each');
select is(
  (select array_agg(p ->> 'name') from jsonb_array_elements(public.map_homemade_in_bounds(60, 61, 179.5, 180) -> 'pins') p),
  array['East Pin'], 'a box ending on the 180 line returns only the east side');

-- ── Pins: cap ───────────────────────────────────────────────────────────────
select is(jsonb_array_length(public.map_homemade_in_bounds(-51, -49, -101, -99) -> 'pins'), 500,
  '501 fresh homemade cooks in the box: 500 pins (the 501 restaurants in the same box do not count)');
select is((public.map_homemade_in_bounds(-51, -49, -101, -99) ->> 'capped')::boolean, true, '501 fresh cooks: capped is true');
select is(
  (select max(p ->> 'id') from jsonb_array_elements(public.map_homemade_in_bounds(-51, -49, -101, -99) -> 'pins') p),
  '00000000-0000-0000-0018-000000001500', 'the capped answer is the 500 smallest ids (stable)');
reset role;
delete from public.businesses where id = '00000000-0000-0000-0018-000000001501';
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
set local request.headers = '{"x-forwarded-for":"198.51.100.1"}';
select is(jsonb_array_length(public.map_homemade_in_bounds(-51, -49, -101, -99) -> 'pins'), 500,
  'exactly 500 fresh cooks: 500 pins are returned');
select is((public.map_homemade_in_bounds(-51, -49, -101, -99) ->> 'capped')::boolean, false, 'exactly 500 fresh cooks: capped is false');

-- ── Details ─────────────────────────────────────────────────────────────────
set local request.headers = '{"x-forwarded-for":"198.51.100.2"}';
select is(
  (select array_agg(k order by k collate "C")
     from jsonb_object_keys(public.get_homemade_details('00000000-0000-0000-0018-000000000001')) k),
  array['cuisine_code', 'currency_code', 'id', 'items', 'name', 'photos'],
  'homemade details has exactly id, name, cuisine_code, currency_code, photos and items');
select results_eq(
  $$ select d ->> 'name', d ->> 'cuisine_code', d ->> 'currency_code'
       from (select public.get_homemade_details('00000000-0000-0000-0018-000000000001') d) s $$,
  $$ values ('Home One'::text, 'IT'::text, 'CAD'::text) $$, 'details returns the name, cuisine and currency');
select is(
  (select array_agg(i ->> 'name' order by (i ->> 'position')::int)
     from jsonb_array_elements(public.get_homemade_details('00000000-0000-0000-0018-000000000001') -> 'items') i),
  array['Bread', 'Soup'], 'items come back ordered by position');
select results_eq(
  $$ select (i ->> 'price_minor')::int, (i ->> 'is_available')::boolean
       from jsonb_array_elements(public.get_homemade_details('00000000-0000-0000-0018-000000000001') -> 'items') i
      order by (i ->> 'position')::int $$,
  $$ values (450, true), (850, false) $$, 'items carry price and availability (a sold-out item is still listed)');
select is(
  (select array_agg(k order by k collate "C")
     from jsonb_object_keys((public.get_homemade_details('00000000-0000-0000-0018-000000000001') -> 'items') -> 0) k),
  array['description', 'id', 'is_available', 'name', 'position', 'price_minor'], 'an item has exactly the documented keys');
select is(jsonb_array_length(public.get_homemade_details('00000000-0000-0000-0018-000000000001') -> 'photos'), 2,
  'only ready photos are returned (the pending one is not)');
select is(
  (select array_agg(k order by k collate "C")
     from jsonb_object_keys((public.get_homemade_details('00000000-0000-0000-0018-000000000001') -> 'photos') -> 0) k),
  array['id', 'kind', 'menu_item_id', 'path', 'position'], 'a photo has exactly the documented keys');
select ok(
  (select position('place_id' in t) = 0 and position('Secret' in t) = 0 and position('resolved_at' in t) = 0
      and position('place_status' in t) = 0 and position('accepts_table_requests' in t) = 0
      and position('public_address' in t) = 0 and position('map_status' in t) = 0
      and position('71.123456' in t) = 0 and position('101.654321' in t) = 0
      and d -> 'lat' is null and d -> 'lng' is null
     from (select public.get_homemade_details('00000000-0000-0000-0018-000000000001') d,
                  public.get_homemade_details('00000000-0000-0000-0018-000000000001')::text t) s),
  'details has no place_id, address, coordinates, resolved_at, place_status or table-request flag');
select is(public.get_homemade_details('00000000-0000-0000-0018-000000000002') ->> 'name', 'Home Twenty Nine',
  'a cook resolved 29 days ago has details');

set local request.headers = '{"x-forwarded-for":"198.51.100.3"}';
select is(public.get_homemade_details('00000000-0000-0000-0018-000000000003'), null, 'details is null for a cook resolved 31 days ago');
select is(public.get_homemade_details('00000000-0000-0000-0018-000000000004'), null, 'details is null for an unlisted cook');
select is(public.get_homemade_details('00000000-0000-0000-0018-000000000005'), null, 'details is null for a place that was not found');
select is(public.get_homemade_details('00000000-0000-0000-0018-000000000006'), null, 'details is null for a cook with no map point');
select is(public.get_homemade_details('00000000-0000-0000-0018-000000000007'), null, 'details is null for a restaurant id');
select is(public.get_homemade_details('00000000-0000-0000-0018-0000000fffff'), null, 'details is null for a random uuid');
select is(public.get_homemade_details(null), null, 'details is null for a null id');
select is(
  (select count(distinct coalesce(public.get_homemade_details(x)::text, '<null>'))::int
     from unnest(array['00000000-0000-0000-0018-000000000003', '00000000-0000-0000-0018-000000000004',
                       '00000000-0000-0000-0018-000000000005', '00000000-0000-0000-0018-000000000006',
                       '00000000-0000-0000-0018-000000000007', '00000000-0000-0000-0018-0000000fffff']::uuid[]) x),
  1, 'every cause of "not shown" gives the same answer');
select is(public.get_restaurant_details('00000000-0000-0000-0018-000000000001'), null,
  'get_restaurant_details is null for a homemade id (unchanged spec 07 behaviour)');

-- ── Signed-in outsider: same answers, same closed tables ────────────────────
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0008-000000000008","role":"authenticated"}';
set local request.headers = '{"x-forwarded-for":"198.51.100.4"}';

select throws_ok($$ select * from public.business_locations $$, '42501', null, 'outsider cannot read business_locations');
select throws_ok($$ select place_id, lat, lng, resolved_at, place_status from public.business_locations $$, '42501', null,
  'outsider cannot read place_id, the exact coordinates, resolved_at or place_status');
select throws_ok($$ select map_lat from public.businesses $$, '42501', null, 'outsider cannot read businesses.map_lat');
select throws_ok($$ select map_lng from public.businesses $$, '42501', null, 'outsider cannot read businesses.map_lng');
select throws_ok($$ select public_address from public.businesses $$, '42501', null, 'outsider cannot read businesses.public_address');
select throws_ok($$ select * from public.map_rate_limits $$, '42501', null, 'outsider cannot read map_rate_limits');
select throws_ok($$ select private.homemade_is_fresh('00000000-0000-0000-0018-000000000001') $$, '42501', null,
  'outsider cannot call private.homemade_is_fresh');
select throws_ok($$ select public.business_owner_view('00000000-0000-0000-0008-000000000001') $$, '42501', null,
  'outsider cannot call business_owner_view to read a cook''s map_status');
select is(
  (select array_agg(p ->> 'id' order by p ->> 'id')
     from jsonb_array_elements(public.map_homemade_in_bounds(71, 71.3, 101.5, 101.8) -> 'pins') p),
  array['00000000-0000-0000-0018-000000000001', '00000000-0000-0000-0018-000000000002'],
  'a signed-in outsider gets the same pins');
select is(public.get_homemade_details('00000000-0000-0000-0018-000000000003'), null,
  'a signed-in outsider gets null for a stale cook');
select is(public.get_my_business(), null, 'an outsider has no business, so no map_status');

-- ── The pin is the shifted point, never the exact one ───────────────────────
reset role;
select results_eq(
  $$ select abs((p ->> 'lat')::float8 - b.map_lat) < 1e-9 and abs((p ->> 'lng')::float8 - b.map_lng) < 1e-9
       from jsonb_array_elements(public.map_homemade_in_bounds(71, 71.3, 101.5, 101.8) -> 'pins') p
       join public.businesses b on b.id = (p ->> 'id')::uuid
      where b.id = '00000000-0000-0000-0018-000000000001' $$,
  $$ values (true) $$, 'a returned pin''s lat/lng equal businesses.map_lat/map_lng');
select results_eq(
  $$ select (p ->> 'lat')::float8 <> l.lat and (p ->> 'lng')::float8 <> l.lng
       from jsonb_array_elements(public.map_homemade_in_bounds(71, 71.3, 101.5, 101.8) -> 'pins') p
       join public.business_locations l on l.business_id = (p ->> 'id')::uuid
      where l.business_id = '00000000-0000-0000-0018-000000000001' $$,
  $$ values (true) $$, 'a returned pin differs from the exact business_locations lat/lng');
select ok(
  (select d between 199 and 501
     from (select sqrt(power(((p ->> 'lat')::float8 - l.lat) * 111320, 2)
                     + power(((p ->> 'lng')::float8 - l.lng) * 111320 * cos(radians(l.lat)), 2)) d
             from jsonb_array_elements(public.map_homemade_in_bounds(71, 71.3, 101.5, 101.8) -> 'pins') p
             join public.business_locations l on l.business_id = (p ->> 'id')::uuid
            where l.business_id = '00000000-0000-0000-0018-000000000001') s),
  'the shifted point is 200-500 m from the exact point');

-- ── map_status for homemade owners ──────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0008-000000000001","role":"authenticated"}';
select is(public.get_my_business() ->> 'map_status', 'visible', 'map_status is visible for a fresh homemade cook');
select ok(position('place_status' in public.get_my_business()::text) = 0
      and position('resolved_at' in public.get_my_business()::text) = 0,
  'the owner view exposes the three-word map_status only, never place_status or resolved_at');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0008-000000000002","role":"authenticated"}';
select is(public.get_my_business() ->> 'map_status', 'visible', 'map_status is visible at 29 days');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0008-000000000003","role":"authenticated"}';
select is(public.get_my_business() ->> 'map_status', 'needs_refresh', 'map_status is needs_refresh once the address is over 30 days old');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0008-000000000005","role":"authenticated"}';
select is(public.get_my_business() ->> 'map_status', 'place_not_found', 'map_status is place_not_found for a not_found place');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0008-000000000013","role":"authenticated"}';
select is(jsonb_typeof(public.get_my_business() -> 'map_status'), 'null', 'map_status is null for a cook with no saved address');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0008-000000000007","role":"authenticated"}';
select is(public.get_my_business() ->> 'map_status', 'visible', 'a restaurant owner''s map_status is unchanged (visible)');
reset role;
update public.business_locations set resolved_at = now() - interval '40 days'
 where business_id = '00000000-0000-0000-0018-000000000005';
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0008-000000000005","role":"authenticated"}';
select is(public.get_my_business() ->> 'map_status', 'place_not_found', 'place_not_found wins over needs_refresh when both are true');
reset role;
update public.business_locations set resolved_at = now() - interval '1 day'
 where business_id = '00000000-0000-0000-0018-000000000005';

-- ── The exact 30-day boundary ───────────────────────────────────────────────
update public.business_locations set resolved_at = now() - interval '30 days'
 where business_id = '00000000-0000-0000-0018-000000000002';
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
set local request.headers = '{"x-forwarded-for":"198.51.100.20"}';
select is(
  (select count(*)::int from jsonb_array_elements(public.map_homemade_in_bounds(71, 71.3, 101.5, 101.8) -> 'pins') p
    where p ->> 'id' = '00000000-0000-0000-0018-000000000002'),
  0, 'a cook resolved exactly 30 days ago is not returned');
select is(public.get_homemade_details('00000000-0000-0000-0018-000000000002'), null,
  'details is null for a cook resolved exactly 30 days ago');
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0008-000000000002","role":"authenticated"}';
select is(public.get_my_business() ->> 'map_status', 'needs_refresh', 'map_status is needs_refresh at exactly 30 days (the same line)');
reset role;
update public.business_locations set resolved_at = now() - interval '30 days' + interval '1 second'
 where business_id = '00000000-0000-0000-0018-000000000002';
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select is(
  (select count(*)::int from jsonb_array_elements(public.map_homemade_in_bounds(71, 71.3, 101.5, 101.8) -> 'pins') p
    where p ->> 'id' = '00000000-0000-0000-0018-000000000002'),
  1, 'a cook resolved one second inside the 30 days is returned');
reset role;
update public.business_locations set resolved_at = now() - interval '29 days'
 where business_id = '00000000-0000-0000-0018-000000000002';

-- ── A refresh brings a stale cook back, and keeps the public point ──────────
update public.business_locations set refresh_attempted_at = now()
 where business_id = '00000000-0000-0000-0018-000000000003';
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok($$ select public.apply_places_refresh('00000000-0000-0000-0018-000000000003', 'ok', 71.1405, 101.6105) $$,
  'a refresh result is applied to a stale homemade cook');
reset role;
select results_eq(
  $$ select b.map_lat, b.map_lng, l.lat from public.businesses b join public.business_locations l on l.business_id = b.id
      where b.id = '00000000-0000-0000-0018-000000000003' $$,
  $$ values (71.14::float8, 101.61::float8, 71.1405::float8) $$,
  'the refresh moved only the exact location; the public point is as it was');
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
set local request.headers = '{"x-forwarded-for":"198.51.100.21"}';
select is(
  (select count(*)::int from jsonb_array_elements(public.map_homemade_in_bounds(71, 71.3, 101.5, 101.8) -> 'pins') p
    where p ->> 'id' = '00000000-0000-0000-0018-000000000003'),
  1, 'the cook that was 31 days old appears again after a refresh');
select is(public.get_homemade_details('00000000-0000-0000-0018-000000000003') ->> 'name', 'Home Thirty One',
  'and its details are available again');
reset role;
update public.business_locations set resolved_at = now() - interval '31 days'
 where business_id = '00000000-0000-0000-0018-000000000003';

-- ── Photos: readable for a fresh listed cook, not for an unlisted one ───────
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select is((select count(*)::int from public.business_photos where business_id = '00000000-0000-0000-0018-000000000001'), 2,
  'anon sees the ready photos of a fresh listed homemade cook');
select is((select count(*)::int from public.business_photos where business_id = '00000000-0000-0000-0018-000000000004'), 0,
  'anon sees no photo of an unlisted homemade cook');
select is((select count(*)::int from storage.objects
            where bucket_id = 'business-media' and name like '00000000-0000-0000-0018-000000000001/%'), 2,
  'anon can read the storage objects of a fresh listed homemade cook''s ready photos');
select is((select count(*)::int from storage.objects
            where bucket_id = 'business-media' and name like '00000000-0000-0000-0018-000000000004/%'), 0,
  'anon cannot read the storage objects of an unlisted homemade cook');
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0008-000000000008","role":"authenticated"}';
select is((select count(*)::int from storage.objects
            where bucket_id = 'business-media' and name like '00000000-0000-0000-0018-000000000004/%'), 0,
  'a signed-in outsider cannot read the storage objects of an unlisted homemade cook');
-- Known behaviour, spec 08 Decision 13c (see docs/product/v1.md §16): photos of a hidden (stale) cook stay
-- readable by id and path. No location is revealed. If this is tightened later, update §16 with it.
reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select is((select count(*)::int from public.business_photos where business_id = '00000000-0000-0000-0018-000000000003'), 1,
  'known behaviour, Decision 13c (see docs/product/v1.md §16): anon still reads the photo row of a 31-day-old (hidden) cook');
select is((select count(*)::int from storage.objects
            where bucket_id = 'business-media' and name like '00000000-0000-0000-0018-000000000003/%'), 1,
  'known behaviour, Decision 13c (see docs/product/v1.md §16): anon still reads the storage object of a 31-day-old (hidden) cook');
reset role;

-- ── Rate limits: own counters per tab ───────────────────────────────────────
delete from public.map_rate_limits;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
set local request.headers = '{"x-forwarded-for":"198.51.100.10, 10.0.0.1"}';
select lives_ok($$ select count(public.map_homemade_in_bounds(71, 71.3, 101.5, 101.8)) from generate_series(1, 120) $$,
  'a guest can make 120 homemade pins calls in a minute');
select throws_ok($$ select public.map_homemade_in_bounds(71, 71.3, 101.5, 101.8) $$, 'P0001', 'rate_limited',
  'the 121st homemade pins call from the same IP raises rate_limited');
select lives_ok($$ select public.map_restaurants_in_bounds(71, 71.3, 101.5, 101.8) $$,
  'the same IP can still load restaurant pins: the counters are separate');
set local request.headers = '{"x-forwarded-for":"198.51.100.11"}';
select lives_ok($$ select public.map_homemade_in_bounds(71, 71.3, 101.5, 101.8) $$, 'a different IP is unaffected');
reset role;
select is((select calls from public.map_rate_limits where caller_key = 'ip:198.51.100.10' and kind = 'homemade_pins'), 120,
  'refused calls leave the homemade count at the limit');
select is((select calls from public.map_rate_limits where caller_key = 'guest:all' and kind = 'homemade_pins'), 121,
  'every accepted guest call counts toward the guest:all ceiling of its own kind (120 + 1)');
select is((select calls from public.map_rate_limits where caller_key = 'guest:all' and kind = 'pins'), 1,
  'homemade calls did not touch the guest:all counter of the pins kind');

set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
set local request.headers = '{"x-forwarded-for":"198.51.100.12"}';
select lives_ok($$ select count(public.map_restaurants_in_bounds(71, 71.3, 101.5, 101.8)) from generate_series(1, 120) $$,
  'a guest uses up the restaurant pins limit');
select throws_ok($$ select public.map_restaurants_in_bounds(71, 71.3, 101.5, 101.8) $$, 'P0001', 'rate_limited',
  'the restaurant pins call is limited');
select lives_ok($$ select public.map_homemade_in_bounds(71, 71.3, 101.5, 101.8) $$,
  'and the same IP can still load homemade pins');

set local request.headers = '{"x-forwarded-for":"198.51.100.13"}';
select lives_ok($$ select count(public.get_homemade_details('00000000-0000-0000-0018-000000000001')) from generate_series(1, 30) $$,
  'a guest can make 30 homemade details calls in a minute');
select throws_ok($$ select public.get_homemade_details('00000000-0000-0000-0018-000000000001') $$, 'P0001', 'rate_limited',
  'the 31st homemade details call from the same IP raises rate_limited');
select lives_ok($$ select public.get_restaurant_details('00000000-0000-0000-0018-000000000007') $$,
  'restaurant details are counted separately');
select lives_ok($$ select public.map_homemade_in_bounds(71, 71.3, 101.5, 101.8) $$, 'homemade details and homemade pins are counted separately');

-- The guest ceiling is per kind: using up one leaves the others open.
reset role;
insert into public.map_rate_limits (caller_key, kind, window_start, calls)
values ('guest:all', 'homemade_pins', date_trunc('minute', now(), 'UTC'), 2000)
on conflict (caller_key, kind, window_start) do update set calls = 2000;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
set local request.headers = '{"x-forwarded-for":"198.51.100.99"}';
select throws_ok($$ select public.map_homemade_in_bounds(71, 71.3, 101.5, 101.8) $$, 'P0001', 'rate_limited',
  'once guests together are over 2,000 homemade pins calls, a guest on a fresh IP gets rate_limited');
select lives_ok($$ select public.map_restaurants_in_bounds(71, 71.3, 101.5, 101.8) $$,
  'the homemade guest ceiling does not limit guests on the Restaurants tab');
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0008-000000000008","role":"authenticated"}';
select lives_ok($$ select public.map_homemade_in_bounds(71, 71.3, 101.5, 101.8) $$,
  'a signed-in user is unaffected by the guest ceiling');
reset role;
select is((select count(*)::int from public.map_rate_limits where caller_key = 'ip:198.51.100.99' and kind = 'homemade_pins'), 0,
  'refused guest calls create no per-IP row');
delete from public.map_rate_limits;
insert into public.map_rate_limits (caller_key, kind, window_start, calls)
values ('guest:all', 'pins', date_trunc('minute', now(), 'UTC'), 2000),
       ('guest:all', 'homemade_details', date_trunc('minute', now(), 'UTC'), 600);
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
set local request.headers = '{"x-forwarded-for":"198.51.100.98"}';
select throws_ok($$ select public.map_restaurants_in_bounds(71, 71.3, 101.5, 101.8) $$, 'P0001', 'rate_limited',
  'the restaurant guest ceiling is used up');
select lives_ok($$ select public.map_homemade_in_bounds(71, 71.3, 101.5, 101.8) $$,
  'and the Homemade tab is not limited by it');
select throws_ok($$ select public.get_homemade_details('00000000-0000-0000-0018-000000000001') $$, 'P0001', 'rate_limited',
  'the guest ceiling for homemade details is 600 a minute');

-- Signed-in users, by user id.
reset role;
delete from public.map_rate_limits;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0008-000000000008","role":"authenticated"}';
set local request.headers = '{"x-forwarded-for":"198.51.100.50"}';
select lives_ok($$ select count(public.map_homemade_in_bounds(71, 71.3, 101.5, 101.8)) from generate_series(1, 120) $$,
  'a signed-in user can make 120 homemade pins calls in a minute');
select throws_ok($$ select public.map_homemade_in_bounds(71, 71.3, 101.5, 101.8) $$, 'P0001', 'rate_limited',
  'the 121st homemade pins call from the same user raises rate_limited');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0008-000000000001","role":"authenticated"}';
select lives_ok($$ select public.map_homemade_in_bounds(71, 71.3, 101.5, 101.8) $$,
  'another signed-in user from the same IP is unaffected');
reset role;
select is((select count(*)::int from public.map_rate_limits where caller_key like 'ip:%' or caller_key = 'guest:all'), 0,
  'signed-in calls create no IP or guest rows');
delete from public.map_rate_limits;

-- ── The box rules match the restaurant function ─────────────────────────────
-- The same boxes through both functions on mirrored fixtures (same points, same names): the answers
-- (errors, too_large, capped, pins without ids) must be identical.
-- Restore the cap fixture deleted above, so both types have 501 rows in the cap box again.
insert into public.businesses (id, owner_id, type, name, cuisine_code, map_lat, map_lng)
values ('00000000-0000-0000-0018-000000001501', '00000000-0000-0000-0008-000000001501', 'homemade', 'Cap 0501', 'IT',
        -50 + 501 * 0.0005, -100 + 501 * 0.0005);
insert into public.business_locations (business_id, place_id, formatted_address, lat, lng)
values ('00000000-0000-0000-0018-000000001501', 'pHK501', 'Cap St 501', -50 + 501 * 0.0005, -100 + 501 * 0.0005);
create temp table boxes (a float8, b float8, c float8, d float8);
grant all on boxes to public;
insert into boxes values
  (null::float8, 71, 100, 101), (70, 71, 100, null), ('NaN'::float8, 71, 100, 101), (70, 'Infinity'::float8, 100, 101),
  (70, 71, '-Infinity'::float8, 101), (71, 70, 100, 101), (89, 100, 0, 10), (-100, -95, 0, 10), (0, 91, 0, 10),
  (0, 90, 0, 90), (0, 10, 0, 91), (-90, 90, -180, 180), (0, 10, 10, -10), (60, 61, 170, -170), (60, 61, 179, 181),
  (60, 61, 179.5, 180), (60, 61, -179.95, -179.85), (60.1, 60.1, 179.9, 179.9), (-51, -49, -101, -99),
  (-50.0005, -49.9995, -100.0005, -99.9995), (60, 61, 170, 190), (-90, -89, -180, -179);
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0008-000000000009","role":"authenticated"}';
set local request.headers = '{"x-forwarded-for":"198.51.100.60"}';
select is((select count(*)::int from boxes), 22, 'the equivalence table holds 22 boxes');
select is((select coalesce(array_agg(format('%s,%s,%s,%s', a, b, c, d)), array[]::text[]) from boxes
            where pg_temp.run(true, a, b, c, d) is distinct from pg_temp.run(false, a, b, c, d)), array[]::text[],
  'every box gives the same answer from map_homemade_in_bounds and map_restaurants_in_bounds');
select ok((select count(*) from boxes where pg_temp.run(true, a, b, c, d) like '%"name"%') >= 8,
  'the equivalence boxes are not vacuous: at least 8 of them return pins');
select ok((select count(*) from boxes where pg_temp.run(true, a, b, c, d) like 'ERR:invalid_bounds%') = 6,
  'and 6 of them are invalid_bounds');
-- The answers once more, kept in a table, so the branch checks below do not spend more of the 120 calls.
create temp table answers as select a, b, c, d, pg_temp.run(true, a, b, c, d) as r from boxes;
select ok((select count(*) from answers where r like '%"too_large": true%') >= 4,
  'the equivalence boxes reach the too_large branch: at least 4 of them');
select ok((select count(*) from answers where r like '%"capped": true%') >= 1,
  'the equivalence boxes reach the capped branch: at least 1 of them');
reset role;

select * from finish();
rollback;
