-- Spec 16 (PR 1): promotions backend - closed tables, seller functions, admin review, Offers list,
-- the offers quota and the promoted / sponsored flags on the map reads.
-- now() is fixed for the whole transaction, so every window below is exact.
begin;
select plan(208);

-- -- Ids ----------------------------------------------------------------------
-- Users 00000000-0000-0000-0016-<n>, businesses ...-0116-<n>, promotions ...-0216-<n> (n = 12 digits).
create function pg_temp.u(n int) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0016-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.b(n int) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0116-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.p(n int) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0216-' || lpad(n::text, 12, '0'))::uuid $$;

-- Kilometres due north of a point, in degrees of latitude (the same earth radius as the function).
create function pg_temp.km(d double precision) returns double precision language sql immutable as $$
  select d / 111.19508 $$;

create function pg_temp.utc_day(shift int default 0) returns text language sql stable as $$
  select to_char((now() at time zone 'UTC')::date + shift, 'YYYY-MM-DD') $$;

create function pg_temp.keys(j jsonb) returns text[] language sql immutable as $$
  select coalesce(array_agg(k order by k collate "C"), array[]::text[]) from jsonb_object_keys(j) k $$;

-- One owner and business. lat null = no map point and no saved address. dx = how far the exact
-- address is from the map point (homemade only; restaurants show their exact point).
create function pg_temp.mkb(n int, t text, lat double precision, lng double precision,
                            listed boolean default true, age interval default '1 day',
                            st text default 'ok', tables boolean default false, dx double precision default 0)
returns void language plpgsql as $$
begin
  insert into auth.users (id, email) values (pg_temp.u(n), 'promo' || n || '@example.test');
  insert into public.businesses (id, owner_id, type, name, cuisine_code, accepts_table_requests,
                                 map_lat, map_lng, public_address, is_listed)
  values (pg_temp.b(n), pg_temp.u(n), t, 'Place ' || n, 'IT', tables, lat, lng,
          case when t = 'restaurant' and lat is not null then n || ' Exact St' end, listed);
  if lat is not null then
    insert into public.business_locations (business_id, place_id, formatted_address, lat, lng, resolved_at, place_status)
    values (pg_temp.b(n), 'pl' || n, n || ' Exact St', lat + dx, lng + dx, now() - age, st);
  end if;
end $$;

-- One campaign row written directly (fixtures only). Windows are offsets from now().
create function pg_temp.mkp(n int, biz int, st text, s interval default null, e interval default null,
                            cat text default 'new_dish')
returns void language sql as $$
  insert into public.promotions (id, business_id, category, headline, status, price_cents, currency_code,
                                 length_days, starts_at, ends_at, reject_reason, cancelled_by, cancelled_at,
                                 created_at)
  values (pg_temp.p(n), pg_temp.b(biz), cat, 'Fixture headline ' || n, st, 2500, 'CAD', 7,
          now() + s, now() + e,
          case when st = 'rejected' then 'other' end,
          case when st = 'cancelled' then 'admin' end,
          case when st = 'cancelled' then now() - interval '1 day' end,
          now() - interval '30 days');
$$;

create function pg_temp.as_user(n int) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', pg_temp.u(n)), true);
end $$;

-- The Offers call and its ids, in answer order.
create function pg_temp.offers(lat double precision, lng double precision, dist int, cat text default null,
                               typ text default null, tables boolean default null, cur text default null)
returns jsonb language sql as $$
  select public.list_offers_near(lat, lng, dist, cat, typ, tables, cur) $$;
create function pg_temp.ids(j jsonb) returns uuid[] language sql immutable as $$
  select coalesce(array_agg((o ->> 'business_id')::uuid order by i), array[]::uuid[])
    from jsonb_array_elements(j -> 'offers') with ordinality e(o, i) $$;
create function pg_temp.pin_promoted(j jsonb, id uuid) returns boolean language sql immutable as $$
  select (p ->> 'promoted')::boolean from jsonb_array_elements(j -> 'pins') p where (p ->> 'id')::uuid = id $$;

-- -- Fixtures (as postgres) ---------------------------------------------------
-- Area A, Offers content, around the grid point (-40.00, -120.00); distances due north.
--  1 restaurant 1 km, active, new_dish, takes tables, cover   2 homemade 2 km, active, special_offer, shifted
--  3 scheduled 1 km   4 ended 1 km   5 requested 1 km   6 rejected 1 km   7 cancelled (was active) 1 km
--  8 unlisted, active   9 stale (31 days), active   10 no map point, active
-- 11 active 10 km featured   12 active 20 km   13 active 8 km   15 active 1 km (cancelled by its seller in group 7)
-- 16 homemade 3 km, no campaign
select pg_temp.mkb(1, 'restaurant', -40 + pg_temp.km(1), -120, tables => true);
select pg_temp.mkb(2, 'homemade', -40 + pg_temp.km(2), -120, dx => 0.003);
select pg_temp.mkb(n, 'restaurant', -40 + pg_temp.km(1), -120 - n * 0.0001) from generate_series(3, 7) n;
select pg_temp.mkb(8, 'restaurant', -40 + pg_temp.km(1), -120.0008, listed => false);
select pg_temp.mkb(9, 'restaurant', -40 + pg_temp.km(1), -120.0009, age => '31 days');
select pg_temp.mkb(10, 'restaurant', null, null);
select pg_temp.mkb(11, 'restaurant', -40 + pg_temp.km(10), -120);
select pg_temp.mkb(12, 'restaurant', -40 + pg_temp.km(20), -120);
select pg_temp.mkb(13, 'restaurant', -40 + pg_temp.km(8), -120);
select pg_temp.mkb(15, 'restaurant', -40 + pg_temp.km(1), -120.0015);
select pg_temp.mkb(16, 'homemade', -40 + pg_temp.km(3), -120, dx => 0.003);
select pg_temp.mkp(1, 1, 'approved', '-1 day', '6 days', 'new_dish');
select pg_temp.mkp(2, 2, 'approved', '-1 day', '6 days', 'special_offer');
select pg_temp.mkp(3, 3, 'approved', '2 days', '9 days');
select pg_temp.mkp(4, 4, 'approved', '-10 days', '-3 days');
select pg_temp.mkp(5, 5, 'requested');
select pg_temp.mkp(6, 6, 'rejected');
select pg_temp.mkp(7, 7, 'cancelled', '-1 day', '6 days');
select pg_temp.mkp(8, 8, 'approved', '-1 day', '6 days');
select pg_temp.mkp(9, 9, 'approved', '-1 day', '6 days');
select pg_temp.mkp(10, 10, 'approved', '-1 day', '6 days');
select pg_temp.mkp(11, 11, 'approved', '-1 day', '6 days', 'featured');
select pg_temp.mkp(12, 12, 'approved', '-1 day', '6 days');
select pg_temp.mkp(13, 13, 'approved', '-1 day', '6 days');
select pg_temp.mkp(15, 15, 'approved', '-1 day', '6 days');
insert into public.business_photos (id, business_id, kind, status, position, path) values
  ('00000000-0000-0000-0316-000000000001', pg_temp.b(1), 'cover', 'ready', null,
   pg_temp.b(1) || '/00000000-0000-0000-0316-000000000001.jpg');

