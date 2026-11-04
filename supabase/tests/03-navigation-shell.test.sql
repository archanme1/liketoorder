-- Spec 03: guests browse as anon, so anon must hold no table or column privileges in public
-- unless a spec grants them on purpose. A later spec that gives guests read access adds its table
-- to the ALLOWLIST block below in the same PR, with its own pgTAP test for both sides.
begin;
select plan(8);

-- ── profiles stays authenticated-only ───────────────────────────────────────
select table_privs_are('public', 'profiles', 'anon', array[]::text[],
  'anon has no privileges on profiles');
-- Table-level checks don't see column grants (e.g. grant select (username) ... to anon).
select ok(
  not has_any_column_privilege('anon', 'public.profiles', 'SELECT, INSERT, UPDATE, REFERENCES'),
  'anon has no column privileges on profiles'
);

-- ── No anon table or column privileges in public outside the allowlist ──────
-- has_table_privilege / has_any_column_privilege read the ACLs directly (information_schema only
-- lists grants visible to the current role), and also catch privileges granted to PUBLIC.
select is_empty(
  $$ with allow(relname) as (
       -- ALLOWLIST: tables guests may access on purpose; add one row per table.
       select 'cuisines'::name   -- spec 04: read-only catalog (04-cuisine-catalog.test.sql)
       union all
       select 'businesses'::name -- spec 05: public listing columns only (05-seller-onboarding.test.sql)
       union all
       select 'currencies'::name -- spec 06: read-only catalog (06-menu-management.test.sql)
       union all
       select 'menu_items'::name -- spec 06: select on listed businesses' items (06-menu-management.test.sql)
       union all
       select 'business_photos'::name -- spec 06: select on ready photos of listed businesses (06-menu-management.test.sql)
     )
     select c.relname::text
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relkind in ('r', 'v', 'm', 'p', 'f')
        and c.relname not in (select relname from allow)
        and (has_table_privilege('anon', c.oid,
               'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
             or has_any_column_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, REFERENCES'))
   $$,
  'anon holds no table or column privileges on any public table outside the allowlist'
);
select ok(
  (select count(*) > 0 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'),
  'the allowlist check has public tables to inspect'
);

-- ── Behaviour as anon ───────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000031', 'owner03@example.test');

set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

select throws_ok(
  $$ select * from public.profiles $$,
  '42501', null,
  'anon cannot select profiles'
);
select throws_ok(
  $$ insert into public.profiles (id) values ('00000000-0000-0000-0000-000000000032') $$,
  '42501', null,
  'anon cannot insert profiles'
);
select throws_ok(
  $$ update public.profiles set bio = 'anon' where id = '00000000-0000-0000-0000-000000000031' $$,
  '42501', null,
  'anon cannot update profiles'
);
select throws_ok(
  $$ delete from public.profiles where id = '00000000-0000-0000-0000-000000000031' $$,
  '42501', null,
  'anon cannot delete profiles'
);

select * from finish();
rollback;
