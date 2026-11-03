-- Spec 05: seller onboarding — businesses, business_locations, places_rate_limits,
-- column grants, function privileges, homemade approximate location and Places quota.
begin;
select plan(192);

-- ── Fixtures (as postgres) ──────────────────────────────────────────────────
-- 0501 A  restaurant, listed, with location (the public one)
-- 0502 B  outsider, no business
-- 0503 C  homemade, listed, no location yet
-- 0504 D  restaurant, unlisted, with a map point
-- 0505 E  no username (profile incomplete)
-- 0506 F  fresh user with a username, no business
-- 0507..0512  quota users
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000501', 'a@example.test'),
  ('00000000-0000-0000-0000-000000000502', 'b@example.test'),
  ('00000000-0000-0000-0000-000000000503', 'c@example.test'),
  ('00000000-0000-0000-0000-000000000504', 'd@example.test'),
  ('00000000-0000-0000-0000-000000000505', 'e@example.test'),
  ('00000000-0000-0000-0000-000000000506', 'f@example.test'),
  ('00000000-0000-0000-0000-000000000507', 'q1@example.test'),
  ('00000000-0000-0000-0000-000000000508', 'q2@example.test'),
  ('00000000-0000-0000-0000-000000000509', 'q3@example.test'),
  ('00000000-0000-0000-0000-000000000510', 'q4@example.test'),
  ('00000000-0000-0000-0000-000000000511', 'q5@example.test'),
  ('00000000-0000-0000-0000-000000000512', 'q6@example.test'),
  ('00000000-0000-0000-0000-000000000513', 'n1@example.test'),
  ('00000000-0000-0000-0000-000000000514', 'n2@example.test'),
  ('00000000-0000-0000-0000-000000000515', 'el1@example.test'),
  ('00000000-0000-0000-0000-000000000516', 'ro1@example.test'),
  ('00000000-0000-0000-0000-000000000517', 'ro2@example.test'),
  ('00000000-0000-0000-0000-000000000518', 'ro3@example.test'),
  ('00000000-0000-0000-0000-000000000519', 'ro4@example.test');
-- 0513 G  fresh user with a username, no business (create_my_business name rules)
-- 0514 H  homemade owner (direct-update name rules)
-- Quota users all have a username (Decision 19). Users that call `resolve` also own a business:
--   0507 (autocomplete + resolve), 0508 (resolve), 0518 (resolve day limit).
-- 0515  username, no business (eligibility: resolve -> no_business, autocomplete still allowed)
-- 0516  rolling window: previous-minute row at the limit, day under the limit
-- 0517  rolling window: day at the limit, no current-minute row
-- 0519  minute-refused calls still count toward the day
update public.profiles set username = 'quota_1' where id = '00000000-0000-0000-0000-000000000507';
update public.profiles set username = 'quota_2' where id = '00000000-0000-0000-0000-000000000508';
update public.profiles set username = 'quota_3' where id = '00000000-0000-0000-0000-000000000509';
update public.profiles set username = 'quota_4' where id = '00000000-0000-0000-0000-000000000510';
update public.profiles set username = 'quota_5' where id = '00000000-0000-0000-0000-000000000511';
update public.profiles set username = 'quota_6' where id = '00000000-0000-0000-0000-000000000512';
update public.profiles set username = 'elig_g'  where id = '00000000-0000-0000-0000-000000000515';
update public.profiles set username = 'roll_a'  where id = '00000000-0000-0000-0000-000000000516';
update public.profiles set username = 'roll_b'  where id = '00000000-0000-0000-0000-000000000517';
update public.profiles set username = 'roll_c'  where id = '00000000-0000-0000-0000-000000000518';
update public.profiles set username = 'roll_d'  where id = '00000000-0000-0000-0000-000000000519';
update public.profiles set is_seller = true
 where id in ('00000000-0000-0000-0000-000000000507', '00000000-0000-0000-0000-000000000508',
              '00000000-0000-0000-0000-000000000518');
update public.profiles set username = 'name_g' where id = '00000000-0000-0000-0000-000000000513';
update public.profiles set username = 'name_h', is_seller = true where id = '00000000-0000-0000-0000-000000000514';

update public.profiles set username = 'owner_a'    where id = '00000000-0000-0000-0000-000000000501';
update public.profiles set username = 'outsider_b' where id = '00000000-0000-0000-0000-000000000502';
update public.profiles set username = 'homemade_c' where id = '00000000-0000-0000-0000-000000000503';
update public.profiles set username = 'unlisted_d' where id = '00000000-0000-0000-0000-000000000504';
update public.profiles set username = 'fresh_f'    where id = '00000000-0000-0000-0000-000000000506';
update public.profiles set is_seller = true
 where id in ('00000000-0000-0000-0000-000000000501', '00000000-0000-0000-0000-000000000503',
              '00000000-0000-0000-0000-000000000504');

insert into public.businesses (id, owner_id, type, name, cuisine_code, map_lat, map_lng, public_address, is_listed) values
  ('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-000000000501',
   'restaurant', 'Trattoria A', 'IT', 43.7, -79.4, '1 Main St, Toronto', true),
  ('00000000-0000-0000-0000-0000000005c1', '00000000-0000-0000-0000-000000000503',
   'homemade', 'Kitchen C', 'FR', null, null, null, true),
  ('00000000-0000-0000-0000-0000000005d1', '00000000-0000-0000-0000-000000000504',
   'restaurant', 'Closed D', 'JP', 43.8, -79.5, '2 Side St, Toronto', false),
  ('00000000-0000-0000-0000-0000000005e1', '00000000-0000-0000-0000-000000000514',
   'homemade', 'Kitchen H', 'IT', null, null, null, true),
  ('00000000-0000-0000-0000-0000000005f7', '00000000-0000-0000-0000-000000000507',
   'homemade', 'Quota Kitchen 1', 'IT', null, null, null, true),
  ('00000000-0000-0000-0000-0000000005f8', '00000000-0000-0000-0000-000000000508',
   'homemade', 'Quota Kitchen 2', 'IT', null, null, null, true),
  ('00000000-0000-0000-0000-0000000005fa', '00000000-0000-0000-0000-000000000518',
   'homemade', 'Quota Kitchen 3', 'IT', null, null, null, true);