-- Sellers (area L, far from every Offers point): 20 restaurant, 21 homemade, 22 unlisted, 23 no map point,
-- 24 stale restaurant, 25 stale homemade, 26 place not_found, 27 outsider (no business), 28 eligible, no campaign.
-- 30-35 change 1, 40-48 admin review, 50-55 seller cancel.
select pg_temp.mkb(20, 'restaurant', 10.20, 10);
select pg_temp.mkb(21, 'homemade', 10.21, 10, dx => 0.003);
select pg_temp.mkb(22, 'restaurant', 10.22, 10, listed => false);
select pg_temp.mkb(23, 'restaurant', null, null);
select pg_temp.mkb(24, 'restaurant', 10.24, 10, age => '31 days');
select pg_temp.mkb(25, 'homemade', 10.25, 10, age => '31 days');
select pg_temp.mkb(26, 'restaurant', 10.26, 10, st => 'not_found');
insert into auth.users (id, email) values (pg_temp.u(27), 'promo27@example.test');
select pg_temp.mkb(n, 'restaurant', 10 + n * 0.01, 11) from generate_series(28, 55) n where n not in (29, 36, 37, 38, 39, 49);
select pg_temp.mkp(300, 30, 'approved', '-10 days', '-3 days');
select pg_temp.mkp(310, 31, 'approved', '2 days', '9 days');
select pg_temp.mkp(320, 32, 'approved', '-1 day', '6 days');
select pg_temp.mkp(330, 33, 'approved', '1 day', '8 days');
select pg_temp.mkp(331, 33, 'requested');
select pg_temp.mkp(340, 34, 'rejected');
select pg_temp.mkp(350, 35, 'cancelled', '-1 day', '6 days');
select pg_temp.mkp(n, n, 'requested') from generate_series(40, 47) n;
select pg_temp.mkp(48, 48, 'approved', '-10 days', '-3 days');
select pg_temp.mkp(50, 50, 'requested');
select pg_temp.mkp(51, 51, 'approved', '2 days', '9 days');
select pg_temp.mkp(52, 52, 'approved', '-1 day', '6 days');
select pg_temp.mkp(53, 53, 'approved', '-10 days', '-3 days');
select pg_temp.mkp(54, 54, 'rejected');
select pg_temp.mkp(55, 55, 'cancelled');

-- Paging: 45 active restaurants near the grid point (-30.00, -110.00), in all three bands.
insert into auth.users (id, email)
select pg_temp.u(1000 + i), 'promo' || (1000 + i) || '@example.test' from generate_series(1, 45) i;
insert into public.businesses (id, owner_id, type, name, cuisine_code, map_lat, map_lng, public_address)
select pg_temp.b(1000 + i), pg_temp.u(1000 + i), 'restaurant', 'Page ' || i, 'IT',
       -30 + pg_temp.km(case i % 3 when 0 then 1 when 1 then 7 else 20 end + i * 0.01), -110, 'Page St ' || i
  from generate_series(1, 45) i;
insert into public.business_locations (business_id, place_id, formatted_address, lat, lng)
select b.id, 'pp' || b.name, b.public_address, b.map_lat, b.map_lng
  from public.businesses b where b.id in (select pg_temp.b(1000 + i) from generate_series(1, 45) i);
select pg_temp.mkp(1000 + i, 1000 + i, 'approved', '-1 day', '6 days') from generate_series(1, 45) i;

-- Cap: 502 fresh restaurants (box lat -20..-19.7, lng -90..-89.7) and 502 fresh homemade cooks
-- (lat -10..-9.7, lng -80..-79.7). In each, only the highest id is promoted.
insert into auth.users (id, email)
select pg_temp.u(n), 'promo' || n || '@example.test'
  from (select generate_series(2001, 2502) union all select generate_series(3001, 3502)) g(n);
insert into public.businesses (id, owner_id, type, name, cuisine_code, map_lat, map_lng, public_address)
select pg_temp.b(2000 + i), pg_temp.u(2000 + i), 'restaurant', 'Cap ' || i, 'IT',
       -20 + i * 0.0005, -90 + i * 0.0005, 'Cap St ' || i
  from generate_series(1, 502) i
union all
select pg_temp.b(3000 + i), pg_temp.u(3000 + i), 'homemade', 'Cook ' || i, 'IT',
       -10 + i * 0.0005, -80 + i * 0.0005, null
  from generate_series(1, 502) i;
insert into public.business_locations (business_id, place_id, formatted_address, lat, lng)
select b.id, 'pc' || b.name, 'Cap address', b.map_lat, b.map_lng
  from public.businesses b
 where b.id in (select pg_temp.b(n) from generate_series(2001, 2502) n
                union all select pg_temp.b(n) from generate_series(3001, 3502) n);
select pg_temp.mkp(2502, 2502, 'approved', '-1 day', '6 days');
select pg_temp.mkp(3502, 3502, 'approved', '-1 day', '6 days');

-- Settings: this file's own row, independent of seed.sql.
delete from public.promotion_settings;
insert into public.promotion_settings (price_cents, currency_code, length_days) values (2500, 'CAD', 7);
delete from public.map_rate_limits;    -- dev data must not count toward the limits below

-- -- 1. Structure and privileges (18) -----------------------------------------
select has_table('public', 'promotions', 'promotions exists');
select has_table('public', 'promotion_settings', 'promotion_settings exists');
select ok((select relrowsecurity from pg_class where oid = 'public.promotions'::regclass), 'RLS is enabled on promotions');
select ok((select relrowsecurity from pg_class where oid = 'public.promotion_settings'::regclass),
  'RLS is enabled on promotion_settings');
select table_privs_are('public', 'promotions', 'anon', array[]::text[], 'anon has no privileges on promotions');
select table_privs_are('public', 'promotions', 'authenticated', array[]::text[],
  'authenticated has no privileges on promotions');
select table_privs_are('public', 'promotion_settings', 'anon', array[]::text[],
  'anon has no privileges on promotion_settings');
select table_privs_are('public', 'promotion_settings', 'authenticated', array[]::text[],
  'authenticated has no privileges on promotion_settings');
select ok(not has_any_column_privilege('anon', 'public.promotions', 'SELECT, INSERT, UPDATE, REFERENCES'),
  'anon has no column privileges on promotions');
select ok(not has_any_column_privilege('authenticated', 'public.promotions', 'SELECT, INSERT, UPDATE, REFERENCES'),
  'authenticated has no column privileges on promotions');
