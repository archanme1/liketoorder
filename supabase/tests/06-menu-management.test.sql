-- Spec 06: menu management (PR 1, database and storage only) — currencies, menu_items,
-- business_photos, storage_cleanup_queue, the business-media bucket and its storage.objects
-- policies, and the menu / photo functions.
-- The function allowlist, the `private` schema checks, businesses.currency_code column
-- privileges and the get_my_business key list live in the 05 file.
--
-- ORDER-DEPENDENT: the sections below share state and must not be reordered. In particular:
--   * the reservation chain g1..g7 / gn (business P) builds on earlier reservations, expiry
--     backdating and finishes, and later upload-policy tests reuse those paths;
--   * the `res` temp table holds each reservation under a key (g1, c1, i2, d_cover, cl20, ...);
--     a key must be written before any later section reads it with pg_temp.rp / pg_temp.rid;
--   * seller mode for business R (06a1) is switched off and back on inside one section, and the
--     visibility counts before and after depend on that toggle being done in place;
--   * queue rows are backdated (queued_at) just before the claim that must drop them (Decision 26).
begin;
select plan(347);

-- ── Fixtures (as postgres) ──────────────────────────────────────────────────
-- users (…0006NN)            businesses (…0006xN)
-- 0601 R  listed restaurant, map point          06a1
-- 0602 H  listed homemade, map point, no address 06b1
-- 0603 U  unlisted restaurant, map point         06c1
-- 0604 N  listed homemade, NO map point          06d1
-- 0605 O  outsider (owns its own listed restaurant) 06e1
-- 0606 X  signed in, username, no business
-- 0607 L  limits + currency lock                 06a2
-- 0608 P  gallery / menu photo limits, expiry, finish, upload policy  06a3
-- 0609 M  move / delete positions                06a4
-- 0610 C  whole-business cascade                 06a5
-- 0611 Q  cover / item retry, replace, queue, claim 06a6
-- 0612 E  59-minute boundary (inserted mid-file)    06a7
-- 0613 D  account-deletion cascade (inserted mid-file) 06a8
-- 0614 F  cleanup_required, 20 queued files (inserted late)  06a9
-- 0615 G  10-minute claim wait (inserted late)       06aa
-- 0616 T  description trimming, table checks, pending item photo cascade (inserted late)  06ab
-- 0617 S  finish size branches, pending menu expiry (inserted late)  06ac
-- items 06f1..06f7, photos 0621..0626 and 0631..0633; late photo ids 0000-0003-… (menu expiry),
-- queue paths 0000-0001-… (cleanup_required) and 0000-0002-… (claim wait)
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000601', 'm601@example.test'),
  ('00000000-0000-0000-0000-000000000602', 'm602@example.test'),
  ('00000000-0000-0000-0000-000000000603', 'm603@example.test'),
  ('00000000-0000-0000-0000-000000000604', 'm604@example.test'),
  ('00000000-0000-0000-0000-000000000605', 'm605@example.test'),
  ('00000000-0000-0000-0000-000000000606', 'm606@example.test'),
  ('00000000-0000-0000-0000-000000000607', 'm607@example.test'),
  ('00000000-0000-0000-0000-000000000608', 'm608@example.test'),
  ('00000000-0000-0000-0000-000000000609', 'm609@example.test'),
  ('00000000-0000-0000-0000-000000000610', 'm610@example.test'),
  ('00000000-0000-0000-0000-000000000611', 'm611@example.test');

update public.profiles set username = 'menu_' || right(id::text, 3)
 where id between '00000000-0000-0000-0000-000000000601' and '00000000-0000-0000-0000-000000000611';
update public.profiles set is_seller = true
 where id between '00000000-0000-0000-0000-000000000601' and '00000000-0000-0000-0000-000000000611'
   and id <> '00000000-0000-0000-0000-000000000606';

insert into public.businesses (id, owner_id, type, name, cuisine_code, map_lat, map_lng, public_address, is_listed) values
  ('00000000-0000-0000-0000-0000000006a1', '00000000-0000-0000-0000-000000000601',
   'restaurant', 'Menu R', 'IT', 43.7, -79.4, '1 Main St, Toronto', true),
  ('00000000-0000-0000-0000-0000000006b1', '00000000-0000-0000-0000-000000000602',
   'homemade', 'Menu H', 'FR', 43.71, -79.41, null, true),
  ('00000000-0000-0000-0000-0000000006c1', '00000000-0000-0000-0000-000000000603',
   'restaurant', 'Menu U', 'JP', 43.8, -79.5, '2 Side St, Toronto', false),
  ('00000000-0000-0000-0000-0000000006d1', '00000000-0000-0000-0000-000000000604',
   'homemade', 'Menu N', 'IT', null, null, null, true),
  ('00000000-0000-0000-0000-0000000006e1', '00000000-0000-0000-0000-000000000605',
   'restaurant', 'Menu O', 'IT', 43.72, -79.42, '3 Side St, Toronto', true),
  ('00000000-0000-0000-0000-0000000006a2', '00000000-0000-0000-0000-000000000607',
   'restaurant', 'Menu L', 'IT', 43.73, -79.43, '4 Side St, Toronto', true),
  ('00000000-0000-0000-0000-0000000006a3', '00000000-0000-0000-0000-000000000608',
   'restaurant', 'Menu P', 'IT', 43.74, -79.44, '5 Side St, Toronto', true),
  ('00000000-0000-0000-0000-0000000006a4', '00000000-0000-0000-0000-000000000609',
   'restaurant', 'Menu M', 'IT', 43.75, -79.45, '6 Side St, Toronto', true),
  ('00000000-0000-0000-0000-0000000006a5', '00000000-0000-0000-0000-000000000610',
   'restaurant', 'Menu C', 'IT', 43.76, -79.46, '7 Side St, Toronto', true),
  ('00000000-0000-0000-0000-0000000006a6', '00000000-0000-0000-0000-000000000611',
   'restaurant', 'Menu Q', 'IT', 43.77, -79.47, '8 Side St, Toronto', true);

insert into public.menu_items (id, business_id, name, description, is_available, position) values
  ('00000000-0000-0000-0000-0000000006f1', '00000000-0000-0000-0000-0000000006a1', 'Soup', null, true, 1),
  ('00000000-0000-0000-0000-0000000006f2', '00000000-0000-0000-0000-0000000006a1', 'Cake', 'Sold out', false, 2),
  ('00000000-0000-0000-0000-0000000006f3', '00000000-0000-0000-0000-0000000006c1', 'Hidden U', null, true, 1),
  ('00000000-0000-0000-0000-0000000006f4', '00000000-0000-0000-0000-0000000006d1', 'Hidden N', null, true, 1),
  ('00000000-0000-0000-0000-0000000006f5', '00000000-0000-0000-0000-0000000006b1', 'Stew', null, true, 1),
  ('00000000-0000-0000-0000-0000000006f6', '00000000-0000-0000-0000-0000000006e1', 'Salad', null, true, 1);

-- ready photos on R (0621 gallery), U, N, H, O; a pending gallery photo on R (0622)
insert into public.business_photos (id, business_id, kind, path, status, position)
select v.id, v.b, 'gallery', v.b::text || '/' || v.id::text || '.jpg', v.s, v.p
  from (values
    ('00000000-0000-0000-0000-000000000621'::uuid, '00000000-0000-0000-0000-0000000006a1'::uuid, 'ready',   1),
    ('00000000-0000-0000-0000-000000000622'::uuid, '00000000-0000-0000-0000-0000000006a1'::uuid, 'pending', null),
    ('00000000-0000-0000-0000-000000000623'::uuid, '00000000-0000-0000-0000-0000000006c1'::uuid, 'ready',   1),
    ('00000000-0000-0000-0000-000000000624'::uuid, '00000000-0000-0000-0000-0000000006d1'::uuid, 'ready',   1),
    ('00000000-0000-0000-0000-000000000625'::uuid, '00000000-0000-0000-0000-0000000006b1'::uuid, 'ready',   1),
    ('00000000-0000-0000-0000-000000000626'::uuid, '00000000-0000-0000-0000-0000000006e1'::uuid, 'ready',   1)
  ) as v(id, b, s, p);

-- an object for every fixture photo (including the pending one)
insert into storage.objects (bucket_id, name, metadata)
select 'business-media', business_id::text || '/' || id::text || '.jpg',
       '{"mimetype":"image/jpeg","size":1000}'::jsonb
  from public.business_photos
 where id between '00000000-0000-0000-0000-000000000621' and '00000000-0000-0000-0000-000000000626';

-- Supabase blocks direct SQL deletes on storage.objects; turn that guard off so the
-- delete tests exercise OUR policy.
set local storage.allow_delete_query = 'true';

-- Helpers. `res` keeps begin_photo_upload results (and ids by key); `put` simulates a
-- successful Storage upload as the calling role (RLS applies, it is SECURITY INVOKER).
create temp table res (k text primary key, j jsonb);
grant all on res to authenticated, anon;
create function pg_temp.rp(p_k text) returns text language sql stable
  as $$ select j->>'path' from res where res.k = p_k $$;
create function pg_temp.rid(p_k text) returns uuid language sql stable
  as $$ select (j->>'photo_id')::uuid from res where res.k = p_k $$;
create procedure pg_temp.put(p_path text, p_mime text default 'image/jpeg', p_size bigint default 1000)
  language sql
  as $$ insert into storage.objects (bucket_id, name, metadata)
        values ('business-media', p_path, jsonb_build_object('mimetype', p_mime, 'size', p_size)) $$;

-- ── RLS enabled ─────────────────────────────────────────────────────────────
select ok((select relrowsecurity from pg_class where oid = 'public.currencies'::regclass),
  'RLS is enabled on currencies');
select ok((select relrowsecurity from pg_class where oid = 'public.menu_items'::regclass),
  'RLS is enabled on menu_items');
select ok((select relrowsecurity from pg_class where oid = 'public.business_photos'::regclass),
  'RLS is enabled on business_photos');
select ok((select relrowsecurity from pg_class where oid = 'public.storage_cleanup_queue'::regclass),
  'RLS is enabled on storage_cleanup_queue');

-- ── Table privileges (exact) ────────────────────────────────────────────────
select table_privs_are('public', 'currencies', 'anon', array['SELECT'],
  'anon has only SELECT on currencies');
select table_privs_are('public', 'currencies', 'authenticated', array['SELECT'],
  'authenticated has only SELECT on currencies');
select table_privs_are('public', 'menu_items', 'anon', array[]::text[],
  'anon has no table-level privileges on menu_items');
select table_privs_are('public', 'menu_items', 'authenticated', array[]::text[],
  'authenticated has no table-level privileges on menu_items');
select table_privs_are('public', 'business_photos', 'anon', array[]::text[],
  'anon has no table-level privileges on business_photos');
select table_privs_are('public', 'business_photos', 'authenticated', array[]::text[],
  'authenticated has no table-level privileges on business_photos');
