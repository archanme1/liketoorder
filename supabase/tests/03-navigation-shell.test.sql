-- Spec 03: guests browse as anon, so anon must hold no table privileges in public unless a spec
-- grants them on purpose. A later spec that gives guests read access adds its table to the
-- allowlist below in the same PR, with its own pgTAP test for both sides.
begin;
select plan(7);

-- ── profiles stays authenticated-only ───────────────────────────────────────
select table_privs_are('public', 'profiles', 'anon', array[]::text[],
  'anon has no privileges on profiles');

-- ── No anon table privileges in public outside the allowlist ────────────────
-- has_table_privilege reads the ACLs directly (information_schema only lists grants visible to
-- the current role), and also catches privileges granted to PUBLIC.
select is_empty(
  $$ select c.relname::text
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relkind in ('r', 'v', 'm', 'p', 'f')
        and c.relname <> all (array[]::name[]) -- allowlist: empty today
        and has_table_privilege('anon', c.oid,
              'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
   $$,
  'anon holds no table privileges on any public table outside the allowlist'
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