select ok(not has_any_column_privilege('anon', 'public.promotion_settings', 'SELECT, INSERT, UPDATE, REFERENCES'),
  'anon has no column privileges on promotion_settings');
select ok(not has_any_column_privilege('authenticated', 'public.promotion_settings', 'SELECT, INSERT, UPDATE, REFERENCES'),
  'authenticated has no column privileges on promotion_settings');
select policies_are('public', 'promotions', array[]::name[], 'promotions has no policies (function access only)');
select policies_are('public', 'promotion_settings', array[]::name[],
  'promotion_settings has no policies (function access only)');
select ok(exists (select 1 from pg_extension e join pg_namespace n on n.oid = e.extnamespace
                   where e.extname = 'btree_gist' and n.nspname = 'extensions'),
  'btree_gist is installed in the extensions schema');
select is((select contype::text from pg_constraint
            where conrelid = 'public.promotions'::regclass and conname = 'promotions_no_overlap'),
  'x', 'promotions_no_overlap is an exclusion constraint');
select ok((select i.indisunique and i.indpred is not null from pg_index i
            where i.indexrelid = to_regclass('public.promotions_one_request')),
  'promotions_one_request is a unique partial index');
select is((select pg_get_constraintdef(oid) from pg_constraint
            where conrelid = 'public.promotions'::regclass and conname = 'promotions_cancel_fields'),
  'CHECK ((((status = ''cancelled''::text) = (cancelled_by IS NOT NULL)) AND ((cancelled_by IS NULL) = (cancelled_at IS NULL))))',
  'promotions_cancel_fields ties the status, cancelled_by and cancelled_at together');

-- -- 2. Function security (16) ------------------------------------------------
select ok(has_function_privilege('authenticated', 'public.request_promotion(text, text, date)', 'execute'),
  'authenticated can execute request_promotion');
select ok(has_function_privilege('authenticated', 'public.cancel_my_promotion(uuid)', 'execute'),
  'authenticated can execute cancel_my_promotion');
select ok(has_function_privilege('authenticated', 'public.get_my_promotion()', 'execute'),
  'authenticated can execute get_my_promotion');
select ok(not has_function_privilege('anon', 'public.request_promotion(text, text, date)', 'execute'),
  'anon cannot execute request_promotion');
select ok(not has_function_privilege('anon', 'public.cancel_my_promotion(uuid)', 'execute'),
  'anon cannot execute cancel_my_promotion');
select ok(not has_function_privilege('anon', 'public.get_my_promotion()', 'execute'),
  'anon cannot execute get_my_promotion');
select ok(has_function_privilege('anon',
            'public.list_offers_near(double precision, double precision, integer, text, text, boolean, text)', 'execute'),
  'anon can execute list_offers_near');
select ok(has_function_privilege('authenticated',
            'public.list_offers_near(double precision, double precision, integer, text, text, boolean, text)', 'execute'),
  'authenticated can execute list_offers_near');
select is_empty(
  $$ select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'private'
        and p.proname in ('admin_review_promotion', 'promotion_is_active', 'business_can_promote', 'promotion_json')
        and (has_function_privilege('anon', p.oid, 'execute')
             or has_function_privilege('authenticated', p.oid, 'execute')
             or has_function_privilege('service_role', p.oid, 'execute')) $$,
  'no private promotion function is executable by anon, authenticated or service_role');
select ok(
  (select bool_and(p.prosecdef and p.proconfig @> array['search_path=""']) and count(*) = 8
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where (n.nspname = 'public' and p.proname in ('request_promotion', 'cancel_my_promotion', 'get_my_promotion', 'list_offers_near'))
       or (n.nspname = 'private' and p.proname in ('admin_review_promotion', 'promotion_is_active', 'business_can_promote', 'promotion_json'))),
  'the eight new functions are security definer with an empty search_path');
select ok(
  (select p.proconfig @> array['statement_timeout=3s'] from pg_proc p where p.oid =
     'public.list_offers_near(double precision, double precision, integer, text, text, boolean, text)'::regprocedure),
  'list_offers_near has a 3 s statement_timeout');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('map_restaurants_in_bounds', 'map_homemade_in_bounds', 'get_restaurant_details', 'get_homemade_details',
                        'request_promotion', 'cancel_my_promotion', 'get_my_promotion', 'list_offers_near')),
  8, 'exactly one of each replaced map function and each new public function exists');

set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok($$ select private.admin_review_promotion(pg_temp.p(5), 'approve', now()) $$, '42501', null,
  'anon cannot call private.admin_review_promotion');
select throws_ok($$ select private.promotion_is_active(pg_temp.b(1)) $$, '42501', null,
  'anon cannot call private.promotion_is_active');
reset role;
set local role authenticated;
select pg_temp.as_user(20);
select throws_ok($$ select private.admin_review_promotion(pg_temp.p(5), 'approve', now()) $$, '42501', null,
  'authenticated cannot call private.admin_review_promotion');
select throws_ok($$ select private.promotion_is_active(pg_temp.b(1)) $$, '42501', null,
  'authenticated cannot call private.promotion_is_active');

-- -- 3. Direct table access refused (16) --------------------------------------
select throws_ok($$ select * from public.promotions $$, '42501', null, 'authenticated cannot read promotions');
select throws_ok($$ insert into public.promotions (business_id, category, headline, price_cents, currency_code, length_days)
                    values (pg_temp.b(20), 'featured', 'Free', 1, 'CAD', 7) $$, '42501', null,
  'authenticated cannot insert a promotion directly');
select throws_ok($$ update public.promotions set status = 'approved' $$, '42501', null,
  'authenticated cannot update promotions (status, review fields)');
select throws_ok($$ delete from public.promotions $$, '42501', null, 'authenticated cannot delete promotions');
select throws_ok($$ select * from public.promotion_settings $$, '42501', null, 'authenticated cannot read promotion_settings');
select throws_ok($$ insert into public.promotion_settings (id, price_cents, currency_code, length_days) values (true, 1, 'CAD', 7) $$,
  '42501', null, 'authenticated cannot insert settings');
select throws_ok($$ update public.promotion_settings set price_cents = 1 $$, '42501', null,
  'authenticated cannot change the price');
select throws_ok($$ delete from public.promotion_settings $$, '42501', null, 'authenticated cannot delete settings');
reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok($$ select * from public.promotions $$, '42501', null, 'anon cannot read promotions');
select throws_ok($$ insert into public.promotions (business_id, category, headline, price_cents, currency_code, length_days)
                    values (pg_temp.b(20), 'featured', 'Free', 1, 'CAD', 7) $$, '42501', null,
  'anon cannot insert a promotion');
select throws_ok($$ update public.promotions set status = 'approved' $$, '42501', null, 'anon cannot update promotions');
select throws_ok($$ delete from public.promotions $$, '42501', null, 'anon cannot delete promotions');
select throws_ok($$ select * from public.promotion_settings $$, '42501', null, 'anon cannot read promotion_settings');
select throws_ok($$ insert into public.promotion_settings (id, price_cents, currency_code, length_days) values (true, 1, 'CAD', 7) $$,
  '42501', null, 'anon cannot insert settings');