select table_privs_are('public', 'storage_cleanup_queue', 'anon', array[]::text[],
  'anon has no table-level privileges on storage_cleanup_queue');
select table_privs_are('public', 'storage_cleanup_queue', 'authenticated', array[]::text[],
  'authenticated has no table-level privileges on storage_cleanup_queue');

-- ── Column privileges (exact, every column) ─────────────────────────────────
select column_privs_are('public', 'menu_items', 'id', 'anon', array['SELECT'], 'anon: menu_items.id is select-only');
select column_privs_are('public', 'menu_items', 'business_id', 'anon', array['SELECT'], 'anon: menu_items.business_id is select-only');
select column_privs_are('public', 'menu_items', 'name', 'anon', array['SELECT'], 'anon: menu_items.name is select-only');
select column_privs_are('public', 'menu_items', 'description', 'anon', array['SELECT'], 'anon: menu_items.description is select-only');
select column_privs_are('public', 'menu_items', 'price_minor', 'anon', array['SELECT'], 'anon: menu_items.price_minor is select-only');
select column_privs_are('public', 'menu_items', 'is_available', 'anon', array['SELECT'], 'anon: menu_items.is_available is select-only');
select column_privs_are('public', 'menu_items', 'position', 'anon', array['SELECT'], 'anon: menu_items.position is select-only');
select column_privs_are('public', 'menu_items', 'created_at', 'anon', array[]::text[], 'anon: menu_items.created_at has no privileges');
select column_privs_are('public', 'menu_items', 'updated_at', 'anon', array[]::text[], 'anon: menu_items.updated_at has no privileges');
select column_privs_are('public', 'menu_items', 'id', 'authenticated', array['SELECT'], 'authenticated: menu_items.id is select-only');
select column_privs_are('public', 'menu_items', 'business_id', 'authenticated', array['SELECT'], 'authenticated: menu_items.business_id is select-only');
select column_privs_are('public', 'menu_items', 'name', 'authenticated', array['SELECT'], 'authenticated: menu_items.name is select-only');
select column_privs_are('public', 'menu_items', 'description', 'authenticated', array['SELECT'], 'authenticated: menu_items.description is select-only');
select column_privs_are('public', 'menu_items', 'price_minor', 'authenticated', array['SELECT'], 'authenticated: menu_items.price_minor is select-only');
select column_privs_are('public', 'menu_items', 'is_available', 'authenticated', array['SELECT'], 'authenticated: menu_items.is_available is select-only');
select column_privs_are('public', 'menu_items', 'position', 'authenticated', array['SELECT'], 'authenticated: menu_items.position is select-only');
select column_privs_are('public', 'menu_items', 'created_at', 'authenticated', array[]::text[], 'authenticated: menu_items.created_at has no privileges');
select column_privs_are('public', 'menu_items', 'updated_at', 'authenticated', array[]::text[], 'authenticated: menu_items.updated_at has no privileges');

select column_privs_are('public', 'business_photos', 'id', 'anon', array['SELECT'], 'anon: business_photos.id is select-only');
select column_privs_are('public', 'business_photos', 'business_id', 'anon', array['SELECT'], 'anon: business_photos.business_id is select-only');
select column_privs_are('public', 'business_photos', 'kind', 'anon', array['SELECT'], 'anon: business_photos.kind is select-only');
select column_privs_are('public', 'business_photos', 'menu_item_id', 'anon', array['SELECT'], 'anon: business_photos.menu_item_id is select-only');
select column_privs_are('public', 'business_photos', 'path', 'anon', array['SELECT'], 'anon: business_photos.path is select-only');
select column_privs_are('public', 'business_photos', 'position', 'anon', array['SELECT'], 'anon: business_photos.position is select-only');
select column_privs_are('public', 'business_photos', 'status', 'anon', array[]::text[], 'anon: business_photos.status has no privileges');
select column_privs_are('public', 'business_photos', 'created_at', 'anon', array[]::text[], 'anon: business_photos.created_at has no privileges');
select column_privs_are('public', 'business_photos', 'id', 'authenticated', array['SELECT'], 'authenticated: business_photos.id is select-only');
select column_privs_are('public', 'business_photos', 'business_id', 'authenticated', array['SELECT'], 'authenticated: business_photos.business_id is select-only');
select column_privs_are('public', 'business_photos', 'kind', 'authenticated', array['SELECT'], 'authenticated: business_photos.kind is select-only');
select column_privs_are('public', 'business_photos', 'menu_item_id', 'authenticated', array['SELECT'], 'authenticated: business_photos.menu_item_id is select-only');
select column_privs_are('public', 'business_photos', 'path', 'authenticated', array['SELECT'], 'authenticated: business_photos.path is select-only');
select column_privs_are('public', 'business_photos', 'position', 'authenticated', array['SELECT'], 'authenticated: business_photos.position is select-only');
select column_privs_are('public', 'business_photos', 'status', 'authenticated', array[]::text[], 'authenticated: business_photos.status has no privileges');
select column_privs_are('public', 'business_photos', 'created_at', 'authenticated', array[]::text[], 'authenticated: business_photos.created_at has no privileges');

select ok(not has_any_column_privilege('anon', 'public.storage_cleanup_queue', 'SELECT, INSERT, UPDATE, REFERENCES'),
  'anon has no column privileges on storage_cleanup_queue');
select ok(not has_any_column_privilege('authenticated', 'public.storage_cleanup_queue', 'SELECT, INSERT, UPDATE, REFERENCES'),
  'authenticated has no column privileges on storage_cleanup_queue');
select ok(not has_any_column_privilege('anon', 'public.currencies', 'INSERT, UPDATE, REFERENCES'),
  'anon has no write or references column privileges on currencies');
select ok(not has_any_column_privilege('authenticated', 'public.currencies', 'INSERT, UPDATE, REFERENCES'),
  'authenticated has no write or references column privileges on currencies');

-- ── Bucket and storage policies ─────────────────────────────────────────────
select is((select public from storage.buckets where id = 'business-media'), false,
  'business-media bucket is private');
select is((select file_size_limit from storage.buckets where id = 'business-media'), 2097152::bigint,
  'business-media bucket limit is 2 MB (2097152 bytes)');
select is((select array(select unnest(allowed_mime_types) order by 1) from storage.buckets where id = 'business-media'),
  array['image/jpeg', 'image/png', 'image/webp'],
  'business-media allows exactly jpeg, png and webp');
select is((select array_agg(policyname::text order by policyname) from pg_policies
            where schemaname = 'storage' and tablename = 'objects' and policyname like 'business\_media%'),
  array['business_media_delete_own', 'business_media_insert_own', 'business_media_select'],
  'business-media has exactly an insert, a select and a delete policy on storage.objects');
select is((select count(*)::int from pg_policies
            where schemaname = 'storage' and tablename = 'objects' and cmd in ('UPDATE', 'ALL')
              and (policyname || ' ' || coalesce(qual, '') || ' ' || coalesce(with_check, '')) ilike '%business%media%'),
  0, 'there is no UPDATE policy on storage.objects for business-media');

-- ── Currencies catalogue ────────────────────────────────────────────────────
select is((select array_agg(code order by code) from public.currencies
            where minor_units = 0 and code in ('JPY', 'KRW', 'VND', 'CLP', 'ISK')),
  array['CLP', 'ISK', 'JPY', 'KRW', 'VND'], 'JPY KRW VND CLP ISK have 0 minor units');
select is((select array_agg(code order by code) from public.currencies
            where minor_units = 2 and code in ('USD', 'CAD', 'EUR')),
  array['CAD', 'EUR', 'USD'], 'USD CAD EUR have 2 minor units');
select is((select array_agg(code order by code) from public.currencies
            where minor_units = 3 and code in ('BHD', 'KWD', 'JOD', 'OMR', 'TND', 'IQD')),
  array['BHD', 'IQD', 'JOD', 'KWD', 'OMR', 'TND'], 'BHD KWD JOD OMR TND IQD have 3 minor units');
select throws_ok($$ insert into public.currencies (code, name, minor_units) values ('ZZA', 'Four decimals', 4) $$,
  '23514', null, 'a currency with 4 minor units is rejected by the table check');
select is((select count(*)::int from public.currencies
            where code in ('CLF', 'UYW', 'XAU', 'XAG', 'XDR', 'XTS', 'XXX')), 0,
  'fund, precious-metal, SDR, test and no-currency codes are absent');

set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select ok((select count(*) from public.currencies) > 100, 'anon can read the currency catalogue');
select throws_ok($$ insert into public.currencies (code, name, minor_units) values ('AAA', 'Test', 2) $$,
  '42501', null, 'anon cannot insert a currency');
select throws_ok($$ update public.currencies set name = 'Hacked' where code = 'USD' $$,
  '42501', null, 'anon cannot update a currency');
select throws_ok($$ delete from public.currencies where code = 'USD' $$,
  '42501', null, 'anon cannot delete a currency');

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000606","role":"authenticated"}';
select ok((select count(*) from public.currencies) > 100, 'authenticated can read the currency catalogue');
select throws_ok($$ insert into public.currencies (code, name, minor_units) values ('AAA', 'Test', 2) $$,
  '42501', null, 'authenticated cannot insert a currency');
select throws_ok($$ update public.currencies set name = 'Hacked' where code = 'USD' $$,
  '42501', null, 'authenticated cannot update a currency');
select throws_ok($$ delete from public.currencies where code = 'USD' $$,
  '42501', null, 'authenticated cannot delete a currency');

-- ── Visibility: anon ────────────────────────────────────────────────────────
reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select is((select count(*)::int from public.menu_items), 4,
  'anon sees only the items of listed businesses with a map point (R x2, H, O)');
select is((select count(*)::int from public.menu_items
            where business_id in ('00000000-0000-0000-0000-0000000006c1', '00000000-0000-0000-0000-0000000006d1')), 0,
  'anon sees no items of an unlisted business or a business with no map point');
select is((select is_available from public.menu_items where id = '00000000-0000-0000-0000-0000000006f2'), false,
  'anon can read an unavailable item, with is_available = false');
select is((select count(*)::int from public.business_photos), 3,
  'anon sees only the ready photos of public businesses');
select is((select count(*)::int from public.business_photos where id = '00000000-0000-0000-0000-000000000622'), 0,
  'anon never sees a pending photo');
select is((select count(*)::int from public.business_photos
            where business_id in ('00000000-0000-0000-0000-0000000006c1', '00000000-0000-0000-0000-0000000006d1')), 0,
  'anon sees no photos of an unlisted business or a business with no map point');
select throws_ok($$ select status from public.business_photos $$, '42501', null,
  'anon cannot read business_photos.status');
select throws_ok($$ select created_at from public.menu_items $$, '42501', null,
  'anon cannot read menu_items.created_at');
select is((select count(*)::int from storage.objects where bucket_id = 'business-media'), 3,
  'anon sees only the objects of ready photos of public businesses');
