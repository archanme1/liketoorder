-- Spec 04: cuisines — read-only catalog, seed contents, sort order, permanent codes, RLS and grants.
begin;
select plan(60);

-- ── Structure, grants and function hardening ────────────────────────────────
select ok(
  (select relrowsecurity from pg_class where oid = 'public.cuisines'::regclass),
  'RLS is enabled on cuisines'
);
select table_privs_are('public', 'cuisines', 'anon', array['SELECT'],
  'anon has only SELECT on cuisines');
select table_privs_are('public', 'cuisines', 'authenticated', array['SELECT'],
  'authenticated has only SELECT on cuisines');
-- Table-level checks don't see column grants.
select ok(
  not has_any_column_privilege('anon', 'public.cuisines', 'INSERT, UPDATE, REFERENCES'),
  'anon has no column privileges beyond select on cuisines'
);
select ok(
  not has_any_column_privilege('authenticated', 'public.cuisines', 'INSERT, UPDATE, REFERENCES'),
  'authenticated has no column privileges beyond select on cuisines'
);
select is(
  (select c.collname::text
     from pg_attribute a join pg_collation c on c.oid = a.attcollation
    where a.attrelid = 'public.cuisines'::regclass and a.attname = 'name'),
  'en-x-icu',
  'cuisines.name uses the ICU English collation'
);
select ok(not has_function_privilege('anon', 'public.cuisines_guard()', 'execute'),
  'anon cannot execute cuisines_guard');
select ok(not has_function_privilege('authenticated', 'public.cuisines_guard()', 'execute'),
  'authenticated cannot execute cuisines_guard');
select is((select proconfig from pg_proc where oid = 'public.cuisines_guard()'::regprocedure),
  array['search_path=""'], 'cuisines_guard pins an empty search_path');
-- Grantee 0 is PUBLIC; the revoke was re-run after the function was replaced.
select ok(
  not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
               where p.oid = 'public.cuisines_guard()'::regprocedure
                 and a.grantee = 0 and a.privilege_type = 'EXECUTE'),
  'PUBLIC cannot execute cuisines_guard'
);
-- tgtype bits: BEFORE (2) + TRUNCATE (32), no ROW bit (1) = statement level.
select is(
  (select tgtype::int from pg_trigger
    where tgrelid = 'public.cuisines'::regclass and tgname = 'cuisines_guard_truncate'),
  34,
  'cuisines_guard_truncate is a before-truncate statement trigger'
);

-- ── Seed contents ───────────────────────────────────────────────────────────
select is((select count(*)::int from public.cuisines), 200, '200 cuisines in total');
select is((select count(*)::int from public.cuisines where kind = 'country'), 197, '197 countries');
select is((select count(*)::int from public.cuisines where kind = 'neutral'), 3, '3 neutral cuisines');
select set_eq(
  $$ select code from public.cuisines where kind = 'neutral' $$,
  array['street-food', 'fusion', 'other'],
  'neutral cuisines are street-food, fusion and other (no vegan)'
);

-- The approved list: 193 UN members + TW, PS, HK, PR. A typo, gap or extra territory fails.
select set_eq(
  $$ select code from public.cuisines where kind = 'country' $$,
  array[
    -- Africa
    'DZ','EG','LY','MA','SD','TN',
    'BJ','BF','CV','CI','GM','GH','GN','GW','LR','ML','MR','NE','NG','SN','SL','TG',
    'AO','CM','CF','TD','CG','CD','GQ','GA','ST',
    'BI','KM','DJ','ER','ET','KE','MG','MW','MU','MZ','RW','SC','SO','SS','TZ','UG','ZM','ZW',
    'BW','SZ','LS','NA','ZA',
    -- Americas
    'CA','US',
    'AG','BS','BB','CU','DM','DO','GD','HT','JM','PR','KN','LC','VC','TT',
    'BZ','CR','SV','GT','HN','MX','NI','PA',
    'AR','BO','BR','CL','CO','EC','GY','PY','PE','SR','UY','VE',
    -- Asia
    'KZ','KG','TJ','TM','UZ',
    'CN','HK','JP','MN','KP','KR','TW',
    'BN','KH','ID','LA','MY','MM','PH','SG','TH','TL','VN',
    'AF','BD','BT','IN','IR','MV','NP','PK','LK',
    'AM','AZ','BH','CY','GE','IQ','IL','JO','KW','LB','OM','PS','QA','SA','SY','TR','AE','YE',
    -- Europe
    'BY','BG','CZ','HU','MD','PL','RO','RU','SK','UA',
    'DK','EE','FI','IS','IE','LV','LT','NO','SE','GB',
    'AL','AD','BA','HR','GR','IT','MT','ME','MK','PT','SM','RS','SI','ES',
    'AT','BE','FR','DE','LI','LU','MC','NL','CH',
    -- Oceania
    'AU','FJ','KI','MH','FM','NR','NZ','PW','PG','WS','SB','TO','TV','VU'
  ],
  'country codes equal the approved 197-code list'
);