select throws_ok($$ update public.promotion_settings set price_cents = 1 $$, '42501', null, 'anon cannot change the price');
select throws_ok($$ delete from public.promotion_settings $$, '42501', null, 'anon cannot delete settings');
reset role;

-- -- 4. request_promotion (28) ------------------------------------------------
select pg_temp.as_user(22);
select throws_ok($$ select public.request_promotion('featured', 'Hello', null) $$, 'P0001', 'not_eligible',
  'an unlisted business gets not_eligible');
select pg_temp.as_user(23);
select throws_ok($$ select public.request_promotion('featured', 'Hello', null) $$, 'P0001', 'not_eligible',
  'a business without a map point gets not_eligible');
select pg_temp.as_user(24);
select throws_ok($$ select public.request_promotion('featured', 'Hello', null) $$, 'P0001', 'not_eligible',
  'a stale restaurant (hidden by the 30-day guard) gets not_eligible');
select pg_temp.as_user(25);
select throws_ok($$ select public.request_promotion('featured', 'Hello', null) $$, 'P0001', 'not_eligible',
  'a stale homemade cook gets not_eligible');
select pg_temp.as_user(26);
select throws_ok($$ select public.request_promotion('featured', 'Hello', null) $$, 'P0001', 'not_eligible',
  'a place Google no longer knows gets not_eligible');
select pg_temp.as_user(27);
select throws_ok($$ select public.request_promotion('featured', 'Hello', null) $$, 'P0001', 'not_eligible',
  'a caller without a business (not an owner) gets not_eligible');

select pg_temp.as_user(20);
delete from public.promotion_settings;
select throws_ok($$ select public.request_promotion('featured', 'Hello', null) $$, 'P0001', 'not_configured',
  'no settings row gives not_configured');
insert into public.promotion_settings (price_cents, currency_code, length_days) values (2500, 'CAD', 7);

select throws_ok($$ select public.request_promotion('featured', '', null) $$, 'P0001', 'invalid_headline',
  'an empty headline is refused');
select throws_ok($$ select public.request_promotion('featured', repeat('a', 61), null) $$, 'P0001', 'invalid_headline',
  'a 61-character headline is refused');
select throws_ok($$ select public.request_promotion('featured', ' Hello', null) $$, 'P0001', 'invalid_headline',
  'a headline starting with a space is refused');
select throws_ok($$ select public.request_promotion('featured', E'Hello\u00A0', null) $$, 'P0001', 'invalid_headline',
  'a headline ending with a no-break space is refused');
select throws_ok($$ select public.request_promotion('featured', E'Hel\u0007lo', null) $$, 'P0001', 'invalid_headline',
  'a headline with a control character is refused');
select throws_ok($$ select public.request_promotion('featured', E'Hel\u200Blo', null) $$, 'P0001', 'invalid_headline',
  'a headline with a zero-width space is refused');
select throws_ok($$ select public.request_promotion('featured', E'Hel\u202Elo', null) $$, 'P0001', 'invalid_headline',
  'a headline with a bidi override is refused');
select throws_ok($$ select public.request_promotion(null, 'Hello', null) $$, 'P0001', 'invalid_category',
  'a missing category is refused');
select throws_ok($$ select public.request_promotion('free_stuff', 'Hello', null) $$, 'P0001', 'invalid_category',
  'an unknown category is refused');
select throws_ok($$ select public.request_promotion('featured', 'Hello', (now() at time zone 'UTC')::date - 2) $$,
  'P0001', 'invalid_start', 'a preferred start two days before the UTC date is refused');
select throws_ok($$ select public.request_promotion('featured', 'Hello', (now() at time zone 'UTC')::date + 91) $$,
  'P0001', 'invalid_start', 'a preferred start more than 90 days ahead is refused');

select pg_temp.as_user(21);
select lives_ok($$ select public.request_promotion('special_offer', repeat('b', 60), (now() at time zone 'UTC')::date - 1) $$,
  'a 60-character headline with a start one day before the UTC date is accepted (Ontario evening)');
do $$ begin perform public.cancel_my_promotion((select id from public.promotions where business_id = pg_temp.b(21) and status = 'requested')); end $$;
select lives_ok($$ select public.request_promotion('special_offer', 'Ninety', (now() at time zone 'UTC')::date + 90) $$,
  'a preferred start exactly 90 days ahead is accepted');
do $$ begin perform public.cancel_my_promotion((select id from public.promotions where business_id = pg_temp.b(21) and status = 'requested')); end $$;
select lives_ok($$ select public.request_promotion('special_offer', 'No date', null) $$,
  'no preferred start is accepted');
do $$ begin perform public.cancel_my_promotion((select id from public.promotions where business_id = pg_temp.b(21) and status = 'requested')); end $$;

select pg_temp.as_user(20);
create temp table req20 as select public.request_promotion('new_dish', 'Two for one on Tuesdays', null) as j;
select is(((select j from req20) -> 'promotion' ->> 'state'), 'requested', 'an eligible owner gets a requested campaign');
select results_eq(
  $$ select price_cents, currency_code, length_days, status, created_at = now()
       from public.promotions where business_id = pg_temp.b(20) $$,
  $$ values (2500, 'CAD'::text, 7, 'requested'::text, true) $$,
  'the stored row snapshots 2500 CAD and 7 days, with a server-set created_at');
select is(pg_temp.keys((select j from req20)), array['eligible', 'promotion', 'settings'],
  'request_promotion answers with eligible, promotion and settings');
select is(pg_temp.keys((select j from req20) -> 'promotion'),
  array['category', 'created_at', 'currency_code', 'ends_at', 'headline', 'id', 'length_days', 'preferred_start',
        'price_cents', 'reject_reason', 'starts_at', 'state'],
  'the promotion object has exactly the documented keys');
select is(pg_temp.keys((select j from req20) -> 'settings'), array['currency_code', 'length_days', 'price_cents'],
  'the settings object has exactly price, currency and length');
select is(pg_temp.keys((select j from req20)), pg_temp.keys(public.get_my_promotion()),
  'request_promotion answers with the same keys as get_my_promotion');
update public.promotion_settings set price_cents = 9900;
select is((select price_cents from public.promotions where business_id = pg_temp.b(20)), 2500,
  'a later price change leaves the snapshot alone');
update public.promotion_settings set price_cents = 2500;

-- -- 5. Change 1: one open campaign at a time, no overlap (10) -----------------
select pg_temp.as_user(30);
select lives_ok($$ select public.request_promotion('featured', 'Back again', null) $$,
  '(a) a request after an approved campaign has ended succeeds');
select pg_temp.as_user(31);
select throws_ok($$ select public.request_promotion('featured', 'Again', null) $$, 'P0001', 'already_open',
  '(b) a request while a scheduled campaign exists gets already_open');