select throws_ok($$ call pg_temp.put('00000000-0000-0000-0000-0000000006a1/00000000-0000-0000-0000-000000000622.jpg') $$,
  '42501', null, 'anon cannot upload to storage');

-- ── Visibility: another signed-in user (no business) ────────────────────────
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000606","role":"authenticated"}';
select is((select count(*)::int from public.menu_items), 4,
  'another user sees only the items of public businesses');
select is((select count(*)::int from public.menu_items
            where business_id in ('00000000-0000-0000-0000-0000000006c1', '00000000-0000-0000-0000-0000000006d1')), 0,
  'another user sees no items of an unlisted business or a business with no map point');
select is((select is_available from public.menu_items where id = '00000000-0000-0000-0000-0000000006f2'), false,
  'another user can read an unavailable item, with is_available = false');
select is((select count(*)::int from public.business_photos), 3,
  'another user sees only the ready photos of public businesses');
select is((select count(*)::int from public.business_photos where id = '00000000-0000-0000-0000-000000000622'), 0,
  'another user never sees a pending photo');
select is((select count(*)::int from public.business_photos
            where business_id in ('00000000-0000-0000-0000-0000000006c1', '00000000-0000-0000-0000-0000000006d1')), 0,
  'another user sees no photos of an unlisted business or a business with no map point');
select throws_ok($$ select status from public.business_photos $$, '42501', null,
  'authenticated cannot read business_photos.status');
select is((select count(*)::int from storage.objects where bucket_id = 'business-media'), 3,
  'another user sees only the objects of ready photos of public businesses');
select is((select count(*)::int from storage.objects
            where name = '00000000-0000-0000-0000-0000000006a1/00000000-0000-0000-0000-000000000622.jpg'), 0,
  'another user cannot see the object of a pending photo');

-- ── Visibility: owners see their own, listed or not ─────────────────────────
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000601","role":"authenticated"}';
select is((select count(*)::int from public.menu_items where business_id = '00000000-0000-0000-0000-0000000006a1'), 2,
  'the owner sees all of their items');
select is((select count(*)::int from public.business_photos where business_id = '00000000-0000-0000-0000-0000000006a1'), 2,
  'the owner sees their ready and their pending photo rows');
select is((select count(*)::int from public.menu_items
            where business_id in ('00000000-0000-0000-0000-0000000006c1', '00000000-0000-0000-0000-0000000006d1')), 0,
  'an owner does not see the hidden items of other businesses');

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000603","role":"authenticated"}';
select is((select count(*)::int from public.menu_items where business_id = '00000000-0000-0000-0000-0000000006c1'), 1,
  'the owner of an unlisted business sees their item');
select is((select count(*)::int from public.business_photos where business_id = '00000000-0000-0000-0000-0000000006c1'), 1,
  'the owner of an unlisted business sees their photo');
select is((select count(*)::int from storage.objects
            where name = '00000000-0000-0000-0000-0000000006c1/00000000-0000-0000-0000-000000000623.jpg'), 1,
  'the owner of an unlisted business sees their object');

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000604","role":"authenticated"}';
select is((select count(*)::int from public.menu_items where business_id = '00000000-0000-0000-0000-0000000006d1'), 1,
  'the owner of a business with no map point sees their item');

-- ── Seller mode off hides everything from outsiders; on restores it ─────────
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000601","role":"authenticated"}';
select lives_ok($$ select public.set_seller_mode(false) $$, 'the owner can switch seller mode off');

reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select is((select count(*)::int from public.menu_items where business_id = '00000000-0000-0000-0000-0000000006a1'), 0,
  'seller mode off: anon sees no items');
select is((select count(*)::int from public.business_photos where business_id = '00000000-0000-0000-0000-0000000006a1'), 0,
  'seller mode off: anon sees no photo rows');
select is((select count(*)::int from storage.objects where name like '00000000-0000-0000-0000-0000000006a1/%'), 0,
  'seller mode off: anon sees no storage objects');

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000606","role":"authenticated"}';
select is((select count(*)::int from public.menu_items where business_id = '00000000-0000-0000-0000-0000000006a1'), 0,
  'seller mode off: another user sees no items');
select is((select count(*)::int from public.business_photos where business_id = '00000000-0000-0000-0000-0000000006a1'), 0,
  'seller mode off: another user sees no photo rows');
select is((select count(*)::int from storage.objects where name like '00000000-0000-0000-0000-0000000006a1/%'), 0,
  'seller mode off: another user sees no storage objects');

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000601","role":"authenticated"}';
select is((select count(*)::int from public.menu_items where business_id = '00000000-0000-0000-0000-0000000006a1'), 2,
  'seller mode off: the owner still sees their items');
select is((select count(*)::int from public.business_photos where business_id = '00000000-0000-0000-0000-0000000006a1'), 2,
  'seller mode off: the owner still sees their photo rows');
select is((select count(*)::int from storage.objects where name like '00000000-0000-0000-0000-0000000006a1/%'), 2,
  'seller mode off: the owner still sees their storage objects');
select lives_ok($$ select public.set_seller_mode(true) $$, 'the owner can switch seller mode back on');

reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select is((select count(*)::int from public.menu_items where business_id = '00000000-0000-0000-0000-0000000006a1'), 2,
  'seller mode on again: anon sees the items');
select is((select count(*)::int from public.business_photos where business_id = '00000000-0000-0000-0000-0000000006a1'), 1,
  'seller mode on again: anon sees the ready photo only');
select is((select count(*)::int from storage.objects where name like '00000000-0000-0000-0000-0000000006a1/%'), 1,
  'seller mode on again: anon sees the ready object only');

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000606","role":"authenticated"}';
select is((select count(*)::int from public.menu_items where business_id = '00000000-0000-0000-0000-0000000006a1'), 2,
  'seller mode on again: another user sees the items');
select is((select count(*)::int from public.business_photos where business_id = '00000000-0000-0000-0000-0000000006a1'), 1,
  'seller mode on again: another user sees the ready photo only');
select is((select count(*)::int from storage.objects where name like '00000000-0000-0000-0000-0000000006a1/%'), 1,
  'seller mode on again: another user sees the ready object only');

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000601","role":"authenticated"}';
select is((select count(*)::int from public.business_photos where business_id = '00000000-0000-0000-0000-0000000006a1'), 2,
  'seller mode on again: the owner still sees their photo rows');

-- ── Direct writes are refused ───────────────────────────────────────────────
select throws_ok($$ insert into public.menu_items (business_id, name, position)
                    values ('00000000-0000-0000-0000-0000000006a1', 'Direct', 9) $$,
  '42501', null, 'the owner cannot insert into menu_items directly');
select throws_ok($$ update public.menu_items set name = 'Direct' where id = '00000000-0000-0000-0000-0000000006f1' $$,
  '42501', null, 'the owner cannot update menu_items directly');
select throws_ok($$ delete from public.menu_items where id = '00000000-0000-0000-0000-0000000006f1' $$,
  '42501', null, 'the owner cannot delete from menu_items directly');
select throws_ok($$ insert into public.business_photos (business_id, kind, path, status)
                    values ('00000000-0000-0000-0000-0000000006a1', 'gallery', 'x', 'ready') $$,
  '42501', null, 'the owner cannot insert into business_photos directly');
select throws_ok($$ update public.business_photos set position = 5 where id = '00000000-0000-0000-0000-000000000621' $$,
  '42501', null, 'the owner cannot update business_photos directly');
select throws_ok($$ delete from public.business_photos where id = '00000000-0000-0000-0000-000000000621' $$,
  '42501', null, 'the owner cannot delete from business_photos directly');
select throws_ok($$ select * from public.storage_cleanup_queue $$, '42501', null,
  'authenticated cannot read storage_cleanup_queue');

reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok($$ insert into public.menu_items (business_id, name, position)
                    values ('00000000-0000-0000-0000-0000000006a1', 'Direct', 9) $$,
  '42501', null, 'anon cannot insert into menu_items');
select throws_ok($$ select * from public.storage_cleanup_queue $$, '42501', null,
  'anon cannot read storage_cleanup_queue');

-- ── Signed out and no-business guards ───────────────────────────────────────
select throws_ok($$ select public.create_menu_item('Anon item', null, null) $$, '42501', null,
  'anon cannot execute create_menu_item');
select throws_ok($$ select * from public.claim_photo_cleanup() $$, '42501', null,
  'anon cannot execute claim_photo_cleanup');

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000606","role":"authenticated"}';
select throws_ok($$ select public.set_menu_currency('CAD') $$, 'P0001', 'no_business',
  'no_business: set_menu_currency');
select throws_ok($$ select public.create_menu_item('Item', null, null) $$, 'P0001', 'no_business',
  'no_business: create_menu_item');
select throws_ok($$ select public.update_menu_item('00000000-0000-0000-0000-0000000006ff', 'Item', null, null, true) $$,
  'P0001', 'no_business', 'no_business: update_menu_item');
select throws_ok($$ select public.move_menu_item('00000000-0000-0000-0000-0000000006ff', 'up') $$,
  'P0001', 'no_business', 'no_business: move_menu_item');
select throws_ok($$ select public.delete_menu_item('00000000-0000-0000-0000-0000000006ff') $$,
  'P0001', 'no_business', 'no_business: delete_menu_item');
select throws_ok($$ select public.begin_photo_upload('gallery') $$, 'P0001', 'no_business',
  'no_business: begin_photo_upload');
select throws_ok($$ select public.finish_photo_upload('00000000-0000-0000-0000-0000000006ff') $$,
  'P0001', 'no_business', 'no_business: finish_photo_upload');
select throws_ok($$ select public.delete_business_photo('00000000-0000-0000-0000-0000000006ff') $$,
  'P0001', 'no_business', 'no_business: delete_business_photo');
select throws_ok($$ select * from public.claim_photo_cleanup() $$, 'P0001', 'no_business',
  'no_business: claim_photo_cleanup');

-- ── Ownership: another business's item or photo id is not_found ─────────────
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000605","role":"authenticated"}';
select throws_ok($$ select public.update_menu_item('00000000-0000-0000-0000-0000000006f1', 'Stolen', null, null, true) $$,
  'P0001', 'not_found', 'an outsider cannot update another business''s item (not_found)');
select throws_ok($$ select public.move_menu_item('00000000-0000-0000-0000-0000000006f1', 'down') $$,
  'P0001', 'not_found', 'an outsider cannot move another business''s item (not_found)');
select throws_ok($$ select public.delete_menu_item('00000000-0000-0000-0000-0000000006f1') $$,
  'P0001', 'not_found', 'an outsider cannot delete another business''s item (not_found)');
select throws_ok($$ select public.update_menu_item('00000000-0000-0000-0000-0000000006ff', 'Ghost', null, null, true) $$,
  'P0001', 'not_found', 'a missing item id gives the same not_found');
select throws_ok($$ select public.finish_photo_upload('00000000-0000-0000-0000-000000000622') $$,
  'P0001', 'not_found', 'an outsider cannot finish another business''s pending photo (not_found)');