insert into public.business_locations (business_id, place_id, formatted_address, lat, lng) values
  ('00000000-0000-0000-0000-0000000005a1', 'pA', '1 Main St, Toronto', 43.7, -79.4),
  ('00000000-0000-0000-0000-0000000005d1', 'pD', '2 Side St, Toronto', 43.8, -79.5);

-- ── RLS enabled ─────────────────────────────────────────────────────────────
select ok((select relrowsecurity from pg_class where oid = 'public.businesses'::regclass),
  'RLS is enabled on businesses');
select ok((select relrowsecurity from pg_class where oid = 'public.business_locations'::regclass),
  'RLS is enabled on business_locations');
select ok((select relrowsecurity from pg_class where oid = 'public.places_rate_limits'::regclass),
  'RLS is enabled on places_rate_limits');

-- ── Table privileges: none at table level ───────────────────────────────────
select table_privs_are('public', 'businesses', 'anon', array[]::text[],
  'anon has no table-level privileges on businesses');
select table_privs_are('public', 'businesses', 'authenticated', array[]::text[],
  'authenticated has no table-level privileges on businesses');
select table_privs_are('public', 'business_locations', 'anon', array[]::text[],
  'anon has no table-level privileges on business_locations');
select table_privs_are('public', 'business_locations', 'authenticated', array[]::text[],
  'authenticated has no table-level privileges on business_locations');
select table_privs_are('public', 'places_rate_limits', 'anon', array[]::text[],
  'anon has no table-level privileges on places_rate_limits');
select table_privs_are('public', 'places_rate_limits', 'authenticated', array[]::text[],
  'authenticated has no table-level privileges on places_rate_limits');

-- ── Column privileges on businesses (exact, every column) ───────────────────
-- anon: select on the 8 public columns only.
select column_privs_are('public', 'businesses', 'id', 'anon', array['SELECT'], 'anon: id is select-only');
select column_privs_are('public', 'businesses', 'type', 'anon', array['SELECT'], 'anon: type is select-only');
select column_privs_are('public', 'businesses', 'name', 'anon', array['SELECT'], 'anon: name is select-only');
select column_privs_are('public', 'businesses', 'cuisine_code', 'anon', array['SELECT'], 'anon: cuisine_code is select-only');
select column_privs_are('public', 'businesses', 'accepts_table_requests', 'anon', array['SELECT'],
  'anon: accepts_table_requests is select-only');
select column_privs_are('public', 'businesses', 'map_lat', 'anon', array['SELECT'], 'anon: map_lat is select-only');
select column_privs_are('public', 'businesses', 'map_lng', 'anon', array['SELECT'], 'anon: map_lng is select-only');
select column_privs_are('public', 'businesses', 'public_address', 'anon', array['SELECT'],
  'anon: public_address is select-only');
select column_privs_are('public', 'businesses', 'owner_id', 'anon', array[]::text[], 'anon: no privileges on owner_id');
select column_privs_are('public', 'businesses', 'is_listed', 'anon', array[]::text[], 'anon: no privileges on is_listed');
select column_privs_are('public', 'businesses', 'created_at', 'anon', array[]::text[], 'anon: no privileges on created_at');
select column_privs_are('public', 'businesses', 'updated_at', 'anon', array[]::text[], 'anon: no privileges on updated_at');
-- authenticated: same select grant, plus update on name, cuisine_code, accepts_table_requests.
select column_privs_are('public', 'businesses', 'id', 'authenticated', array['SELECT'], 'authenticated: id is select-only');
select column_privs_are('public', 'businesses', 'type', 'authenticated', array['SELECT'], 'authenticated: type is select-only');
select column_privs_are('public', 'businesses', 'name', 'authenticated', array['SELECT', 'UPDATE'],
  'authenticated: name is select + update');
select column_privs_are('public', 'businesses', 'cuisine_code', 'authenticated', array['SELECT', 'UPDATE'],
  'authenticated: cuisine_code is select + update');
select column_privs_are('public', 'businesses', 'accepts_table_requests', 'authenticated', array['SELECT', 'UPDATE'],
  'authenticated: accepts_table_requests is select + update');
select column_privs_are('public', 'businesses', 'map_lat', 'authenticated', array['SELECT'], 'authenticated: map_lat is select-only');
select column_privs_are('public', 'businesses', 'map_lng', 'authenticated', array['SELECT'], 'authenticated: map_lng is select-only');
select column_privs_are('public', 'businesses', 'public_address', 'authenticated', array['SELECT'],
  'authenticated: public_address is select-only');
select column_privs_are('public', 'businesses', 'owner_id', 'authenticated', array[]::text[],
  'authenticated: no privileges on owner_id');
select column_privs_are('public', 'businesses', 'is_listed', 'authenticated', array[]::text[],
  'authenticated: no privileges on is_listed');
select column_privs_are('public', 'businesses', 'created_at', 'authenticated', array[]::text[],
  'authenticated: no privileges on created_at');
select column_privs_are('public', 'businesses', 'updated_at', 'authenticated', array[]::text[],
  'authenticated: no privileges on updated_at');

-- ── No column privileges at all on the private tables ───────────────────────
select ok(not has_any_column_privilege('anon', 'public.business_locations', 'SELECT, INSERT, UPDATE, REFERENCES'),
  'anon has no column privileges on business_locations');
select ok(not has_any_column_privilege('authenticated', 'public.business_locations', 'SELECT, INSERT, UPDATE, REFERENCES'),
  'authenticated has no column privileges on business_locations');
select ok(not has_any_column_privilege('anon', 'public.places_rate_limits', 'SELECT, INSERT, UPDATE, REFERENCES'),
  'anon has no column privileges on places_rate_limits');