select pg_temp.as_user(32);
select throws_ok($$ select public.request_promotion('featured', 'Again', null) $$, 'P0001', 'already_open',
  '(b) a request while an active campaign exists gets already_open');
select pg_temp.as_user(20);
select throws_ok($$ select public.request_promotion('featured', 'Again', null) $$, 'P0001', 'already_open',
  '(c) a second request while one is requested gets already_open');
select throws_ok($$ select private.admin_review_promotion(pg_temp.p(331), 'approve', now() + interval '3 days') $$,
  'P0001', 'overlap', '(d) approving a window that overlaps an approved one gives overlap');
select throws_ok($$ select pg_temp.mkp(332, 33, 'approved', '2 days', '4 days') $$, '23P01',
  'conflicting key value violates exclusion constraint "promotions_no_overlap"',
  '(d) an overlapping approved row is refused by the exclusion constraint itself');
select is(private.admin_review_promotion(pg_temp.p(331), 'approve', now() + interval '8 days') ->> 'state', 'scheduled',
  '(d) a back-to-back window (starting when the other ends) is allowed');
select throws_ok($$ select pg_temp.mkp(333, 20, 'requested') $$, '23505',
  'duplicate key value violates unique constraint "promotions_one_request"',
  '(e) a direct second requested row violates promotions_one_request (the race backstop)');
select pg_temp.as_user(34);
select lives_ok($$ select public.request_promotion('featured', 'After a no', null) $$,
  'a rejected campaign does not block a new request');
select pg_temp.as_user(35);
select lives_ok($$ select public.request_promotion('featured', 'After a cancel', null) $$,
  'a cancelled campaign does not block a new request');

-- -- 6. admin_review_promotion (23) -------------------------------------------
create temp table rev40 as select private.admin_review_promotion(pg_temp.p(40), 'approve', now() + interval '2 days') as j;
select is((select j ->> 'state' from rev40), 'scheduled', 'approving with a future start gives scheduled');
select results_eq(
  $$ select starts_at, ends_at, reviewed_at from public.promotions where id = pg_temp.p(40) $$,
  $$ values (now() + interval '2 days', now() + interval '9 days', now()) $$,
  'approval stores the start, ends_at = start + 7 days, and reviewed_at');
select is(pg_temp.keys((select j from rev40)), array['ends_at', 'id', 'starts_at', 'state'],
  'the admin answer has exactly id, state, starts_at and ends_at');
select is(private.admin_review_promotion(pg_temp.p(41), 'approve', now()) ->> 'state', 'active',
  'approving with start now gives active');
select is(private.admin_review_promotion(pg_temp.p(42), 'approve', now() - interval '59 minutes') ->> 'state', 'active',
  'a start 59 minutes in the past is accepted');
select throws_ok($$ select private.admin_review_promotion(pg_temp.p(43), 'approve') $$, 'P0001', 'invalid_start',
  'approving without a start is refused');
select throws_ok($$ select private.admin_review_promotion(pg_temp.p(43), 'approve', now() - interval '61 minutes') $$,
  'P0001', 'invalid_start', 'a start more than 1 hour in the past is refused');
select throws_ok($$ select private.admin_review_promotion(pg_temp.p(40), 'approve', now() + interval '20 days') $$,
  'P0001', 'invalid_transition', 'an approved campaign cannot be approved again');
select is(
  (select array_agg(private.admin_review_promotion(pg_temp.p(n), 'reject', null, r) ->> 'state' order by n)
     from (values (44, 'headline'), (45, 'not_paid'), (46, 'not_eligible'), (47, 'other')) v(n, r)),
  array['rejected', 'rejected', 'rejected', 'rejected'], 'each of the four reasons rejects a request');
select is((select array_agg(reject_reason order by id) from public.promotions where id in (pg_temp.p(44), pg_temp.p(45), pg_temp.p(46), pg_temp.p(47))),
  array['headline', 'not_paid', 'not_eligible', 'other'], 'the reason is stored');
select throws_ok($$ select private.admin_review_promotion(pg_temp.p(43), 'reject', null, 'too_spicy') $$,
  'P0001', 'invalid_reason', 'an unknown reject reason is refused');
select throws_ok($$ select private.admin_review_promotion(pg_temp.p(43), 'reject') $$,
  'P0001', 'invalid_reason', 'a reject without a reason is refused');
select throws_ok($$ select private.admin_review_promotion(pg_temp.p(40), 'reject', null, 'other') $$,
  'P0001', 'invalid_transition', 'an approved campaign cannot be rejected');
select throws_ok($$ select private.admin_review_promotion(pg_temp.p(44), 'approve', now() + interval '1 day') $$,
  'P0001', 'invalid_transition', 'a rejected campaign cannot be approved');
select is(private.admin_review_promotion(pg_temp.p(43), 'cancel') ->> 'state', 'cancelled',
  'the admin can cancel a request');
select is(private.admin_review_promotion(pg_temp.p(40), 'cancel') ->> 'state', 'cancelled',
  'the admin can cancel a scheduled campaign');
select is(private.admin_review_promotion(pg_temp.p(41), 'cancel') ->> 'state', 'cancelled',
  'the admin can cancel an active campaign');
select results_eq(
  $$ select bool_and(cancelled_by = 'admin' and cancelled_at = now() and reviewed_at = now())
       from public.promotions where id in (pg_temp.p(40), pg_temp.p(41), pg_temp.p(43)) $$,
  $$ values (true) $$, 'an admin cancel records admin, the time and reviewed_at');
select throws_ok($$ select private.admin_review_promotion(pg_temp.p(48), 'cancel') $$,
  'P0001', 'invalid_transition', 'an ended campaign cannot be cancelled');
select throws_ok($$ select private.admin_review_promotion(pg_temp.p(44), 'cancel') $$,
  'P0001', 'invalid_transition', 'a rejected campaign cannot be cancelled');
select throws_ok($$ select private.admin_review_promotion(pg_temp.p(43), 'approve', now() + interval '1 day') $$,
  'P0001', 'invalid_transition', 'a cancelled campaign cannot be approved or cancelled again');
select throws_ok($$ select private.admin_review_promotion(pg_temp.p(42), 'pause') $$,
  'P0001', 'invalid_transition', 'an unknown decision gives invalid_transition');
select throws_ok($$ select private.admin_review_promotion('00000000-0000-0000-0216-999999999999', 'cancel') $$,
  'P0001', 'not_found', 'an unknown id gives not_found');

-- -- 7. cancel_my_promotion (14) ----------------------------------------------
select pg_temp.as_user(50);
select is(pg_temp.keys(public.cancel_my_promotion(pg_temp.p(50))), array['eligible', 'promotion', 'settings'],
  'cancelling a request answers with the get_my_promotion shape');