select throws_ok($$ select public.finish_photo_upload('00000000-0000-0000-0000-000000000621') $$,
  'P0001', 'not_found', 'finish_photo_upload on a ready photo of another business is not_found');
select throws_ok($$ select public.delete_business_photo('00000000-0000-0000-0000-000000000621') $$,
  'P0001', 'not_found', 'an outsider cannot delete another business''s photo (not_found)');
select throws_ok($$ select public.delete_business_photo('00000000-0000-0000-0000-0000000006ff') $$,
  'P0001', 'not_found', 'a missing photo id gives the same not_found');

reset role;
select is((select array_agg(mi.name order by mi.position) from public.menu_items mi
            where mi.business_id = '00000000-0000-0000-0000-0000000006a1'),
  array['Soup', 'Cake'], 'the other business''s items are unchanged after the outsider attempts');

-- ── Currency lock, item functions and the 100-item limit (business L) ───────
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000607","role":"authenticated"}';
select throws_ok($$ select public.set_menu_currency(null) $$, 'P0001', 'invalid_input',
  'set_menu_currency(null) raises invalid_input');
select throws_ok($$ select public.set_menu_currency('ZZZ') $$, '23503', null,
  'set_menu_currency with an unknown code raises a foreign key violation');
select throws_ok($$ select public.create_menu_item('Priced', null, 1250) $$, 'P0001', 'currency_required',
  'a price with no currency raises currency_required');
select lives_ok($$ select public.create_menu_item('Plain', '', null) $$, 'create_menu_item with no price works');
select ok(exists(select 1 from public.menu_items
                  where name = 'Plain' and business_id = '00000000-0000-0000-0000-0000000006a2' and description is null),
  'the item exists and an empty description is stored as null');
select lives_ok($$ select public.create_menu_item('Fancy', 'A nice dish', null) $$, 'create_menu_item with a description works');
select is((select description from public.menu_items where name = 'Fancy' and business_id = '00000000-0000-0000-0000-0000000006a2'),
  'A nice dish', 'a non-empty description is kept');
select lives_ok($$ select public.set_menu_currency('CAD') $$, 'set_menu_currency works while no item has a price');
select is(public.get_my_business()->>'currency_code', 'CAD', 'get_my_business reflects the chosen currency');
select lives_ok($$ select public.create_menu_item('Priced', null, 1250) $$, 'a price works once the currency is set');
select is((select price_minor from public.menu_items where name = 'Priced' and business_id = '00000000-0000-0000-0000-0000000006a2'),
  1250, 'the price is stored as integer minor units');
select throws_ok($$ select public.set_menu_currency('USD') $$, 'P0001', 'prices_exist',
  'changing the currency while an item has a price raises prices_exist');
select lives_ok($$ select public.set_menu_currency('CAD') $$, 'setting the same currency again is allowed');
select lives_ok($$ select public.update_menu_item(
    (select id from public.menu_items where name = 'Priced' and business_id = '00000000-0000-0000-0000-0000000006a2'),
    'Priced', null, null, true) $$, 'update_menu_item can remove a price');
select ok(exists(select 1 from public.menu_items
                  where name = 'Priced' and business_id = '00000000-0000-0000-0000-0000000006a2' and price_minor is null),
  'the item still exists and its price is now null');
select lives_ok($$ select public.set_menu_currency('USD') $$, 'set_menu_currency works again after the prices are removed');
select is(public.get_my_business()->>'currency_code', 'USD', 'get_my_business reflects the new currency');
select is((select array_agg(mi.name order by mi.position) from public.menu_items mi
            where mi.business_id = '00000000-0000-0000-0000-0000000006a2'),
  array['Plain', 'Fancy', 'Priced'], 'create_menu_item appends at max position + 1');

reset role;
insert into public.menu_items (business_id, name, position)
select '00000000-0000-0000-0000-0000000006a2', 'Bulk ' || g, g from generate_series(4, 100) g;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000607","role":"authenticated"}';
select throws_ok($$ select public.create_menu_item('One too many', null, null) $$, 'P0001', 'item_limit',
  'the 101st item raises item_limit');
select is((select count(*)::int from public.menu_items where business_id = '00000000-0000-0000-0000-0000000006a2'), 100,
  'the refused item was not created');
select lives_ok($$ select public.delete_menu_item(
    (select id from public.menu_items where name = 'Plain' and business_id = '00000000-0000-0000-0000-0000000006a2')) $$,
  'delete_menu_item removes the first item');
select is((select array_agg(mi.position order by mi.position)
             from public.menu_items mi where mi.business_id = '00000000-0000-0000-0000-0000000006a2'),
  (select array_agg(g order by g) from generate_series(1, 99) g),
  'deleting an item closes the gap, positions are 1..99');
select lives_ok($$ select public.create_menu_item('Back to 100', null, null) $$,
  'deleting an item frees a slot under the limit');
select is((select count(*)::int from public.menu_items where business_id = '00000000-0000-0000-0000-0000000006a2'), 100,
  'the business is back at 100 items');

-- ── Move and delete keep positions 1..n (business M) ────────────────────────
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000609","role":"authenticated"}';
select lives_ok($$ select public.create_menu_item('A', null, null) $$, 'M: create A');
select lives_ok($$ select public.create_menu_item('B', null, null) $$, 'M: create B');
select lives_ok($$ select public.create_menu_item('C', null, null) $$, 'M: create C');
select lives_ok($$ select public.move_menu_item((select id from public.menu_items where name = 'B' and business_id = '00000000-0000-0000-0000-0000000006a4'), 'up') $$,
  'M: move B up');
select is((select array_agg(mi.name order by mi.position) from public.menu_items mi where mi.business_id = '00000000-0000-0000-0000-0000000006a4'),
  array['B', 'A', 'C'], 'moving B up swaps it with A');
select lives_ok($$ select public.move_menu_item((select id from public.menu_items where name = 'B' and business_id = '00000000-0000-0000-0000-0000000006a4'), 'up') $$,
  'M: moving the first item up does not raise');
select is((select array_agg(mi.name order by mi.position) from public.menu_items mi where mi.business_id = '00000000-0000-0000-0000-0000000006a4'),
  array['B', 'A', 'C'], 'moving the first item up changes nothing');
select lives_ok($$ select public.move_menu_item((select id from public.menu_items where name = 'C' and business_id = '00000000-0000-0000-0000-0000000006a4'), 'down') $$,
  'M: moving the last item down does not raise');
select is((select array_agg(mi.name order by mi.position) from public.menu_items mi where mi.business_id = '00000000-0000-0000-0000-0000000006a4'),
  array['B', 'A', 'C'], 'moving the last item down changes nothing');
select lives_ok($$ select public.move_menu_item((select id from public.menu_items where name = 'A' and business_id = '00000000-0000-0000-0000-0000000006a4'), 'down') $$,
  'M: move A down');
select is((select array_agg(mi.name order by mi.position) from public.menu_items mi where mi.business_id = '00000000-0000-0000-0000-0000000006a4'),
  array['B', 'C', 'A'], 'moving A down swaps it with C');
select throws_ok($$ select public.move_menu_item((select id from public.menu_items where name = 'A' and business_id = '00000000-0000-0000-0000-0000000006a4'), 'sideways') $$,
  'P0001', 'invalid_direction', 'a direction other than up or down raises invalid_direction');
select is((select array_agg(mi.position order by mi.position) from public.menu_items mi where mi.business_id = '00000000-0000-0000-0000-0000000006a4'),
  array[1, 2, 3], 'positions stay 1..n after the moves');
select throws_ok($$ select public.update_menu_item((select id from public.menu_items where name = 'A' and business_id = '00000000-0000-0000-0000-0000000006a4'), 'A', null, 100, true) $$,
  'P0001', 'currency_required', 'update_menu_item with a price and no currency raises currency_required');
select lives_ok($$ select public.delete_menu_item((select id from public.menu_items where name = 'C' and business_id = '00000000-0000-0000-0000-0000000006a4')) $$,
  'M: delete the middle item');
select is((select array_agg(mi.name || mi.position::text order by mi.position) from public.menu_items mi where mi.business_id = '00000000-0000-0000-0000-0000000006a4'),
  array['B1', 'A2'], 'deleting the middle item closes the gap');

-- ── Photo reservations: validation and limits (business P) ──────────────────
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000608","role":"authenticated"}';
select lives_ok($$ select public.create_menu_item('PItem', null, null) $$, 'P: create an item');
select throws_ok($$ select public.begin_photo_upload('banner') $$, 'P0001', 'invalid_input',
  'begin_photo_upload rejects an unknown kind');
select throws_ok($$ select public.begin_photo_upload('item') $$, 'P0001', 'invalid_input',
  'begin_photo_upload rejects kind item without an item id');
select throws_ok($$ select public.begin_photo_upload('gallery',
    (select id from public.menu_items where name = 'PItem' and business_id = '00000000-0000-0000-0000-0000000006a3')) $$,
  'P0001', 'invalid_input', 'begin_photo_upload rejects an item id for a non-item kind');
select throws_ok($$ select public.begin_photo_upload('item', '00000000-0000-0000-0000-0000000006ff') $$,
  'P0001', 'invalid_input', 'begin_photo_upload rejects a missing item id with invalid_input');
select throws_ok($$ select public.begin_photo_upload('item', '00000000-0000-0000-0000-0000000006f1') $$,
  'P0001', 'invalid_input', 'begin_photo_upload rejects another business''s item id with invalid_input');

insert into res select 'g1', public.begin_photo_upload('gallery');
insert into res select 'g2', public.begin_photo_upload('gallery');
insert into res select 'g3', public.begin_photo_upload('gallery');
insert into res select 'g4', public.begin_photo_upload('gallery');
insert into res select 'g5', public.begin_photo_upload('gallery');
insert into res select 'g6', public.begin_photo_upload('gallery');
reset role;
select is((select count(*)::int from public.business_photos
            where business_id = '00000000-0000-0000-0000-0000000006a3' and kind = 'gallery' and status = 'pending'), 6,
  'six gallery reservations are pending');
select is((select count(*)::int from public.business_photos
            where business_id = '00000000-0000-0000-0000-0000000006a3' and path = pg_temp.rp('g1')
              and path = business_id::text || '/' || id::text || '.jpg'), 1,
  'a reservation path is <business_id>/<photo_id>.jpg');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000608","role":"authenticated"}';
select throws_ok($$ select public.begin_photo_upload('gallery') $$, 'P0001', 'photo_limit',
  'the 7th gallery photo raises photo_limit, counting pending rows');
select lives_ok($$ select public.delete_business_photo(pg_temp.rid('g6')) $$,
  'a pending gallery photo can be deleted');
reset role;
select is((select count(*)::int from public.storage_cleanup_queue where path = pg_temp.rp('g6')), 1,
  'the deleted pending photo''s path is queued');