select ok(not has_any_column_privilege('authenticated', 'public.places_rate_limits', 'SELECT, INSERT, UPDATE, REFERENCES'),
  'authenticated has no column privileges on places_rate_limits');

-- ── Function privilege allowlist (§16) ──────────────────────────────────────
-- has_function_privilege also reflects PUBLIC grants; extension-owned functions are excluded.
select is(
  (select coalesce(array_agg(distinct p.proname::text order by p.proname::text), array[]::text[])
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and has_function_privilege('authenticated', p.oid, 'execute')
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')),
  array['create_my_business', 'get_my_business', 'set_seller_mode'],
  'only the three allowlisted public functions are executable by authenticated'
);
select is(
  (select coalesce(array_agg(distinct p.proname::text order by p.proname::text), array[]::text[])
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and has_function_privilege('anon', p.oid, 'execute')
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')),
  array[]::text[],
  'anon can execute no public function'
);
select ok(not has_function_privilege('anon', 'public.business_owner_view(uuid)', 'execute'),
  'anon cannot execute business_owner_view');
select ok(not has_function_privilege('authenticated', 'public.business_owner_view(uuid)', 'execute'),
  'authenticated cannot execute business_owner_view');
select ok(not has_function_privilege('anon',
  'public.set_business_location(uuid, text, text, double precision, double precision)', 'execute'),
  'anon cannot execute set_business_location');
select ok(not has_function_privilege('authenticated',
  'public.set_business_location(uuid, text, text, double precision, double precision)', 'execute'),
  'authenticated cannot execute set_business_location');
select ok(not has_function_privilege('anon', 'public.consume_places_quota(uuid, text)', 'execute'),
  'anon cannot execute consume_places_quota');
select ok(not has_function_privilege('authenticated', 'public.consume_places_quota(uuid, text)', 'execute'),
  'authenticated cannot execute consume_places_quota');
select ok(has_function_privilege('service_role',
  'public.set_business_location(uuid, text, text, double precision, double precision)', 'execute'),
  'service_role can execute set_business_location');
select ok(has_function_privilege('service_role', 'public.consume_places_quota(uuid, text)', 'execute'),
  'service_role can execute consume_places_quota');

-- Security definer + pinned empty search_path on all six.
select ok((select prosecdef from pg_proc
  where oid = 'public.create_my_business(text, text, text, boolean)'::regprocedure),
  'create_my_business is security definer');
select ok((select prosecdef from pg_proc where oid = 'public.set_seller_mode(boolean)'::regprocedure),
  'set_seller_mode is security definer');
select ok((select prosecdef from pg_proc where oid = 'public.get_my_business()'::regprocedure),
  'get_my_business is security definer');
select ok((select prosecdef from pg_proc
  where oid = 'public.set_business_location(uuid, text, text, double precision, double precision)'::regprocedure),
  'set_business_location is security definer');
select ok((select prosecdef from pg_proc where oid = 'public.consume_places_quota(uuid, text)'::regprocedure),
  'consume_places_quota is security definer');
select ok((select prosecdef from pg_proc where oid = 'public.business_owner_view(uuid)'::regprocedure),
  'business_owner_view is security definer');
select is((select proconfig from pg_proc where oid = 'public.create_my_business(text, text, text, boolean)'::regprocedure),
  array['search_path=""'], 'create_my_business pins an empty search_path');
select is((select proconfig from pg_proc where oid = 'public.set_seller_mode(boolean)'::regprocedure),
  array['search_path=""'], 'set_seller_mode pins an empty search_path');
select is((select proconfig from pg_proc where oid = 'public.get_my_business()'::regprocedure),
  array['search_path=""'], 'get_my_business pins an empty search_path');
select is((select proconfig from pg_proc
  where oid = 'public.set_business_location(uuid, text, text, double precision, double precision)'::regprocedure),
  array['search_path=""'], 'set_business_location pins an empty search_path');
select is((select proconfig from pg_proc where oid = 'public.consume_places_quota(uuid, text)'::regprocedure),
  array['search_path=""'], 'consume_places_quota pins an empty search_path');
select is((select proconfig from pg_proc where oid = 'public.business_owner_view(uuid)'::regprocedure),
  array['search_path=""'], 'business_owner_view pins an empty search_path');

-- ── Anon ────────────────────────────────────────────────────────────────────
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

select throws_ok($$ select * from public.business_locations $$, '42501', null,
  'anon cannot select business_locations');
select throws_ok($$ select owner_id from public.businesses $$, '42501', null,
  'anon cannot select owner_id');
select throws_ok($$ select is_listed from public.businesses $$, '42501', null,
  'anon cannot select is_listed');
select throws_ok($$ select * from public.businesses $$, '42501', null,
  'anon cannot select * from businesses');
select throws_ok($$ select * from public.places_rate_limits $$, '42501', null,
  'anon cannot select places_rate_limits');
select is(
  (select count(*)::int from public.businesses where id = '00000000-0000-0000-0000-0000000005a1'),
  1, 'anon sees a listed business that has a location');
select is(
  (select count(*)::int from public.businesses where id = '00000000-0000-0000-0000-0000000005d1'),
  0, 'anon does not see an unlisted business');
select is(
  (select count(*)::int from public.businesses where id = '00000000-0000-0000-0000-0000000005c1'),
  0, 'anon does not see a business without a location');
select throws_ok(
  $$ select public.create_my_business('restaurant', 'Anon Place', 'IT') $$,
  '42501', null, 'anon cannot execute create_my_business');

-- ── Outsider (B: signed in, no business) ────────────────────────────────────
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000502","role":"authenticated"}';

select throws_ok($$ select * from public.business_locations $$, '42501', null,
  'outsider cannot select business_locations');
select throws_ok($$ select owner_id from public.businesses $$, '42501', null,
  'outsider cannot select owner_id');
select throws_ok($$ select is_listed from public.businesses $$, '42501', null,
  'outsider cannot select is_listed');
select throws_ok($$ select * from public.businesses $$, '42501', null,
  'outsider cannot select * from businesses');
select throws_ok($$ select * from public.places_rate_limits $$, '42501', null,
  'outsider cannot select places_rate_limits');
select is(
  (select count(*)::int from public.businesses where id = '00000000-0000-0000-0000-0000000005a1'),
  1, 'outsider sees a listed business that has a location via the public columns');
select is(
  (select count(*)::int from public.businesses where id = '00000000-0000-0000-0000-0000000005d1'),
  0, 'outsider does not see an unlisted business');
select is(
  (select count(*)::int from public.businesses where id = '00000000-0000-0000-0000-0000000005c1'),
  0, 'outsider does not see a business without a location');

with u as (
  update public.businesses set name = 'hacked'
   where id = '00000000-0000-0000-0000-0000000005a1'
  returning 1
)
select is(count(*)::int, 0, 'outsider update of a visible business affects 0 rows') from u;
with u as (
  update public.businesses set name = 'hacked'
   where id = '00000000-0000-0000-0000-0000000005d1'
  returning 1
)
select is(count(*)::int, 0, 'outsider update of an unlisted business affects 0 rows') from u;

select is(public.get_my_business(), null, 'get_my_business returns null for a user with no business');

select throws_ok(
  $$ select public.set_business_location('00000000-0000-0000-0000-000000000501', 'x', 'x', 1, 1) $$,
  '42501', null, 'authenticated cannot call set_business_location');
select throws_ok(
  $$ select public.consume_places_quota('00000000-0000-0000-0000-000000000502', 'autocomplete') $$,
  '42501', null, 'authenticated cannot call consume_places_quota');
select throws_ok(
  $$ select public.business_owner_view('00000000-0000-0000-0000-000000000501') $$,
  '42501', null, 'authenticated cannot call business_owner_view');

-- ── Owner of the homemade business (C) ──────────────────────────────────────
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000503","role":"authenticated"}';

select is(
  (select count(*)::int from public.businesses where id = '00000000-0000-0000-0000-0000000005c1'),
  1, 'owner sees their own business even without a location');
select is(public.get_my_business()->>'id', '00000000-0000-0000-0000-0000000005c1',
  'get_my_business returns the caller''s own business');
select is(jsonb_typeof(public.get_my_business()->'location'), 'null',
  'get_my_business location is null when no address is saved');
select is(position('1 Main St' in public.get_my_business()::text), 0,
  'get_my_business never leaks another user''s address');
select throws_ok(
  $$ update public.businesses set accepts_table_requests = true
      where id = '00000000-0000-0000-0000-0000000005c1' $$,
  '23514', null, 'homemade cannot accept table requests');

-- ── Owner of the restaurant (A) ─────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000501","role":"authenticated"}';

select lives_ok(
  $$ update public.businesses
        set name = 'Renamed Trattoria', cuisine_code = 'JP', accepts_table_requests = true
      where id = '00000000-0000-0000-0000-0000000005a1' $$,
  'owner can update name, cuisine_code and accepts_table_requests');
select results_eq(
  $$ select name, cuisine_code, accepts_table_requests from public.businesses
      where id = '00000000-0000-0000-0000-0000000005a1' $$,
  $$ values ('Renamed Trattoria'::text, 'JP'::text, true) $$,
  'owner update is stored');

select throws_ok(
  $$ update public.businesses set type = 'homemade' where id = '00000000-0000-0000-0000-0000000005a1' $$,
  '42501', null, 'owner cannot update type');
select throws_ok(
  $$ update public.businesses set owner_id = '00000000-0000-0000-0000-000000000502'
      where id = '00000000-0000-0000-0000-0000000005a1' $$,
  '42501', null, 'owner cannot update owner_id');
select throws_ok(
  $$ update public.businesses set is_listed = false where id = '00000000-0000-0000-0000-0000000005a1' $$,
  '42501', null, 'owner cannot update is_listed');
select throws_ok(
  $$ update public.businesses set map_lat = 10 where id = '00000000-0000-0000-0000-0000000005a1' $$,
  '42501', null, 'owner cannot update map_lat');
select throws_ok(
  $$ update public.businesses set map_lng = 10 where id = '00000000-0000-0000-0000-0000000005a1' $$,
  '42501', null, 'owner cannot update map_lng');
select throws_ok(
  $$ update public.businesses set public_address = 'Fake St' where id = '00000000-0000-0000-0000-0000000005a1' $$,
  '42501', null, 'owner cannot update public_address');
select throws_ok(
  $$ update public.businesses set created_at = now() - interval '1 year'
      where id = '00000000-0000-0000-0000-0000000005a1' $$,
  '42501', null, 'owner cannot update created_at');
select throws_ok(
  $$ insert into public.businesses (owner_id, type, name, cuisine_code)
     values ('00000000-0000-0000-0000-000000000501', 'restaurant', 'Second', 'IT') $$,
  '42501', null, 'owner cannot insert a business');
select throws_ok(
  $$ delete from public.businesses where id = '00000000-0000-0000-0000-0000000005a1' $$,
  '42501', null, 'owner cannot delete a business');

select is(public.get_my_business()->>'id', '00000000-0000-0000-0000-0000000005a1',
  'get_my_business returns the owner''s business');
select is(public.get_my_business()->'location'->>'formatted_address', '1 Main St, Toronto',
  'get_my_business returns the owner''s saved address');
select is(((public.get_my_business()->'location'->>'lat'))::float8, 43.7::float8,
  'get_my_business returns the owner''s exact latitude');
select is(
  (select array_agg(k order by k collate "C") from jsonb_object_keys(public.get_my_business()) k),
  array['accepts_table_requests', 'created_at', 'cuisine_code', 'id', 'is_listed', 'location',
        'map_lat', 'map_lng', 'name', 'public_address', 'type', 'updated_at'],
  'get_my_business has exactly the documented keys and never owner_id'
);

-- Outsider who owns a business (A) cannot touch another owner's business (C).
with u as (
  update public.businesses set name = 'hacked'
   where id = '00000000-0000-0000-0000-0000000005c1'
  returning 1
)
select is(count(*)::int, 0, 'an owner updating another owner''s business affects 0 rows') from u;
reset role;
select results_eq(
  $$ select name, cuisine_code from public.businesses where id = '00000000-0000-0000-0000-0000000005c1' $$,
  $$ values ('Kitchen C'::text, 'FR'::text) $$,
  'the other owner''s business row is unchanged');
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000501","role":"authenticated"}';
select ok(
  (public.get_my_business()->>'id') = '00000000-0000-0000-0000-0000000005a1'
  and (public.get_my_business()->>'id') not in
      ('00000000-0000-0000-0000-0000000005c1', '00000000-0000-0000-0000-0000000005d1'),
  'get_my_business as A returns A''s own id, never C''s or D''s');
select is(position('2 Side St' in public.get_my_business()::text), 0,
  'get_my_business as an owner with an address never leaks another owner''s address');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000504","role":"authenticated"}';
select is(public.get_my_business()->'location'->>'formatted_address', '2 Side St, Toronto',
  'get_my_business as D returns only D''s own saved address');
select is(position('1 Main St' in public.get_my_business()::text), 0,
  'get_my_business as D never contains another owner''s address');

-- ── create_my_business ──────────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000505","role":"authenticated"}';
select throws_ok(
  $$ select public.create_my_business('restaurant', 'No Username', 'IT') $$,
  'P0001', 'profile_incomplete', 'create_my_business fails with profile_incomplete without a username');

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000506","role":"authenticated"}';
select throws_ok(
  $$ select public.create_my_business('homemade', 'Gran Kitchen', 'IT', true) $$,
  'P0001', 'tables_restaurant_only', 'create_my_business rejects homemade with table requests');
select throws_ok(
  $$ select public.create_my_business('restaurant', '', 'IT') $$,
  '23514', null, 'create_my_business rejects an empty name');
select throws_ok(
  $$ select public.create_my_business('restaurant', 'Nowhere Cafe', 'no-such-cuisine') $$,
  '23503', null, 'create_my_business rejects an unknown cuisine');
select lives_ok(
  $$ select public.create_my_business('homemade', 'Gran Kitchen', 'IT') $$,
  'create_my_business creates a business (tables default to false)');
select ok(
  (select is_seller from public.profiles where id = '00000000-0000-0000-0000-000000000506'),
  'create_my_business sets is_seller = true');
select is(public.get_my_business()->>'name', 'Gran Kitchen',
  'the new business is returned by get_my_business');
select is((public.get_my_business()->>'is_listed')::boolean, true,
  'the new business is listed');
select throws_ok(
  $$ select public.create_my_business('restaurant', 'Another', 'IT') $$,
  'P0001', 'already_has_business', 'a second create_my_business fails with already_has_business');
select throws_ok(
  $$ update public.profiles set is_seller = false where id = '00000000-0000-0000-0000-000000000506' $$,
  '42501', null, 'authenticated still cannot update profiles.is_seller');

-- Business name rules via create_my_business (G: username, no business). Rejections first.
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000513","role":"authenticated"}';
select throws_ok(
  $$ select public.create_my_business('restaurant', ' Leading', 'IT') $$,
  '23514', null, 'create_my_business rejects a name with a leading space');
select throws_ok(
  $$ select public.create_my_business('restaurant', 'Trailing ', 'IT') $$,
  '23514', null, 'create_my_business rejects a name with a trailing space');
select throws_ok(
  $$ select public.create_my_business('restaurant', E'Joe\tPizza', 'IT') $$,
  '23514', null, 'create_my_business rejects a name with a control character');
select throws_ok(
  $$ select public.create_my_business('restaurant', repeat('a', 61), 'IT') $$,
  '23514', null, 'create_my_business rejects a 61-character name');
select lives_ok(
  $$ select public.create_my_business('restaurant', repeat('a', 60), 'IT') $$,
  'create_my_business accepts a 60-character name');

-- Business name rules via direct update (H owns business 5e1).
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000514","role":"authenticated"}';
select throws_ok(
  $$ update public.businesses set name = ' Leading' where id = '00000000-0000-0000-0000-0000000005e1' $$,
  '23514', null, 'owner update rejects a name with a leading space');
select throws_ok(
  $$ update public.businesses set name = 'Trailing ' where id = '00000000-0000-0000-0000-0000000005e1' $$,
  '23514', null, 'owner update rejects a name with a trailing space');
select throws_ok(
  $$ update public.businesses set name = E'Joe\tPizza' where id = '00000000-0000-0000-0000-0000000005e1' $$,
  '23514', null, 'owner update rejects a name with a control character');
select throws_ok(
  $$ update public.businesses set name = repeat('a', 61) where id = '00000000-0000-0000-0000-0000000005e1' $$,
  '23514', null, 'owner update rejects a 61-character name');
select lives_ok(
  $$ update public.businesses set name = repeat('b', 60) where id = '00000000-0000-0000-0000-0000000005e1' $$,
  'owner update accepts a 60-character name');
-- An update that matched no rows would also "live"; prove the row actually changed.
select is(
  (select name from public.businesses where id = '00000000-0000-0000-0000-0000000005e1'),
  repeat('b', 60),
  'owner update stores the 60-character name');

-- ── set_seller_mode ─────────────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000502","role":"authenticated"}';
select throws_ok($$ select public.set_seller_mode(true) $$, 'P0001', 'no_business',
  'set_seller_mode fails with no_business when the caller has none');

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000506","role":"authenticated"}';
select lives_ok($$ select public.set_seller_mode(false) $$, 'set_seller_mode(false) succeeds');
select is((select is_seller from public.profiles where id = '00000000-0000-0000-0000-000000000506'), false,
  'set_seller_mode(false) clears is_seller');
select is((public.get_my_business()->>'is_listed')::boolean, false,
  'set_seller_mode(false) unlists the business (kept in sync)');
select lives_ok($$ select public.set_seller_mode(true) $$, 'set_seller_mode(true) succeeds');
select is((select is_seller from public.profiles where id = '00000000-0000-0000-0000-000000000506'), true,
  'set_seller_mode(true) sets is_seller again');
select is((public.get_my_business()->>'is_listed')::boolean, true,
  'set_seller_mode(true) lists the business again');

-- Seller mode off hides a located business from anon; on restores it.
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000501","role":"authenticated"}';
select lives_ok($$ select public.set_seller_mode(false) $$, 'owner A switches seller mode off');
reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select is(
  (select count(*)::int from public.businesses where id = '00000000-0000-0000-0000-0000000005a1'),
  0, 'anon cannot see the business while seller mode is off');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000501","role":"authenticated"}';
select lives_ok($$ select public.set_seller_mode(true) $$, 'owner A switches seller mode back on');
reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select is(
  (select count(*)::int from public.businesses where id = '00000000-0000-0000-0000-0000000005a1'),
  1, 'anon sees the business again once seller mode is back on');
reset role;

-- ── Approximate location: 50 homemade businesses ────────────────────────────
insert into auth.users (id, email)
select ('00000000-0000-0000-0005-' || lpad(i::text, 12, '0'))::uuid, 'bulk' || i || '@example.test'
  from generate_series(1, 50) i;
update public.profiles set username = 'bulk_' || right(id::text, 2)
 where id::text like '00000000-0000-0000-0005-%';
insert into public.businesses (owner_id, type, name, cuisine_code)
select ('00000000-0000-0000-0005-' || lpad(i::text, 12, '0'))::uuid, 'homemade', 'Bulk ' || i, 'IT'
  from generate_series(1, 50) i;

create temp view bulk_dist as
select b.owner_id, b.map_lat, b.map_lng, b.public_address, l.lat, l.lng,
       2 * 6371008.8 * asin(sqrt(
         power(sin(radians(b.map_lat - l.lat) / 2), 2)
         + cos(radians(l.lat)) * cos(radians(b.map_lat)) * power(sin(radians(b.map_lng - l.lng) / 2), 2)
       )) as metres
  from public.businesses b
  join public.business_locations l on l.business_id = b.id
 where b.owner_id::text like '00000000-0000-0000-0005-%';

select is(
  (select count(*)::int from public.businesses where owner_id::text like '00000000-0000-0000-0005-%'),
  50, 'fixture: 50 homemade businesses exist');

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok(
  $$ select public.set_business_location(
       ('00000000-0000-0000-0005-' || lpad(i::text, 12, '0'))::uuid,
       'bulk_place_' || i, 'Addr ' || i,
       (43.65 + i * 0.0001)::float8, (-79.38 + i * 0.0001)::float8)
       from generate_series(1, 50) i $$,
  'service_role saves a location for each of 50 homemade businesses');
reset role;

select is(
  (select count(*)::int from bulk_dist where metres between 199 and 501),
  50, 'all 50 shifted map points are between 199 m and 501 m from the exact point');
select is(
  (select count(*)::int from bulk_dist where map_lat = lat and map_lng = lng),
  0, 'no shifted map point equals the exact point');
select is(
  (select count(*)::int from bulk_dist where public_address is not null),
  0, 'homemade public_address stays null');

-- Stability: business 1 (exact 43.6501, -79.3799, place bulk_place_1).
create temp table snap as
select map_lat, map_lng from public.businesses
 where owner_id = '00000000-0000-0000-0005-000000000001';

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(
  r->'location'->>'formatted_address', 'Addr 1',
  'set_business_location returns the owner view with location.formatted_address')
from (select public.set_business_location('00000000-0000-0000-0005-000000000001',
        'bulk_place_1', 'Addr 1', 43.6501, -79.3799) as r) s;
select ok(
  r ? 'id' and r ? 'is_listed' and r ? 'location' and not (r ? 'owner_id'),
  'set_business_location returns the get_my_business shape without owner_id')
from (select public.set_business_location('00000000-0000-0000-0005-000000000001',
        'bulk_place_1', 'Addr 1', 43.6501, -79.3799) as r) s;
reset role;
select results_eq(
  $$ select map_lat, map_lng from public.businesses where owner_id = '00000000-0000-0000-0005-000000000001' $$,
  $$ select map_lat, map_lng from snap $$,
  'saving the same place_id and coordinates leaves the map point unchanged');

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok(
  $$ select public.set_business_location('00000000-0000-0000-0005-000000000001',
       'bulk_place_1', 'Addr 1', 43.65011, -79.37989) $$,
  'saving the same place_id with slightly different coordinates succeeds');
reset role;
select results_eq(
  $$ select map_lat, map_lng from public.businesses where owner_id = '00000000-0000-0000-0005-000000000001' $$,
  $$ select map_lat, map_lng from snap $$,
  'same place_id with different coordinates leaves the map point unchanged');
select is(
  (select l.lat from public.business_locations l
     join public.businesses b on b.id = l.business_id
    where b.owner_id = '00000000-0000-0000-0005-000000000001'),
  43.65011::float8,
  'the exact coordinates are refreshed for the same place_id');

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok(
  $$ select public.set_business_location('00000000-0000-0000-0005-000000000001',
       'bulk_place_new', 'Elsewhere 9', 43.70, -79.45) $$,
  'saving a new place_id succeeds');
reset role;
select ok(
  (select (b.map_lat, b.map_lng) is distinct from (s.map_lat, s.map_lng)
     from public.businesses b, snap s
    where b.owner_id = '00000000-0000-0000-0005-000000000001'),
  'a new place_id changes the map point');
select ok(
  (select metres between 199 and 501 from bulk_dist where owner_id = '00000000-0000-0000-0005-000000000001'),
  'the re-rolled point is again 199-501 m from the new exact point');

-- ── Shift edges: date line and pole (20 homemade sellers per case) ──────────
-- Group 6: lng  179.9995, group 7: lng -179.9995, group 8: lat 89.9. The shift is random, so
-- every row must satisfy the assertions (not an average).
insert into auth.users (id, email)
select ('00000000-0000-0000-000' || g || '-' || lpad(i::text, 12, '0'))::uuid, 'edge' || g || '_' || i || '@example.test'
  from generate_series(6, 8) g, generate_series(1, 20) i;
update public.profiles set username = 'e' || substr(id::text, 20, 4) || '_' || right(id::text, 2)
 where id::text ~ '^00000000-0000-0000-000[678]-';
insert into public.businesses (id, owner_id, type, name, cuisine_code)
select ('00000000-0000-0000-001' || g || '-' || lpad(i::text, 12, '0'))::uuid,
       ('00000000-0000-0000-000' || g || '-' || lpad(i::text, 12, '0'))::uuid,
       'homemade', 'Edge ' || g || '-' || i, 'IT'
  from generate_series(6, 8) g, generate_series(1, 20) i;

create temp view edge_dist as
select substr(b.owner_id::text, 20, 4) as grp, b.map_lat, b.map_lng, l.lat, l.lng,
       2 * 6371008.8 * asin(sqrt(
         power(sin(radians(b.map_lat - l.lat) / 2), 2)
         + cos(radians(l.lat)) * cos(radians(b.map_lat)) * power(sin(radians(b.map_lng - l.lng) / 2), 2)
       )) as metres
  from public.businesses b
  join public.business_locations l on l.business_id = b.id
 where b.owner_id::text ~ '^00000000-0000-0000-000[678]-';

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok(
  $$ select public.set_business_location(
       ('00000000-0000-0000-0006-' || lpad(i::text, 12, '0'))::uuid,
       'edge_e_' || i, 'East ' || i, (10 + i * 0.01)::float8, 179.9995::float8)
       from generate_series(1, 20) i $$,
  'service_role saves 20 homemade locations at lng 179.9995');
select lives_ok(
  $$ select public.set_business_location(
       ('00000000-0000-0000-0007-' || lpad(i::text, 12, '0'))::uuid,
       'edge_w_' || i, 'West ' || i, (10 + i * 0.01)::float8, (-179.9995)::float8)
       from generate_series(1, 20) i $$,
  'service_role saves 20 homemade locations at lng -179.9995');
select lives_ok(
  $$ select public.set_business_location(
       ('00000000-0000-0000-0008-' || lpad(i::text, 12, '0'))::uuid,
       'edge_n_' || i, 'North ' || i, 89.9::float8, (i * 0.01)::float8)
       from generate_series(1, 20) i $$,
  'service_role saves 20 homemade locations at lat 89.9');
reset role;

select is(
  (select count(*)::int from edge_dist
    where grp = '0006' and map_lat between -90 and 90 and map_lng between -180 and 180),
  20, 'lng 179.9995: every stored point is inside the coordinate ranges');
select is(
  (select count(*)::int from edge_dist where grp = '0006' and metres between 199 and 501),
  20, 'lng 179.9995: every stored point is 199-501 m from the exact point (wrap across the date line)');
select is(
  (select count(*)::int from edge_dist
    where grp = '0007' and map_lat between -90 and 90 and map_lng between -180 and 180),
  20, 'lng -179.9995: every stored point is inside the coordinate ranges');
select is(
  (select count(*)::int from edge_dist where grp = '0007' and metres between 199 and 501),
  20, 'lng -179.9995: every stored point is 199-501 m from the exact point (wrap across the date line)');
select is(
  (select count(*)::int from edge_dist
    where grp = '0008' and map_lat between -90 and 90 and map_lng between -180 and 180),
  20, 'lat 89.9: every stored point is inside the coordinate ranges');
select is(
  (select count(*)::int from edge_dist where grp = '0008' and (map_lat, map_lng) is distinct from (lat, lng)),
  20, 'lat 89.9: no stored point equals the exact point');

-- Restaurant: public point is exact, public_address is the formatted address.
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok(
  $$ select public.set_business_location('00000000-0000-0000-0000-000000000501',
       'pR', 'Restaurant Rd 5, Toronto', 43.6532, -79.3832) $$,
  'service_role saves a restaurant location');
reset role;
select results_eq(
  $$ select map_lat, map_lng from public.businesses where id = '00000000-0000-0000-0000-0000000005a1' $$,
  $$ values (43.6532::float8, -79.3832::float8) $$,
  'restaurant map point equals the exact point');
select is(
  (select public_address from public.businesses where id = '00000000-0000-0000-0000-0000000005a1'),
  'Restaurant Rd 5, Toronto',
  'restaurant public_address equals the formatted address');

-- No business.
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select throws_ok(
  $$ select public.set_business_location('00000000-0000-0000-0000-000000000502', 'x', 'x', 1, 1) $$,
  'P0001', 'no_business', 'set_business_location fails with no_business when the owner has none');
reset role;

-- ── consume_places_quota ────────────────────────────────────────────────────
-- Same transaction => same now() => same minute window.
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select throws_ok(
  $$ select public.consume_places_quota('00000000-0000-0000-0000-000000000507', 'geocode') $$,
  'P0001', 'invalid_kind', 'consume_places_quota rejects an unknown kind with invalid_kind');
select is(
  (select (count(*) filter (where r))::int from (
     select public.consume_places_quota('00000000-0000-0000-0000-000000000507', 'autocomplete') as r
       from generate_series(1, 30)) s),
  30, 'the first 30 autocomplete calls in a minute return true');
select is(public.consume_places_quota('00000000-0000-0000-0000-000000000507', 'autocomplete'), false,
  'the 31st autocomplete call in a minute returns false');
select is(public.consume_places_quota('00000000-0000-0000-0000-000000000507', 'resolve'), true,
  'the resolve quota is counted separately from autocomplete');

select is(
  (select (count(*) filter (where r))::int from (
     select public.consume_places_quota('00000000-0000-0000-0000-000000000508', 'resolve') as r
       from generate_series(1, 5)) s),
  5, 'the first 5 resolve calls in a minute return true');
reset role;
select is(
  (select count from public.places_rate_limits
    where user_id = '00000000-0000-0000-0000-000000000508' and kind = 'resolve'
      and window_kind = 'minute' and window_start = date_trunc('minute', now(), 'UTC')),
  5, 'the minute window row counts 5 resolve calls');
select is(
  (select count from public.places_rate_limits
    where user_id = '00000000-0000-0000-0000-000000000508' and kind = 'resolve'
      and window_kind = 'day' and window_start = date_trunc('day', now(), 'UTC')),
  5, 'the day window row counts 5 resolve calls');
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.consume_places_quota('00000000-0000-0000-0000-000000000508', 'resolve'), false,
  'the 6th resolve call in a minute returns false');
reset role;

-- Day window.
insert into public.places_rate_limits (user_id, kind, window_start, window_kind, count) values
  ('00000000-0000-0000-0000-000000000509', 'autocomplete', date_trunc('day', now(), 'UTC'), 'day', 100),
  ('00000000-0000-0000-0000-000000000510', 'autocomplete', date_trunc('day', now(), 'UTC'), 'day', 99);
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.consume_places_quota('00000000-0000-0000-0000-000000000509', 'autocomplete'), false,
  'autocomplete returns false once the day window is at 100');
