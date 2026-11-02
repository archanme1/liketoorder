-- S2 guard: every table in `public` must have RLS enabled.
-- Runs in CI on every PR, so a table shipped without RLS fails the build.
-- On failure, pgTAP lists the offending tables.
begin;
select plan(2);

select is_empty(
  $$ select c.relname::text
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relkind in ('r', 'p')
        and not c.relrowsecurity $$,
  'every public table has row level security enabled'
);

-- Views run with their owner's rights and skip RLS unless security_invoker is set.
-- Materialized views can't use security_invoker, so any in public fails.
select is_empty(
  $$ select c.relname::text
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and (
          c.relkind = 'm'
          or (c.relkind = 'v'
              and not coalesce(c.reloptions @> array['security_invoker=true'], false))
        ) $$,
  'every public view uses security_invoker, and there are no materialized views'
);

select * from finish();
rollback;