select results_eq(
  $$ select status, cancelled_by, cancelled_at = now() from public.promotions where id = pg_temp.p(50) $$,
  $$ values ('cancelled'::text, 'seller'::text, true) $$, 'the seller cancel records seller and the time');
select pg_temp.as_user(51);
select is(public.cancel_my_promotion(pg_temp.p(51)) -> 'promotion' ->> 'state', 'cancelled',
  'a scheduled campaign can be cancelled by its seller');
select pg_temp.as_user(52);
select is(public.cancel_my_promotion(pg_temp.p(52)) -> 'promotion' ->> 'state', 'cancelled',
  'an active campaign can be cancelled by its seller');
select pg_temp.as_user(53);
select throws_ok($$ select public.cancel_my_promotion(pg_temp.p(53)) $$, 'P0001', 'not_cancellable',
  'an ended campaign cannot be cancelled');
select pg_temp.as_user(54);
select throws_ok($$ select public.cancel_my_promotion(pg_temp.p(54)) $$, 'P0001', 'not_cancellable',
  'a rejected campaign cannot be cancelled');
select pg_temp.as_user(55);
select throws_ok($$ select public.cancel_my_promotion(pg_temp.p(55)) $$, 'P0001', 'not_cancellable',
  'a cancelled campaign cannot be cancelled again');
select pg_temp.as_user(50);
select throws_ok($$ select public.cancel_my_promotion(pg_temp.p(310)) $$, 'P0001', 'not_found',
  'another owner''s campaign id gives not_found');
select throws_ok($$ select public.cancel_my_promotion('00000000-0000-0000-0216-999999999999') $$, 'P0001', 'not_found',
  'an unknown id gives the same not_found');
select pg_temp.as_user(27);
select throws_ok($$ select public.cancel_my_promotion(pg_temp.p(310)) $$, 'P0001', 'not_found',
  'a caller without a business gets not_found');
select is((select status from public.promotions where id = pg_temp.p(310)), 'approved',
  'the refused cancels changed nothing');
select pg_temp.as_user(99);
select ok(pg_temp.ids(pg_temp.offers(-40, -120, 5)) @> array[pg_temp.b(15)], 'place 15 is in Offers before its seller cancels');
select pg_temp.as_user(15);
do $$ begin perform public.cancel_my_promotion(pg_temp.p(15)); end $$;
select pg_temp.as_user(99);
select ok(not pg_temp.ids(pg_temp.offers(-40, -120, 5)) @> array[pg_temp.b(15)], 'a cancelled active campaign leaves Offers at once');
select is(pg_temp.pin_promoted(public.map_restaurants_in_bounds(-40.5, -39.5, -120.5, -119.5), pg_temp.b(15)), false,
  'and its pin is no longer promoted');

-- -- 8. get_my_promotion (16) -------------------------------------------------
select pg_temp.as_user(20);
select is(public.get_my_promotion() -> 'promotion' ->> 'state', 'requested', 'state requested');
select pg_temp.as_user(31);
select is(public.get_my_promotion() -> 'promotion' ->> 'state', 'scheduled', 'state scheduled (approved, not started)');
select pg_temp.as_user(32);
select is(public.get_my_promotion() -> 'promotion' ->> 'state', 'active', 'state active (approved, running now)');
select pg_temp.as_user(53);
select is(public.get_my_promotion() -> 'promotion' ->> 'state', 'ended', 'state ended (approved, past its end)');
select pg_temp.as_user(54);
select is(public.get_my_promotion() -> 'promotion' ->> 'state', 'rejected', 'state rejected');
select pg_temp.as_user(50);
select is(public.get_my_promotion() -> 'promotion' ->> 'state', 'cancelled', 'state cancelled');
select pg_temp.as_user(28);
select ok(public.get_my_promotion() -> 'promotion' = 'null'::jsonb, 'an owner without campaigns gets promotion null');
select is((public.get_my_promotion() ->> 'eligible')::boolean, true, 'and an eligible business says eligible');
select pg_temp.as_user(27);
select results_eq($$ select public.get_my_promotion() -> 'promotion' = 'null'::jsonb, (public.get_my_promotion() ->> 'eligible')::boolean $$,
  $$ values (true, false) $$, 'a caller without a business gets promotion null and eligible false');
select pg_temp.as_user(24);
select is((public.get_my_promotion() ->> 'eligible')::boolean, false, 'a stale business is not eligible');
delete from public.promotion_settings;
select ok(public.get_my_promotion() -> 'settings' = 'null'::jsonb, 'settings is null when there is no settings row');
insert into public.promotion_settings (price_cents, currency_code, length_days) values (2500, 'CAD', 7);
select pg_temp.as_user(30);
select is(public.get_my_promotion() -> 'promotion' ->> 'state', 'requested',
  'only the latest campaign is returned (the new request, not the ended one)');
select is(pg_temp.keys(public.get_my_promotion()), array['eligible', 'promotion', 'settings'],
  'get_my_promotion has exactly eligible, promotion and settings');
select is(pg_temp.keys(public.get_my_promotion() -> 'promotion'),
  array['category', 'created_at', 'currency_code', 'ends_at', 'headline', 'id', 'length_days', 'preferred_start',
        'price_cents', 'reject_reason', 'starts_at', 'state'], 'its promotion has exactly the documented keys');
select is(public.get_my_promotion() -> 'settings', '{"price_cents": 2500, "currency_code": "CAD", "length_days": 7}'::jsonb,
  'settings carries the price, currency and length');
select pg_temp.as_user(20);
select is((public.get_my_promotion() -> 'promotion' ->> 'id')::uuid,
  (select id from public.promotions where business_id = pg_temp.b(20)), 'each owner sees only their own campaign');

-- -- 9. list_offers_near: content and privacy (21) ----------------------------
delete from public.map_rate_limits;
select pg_temp.as_user(99);
create temp table near30 as select pg_temp.offers(-40, -120, 30) as j;
select set_eq($$ select unnest(pg_temp.ids((select j from near30))) $$,
  $$ values (pg_temp.b(1)), (pg_temp.b(2)), (pg_temp.b(11)), (pg_temp.b(12)), (pg_temp.b(13)) $$,
  'only active campaigns of listed, fresh businesses with a map point appear');