-- Decision 5: required countries, by name.
select is_empty(
  $$ select n from unnest(array[
       'Canada', 'United States', 'India', 'Pakistan', 'Sri Lanka', 'Philippines', 'China',
       'Jamaica', 'Trinidad and Tobago', 'Nigeria', 'Ethiopia', 'Somalia', 'South Korea',
       'Vietnam', 'Lebanon', 'Iran', 'Portugal', 'Greece', 'Poland', 'Ukraine'
     ]) as n
     where n not in (select name::text from public.cuisines where kind = 'country') $$,
  'all 20 required countries are present by name'
);
-- Decision 6: names.
select is_empty(
  $$ select n from unnest(array[
       'Taiwan', 'Palestine', 'Hong Kong', 'Puerto Rico', 'Russia', 'Türkiye', 'Czechia',
       'United Kingdom'
     ]) as n
     where n not in (select name::text from public.cuisines where kind = 'country') $$,
  'Decision 6 names are present'
);

-- Known flags, as literals (independent of the generated-column expression).
select is((select flag from public.cuisines where code = 'IT'), '🇮🇹', 'IT flag is 🇮🇹');
select is((select flag from public.cuisines where code = 'CA'), '🇨🇦', 'CA flag is 🇨🇦');
select is((select flag from public.cuisines where code = 'JP'), '🇯🇵', 'JP flag is 🇯🇵');
select is((select flag from public.cuisines where code = 'GB'), '🇬🇧', 'GB flag is 🇬🇧');
select is((select flag from public.cuisines where code = 'TW'), '🇹🇼', 'TW flag is 🇹🇼');

-- Every country flag is the regional-indicator pair for its code.
select is_empty(
  $$ select code from public.cuisines
      where kind = 'country'
        and (flag is null
             or flag <> chr(127397 + ascii(substr(code, 1, 1))) || chr(127397 + ascii(substr(code, 2, 1)))) $$,
  'every country flag matches its code'
);
select is(
  (select count(*)::int from public.cuisines
    where kind = 'country' and char_length(flag) = 2
      and flag = chr(127397 + ascii(substr(code, 1, 1))) || chr(127397 + ascii(substr(code, 2, 1)))),
  197,
  'all 197 country flags were checked'
);

-- Shape.
select is_empty(
  $$ select code from public.cuisines where kind = 'country' and icon is not null $$,
  'no country has an icon'
);
select is_empty(
  $$ select code from public.cuisines where kind = 'neutral' and (icon is null or flag is not null) $$,
  'every neutral cuisine has an icon and no flag'
);
select is(
  (select code from public.cuisines order by sort_order desc limit 1),
  'other',
  'Other has the highest sort_order'
);

-- ── Order (sort_order, then ICU name) ──────────────────────────────────────
select is(
  (select string_agg(name, ' > ' order by sort_order, name) from public.cuisines
    where name in ('Croatia', 'Costa Rica', 'Côte d''Ivoire')),
  'Costa Rica > Côte d''Ivoire > Croatia',
  'Côte d''Ivoire sorts between Costa Rica and Croatia'
);
select is(
  (select string_agg(name, ' > ' order by sort_order, name) from public.cuisines
    where name in ('Saudi Arabia', 'San Marino', 'São Tomé and Príncipe')),
  'San Marino > São Tomé and Príncipe > Saudi Arabia',
  'São Tomé and Príncipe sorts between San Marino and Saudi Arabia'
);
select is(
  (select string_agg(name, ' > ' order by sort_order, name) from public.cuisines
    where name in ('Turkmenistan', 'Tunisia', 'Türkiye')),
  'Tunisia > Türkiye > Turkmenistan',
  'Türkiye sorts between Tunisia and Turkmenistan'
);
select is(
  (select name::text from public.cuisines order by sort_order, name limit 1),
  'Afghanistan',
  'the first cuisine is Afghanistan'
);
select is(
  (select string_agg(name, ' > ' order by sort_order, name)
     from (select name, sort_order from public.cuisines order by sort_order desc, name desc limit 3) s),
  'Street food > Fusion > Other',
  'the last three cuisines are Street food, Fusion, Other'
);