select is(public.consume_places_quota('00000000-0000-0000-0000-000000000510', 'autocomplete'), true,
  'the 100th autocomplete call of the day returns true');
select is(public.consume_places_quota('00000000-0000-0000-0000-000000000510', 'autocomplete'), false,
  'the 101st autocomplete call of the day returns false');
reset role;

-- Resolve day limit (5/day) and the minute window rolling over while the day carries on.
insert into public.places_rate_limits (user_id, kind, window_start, window_kind, count) values
  ('00000000-0000-0000-0000-000000000518', 'resolve', date_trunc('day', now(), 'UTC'), 'day', 5),
  ('00000000-0000-0000-0000-000000000516', 'autocomplete', date_trunc('minute', now() - interval '1 minute', 'UTC'), 'minute', 30),
  ('00000000-0000-0000-0000-000000000516', 'autocomplete', date_trunc('day', now(), 'UTC'), 'day', 50),
  ('00000000-0000-0000-0000-000000000517', 'autocomplete', date_trunc('day', now(), 'UTC'), 'day', 100);
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.consume_places_quota('00000000-0000-0000-0000-000000000518', 'resolve'), false,
  'resolve returns false once the day window is at 5');
select is(public.consume_places_quota('00000000-0000-0000-0000-000000000516', 'autocomplete'), true,
  'a previous-minute row at the limit does not block the next minute while the day is under its limit');