select ok(not pg_temp.ids((select j from near30)) @> array[pg_temp.b(3)], 'a scheduled campaign does not appear');
select ok(not pg_temp.ids((select j from near30)) @> array[pg_temp.b(4)], 'an ended campaign does not appear');
select ok(not pg_temp.ids((select j from near30)) @> array[pg_temp.b(5)], 'a requested campaign does not appear');
select ok(not pg_temp.ids((select j from near30)) @> array[pg_temp.b(6)], 'a rejected campaign does not appear');
select ok(not pg_temp.ids((select j from near30)) @> array[pg_temp.b(7)], 'a cancelled campaign does not appear');
select ok(not pg_temp.ids((select j from near30)) @> array[pg_temp.b(8)], 'an unlisted business does not appear');
select ok(not pg_temp.ids((select j from near30)) @> array[pg_temp.b(9)], 'a stale business does not appear');
select ok(not pg_temp.ids((select j from near30)) @> array[pg_temp.b(10)], 'a business without a map point does not appear');
select is(pg_temp.keys((select j from near30)), array['next_cursor', 'offers'], 'the answer has exactly offers and next_cursor');
select is(
  (select array_agg(distinct array_to_string(pg_temp.keys(o), ',')) from jsonb_array_elements((select j from near30) -> 'offers') o),
  array['accepts_table_requests,band,business_id,category,cover,cuisine_code,ends_at,headline,lat,lng,name,type'],
  'every offer has exactly the 12 documented keys');
select results_eq(
  $$ select o -> 'lat', o -> 'lng' from jsonb_array_elements((select j from near30) -> 'offers') o
      where (o ->> 'business_id')::uuid = pg_temp.b(2) $$,
  $$ select to_jsonb(map_lat), to_jsonb(map_lng) from public.businesses where id = pg_temp.b(2) $$,
  'a homemade offer carries the shifted public point');
select ok(
  (select (o ->> 'lat')::float8 <> l.lat and (o ->> 'lng')::float8 <> l.lng
     from jsonb_array_elements((select j from near30) -> 'offers') o, public.business_locations l
    where (o ->> 'business_id')::uuid = pg_temp.b(2) and l.business_id = pg_temp.b(2)),
  'a homemade offer never carries the exact point');
select ok(
  position('00000000-0000-0000-0016-' in (select j::text from near30)) = 0
  and position('Exact St' in (select j::text from near30)) = 0
  and position('price' in (select j::text from near30)) = 0
  and position('status' in (select j::text from near30)) = 0
  and position('place_id' in (select j::text from near30)) = 0
  and position('reviewed' in (select j::text from near30)) = 0,
  'offers carry no owner id, address, price, status, place_id or admin field');
select is(
  (select pg_temp.keys(o -> 'cover') from jsonb_array_elements((select j from near30) -> 'offers') o
    where (o ->> 'business_id')::uuid = pg_temp.b(1)),
  array['id', 'kind', 'menu_item_id', 'path', 'position'], 'a cover has the details photo shape');
select ok(
  (select o -> 'cover' = 'null'::jsonb from jsonb_array_elements((select j from near30) -> 'offers') o
    where (o ->> 'business_id')::uuid = pg_temp.b(2)), 'a place without a cover has cover null');
select is(pg_temp.ids(pg_temp.offers(-40, -120, 30, 'special_offer')), array[pg_temp.b(2)],
  'the category filter keeps only that category');
select set_eq($$ select unnest(pg_temp.ids(pg_temp.offers(-40, -120, 30, null, 'restaurant'))) $$,
  $$ values (pg_temp.b(1)), (pg_temp.b(11)), (pg_temp.b(12)), (pg_temp.b(13)) $$, 'the type filter restaurant drops home cooks');
select is(pg_temp.ids(pg_temp.offers(-40, -120, 30, null, 'homemade')), array[pg_temp.b(2)],
  'the type filter homemade keeps only home cooks');
select is(pg_temp.ids(pg_temp.offers(-40, -120, 30, null, null, true)), array[pg_temp.b(1)],
  'the tables filter keeps only places that take table requests');
select results_eq(
  $$ select (o ->> 'business_id')::uuid, (o ->> 'band')::int from jsonb_array_elements((select j from near30) -> 'offers') o
      where (o ->> 'business_id')::uuid in (pg_temp.b(1), pg_temp.b(11), pg_temp.b(12)) order by 2 $$,
  $$ values (pg_temp.b(1), 0), (pg_temp.b(11), 1), (pg_temp.b(12), 2) $$,
  'bands: under 5 km is 0, under 15 km is 1, farther is 2');

-- -- 10. Validation (12) ------------------------------------------------------
select throws_ok($$ select pg_temp.offers(-40.01, -120, 5) $$, 'P0001', 'invalid_point', 'an off-grid latitude is refused');
select throws_ok($$ select pg_temp.offers(-40, -120.03, 5) $$, 'P0001', 'invalid_point', 'an off-grid longitude is refused');
select throws_ok($$ select pg_temp.offers(90.05, -120, 5) $$, 'P0001', 'invalid_point', 'a latitude past 90 is refused');
select throws_ok($$ select pg_temp.offers(-40, 180.05, 5) $$, 'P0001', 'invalid_point', 'a longitude past 180 is refused');
select throws_ok($$ select pg_temp.offers(null, -120, 5) $$, 'P0001', 'invalid_point', 'a missing point is refused');
select throws_ok($$ select pg_temp.offers('NaN'::float8, -120, 5) $$, 'P0001', 'invalid_point', 'NaN is refused');
select throws_ok($$ select pg_temp.offers(-40, -120, 10) $$, 'P0001', 'invalid_distance', 'only 5, 15 or 30 km are allowed');
select throws_ok($$ select pg_temp.offers(-40, -120, 5, 'free_stuff') $$, 'P0001', 'invalid_filter', 'an unknown category is refused');
select throws_ok($$ select pg_temp.offers(-40, -120, 5, null, 'shop') $$, 'P0001', 'invalid_filter', 'an unknown type is refused');
select throws_ok($$ select pg_temp.offers(-40, -120, 5, null, null, null, 'garbage') $$, 'P0001', 'invalid_cursor',
  'a malformed cursor is refused');
select throws_ok(format($$ select pg_temp.offers(-40, -120, 5, null, null, null, '%s|0|%s|%s') $$,
                        pg_temp.utc_day(-2), md5('x'), pg_temp.b(1)),
  'P0001', 'invalid_cursor', 'a cursor from two days ago is refused');
select throws_ok(format($$ select pg_temp.offers(-40, -120, 5, null, null, null, '2026-02-30|0|%s|%s') $$, md5('x'), pg_temp.b(1)),
  'P0001', 'invalid_cursor', 'a cursor with an impossible date is refused');

-- -- 11. The 4 km margin (3) --------------------------------------------------
select ok(pg_temp.ids(pg_temp.offers(-40, -120, 5)) @> array[pg_temp.b(13)],
  'a place 8 km from the grid point is included at About 5 km');
select ok(not pg_temp.ids(pg_temp.offers(-40, -120, 5)) @> array[pg_temp.b(11)],
  'a place 10 km from the grid point is excluded at About 5 km');
select ok(pg_temp.ids(pg_temp.offers(-40, -120, 15)) @> array[pg_temp.b(11)],
  'the same place is included at About 15 km');