-- ── Constraints (as the table owner) ────────────────────────────────────────
select throws_ok(
  $$ insert into public.cuisines (code, kind, name, sort_order) values ('xx', 'country', 'Lowerland', 100) $$,
  '23514', null, 'a lower-case country code is rejected'
);
select throws_ok(
  $$ insert into public.cuisines (code, kind, name, sort_order) values ('ITA', 'country', 'Threeland', 100) $$,
  '23514', null, 'a 3-letter country code is rejected'
);
select throws_ok(
  $$ insert into public.cuisines (code, kind, name, icon, sort_order)
     values ('XX', 'country', 'Iconland', 'shuffle-outline', 100) $$,
  '23514', null, 'a country with an icon is rejected'
);
select throws_ok(
  $$ insert into public.cuisines (code, kind, name, icon, sort_order)
     values ('Street', 'neutral', 'Upper street', 'shuffle-outline', 900) $$,
  '23514', null, 'a neutral cuisine with an upper-case code is rejected'
);
select throws_ok(
  $$ insert into public.cuisines (code, kind, name, sort_order) values ('no-icon', 'neutral', 'No icon', 900) $$,
  '23514', null, 'a neutral cuisine without an icon is rejected'
);
select throws_ok(
  $$ insert into public.cuisines (code, kind, name, sort_order) values ('XX', 'region', 'Regionland', 100) $$,
  '23514', null, 'an unknown kind is rejected'
);
select throws_ok(
  $$ insert into public.cuisines (code, kind, name, sort_order) values ('XX', 'country', repeat('a', 41), 100) $$,
  '23514', null, 'a name longer than 40 is rejected'
);
select throws_ok(
  $$ insert into public.cuisines (code, kind, name, sort_order) values ('XX', 'country', 'Italy', 100) $$,
  '23505', null, 'a duplicate name is rejected'
);
select throws_ok(
  $$ insert into public.cuisines (code, kind, name, sort_order) values ('IT', 'country', 'Italia', 100) $$,
  '23505', null, 'a duplicate code is rejected'
);

-- ── Codes are permanent (as the table owner, i.e. the migration role) ──────
select throws_ok(
  $$ update public.cuisines set code = 'XI' where code = 'IT' $$,
  'P0001', 'cuisine_code_permanent: codes are never renamed',
  'renaming a code fails even as the table owner'
);
select throws_ok(
  $$ delete from public.cuisines where code = 'IT' $$,
  'P0001', 'cuisine_code_permanent: rows are never deleted',
  'deleting a row fails even as the table owner'
);
-- cascade: since spec 05, businesses.cuisine_code references this table, so a plain truncate is
-- refused by the foreign key (0A000) before the guard runs. Cascade gets past that, so the guard is tested.
select throws_ok(
  $$ truncate public.cuisines cascade $$,
  'P0001', 'cuisine_code_permanent: the table is never truncated',
  'truncating the table fails even as the table owner'
);
select lives_ok(
  $$ update public.cuisines set name = 'Italy (test)' where code = 'IT' $$,
  'the table owner can update a name'
);
select lives_ok(
  $$ update public.cuisines set icon = 'shuffle-outline' where code = 'other' $$,
  'the table owner can update an icon'
);
select lives_ok(
  $$ update public.cuisines set sort_order = 101 where code = 'IT' $$,
  'the table owner can update a sort_order'
);
select results_eq(
  -- results_eq compares rows, so the ICU-collated name must match the literal's default collation.
  $$ select code, name collate "default", sort_order::int from public.cuisines where code = 'IT' $$,
  $$ values ('IT'::text, 'Italy (test)'::text, 101) $$,
  'owner updates to name and sort_order are stored, code unchanged'
);

-- ── Anon ────────────────────────────────────────────────────────────────────
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

select is((select count(*)::int from public.cuisines), 200, 'anon can read all 200 cuisines');
select throws_ok(
  $$ insert into public.cuisines (code, kind, name, sort_order) values ('XX', 'country', 'Anonland', 100) $$,
  '42501', null, 'anon cannot insert cuisines'
);
select throws_ok(
  $$ update public.cuisines set name = 'Hacked' where code = 'JP' $$,
  '42501', null, 'anon cannot update cuisines'
);
select throws_ok(
  $$ delete from public.cuisines where code = 'JP' $$,
  '42501', null, 'anon cannot delete cuisines'
);
select throws_ok(
  $$ truncate public.cuisines $$,
  '42501', null, 'anon cannot truncate cuisines'
);

-- ── Authenticated ───────────────────────────────────────────────────────────
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000041","role":"authenticated"}';

select is((select count(*)::int from public.cuisines), 200, 'authenticated can read all 200 cuisines');
select throws_ok(
  $$ insert into public.cuisines (code, kind, name, sort_order) values ('XX', 'country', 'Userland', 100) $$,
  '42501', null, 'authenticated cannot insert cuisines'
);
select throws_ok(
  $$ update public.cuisines set name = 'Hacked' where code = 'JP' $$,
  '42501', null, 'authenticated cannot update cuisines'
);
select throws_ok(
  $$ delete from public.cuisines where code = 'JP' $$,
  '42501', null, 'authenticated cannot delete cuisines'
);
select throws_ok(
  $$ truncate public.cuisines $$,
  '42501', null, 'authenticated cannot truncate cuisines'
);

-- ── Back to the owner: nothing the clients tried was stored ────────────────
reset role;
select is((select name::text from public.cuisines where code = 'JP'), 'Japan',
  'Japan is unchanged after the client write attempts');

select * from finish();
rollback;
