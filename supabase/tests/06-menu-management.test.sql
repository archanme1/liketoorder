-- Spec 06: menu management (PR 1, database and storage only) — currencies, menu_items,
-- business_photos, storage_cleanup_queue, the business-media bucket and its storage.objects
-- policies, and the menu / photo functions.
-- The function allowlist, the `private` schema checks, businesses.currency_code column
-- privileges and the get_my_business key list live in the 05 file.
begin;
select plan(275);

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
-- items 06f1..06f7, photos 0621..0626 and 0631..0633
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
            where schemaname = 'storage' and tablename = 'objects' and cmd = 'UPDATE'
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
select is((select count(*)::int from public.currencies where minor_units not in (0, 2, 3)), 0,
  'no currency has minor units outside 0, 2 and 3');
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
select is((select description from public.menu_items where name = 'Plain' and business_id = '00000000-0000-0000-0000-0000000006a2'),
  null::text, 'an empty description is stored as null');
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
select is((select price_minor from public.menu_items where name = 'Priced' and business_id = '00000000-0000-0000-0000-0000000006a2'),
  null::integer, 'the price is now null');
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
select ok((select array_agg(mi.position order by mi.position) = (select array_agg(g order by g) from generate_series(1, 99) g)
             from public.menu_items mi where mi.business_id = '00000000-0000-0000-0000-0000000006a2'),
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
select throws_ok($$ call pg_temp.put(pg_temp.rp('g7')) $$, null::char(5), null::text,
  'uploading again to a path that already has an object is refused');
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
do $$
declare n text;
begin
  foreach n in array array['not-a-uuid/x.jpg', 'x.jpg', 'zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz/a.jpg'] loop
    begin
      insert into storage.objects (bucket_id, name, metadata)
      values ('business-media', n, '{"mimetype":"image/jpeg","size":1000}');
    exception when others then
      null;
    end;
  end loop;
end $$;
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

select * from finish();
rollback;
