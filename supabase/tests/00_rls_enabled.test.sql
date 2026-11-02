-- S2 guard: every table in `public` must have RLS enabled.
-- Runs in CI on every PR, so a table shipped without RLS fails the build.
-- On failure, pgTAP lists the offending tables.
begin;
select plan(1);

select is_empty(
  $$ select c.relname::text
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relkind in ('r', 'p')
        and not c.relrowsecurity $$,
  'every public table has row level security enabled'
);

select * from finish();
rollback;