-- Decision 26: a queue row is dropped only once it is older than 10 minutes.
update public.storage_cleanup_queue set queued_at = now() - interval '11 minutes' where path = pg_temp.rp('g6');
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000608","role":"authenticated"}';
select is((select count(*)::int from public.claim_photo_cleanup() as p where p = pg_temp.rp('g6')), 0,
  'claim_photo_cleanup does not return a path whose object was never uploaded');
reset role;
select is((select count(*)::int from public.storage_cleanup_queue where path = pg_temp.rp('g6')), 0,
  'claim_photo_cleanup dropped the queue row of the missing object');
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000608","role":"authenticated"}';
select lives_ok($$ insert into res select 'g7', public.begin_photo_upload('gallery') $$,
  'deleting a pending gallery photo frees its slot at once');
select throws_ok($$ select public.begin_photo_upload('gallery') $$, 'P0001', 'photo_limit',
  'the gallery is full again after reserving the freed slot');

insert into res select 'm1', public.begin_photo_upload('menu');
insert into res select 'm2', public.begin_photo_upload('menu');
insert into res select 'm3', public.begin_photo_upload('menu');
insert into res select 'm4', public.begin_photo_upload('menu');
insert into res select 'm5', public.begin_photo_upload('menu');
insert into res select 'm6', public.begin_photo_upload('menu');
insert into res select 'm7', public.begin_photo_upload('menu');
insert into res select 'm8', public.begin_photo_upload('menu');
insert into res select 'm9', public.begin_photo_upload('menu');
insert into res select 'm10', public.begin_photo_upload('menu');
select throws_ok($$ select public.begin_photo_upload('menu') $$, 'P0001', 'photo_limit',
  'the 11th menu photo raises photo_limit, counting pending rows');
reset role;
select is((select count(*)::int from public.business_photos
            where business_id = '00000000-0000-0000-0000-0000000006a3' and kind = 'menu' and status = 'pending'), 10,
  'ten menu reservations are pending and the 11th was not created');

-- ── Expired reservations ────────────────────────────────────────────────────
update public.business_photos set created_at = now() - interval '61 minutes'
 where id in (pg_temp.rid('g1'), pg_temp.rid('g2'));
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000608","role":"authenticated"}';
select throws_ok($$ call pg_temp.put(pg_temp.rp('g1')) $$, '42501', null,
  'an expired reservation''s path cannot be uploaded to');
select lives_ok($$ insert into res select 'gn', public.begin_photo_upload('gallery') $$,
  'expired pending rows stop counting toward the gallery limit');
reset role;
select is((select count(*)::int from public.business_photos where id in (pg_temp.rid('g1'), pg_temp.rid('g2'))), 0,
  'begin_photo_upload deleted the expired reservations');
select is((select count(*)::int from public.storage_cleanup_queue where path in (pg_temp.rp('g1'), pg_temp.rp('g2'))), 2,
  'the expired reservations'' paths are queued');

-- ── finish_photo_upload ─────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000608","role":"authenticated"}';
select throws_ok($$ select public.finish_photo_upload(pg_temp.rid('g3')) $$, 'P0001', 'upload_missing',
  'finish_photo_upload without an object raises upload_missing');
select lives_ok($$ call pg_temp.put(pg_temp.rp('g3'), 'image/gif', 1000) $$,
  'an object with a gif content type can be recorded at a reserved path');
select throws_ok($$ select public.finish_photo_upload(pg_temp.rid('g3')) $$, 'P0001', 'upload_missing',
  'finish_photo_upload with a disallowed mimetype raises upload_missing');
call pg_temp.put(pg_temp.rp('g4'), 'image/jpeg', 2097153);
select throws_ok($$ select public.finish_photo_upload(pg_temp.rid('g4')) $$, 'P0001', 'upload_missing',
  'finish_photo_upload with a size over 2097152 raises upload_missing');
call pg_temp.put(pg_temp.rp('g5'), 'image/jpeg', 2097152);
select is((select public.finish_photo_upload(pg_temp.rid('g5'))->>'id'), pg_temp.rid('g5')::text,
  'finish_photo_upload accepts a jpeg of exactly 2097152 bytes and returns the photo');
call pg_temp.put(pg_temp.rp('g7'), 'image/png', 1000);
select lives_ok($$ select public.finish_photo_upload(pg_temp.rid('g7')) $$, 'finish_photo_upload accepts png');
call pg_temp.put(pg_temp.rp('gn'), 'image/webp', 1000);
select lives_ok($$ select public.finish_photo_upload(pg_temp.rid('gn')) $$, 'finish_photo_upload accepts webp');
select throws_ok($$ select public.finish_photo_upload(pg_temp.rid('g5')) $$, 'P0001', 'not_found',
  'finish_photo_upload on an already ready photo is not_found');
reset role;
select is((select array_agg(bp.position order by bp.position) from public.business_photos bp
            where bp.business_id = '00000000-0000-0000-0000-0000000006a3' and bp.kind = 'gallery' and bp.status = 'ready'),
  array[1, 2, 3], 'finished gallery photos get positions 1..n');
select is((select bp.position from public.business_photos bp where bp.id = pg_temp.rid('g5')), 1,
  'the first finished gallery photo has position 1');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000608","role":"authenticated"}';
call pg_temp.put(pg_temp.rp('m1'));
call pg_temp.put(pg_temp.rp('m2'));
call pg_temp.put(pg_temp.rp('m3'));
select lives_ok($$ select public.finish_photo_upload(pg_temp.rid('m1')) $$, 'finish menu photo 1');
select lives_ok($$ select public.finish_photo_upload(pg_temp.rid('m2')) $$, 'finish menu photo 2');
select lives_ok($$ select public.finish_photo_upload(pg_temp.rid('m3')) $$, 'finish menu photo 3');
reset role;
select is((select array_agg(bp.position order by bp.position) from public.business_photos bp
            where bp.business_id = '00000000-0000-0000-0000-0000000006a3' and bp.kind = 'menu' and bp.status = 'ready'),
  array[1, 2, 3], 'finished menu photos get positions 1..n');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000608","role":"authenticated"}';
select lives_ok($$ select public.delete_business_photo(pg_temp.rid('m1')) $$, 'a ready menu photo can be deleted');
reset role;
select is((select array_agg(bp.position order by bp.position) from public.business_photos bp
            where bp.business_id = '00000000-0000-0000-0000-0000000006a3' and bp.kind = 'menu' and bp.status = 'ready'),
  array[1, 2], 'deleting a menu photo closes the position gap');
select is((select count(*)::int from public.storage_cleanup_queue where path = pg_temp.rp('m1')), 1,
  'the deleted ready photo''s path is queued');
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000608","role":"authenticated"}';
select is((select count(*)::int from public.claim_photo_cleanup() as p where p = pg_temp.rp('m1')), 1,
  'claim_photo_cleanup returns a queued path whose object still exists');

-- ── Upload policy ───────────────────────────────────────────────────────────
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000605","role":"authenticated"}';
select throws_ok($$ call pg_temp.put(pg_temp.rp('m4')) $$, '42501', null,
  'another user cannot upload to someone else''s reserved path');

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000608","role":"authenticated"}';
select throws_ok($$ call pg_temp.put('00000000-0000-0000-0000-0000000006a1/00000000-0000-0000-0000-000000000622.jpg') $$,
  '42501', null, 'an owner cannot upload to another business''s reserved path');
select throws_ok($$ call pg_temp.put('00000000-0000-0000-0000-0000000006a1/00000000-0000-0000-0000-0000000006ff.jpg') $$,
  '42501', null, 'an owner cannot upload into another business''s folder');
select throws_ok($$ call pg_temp.put('00000000-0000-0000-0000-0000000006a3/00000000-0000-0000-0000-0000000006ff.jpg') $$,
  '42501', null, 'an owner cannot upload at an unreserved path in their own folder');
select lives_ok($$ call pg_temp.put(pg_temp.rp('m4')) $$,
  'an owner can upload at a path reserved by a fresh pending row of their business');
-- The insert policy refuses (42501) before the unique name index is reached (23505).
select throws_ok($$ call pg_temp.put(pg_temp.rp('g7')) $$, '42501', null,
  'uploading to a ready photo''s path is refused by the insert policy (object still present)');
reset role;
delete from storage.objects where name = pg_temp.rp('g7');
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000608","role":"authenticated"}';
select throws_ok($$ call pg_temp.put(pg_temp.rp('g7')) $$, '42501', null,
  'uploading to a path whose photo is already ready is refused');

-- ── Cover retry, replace, queue and claim (business Q) ──────────────────────
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000611","role":"authenticated"}';
select lives_ok($$ select public.create_menu_item('QItem', null, null) $$, 'Q: create an item');
insert into res select 'qi', jsonb_build_object('photo_id', id) from public.menu_items
 where name = 'QItem' and business_id = '00000000-0000-0000-0000-0000000006a6';

insert into res select 'c1', public.begin_photo_upload('cover');
insert into res select 'c2', public.begin_photo_upload('cover');
reset role;
select is((select array_agg(id) from public.business_photos
            where business_id = '00000000-0000-0000-0000-0000000006a6' and kind = 'cover' and status = 'pending'),
  array[pg_temp.rid('c2')], 'a second cover reservation replaces the first, leaving one pending cover row');
select is((select count(*)::int from public.storage_cleanup_queue where path = pg_temp.rp('c1')), 1,
  'the replaced cover reservation''s path is queued');
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000611","role":"authenticated"}';
select throws_ok($$ call pg_temp.put(pg_temp.rp('c1')) $$, '42501', null,
  'the replaced cover reservation''s old path can no longer be uploaded to');
select lives_ok($$ call pg_temp.put(pg_temp.rp('c2')) $$, 'the new cover reservation can be uploaded to at once');
select is((select public.finish_photo_upload(pg_temp.rid('c2'))->>'id'), pg_temp.rid('c2')::text,
  'the retried cover upload can be finished at once');
reset role;
select is((select count(*)::int from public.business_photos
            where business_id = '00000000-0000-0000-0000-0000000006a6' and kind = 'cover' and status = 'ready'), 1,
  'there is exactly one ready cover');
-- Decision 26: a queue row is dropped only once it is older than 10 minutes.
update public.storage_cleanup_queue set queued_at = now() - interval '11 minutes' where path = pg_temp.rp('c1');
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000611","role":"authenticated"}';
select is((select count(*)::int from public.claim_photo_cleanup() as p where p = pg_temp.rp('c1')), 0,
  'claim_photo_cleanup does not return the retried reservation''s path (no object)');
reset role;
select is((select count(*)::int from public.storage_cleanup_queue where path = pg_temp.rp('c1')), 0,
  'claim_photo_cleanup dropped the queue row of the missing object');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000611","role":"authenticated"}';
insert into res select 'c3', public.begin_photo_upload('cover');
call pg_temp.put(pg_temp.rp('c3'));
select is((select public.finish_photo_upload(pg_temp.rid('c3'))->>'id'), pg_temp.rid('c3')::text,
  'a replacement cover can be finished');