select is(public.consume_places_quota('00000000-0000-0000-0000-000000000517', 'autocomplete'), false,
  'a day row at the limit returns false even with no current-minute row');

-- Calls refused by the minute limit still count toward the day.
select is(
  (select (count(*) filter (where r))::text || '/' || (count(*) filter (where not r))::text from (
     select public.consume_places_quota('00000000-0000-0000-0000-000000000519', 'autocomplete') as r
       from generate_series(1, 35)) s),
  '30/5', '35 autocomplete calls in a minute: 30 return true, 5 return false');
reset role;
select is(
  (select count from public.places_rate_limits
    where user_id = '00000000-0000-0000-0000-000000000519' and kind = 'autocomplete'
      and window_kind = 'day' and window_start = date_trunc('day', now(), 'UTC')),
  35, 'the day count keeps increasing after the minute limit is passed');

-- Eligibility (Decision 19): refused before anything is counted.
-- E (0505) has no username and no business; 0515 has a username and no business.
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select throws_ok(
  $$ select public.consume_places_quota('00000000-0000-0000-0000-000000000505', 'autocomplete') $$,
  'P0001', 'profile_incomplete', 'autocomplete without a username raises profile_incomplete');
select throws_ok(
  $$ select public.consume_places_quota('00000000-0000-0000-0000-000000000505', 'resolve') $$,
  'P0001', 'profile_incomplete', 'resolve without a username raises profile_incomplete');
