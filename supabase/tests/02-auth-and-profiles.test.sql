-- Spec 02: profiles table — RLS, grants, triggers and check constraints.
begin;
select plan(59);

-- Two users: owner (…01) and outsider (…02). Inserting into auth.users fires the profile trigger.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'owner@example.test'),
  ('00000000-0000-0000-0000-000000000002', 'outsider@example.test');

-- ── Structure and trigger ───────────────────────────────────────────────────
select ok(
  (select relrowsecurity from pg_class where oid = 'public.profiles'::regclass),
  'RLS is enabled on profiles'
);
select is(
  (select count(*)::int from public.profiles
    where id in ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002')),
  2,
  'trigger creates exactly one profile per auth user'
);
select is(
  (select username from public.profiles where id = '00000000-0000-0000-0000-000000000001'),
  null,
  'new profile has a null username until setup'
);

-- ── Grants and function hardening (a later migration must not loosen these) ─
select table_privs_are('public', 'profiles', 'anon', array[]::text[],
  'anon has no privileges on profiles');
select table_privs_are('public', 'profiles', 'authenticated', array['SELECT'],
  'authenticated has only table-level SELECT on profiles');
select column_privs_are('public', 'profiles', 'is_seller', 'authenticated', array['SELECT'],
  'authenticated cannot update is_seller');
select column_privs_are('public', 'profiles', 'id', 'authenticated', array['SELECT'],
  'authenticated cannot update id');
select column_privs_are('public', 'profiles', 'created_at', 'authenticated', array['SELECT'],
  'authenticated cannot update created_at');
select column_privs_are('public', 'profiles', 'updated_at', 'authenticated', array['SELECT'],
  'authenticated cannot update updated_at');
select column_privs_are('public', 'profiles', 'username', 'authenticated', array['SELECT', 'UPDATE'],
  'authenticated can update username');
select column_privs_are('public', 'profiles', 'display_name', 'authenticated', array['SELECT', 'UPDATE'],
  'authenticated can update display_name');
select column_privs_are('public', 'profiles', 'bio', 'authenticated', array['SELECT', 'UPDATE'],
  'authenticated can update bio');
select column_privs_are('public', 'profiles', 'city', 'authenticated', array['SELECT', 'UPDATE'],
  'authenticated can update city');

select ok(not has_function_privilege('anon', 'public.handle_new_user()', 'execute'),
  'anon cannot execute handle_new_user');
select ok(not has_function_privilege('authenticated', 'public.handle_new_user()', 'execute'),
  'authenticated cannot execute handle_new_user');
select ok(not has_function_privilege('anon', 'public.set_updated_at()', 'execute'),
  'anon cannot execute set_updated_at');
select ok(not has_function_privilege('authenticated', 'public.set_updated_at()', 'execute'),
  'authenticated cannot execute set_updated_at');
select ok((select prosecdef from pg_proc where oid = 'public.handle_new_user()'::regprocedure),
  'handle_new_user is security definer');
select is((select proconfig from pg_proc where oid = 'public.handle_new_user()'::regprocedure),
  array['search_path=""'], 'handle_new_user pins an empty search_path');
select is((select proconfig from pg_proc where oid = 'public.set_updated_at()'::regprocedure),
  array['search_path=""'], 'set_updated_at pins an empty search_path');

-- Backdate updated_at (trigger off) so the server-set value is observable later.
alter table public.profiles disable trigger profiles_set_updated_at;
update public.profiles set updated_at = '2000-01-01T00:00:00Z'
 where id = '00000000-0000-0000-0000-000000000001';
alter table public.profiles enable trigger profiles_set_updated_at;

-- ── Anon ────────────────────────────────────────────────────────────────────
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

select throws_ok(
  $$ select * from public.profiles $$,
  '42501', null,
  'anon cannot select profiles'
);
select throws_ok(
  $$ insert into public.profiles (id) values ('00000000-0000-0000-0000-000000000003') $$,
  '42501', null,
  'anon cannot insert profiles'
);
select throws_ok(
  $$ update public.profiles set bio = 'anon' where id = '00000000-0000-0000-0000-000000000001' $$,
  '42501', null,
  'anon cannot update profiles'
);
select throws_ok(
  $$ delete from public.profiles where id = '00000000-0000-0000-0000-000000000001' $$,
  '42501', null,
  'anon cannot delete profiles'
);

-- ── Owner ───────────────────────────────────────────────────────────────────
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';

select lives_ok(
  $$ update public.profiles
        set username = 'archan', display_name = 'Archan Me', bio = 'Hungry.', city = 'Berlin'
      where id = '00000000-0000-0000-0000-000000000001' $$,
  'owner can update username, display_name, bio and city'
);
select results_eq(
  $$ select username, display_name, bio, city from public.profiles
      where id = '00000000-0000-0000-0000-000000000001' $$,
  $$ values ('archan'::text, 'Archan Me'::text, 'Hungry.'::text, 'Berlin'::text) $$,
  'owner update is stored'
);
select ok(
  (select updated_at > '2000-01-01T00:00:00Z' from public.profiles
    where id = '00000000-0000-0000-0000-000000000001'),
  'trigger sets updated_at on update'
);
select is(
  (select count(*)::int from public.profiles
    where id in ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002')),
  2,
  'authenticated user can select other users'' profiles'
);

-- Column grants: server-owned columns can't be written by the client.
select throws_ok(
  $$ update public.profiles set is_seller = true where id = '00000000-0000-0000-0000-000000000001' $$,
  '42501', null, 'owner cannot set is_seller'
);
select throws_ok(
  $$ update public.profiles set id = '00000000-0000-0000-0000-000000000009' where id = '00000000-0000-0000-0000-000000000001' $$,
  '42501', null, 'owner cannot change id'
);
select throws_ok(
  $$ update public.profiles set created_at = now() - interval '1 year' where id = '00000000-0000-0000-0000-000000000001' $$,
  '42501', null, 'owner cannot set created_at'
);
select throws_ok(
  $$ update public.profiles set updated_at = '2000-01-01T00:00:00Z' where id = '00000000-0000-0000-0000-000000000001' $$,
  '42501', null, 'owner cannot set updated_at'
);

-- No client insert or delete.
select throws_ok(
  $$ insert into public.profiles (id) values ('00000000-0000-0000-0000-000000000001') $$,
  '42501', null, 'client cannot insert a profile, even for their own id'
);
select throws_ok(
  $$ delete from public.profiles where id = '00000000-0000-0000-0000-000000000001' $$,
  '42501', null, 'client cannot delete a profile'
);

-- Check constraints: rejected values.
select throws_ok(
  $$ update public.profiles set username = 'ab' where id = '00000000-0000-0000-0000-000000000001' $$,
  '23514', null, 'username shorter than 3 is rejected'
);
select throws_ok(
  $$ update public.profiles set username = 'has space' where id = '00000000-0000-0000-0000-000000000001' $$,
  '23514', null, 'username with a space is rejected'
);
select throws_ok(
  $$ update public.profiles set username = 'UPPER' where id = '00000000-0000-0000-0000-000000000001' $$,
  '23514', null, 'uppercase username is rejected'
);
select throws_ok(
  $$ update public.profiles set username = repeat('a', 21) where id = '00000000-0000-0000-0000-000000000001' $$,
  '23514', null, 'username longer than 20 is rejected'
);
select throws_ok(
  $$ update public.profiles set display_name = '' where id = '00000000-0000-0000-0000-000000000001' $$,
  '23514', null, 'empty display name is rejected'
);
select throws_ok(
  $$ update public.profiles set display_name = '   ' where id = '00000000-0000-0000-0000-000000000001' $$,
  '23514', null, 'whitespace-only display name is rejected'
);
select throws_ok(
  $$ update public.profiles set display_name = repeat('a', 51) where id = '00000000-0000-0000-0000-000000000001' $$,
  '23514', null, 'display name longer than 50 is rejected'
);
select throws_ok(
  $$ update public.profiles set bio = repeat('a', 161) where id = '00000000-0000-0000-0000-000000000001' $$,
  '23514', null, 'bio longer than 160 is rejected'
);
select throws_ok(
  $$ update public.profiles set city = repeat('a', 61) where id = '00000000-0000-0000-0000-000000000001' $$,
  '23514', null, 'city longer than 60 is rejected'
);
select throws_ok(
  $$ update public.profiles set bio = null where id = '00000000-0000-0000-0000-000000000001' $$,
  '23502', null, 'bio cannot be null'
);

-- Check constraints: boundary values that must pass (mirrored by the zod schemas).
select lives_ok(
  $$ update public.profiles set username = 'abc' where id = '00000000-0000-0000-0000-000000000001' $$,
  'username of exactly 3 is allowed'
);
select lives_ok(
  $$ update public.profiles set username = 'a_1' || repeat('b', 17) where id = '00000000-0000-0000-0000-000000000001' $$,
  'username of exactly 20 with digits and underscore is allowed'
);
select lives_ok(
  $$ update public.profiles set display_name = 'A' where id = '00000000-0000-0000-0000-000000000001' $$,
  'display name of exactly 1 is allowed'
);
select lives_ok(
  $$ update public.profiles set display_name = repeat('a', 50) where id = '00000000-0000-0000-0000-000000000001' $$,
  'display name of exactly 50 is allowed'
);
select lives_ok(
  $$ update public.profiles set bio = repeat('a', 160), city = repeat('a', 60)
      where id = '00000000-0000-0000-0000-000000000001' $$,
  'bio of 160 and city of 60 are allowed'
);
select lives_ok(
  $$ update public.profiles set bio = '', city = '' where id = '00000000-0000-0000-0000-000000000001' $$,
  'empty bio and city are allowed'
);
-- Reserved usernames (Decision 8): rejected exactly, but allowed as part of a longer name.
select throws_ok(
  $$ update public.profiles set username = 'admin' where id = '00000000-0000-0000-0000-000000000001' $$,
  '23514', null, 'reserved username admin is rejected'
);
select throws_ok(
  $$ update public.profiles set username = 'liketoorder' where id = '00000000-0000-0000-0000-000000000001' $$,
  '23514', null, 'reserved username liketoorder is rejected'
);
select lives_ok(
  $$ update public.profiles set username = 'admin_fan' where id = '00000000-0000-0000-0000-000000000001' $$,
  'a username that only contains a reserved word is allowed'
);

select lives_ok(
  $$ update public.profiles set username = 'archan' where id = '00000000-0000-0000-0000-000000000001' $$,
  'owner sets username back to archan'
);

-- ── Outsider ────────────────────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';

with u as (
  update public.profiles set bio = 'hacked'
   where id = '00000000-0000-0000-0000-000000000001'
  returning 1
)
select is(count(*)::int, 0, 'outsider update of another profile affects 0 rows') from u;

-- Username uniqueness is case-insensitive: lowercase duplicates violate unique,
-- and any uppercase spelling is rejected by the lowercase-only check.
select throws_ok(
  $$ update public.profiles set username = 'archan' where id = '00000000-0000-0000-0000-000000000002' $$,
  '23505', null, 'taken username is rejected'
);
select throws_ok(
  $$ update public.profiles set username = 'Archan' where id = '00000000-0000-0000-0000-000000000002' $$,
  '23514', null, 'differently-cased taken username is rejected'
);

-- ── Back to postgres: verify the outsider changed nothing, then cascade ─────
reset role;

select is(
  (select bio from public.profiles where id = '00000000-0000-0000-0000-000000000001'),
  '',
  'owner profile is unchanged after the outsider update'
);

delete from auth.users where id = '00000000-0000-0000-0000-000000000002';
select is(
  (select count(*)::int from public.profiles where id = '00000000-0000-0000-0000-000000000002'),
  0,
  'deleting the auth user cascades to the profile'
);

select * from finish();
rollback;