reset role;
select is((select array_agg(id) from public.business_photos
            where business_id = '00000000-0000-0000-0000-0000000006a6' and kind = 'cover' and status = 'ready'),
  array[pg_temp.rid('c3')], 'replacing a ready cover leaves exactly one ready row, the new one');
select is((select count(*)::int from public.storage_cleanup_queue where path = pg_temp.rp('c2')), 1,
  'the replaced cover''s path is queued');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000611","role":"authenticated"}';
select is((select count(*)::int from public.claim_photo_cleanup() as p where p = pg_temp.rp('c2')), 1,
  'claim_photo_cleanup returns a queued path whose object still exists');
select is((select count(*)::int from public.claim_photo_cleanup() as p where p like '00000000-0000-0000-0000-0000000006a3/%'), 0,
  'claim_photo_cleanup never returns another business''s paths');

-- no update path: an owner's rename of a live object changes nothing
with u as (update storage.objects set name = name || '.moved' where name = pg_temp.rp('c3') returning 1)
select is((select count(*)::int from u), 0, 'an owner''s update of a live business-media object affects 0 rows');
reset role;
select is((select count(*)::int from storage.objects where name = pg_temp.rp('c3')), 1,
  'the live object kept its name after the owner''s update attempt');
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000611","role":"authenticated"}';

-- delete rules for live vs queued objects
with d as (delete from storage.objects where name = pg_temp.rp('c3') returning 1)
select is((select count(*)::int from d), 0, 'an owner cannot delete a live object');
reset role;
select is((select count(*)::int from storage.objects where name = pg_temp.rp('c3')), 1,
  'the live object is still there');
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000605","role":"authenticated"}';
with d as (delete from storage.objects where name = pg_temp.rp('c2') returning 1)
select is((select count(*)::int from d), 0, 'an outsider cannot delete a queued object of another business');
with d as (delete from storage.objects where name = pg_temp.rp('c3') returning 1)
select is((select count(*)::int from d), 0, 'an outsider cannot delete a live object of another business');
reset role;
select is((select count(*)::int from storage.objects where name in (pg_temp.rp('c2'), pg_temp.rp('c3'))), 2,
  'the outsider''s delete attempts removed nothing');
delete from storage.objects where name = pg_temp.rp('c2');
-- Decision 26: a queue row is dropped only once it is older than 10 minutes.
update public.storage_cleanup_queue set queued_at = now() - interval '11 minutes' where path = pg_temp.rp('c2');
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000611","role":"authenticated"}';
select is((select count(*)::int from public.claim_photo_cleanup() as p where p = pg_temp.rp('c2')), 0,
  'claim_photo_cleanup does not return a path whose object is gone');
reset role;
select is((select count(*)::int from public.storage_cleanup_queue where path = pg_temp.rp('c2')), 0,
  'claim_photo_cleanup drops queue rows whose object is gone');

-- item photo retry and replace
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000611","role":"authenticated"}';
insert into res select 'i1', public.begin_photo_upload('item', pg_temp.rid('qi'));
insert into res select 'i2', public.begin_photo_upload('item', pg_temp.rid('qi'));
reset role;
select is((select array_agg(id) from public.business_photos
            where menu_item_id = pg_temp.rid('qi') and kind = 'item' and status = 'pending'),
  array[pg_temp.rid('i2')], 'a second reservation for the same item replaces the first pending one');
select is((select count(*)::int from public.storage_cleanup_queue where path = pg_temp.rp('i1')), 1,
  'the replaced item reservation''s path is queued');
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000611","role":"authenticated"}';
select throws_ok($$ call pg_temp.put(pg_temp.rp('i1')) $$, '42501', null,
  'the replaced item reservation''s old path can no longer be uploaded to');
select lives_ok($$ call pg_temp.put(pg_temp.rp('i2')) $$, 'the new item reservation can be uploaded to at once');
select is((select public.finish_photo_upload(pg_temp.rid('i2'))->>'id'), pg_temp.rid('i2')::text,
  'the retried item upload can be finished at once');
reset role;
select is((select array_agg(id) from public.business_photos
            where menu_item_id = pg_temp.rid('qi') and kind = 'item' and status = 'ready'),
  array[pg_temp.rid('i2')], 'the item has exactly one ready photo');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000611","role":"authenticated"}';
insert into res select 'i3', public.begin_photo_upload('item', pg_temp.rid('qi'));
call pg_temp.put(pg_temp.rp('i3'));
select is((select public.finish_photo_upload(pg_temp.rid('i3'))->>'id'), pg_temp.rid('i3')::text,
  'a replacement item photo can be finished');
reset role;
select is((select array_agg(id) from public.business_photos
            where menu_item_id = pg_temp.rid('qi') and kind = 'item' and status = 'ready'),
  array[pg_temp.rid('i3')], 'replacing a ready item photo leaves exactly one ready row, the new one');
select is((select count(*)::int from public.storage_cleanup_queue where path = pg_temp.rp('i2')), 1,
  'the replaced item photo''s path is queued');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000605","role":"authenticated"}';
with d as (delete from storage.objects where name = pg_temp.rp('i2') returning 1)
select is((select count(*)::int from d), 0, 'an outsider cannot delete a queued object');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000611","role":"authenticated"}';
with d as (delete from storage.objects where name = pg_temp.rp('i2') returning 1)
select is((select count(*)::int from d), 1, 'the owner can delete an object whose photo row is gone (queued)');

-- delete item / delete photo queue their paths
select lives_ok($$ select public.delete_menu_item(pg_temp.rid('qi')) $$, 'Q: delete the item that has a photo');
reset role;
select is((select count(*)::int from public.business_photos where id = pg_temp.rid('i3')), 0,
  'deleting an item removes its photo row');
select is((select count(*)::int from public.storage_cleanup_queue where path = pg_temp.rp('i3')), 1,
  'deleting an item queues its photo path');
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000611","role":"authenticated"}';
select lives_ok($$ select public.delete_business_photo(pg_temp.rid('c3')) $$, 'a ready cover can be deleted');
reset role;
select is((select count(*)::int from public.storage_cleanup_queue where path = pg_temp.rp('c3')), 1,
  'deleting a ready photo queues its path');

-- ── Deleting the whole business queues every path ───────────────────────────
insert into public.menu_items (id, business_id, name, position) values
  ('00000000-0000-0000-0000-0000000006f7', '00000000-0000-0000-0000-0000000006a5', 'C item', 1);
insert into public.business_photos (id, business_id, kind, menu_item_id, path, status, position)
select v.id, '00000000-0000-0000-0000-0000000006a5', v.k, v.mi,
       '00000000-0000-0000-0000-0000000006a5/' || v.id::text || '.jpg', 'ready', v.p
  from (values
    ('00000000-0000-0000-0000-000000000631'::uuid, 'gallery', null::uuid, 1),
    ('00000000-0000-0000-0000-000000000632'::uuid, 'cover',   null::uuid, null::int),
    ('00000000-0000-0000-0000-000000000633'::uuid, 'item',    '00000000-0000-0000-0000-0000000006f7'::uuid, null::int)
  ) as v(id, k, mi, p);
delete from public.businesses where id = '00000000-0000-0000-0000-0000000006a5';
select is((select count(*)::int from public.storage_cleanup_queue
            where path in ('00000000-0000-0000-0000-0000000006a5/00000000-0000-0000-0000-000000000631.jpg',
                           '00000000-0000-0000-0000-0000000006a5/00000000-0000-0000-0000-000000000632.jpg',
                           '00000000-0000-0000-0000-0000000006a5/00000000-0000-0000-0000-000000000633.jpg')), 3,
  'deleting a business queues the paths of its gallery, cover and item photos');
select is((select count(*)::int from public.storage_cleanup_queue where business_id = '00000000-0000-0000-0000-0000000006a5'), 3,
  'the queue rows carry the deleted business id and outlive the business');
select is((select (select count(*) from public.menu_items where business_id = '00000000-0000-0000-0000-0000000006a5')
                 + (select count(*) from public.business_photos where business_id = '00000000-0000-0000-0000-0000000006a5'))::int, 0,
  'deleting a business cascades to its items and photo rows');

-- ── Malformed folder names fail closed ──────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000608","role":"authenticated"}';
select throws_ok($$ call pg_temp.put('not-a-uuid/x.jpg') $$, '42501', null,
  'an upload into a non-uuid folder raises insufficient_privilege');
select throws_ok($$ call pg_temp.put('x.jpg') $$, '42501', null,
  'an upload with no folder raises insufficient_privilege');
select throws_ok($$ call pg_temp.put('zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz/a.jpg') $$, '42501', null,
  'an upload into a uuid-shaped but invalid folder raises insufficient_privilege');
reset role;
select is((select count(*)::int from storage.objects where name = 'not-a-uuid/x.jpg'), 0,
  'an upload into a non-uuid folder is refused');
select is((select count(*)::int from storage.objects where name = 'x.jpg'), 0,
  'an upload with no folder is refused');
select is((select count(*)::int from storage.objects where name = 'zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz/a.jpg'), 0,
  'an upload into a uuid-shaped but invalid folder is refused');

-- plant malformed rows as postgres, then check select and delete fail closed
insert into storage.objects (bucket_id, name, metadata)
select 'business-media', n, '{"mimetype":"image/jpeg","size":1000}'
  from unnest(array['not-a-uuid/x.jpg', 'x.jpg', 'zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz/a.jpg']) as n;
select is((select count(*)::int from storage.objects
            where name in ('not-a-uuid/x.jpg', 'x.jpg', 'zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz/a.jpg')), 3,
  'the malformed rows exist (planted as postgres)');
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select is((select count(*)::int from storage.objects
            where name in ('not-a-uuid/x.jpg', 'x.jpg', 'zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz/a.jpg')), 0,
  'anon sees nothing, and no error, for malformed folder names');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000608","role":"authenticated"}';
select is((select count(*)::int from storage.objects
            where name in ('not-a-uuid/x.jpg', 'x.jpg', 'zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz/a.jpg')), 0,
  'an owner sees nothing, and no error, for malformed folder names');
with d as (delete from storage.objects
            where name in ('not-a-uuid/x.jpg', 'x.jpg', 'zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz/a.jpg') returning 1)
select is((select count(*)::int from d), 0, 'an owner deletes nothing, and gets no error, for malformed folder names');
reset role;
select is((select count(*)::int from storage.objects
            where name in ('not-a-uuid/x.jpg', 'x.jpg', 'zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz/a.jpg')), 3,
  'the malformed rows are still there after the delete attempt');
delete from storage.objects
 where name in ('not-a-uuid/x.jpg', 'x.jpg', 'zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz/a.jpg');

-- ── Expiry boundary: a 59-minute reservation is still live (owner 0612, business 06a7) ──
reset role;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000612', 'm612@example.test');
update public.profiles set username = 'menu_612', is_seller = true
 where id = '00000000-0000-0000-0000-000000000612';