select throws_ok(
  $$ select public.consume_places_quota('00000000-0000-0000-0000-000000000515', 'resolve') $$,
  'P0001', 'no_business', 'resolve with a username but no business raises no_business');
select is(public.consume_places_quota('00000000-0000-0000-0000-000000000515', 'autocomplete'), true,
  'autocomplete still returns true for a user with a username and no business');
reset role;
select is(
  (select count(*)::int from public.places_rate_limits
    where user_id = '00000000-0000-0000-0000-000000000505'),
  0, 'refused calls for a user without a username count nothing');
select is(
  (select count(*)::int from public.places_rate_limits
    where user_id = '00000000-0000-0000-0000-000000000515' and kind = 'resolve'),
  0, 'a refused resolve call for a user without a business counts nothing');

-- Old windows are cleaned up for the calling user only.
insert into public.places_rate_limits (user_id, kind, window_start, window_kind, count) values
  ('00000000-0000-0000-0000-000000000511', 'autocomplete', date_trunc('day', now() - interval '3 days', 'UTC'), 'day', 5),
  ('00000000-0000-0000-0000-000000000512', 'autocomplete', date_trunc('day', now() - interval '3 days', 'UTC'), 'day', 5);
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok(
  $$ select public.consume_places_quota('00000000-0000-0000-0000-000000000511', 'autocomplete') $$,
  'a quota call by a user with an old window succeeds');
reset role;
select is(
  (select count(*)::int from public.places_rate_limits
    where user_id = '00000000-0000-0000-0000-000000000511' and window_start < now() - interval '2 days'),
  0, 'windows older than 2 days are deleted on a call');
select is(
  (select count(*)::int from public.places_rate_limits
    where user_id = '00000000-0000-0000-0000-000000000512' and window_start < now() - interval '2 days'),
  1, 'another user''s old windows are not touched');

select * from finish();
rollback;