-- -- 12. Paging (12) ----------------------------------------------------------
delete from public.map_rate_limits;
create temp table pages (n int, j jsonb);
insert into pages select 1, pg_temp.offers(-30, -110, 30);
insert into pages select 2, pg_temp.offers(-30, -110, 30, cur => (select j ->> 'next_cursor' from pages where n = 1));
insert into pages select 3, pg_temp.offers(-30, -110, 30, cur => (select j ->> 'next_cursor' from pages where n = 2));
create temp table paged as
  select (o ->> 'business_id')::uuid as id, (o ->> 'band')::int as band, row_number() over (order by p.n, e.i) as rn
    from pages p, jsonb_array_elements(p.j -> 'offers') with ordinality e(o, i);
select is((select jsonb_array_length(j -> 'offers') from pages where n = 1), 20, 'page 1 has 20 offers');
select is((select jsonb_array_length(j -> 'offers') from pages where n = 2), 20, 'page 2 has 20 offers');
select is((select jsonb_array_length(j -> 'offers') from pages where n = 3), 5, 'page 3 has the last 5');
select ok((select j -> 'next_cursor' = 'null'::jsonb from pages where n = 3), 'the last page has no next_cursor');
select is((select count(distinct id)::int from paged), 45, 'all 45 offers came back');
select is((select count(*)::int from paged), 45, 'and none came back twice');
select is(pg_temp.ids(pg_temp.offers(-30, -110, 30)), pg_temp.ids((select j from pages where n = 1)),
  'a second call the same UTC day gives the same order');
select is(
  (select array_agg(id order by rn) from paged),
  (select array_agg(id order by band, md5(id::text || pg_temp.utc_day()) collate "C", id) from paged),
  'the order is band, then md5(id || UTC date), then id');
select ok((select starts_with(j ->> 'next_cursor', pg_temp.utc_day() || '|') from pages where n = 1),
  'the cursor carries the UTC day');
-- Across midnight: a cursor made yesterday keeps yesterday's rotation for the next page.
create temp table yday as
  select id, band, row_number() over (order by band, md5(id::text || pg_temp.utc_day(-1)) collate "C", id) as rn from paged;
create temp table ypage as
  select pg_temp.offers(-30, -110, 30, cur => (
    select format('%s|%s|%s|%s', pg_temp.utc_day(-1), band, md5(id::text || pg_temp.utc_day(-1)), id) from yday where rn = 20)) as j;
select is(pg_temp.ids((select j from ypage)), (select array_agg(id order by rn) from yday where rn between 21 and 40),
  'a cursor from yesterday continues in yesterday''s order (no repeats or gaps across midnight)');
select ok((select starts_with(j ->> 'next_cursor', pg_temp.utc_day(-1) || '|') from ypage),
  'and its next cursor keeps yesterday''s day');
select lives_ok(format($$ select pg_temp.offers(-30, -110, 30, cur => '%s|0|%s|%s') $$,
                       pg_temp.utc_day(1), md5('x'), pg_temp.b(1)),
  'a cursor dated tomorrow (UTC) is accepted');

-- -- 13. The offers quota (6) -------------------------------------------------
delete from public.map_rate_limits;
insert into public.map_rate_limits (caller_key, kind, window_start, calls)
values ('u:' || pg_temp.u(99), 'offers', date_trunc('minute', now(), 'UTC'), 120);
select throws_ok($$ select pg_temp.offers(-40, -120, 5) $$, 'P0001', 'rate_limited',
  'the 121st offers call in a minute from a signed-in caller is refused (the pins limit)');
delete from public.map_rate_limits;
set local request.jwt.claims = '{"role":"anon"}';
set local request.headers = '{"x-forwarded-for":"198.51.100.16"}';
select lives_ok($$ select pg_temp.offers(-40, -120, 5) $$, 'a guest can list offers');
select is((select calls from public.map_rate_limits where caller_key = 'ip:198.51.100.16' and kind = 'offers'), 1,
  'each offers call adds exactly 1 to its own kind');
select is((select count(*)::int from public.map_rate_limits where kind = 'pins'), 0,
  'offers calls never touch the pins counters');
update public.map_rate_limits set calls = 2000 where caller_key = 'guest:all' and kind = 'offers';
select throws_ok($$ select pg_temp.offers(-40, -120, 5) $$, 'P0001', 'rate_limited',
  'the guest ceiling for offers is 2000 a minute (the pins ceiling)');
select lives_ok($$ select public.map_restaurants_in_bounds(-40.5, -39.5, -120.5, -119.5) $$,
  'a full offers ceiling leaves the pins ceiling open');

-- -- 14. promoted and sponsored on the map reads (13) -------------------------
delete from public.map_rate_limits;
select pg_temp.as_user(99);
create temp table pinsA as select public.map_restaurants_in_bounds(-40.5, -39.5, -120.5, -119.5) as j;
select is(pg_temp.pin_promoted((select j from pinsA), pg_temp.b(1)), true, 'an active campaign marks the pin promoted');
select is(pg_temp.pin_promoted((select j from pinsA), pg_temp.b(3)), false, 'a scheduled campaign does not');
select is(pg_temp.pin_promoted((select j from pinsA), pg_temp.b(4)), false, 'an ended campaign does not');
select is(pg_temp.pin_promoted((select j from pinsA), pg_temp.b(7)), false, 'a cancelled campaign does not');
select is(pg_temp.pin_promoted(public.map_homemade_in_bounds(-40.5, -39.5, -120.5, -119.5), pg_temp.b(2)), true,
  'an active home cook''s pin is promoted');
select is((public.get_restaurant_details(pg_temp.b(1)) ->> 'sponsored')::boolean, true, 'restaurant details say sponsored');
select is((public.get_restaurant_details(pg_temp.b(3)) ->> 'sponsored')::boolean, false,
  'restaurant details of a scheduled campaign are not sponsored');
select is((public.get_homemade_details(pg_temp.b(2)) ->> 'sponsored')::boolean, true, 'homemade details say sponsored');
select is((public.get_homemade_details(pg_temp.b(16)) ->> 'sponsored')::boolean, false,
  'homemade details without a campaign are not sponsored');
create temp table capR as select public.map_restaurants_in_bounds(-20, -19.7, -90, -89.7) as j;
select results_eq(
  $$ select jsonb_array_length(j -> 'pins'), (j ->> 'capped')::boolean from capR $$, $$ values (500, true) $$,
  '502 restaurants: 500 pins and capped');
select is(pg_temp.pin_promoted((select j from capR), pg_temp.b(2502)), true,
  'the promoted restaurant (highest id, which an id-only cap would drop) is inside the 500');
create temp table capH as select public.map_homemade_in_bounds(-10, -9.7, -80, -79.7) as j;
select results_eq(
  $$ select jsonb_array_length(j -> 'pins'), (j ->> 'capped')::boolean from capH $$, $$ values (500, true) $$,
  '502 home cooks: 500 pins and capped');
select is(pg_temp.pin_promoted((select j from capH), pg_temp.b(3502)), true,
  'the promoted home cook (highest id) is inside the 500');

select * from finish();
rollback;