insert into public.businesses (id, owner_id, type, name, cuisine_code, map_lat, map_lng, public_address, is_listed) values
  ('00000000-0000-0000-0000-0000000006a7', '00000000-0000-0000-0000-000000000612',
   'restaurant', 'Menu E', 'IT', 43.78, -79.48, '9 Side St, Toronto', true);

-- Order: (1) reserve the boundary photo e1, (2) backdate it to 59 minutes as postgres,
-- (3) reserve five more so the gallery holds 6 pending rows including e1, (4) the next
-- reservation must raise photo_limit because e1 still counts, (5) only then upload to e1's
-- path and finish it, which proves the 59-minute row was neither expired nor purged.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000612","role":"authenticated"}';
insert into res select 'e1', public.begin_photo_upload('gallery');
reset role;
update public.business_photos set created_at = now() - interval '59 minutes'
 where id = pg_temp.rid('e1');
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000612","role":"authenticated"}';
insert into res select 'e2', public.begin_photo_upload('gallery');
insert into res select 'e3', public.begin_photo_upload('gallery');
insert into res select 'e4', public.begin_photo_upload('gallery');
insert into res select 'e5', public.begin_photo_upload('gallery');
insert into res select 'e6', public.begin_photo_upload('gallery');
select throws_ok($$ select public.begin_photo_upload('gallery') $$, 'P0001', 'photo_limit',
  'a 59-minute pending gallery row still counts toward the gallery limit');
select lives_ok($$ call pg_temp.put(pg_temp.rp('e1')) $$,
  'the owner can upload to a reservation that is 59 minutes old');
select lives_ok($$ select public.finish_photo_upload(pg_temp.rid('e1')) $$,
  'finish_photo_upload succeeds for a reservation that is 59 minutes old');
reset role;
select is((select status from public.business_photos where id = pg_temp.rid('e1')), 'ready',
  'the 59-minute reservation is ready after the upload and finish');

-- ── Account deletion cascade queues every photo path (owner 0613, business 06a8) ──
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000613', 'm613@example.test');
update public.profiles set username = 'menu_613', is_seller = true
 where id = '00000000-0000-0000-0000-000000000613';
insert into public.businesses (id, owner_id, type, name, cuisine_code, map_lat, map_lng, public_address, is_listed) values
  ('00000000-0000-0000-0000-0000000006a8', '00000000-0000-0000-0000-000000000613',
   'restaurant', 'Menu D', 'IT', 43.79, -79.49, '10 Side St, Toronto', true);

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000613","role":"authenticated"}';
select lives_ok($$ select public.set_menu_currency('CAD') $$, 'D: set the currency');
select lives_ok($$ select public.create_menu_item('Doomed dish', null, null) $$, 'D: create an item');
insert into res select 'd_cover', public.begin_photo_upload('cover');
insert into res select 'd_gal', public.begin_photo_upload('gallery');
insert into res select 'd_menu', public.begin_photo_upload('menu');
insert into res select 'd_item', public.begin_photo_upload('item',
  (select id from public.menu_items where name = 'Doomed dish' and business_id = '00000000-0000-0000-0000-0000000006a8'));
insert into res select 'd_pend', public.begin_photo_upload('gallery');
call pg_temp.put(pg_temp.rp('d_cover'));
call pg_temp.put(pg_temp.rp('d_gal'));
call pg_temp.put(pg_temp.rp('d_menu'));
call pg_temp.put(pg_temp.rp('d_item'));
select lives_ok($$ select public.finish_photo_upload(pg_temp.rid('d_cover')) $$, 'D: finish the cover');
select lives_ok($$ select public.finish_photo_upload(pg_temp.rid('d_gal')) $$, 'D: finish the gallery photo');
select lives_ok($$ select public.finish_photo_upload(pg_temp.rid('d_menu')) $$, 'D: finish the menu photo');
select lives_ok($$ select public.finish_photo_upload(pg_temp.rid('d_item')) $$, 'D: finish the item photo');
-- d_pend stays pending (never uploaded or finished)

reset role;
delete from auth.users where id = '00000000-0000-0000-0000-000000000613';
select is((select count(*)::int from public.storage_cleanup_queue where path = pg_temp.rp('d_cover')), 1,
  'account deletion queued the cover path');
select is((select count(*)::int from public.storage_cleanup_queue where path = pg_temp.rp('d_gal')), 1,
  'account deletion queued the ready gallery path');
select is((select count(*)::int from public.storage_cleanup_queue where path = pg_temp.rp('d_menu')), 1,
  'account deletion queued the menu photo path');
select is((select count(*)::int from public.storage_cleanup_queue where path = pg_temp.rp('d_item')), 1,
  'account deletion queued the item photo path');
select is((select count(*)::int from public.storage_cleanup_queue where path = pg_temp.rp('d_pend')), 1,
  'account deletion queued the pending gallery path');
select is((select count(*)::int from public.business_photos where business_id = '00000000-0000-0000-0000-0000000006a8'), 0,
  'account deletion removed the business''s photo rows');
select is((select count(*)::int from public.menu_items where business_id = '00000000-0000-0000-0000-0000000006a8'), 0,
  'account deletion removed the business''s menu items');
select is((select count(*)::int from public.businesses where id = '00000000-0000-0000-0000-0000000006a8'), 0,
  'account deletion removed the business');
select is((select count(*)::int from public.storage_cleanup_queue
            where business_id = '00000000-0000-0000-0000-0000000006a8'
              and path in (pg_temp.rp('d_cover'), pg_temp.rp('d_gal'), pg_temp.rp('d_menu'),
                           pg_temp.rp('d_item'), pg_temp.rp('d_pend'))), 5,
  'the queued rows keep the deleted business id');

-- ── Late fixtures: owners 0614-0617, businesses 06a9-06ac (all as postgres) ──
reset role;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000614', 'm614@example.test'),
  ('00000000-0000-0000-0000-000000000615', 'm615@example.test'),
  ('00000000-0000-0000-0000-000000000616', 'm616@example.test'),
  ('00000000-0000-0000-0000-000000000617', 'm617@example.test');
update public.profiles set username = 'menu_' || right(id::text, 3), is_seller = true
 where id between '00000000-0000-0000-0000-000000000614' and '00000000-0000-0000-0000-000000000617';
insert into public.businesses (id, owner_id, type, name, cuisine_code, map_lat, map_lng, public_address, is_listed) values
  ('00000000-0000-0000-0000-0000000006a9', '00000000-0000-0000-0000-000000000614',
   'restaurant', 'Menu F', 'IT', 43.80, -79.50, '11 Side St, Toronto', true),
  ('00000000-0000-0000-0000-0000000006aa', '00000000-0000-0000-0000-000000000615',
   'restaurant', 'Menu G', 'IT', 43.81, -79.51, '12 Side St, Toronto', true),
  ('00000000-0000-0000-0000-0000000006ab', '00000000-0000-0000-0000-000000000616',
   'restaurant', 'Menu T', 'IT', 43.82, -79.52, '13 Side St, Toronto', true),
  ('00000000-0000-0000-0000-0000000006ac', '00000000-0000-0000-0000-000000000617',
   'restaurant', 'Menu S', 'IT', 43.83, -79.53, '14 Side St, Toronto', true);

-- ── cleanup_required (Decision 25), business 06a9 / owner 0614 ──────────────
-- 20 queued files that are still in storage, all inside the business's folder.
insert into public.storage_cleanup_queue (path, business_id)
select '00000000-0000-0000-0000-0000000006a9/00000000-0000-0000-0001-' || lpad(g::text, 12, '0') || '.jpg',
       '00000000-0000-0000-0000-0000000006a9'
  from generate_series(1, 20) g;
insert into storage.objects (bucket_id, name, metadata)
select 'business-media', path, '{"mimetype":"image/jpeg","size":1000}'::jsonb
  from public.storage_cleanup_queue
 where business_id = '00000000-0000-0000-0000-0000000006a9';
insert into res values
  ('cl01', jsonb_build_object('path', '00000000-0000-0000-0000-0000000006a9/00000000-0000-0000-0001-000000000001.jpg')),
  ('cl02', jsonb_build_object('path', '00000000-0000-0000-0000-0000000006a9/00000000-0000-0000-0001-000000000002.jpg')),
  ('cl20', jsonb_build_object('path', '00000000-0000-0000-0000-0000000006a9/00000000-0000-0000-0001-000000000020.jpg'));

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000614","role":"authenticated"}';
select throws_ok($$ select public.begin_photo_upload('cover') $$, 'P0001', 'cleanup_required',
  'cleanup_required: a cover reservation is refused with 20 queued files still in storage');
select throws_ok($$ select public.begin_photo_upload('gallery') $$, 'P0001', 'cleanup_required',
  'cleanup_required: a gallery reservation is refused with 20 queued files still in storage');

-- down to 19 queued files in storage
reset role;
delete from public.storage_cleanup_queue where path = pg_temp.rp('cl20');
delete from storage.objects where name = pg_temp.rp('cl20');
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000614","role":"authenticated"}';
select lives_ok($$ insert into res select 'cl_c', public.begin_photo_upload('cover') $$,
  'with 19 queued files in storage, a cover reservation succeeds');
select lives_ok($$ insert into res select 'cl_g', public.begin_photo_upload('gallery') $$,
  'with 19 queued files in storage, a gallery reservation succeeds');

-- back to 20, then the owner removes two of the queued files
reset role;
insert into public.storage_cleanup_queue (path, business_id)
values (pg_temp.rp('cl20'), '00000000-0000-0000-0000-0000000006a9');
insert into storage.objects (bucket_id, name, metadata)
values ('business-media', pg_temp.rp('cl20'), '{"mimetype":"image/jpeg","size":1000}'::jsonb);
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000614","role":"authenticated"}';
select throws_ok($$ select public.begin_photo_upload('gallery') $$, 'P0001', 'cleanup_required',
  'cleanup_required: back at 20 queued files in storage the reservation is refused again');
with d as (delete from storage.objects where name in (pg_temp.rp('cl01'), pg_temp.rp('cl02')) returning 1)
select is((select count(*)::int from d), 2, 'the owner can delete two queued files');
select lives_ok($$ insert into res select 'cl_g2', public.begin_photo_upload('gallery') $$,
  'after the owner deletes enough queued files, a reservation succeeds again');
reset role;
select is((select count(*)::int from public.storage_cleanup_queue
            where business_id = '00000000-0000-0000-0000-0000000006a9'), 20,
  'queue rows whose file is gone are still queued (cleanup has not run) but no longer count');

-- ── 10-minute wait in claim_photo_cleanup (Decision 26), business 06aa / owner 0615 ──
insert into res values
  ('w1', jsonb_build_object('path', '00000000-0000-0000-0000-0000000006aa/00000000-0000-0000-0002-000000000001.jpg')),
  ('w2', jsonb_build_object('path', '00000000-0000-0000-0000-0000000006aa/00000000-0000-0000-0002-000000000002.jpg'));
insert into public.storage_cleanup_queue (path, business_id, queued_at) values
  (pg_temp.rp('w1'), '00000000-0000-0000-0000-0000000006aa', now() - interval '5 minutes'),
  (pg_temp.rp('w2'), '00000000-0000-0000-0000-0000000006aa', now() - interval '11 minutes');
insert into storage.objects (bucket_id, name, metadata)
values ('business-media', pg_temp.rp('w2'), '{"mimetype":"image/jpeg","size":1000}'::jsonb);
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000615","role":"authenticated"}';
select is((select count(*)::int from public.claim_photo_cleanup() as p where p = pg_temp.rp('w1')), 0,
  'claim_photo_cleanup does not return a path whose file is gone (queue row under 10 minutes old)');
select is((select count(*)::int from public.claim_photo_cleanup() as p where p = pg_temp.rp('w2')), 1,
  'claim_photo_cleanup returns a queued path whose file still exists, however old');
reset role;
select is((select count(*)::int from public.storage_cleanup_queue where path = pg_temp.rp('w1')), 1,
  'claim_photo_cleanup keeps a missing-file queue row younger than 10 minutes');
update public.storage_cleanup_queue set queued_at = now() - interval '11 minutes' where path = pg_temp.rp('w1');
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000615","role":"authenticated"}';
select is((select count(*)::int from public.claim_photo_cleanup() as p where p = pg_temp.rp('w1')), 0,
  'claim_photo_cleanup never returns a path whose file is gone (queue row 11 minutes old)');
reset role;
select is((select count(*)::int from public.storage_cleanup_queue where path = pg_temp.rp('w1')), 0,
  'claim_photo_cleanup drops a missing-file queue row once it is 11 minutes old');

-- ── Description trimming, table checks, pending item photo cascade (business 06ab / owner 0616) ──
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000616","role":"authenticated"}';
select lives_ok($$ select public.create_menu_item('T1', '  Tasty  ', null) $$, 'create_menu_item with a padded description works');
select ok(exists(select 1 from public.menu_items
                  where name = 'T1' and business_id = '00000000-0000-0000-0000-0000000006ab' and description = 'Tasty'),
  'create_menu_item stores ''  Tasty  '' as ''Tasty''');
select lives_ok($$ select public.create_menu_item('T2', 'Old', null) $$, 'create_menu_item for the update test works');
select lives_ok($$ select public.update_menu_item(
    (select id from public.menu_items where name = 'T2' and business_id = '00000000-0000-0000-0000-0000000006ab'),
    'T2', '  Tasty  ', null, true) $$, 'update_menu_item with a padded description works');
select ok(exists(select 1 from public.menu_items
                  where name = 'T2' and business_id = '00000000-0000-0000-0000-0000000006ab' and description = 'Tasty'),
  'update_menu_item stores ''  Tasty  '' as ''Tasty''');
select lives_ok($$ select public.create_menu_item('T3', '   ', null) $$, 'create_menu_item with a blank description works');
select ok(exists(select 1 from public.menu_items
                  where name = 'T3' and business_id = '00000000-0000-0000-0000-0000000006ab' and description is null),
  'create_menu_item stores a blank description as null (and the row exists)');
select lives_ok($$ select public.update_menu_item(
    (select id from public.menu_items where name = 'T2' and business_id = '00000000-0000-0000-0000-0000000006ab'),
    'T2', '   ', null, true) $$, 'update_menu_item with a blank description works');
select ok(exists(select 1 from public.menu_items
                  where name = 'T2' and business_id = '00000000-0000-0000-0000-0000000006ab' and description is null),
  'update_menu_item stores a blank description as null (and the row exists)');

select lives_ok($$ select public.set_menu_currency('CAD') $$, 'T: set the currency so prices can be tried');
select throws_ok($$ select public.create_menu_item('', null, null) $$, '23514', null,
  'create_menu_item with an empty name raises a check violation');
select throws_ok($$ select public.create_menu_item(' padded ', null, null) $$, '23514', null,
  'create_menu_item with an untrimmed name raises a check violation');
select throws_ok($$ select public.create_menu_item('Free', null, 0) $$, '23514', null,
  'create_menu_item with price 0 raises a check violation');
select throws_ok($$ select public.create_menu_item('Negative', null, -1) $$, '23514', null,
  'create_menu_item with price -1 raises a check violation');
select throws_ok($$ select public.create_menu_item('Huge', null, 1000000000) $$, '23514', null,
  'create_menu_item with price 1000000000 raises a check violation');
select throws_ok($$ select public.update_menu_item(
    (select id from public.menu_items where name = 'T2' and business_id = '00000000-0000-0000-0000-0000000006ab'),
    '', null, null, true) $$, '23514', null,
  'update_menu_item with an empty name raises a check violation');
select throws_ok($$ select public.update_menu_item(
    (select id from public.menu_items where name = 'T2' and business_id = '00000000-0000-0000-0000-0000000006ab'),
    'T2', null, 0, true) $$, '23514', null,
  'update_menu_item with price 0 raises a check violation');

-- pending item photo cascade
insert into res select 'pi', public.begin_photo_upload('item',
  (select id from public.menu_items where name = 'T3' and business_id = '00000000-0000-0000-0000-0000000006ab'));
select lives_ok($$ select public.delete_menu_item(
    (select id from public.menu_items where name = 'T3' and business_id = '00000000-0000-0000-0000-0000000006ab')) $$,
  'deleting an item that has a pending item photo works');
reset role;
select is((select count(*)::int from public.business_photos where id = pg_temp.rid('pi')), 0,
  'deleting an item removes its pending item photo row');
select is((select count(*)::int from public.storage_cleanup_queue where path = pg_temp.rp('pi')), 1,
  'deleting an item queues the path of its pending item photo');

-- ── finish_photo_upload size branches and bucket check (business 06ac / owner 0617) ──
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000617","role":"authenticated"}';
insert into res select 'sz0', public.begin_photo_upload('gallery');
insert into res select 'szm', public.begin_photo_upload('gallery');
insert into res select 'sza', public.begin_photo_upload('gallery');
insert into res select 'szl', public.begin_photo_upload('gallery');
insert into res select 'szb', public.begin_photo_upload('gallery');
reset role;
insert into storage.objects (bucket_id, name, metadata) values
  ('business-media', pg_temp.rp('sz0'), '{"mimetype":"image/jpeg","size":0}'::jsonb),
  ('business-media', pg_temp.rp('szm'), '{"mimetype":"image/jpeg"}'::jsonb),
  ('business-media', pg_temp.rp('sza'), '{"mimetype":"image/jpeg","size":"abc"}'::jsonb),
  ('business-media', pg_temp.rp('szl'), '{"mimetype":"image/jpeg","size":2097153}'::jsonb);
insert into storage.buckets (id, name) values ('other-media', 'other-media') on conflict do nothing;
insert into storage.objects (bucket_id, name, metadata)
values ('other-media', pg_temp.rp('szb'), '{"mimetype":"image/jpeg","size":1000}'::jsonb);
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000617","role":"authenticated"}';
select throws_ok($$ select public.finish_photo_upload(pg_temp.rid('sz0')) $$, 'P0001', 'upload_missing',
  'finish_photo_upload with an object of size 0 raises upload_missing');
select throws_ok($$ select public.finish_photo_upload(pg_temp.rid('szm')) $$, 'P0001', 'upload_missing',
  'finish_photo_upload with no size in the metadata raises upload_missing');
select throws_ok($$ select public.finish_photo_upload(pg_temp.rid('sza')) $$, 'P0001', 'upload_missing',
  'finish_photo_upload with a non-numeric size raises upload_missing');
select throws_ok($$ select public.finish_photo_upload(pg_temp.rid('szl')) $$, 'P0001', 'upload_missing',
  'finish_photo_upload with a size of 2097153 raises upload_missing');
select throws_ok($$ select public.finish_photo_upload(pg_temp.rid('szb')) $$, 'P0001', 'upload_missing',
  'finish_photo_upload with an object of the same name in another bucket raises upload_missing');

-- ── Pending menu reservation expiry (same business 06ac) ────────────────────
reset role;
insert into public.business_photos (id, business_id, kind, path, status)
select ('00000000-0000-0000-0003-' || lpad(g::text, 12, '0'))::uuid,
       '00000000-0000-0000-0000-0000000006ac', 'menu',
       '00000000-0000-0000-0000-0000000006ac/00000000-0000-0000-0003-' || lpad(g::text, 12, '0') || '.jpg',
       'pending'
  from generate_series(1, 10) g;
insert into res values
  ('me1', jsonb_build_object('photo_id', '00000000-0000-0000-0003-000000000001',
                             'path', '00000000-0000-0000-0000-0000000006ac/00000000-0000-0000-0003-000000000001.jpg'));
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000617","role":"authenticated"}';
select throws_ok($$ select public.begin_photo_upload('menu') $$, 'P0001', 'photo_limit',
  'ten fresh pending menu reservations fill the menu limit');
reset role;
update public.business_photos set created_at = now() - interval '61 minutes' where id = pg_temp.rid('me1');
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000617","role":"authenticated"}';
select lives_ok($$ insert into res select 'me11', public.begin_photo_upload('menu') $$,
  'a pending menu reservation older than 1 hour stops counting toward the 10');
reset role;
select is((select count(*)::int from public.business_photos where id = pg_temp.rid('me1')), 0,
  'begin_photo_upload deleted the expired pending menu reservation');
select is((select count(*)::int from public.storage_cleanup_queue where path = pg_temp.rp('me1')), 1,
  'the expired pending menu reservation''s path is queued');

-- ── currencies guard, as the table owner (postgres) ─────────────────────────
-- Each statement runs inside throws_ok's own subtransaction, so nothing leaks into the rest of the file.
-- TRUNCATE uses CASCADE so the foreign key from businesses cannot raise first: only the guard may refuse it.
select throws_ok($$ update public.currencies set code = 'ZZZ' where code = 'USD' $$, 'P0001', null,
  'the currencies guard blocks a code change (P0001)');
select throws_like($$ update public.currencies set code = 'ZZZ' where code = 'USD' $$, 'currency_code_permanent%',
  'the code-change error starts with currency_code_permanent');
select throws_ok($$ delete from public.currencies where code = 'USD' $$, 'P0001', null,
  'the currencies guard blocks a delete (P0001)');
select throws_like($$ delete from public.currencies where code = 'USD' $$, 'currency_code_permanent%',
  'the delete error starts with currency_code_permanent');
-- Run the deferred menu_items position checks now: TRUNCATE refuses (55006) a table with pending
-- trigger events before any truncate trigger fires, which would hide the guard.
set constraints all immediate;
select throws_ok($$ truncate public.currencies cascade $$, 'P0001', null,
  'the currencies guard blocks a truncate (P0001)');
select throws_like($$ truncate public.currencies cascade $$, 'currency_code_permanent%',
  'the truncate error starts with currency_code_permanent');

select * from finish();
rollback;
