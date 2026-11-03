-- Spec 04 review fix: row triggers don't fire on TRUNCATE, so the permanence guard also needs a
-- statement-level trigger. Without it, a truncate + re-seed could reuse a code for another cuisine.

create or replace function public.cuisines_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'TRUNCATE' then raise exception 'cuisine_code_permanent: the table is never truncated'; end if;
  if tg_op = 'DELETE' then raise exception 'cuisine_code_permanent: rows are never deleted'; end if;
  if new.code <> old.code then raise exception 'cuisine_code_permanent: codes are never renamed'; end if;
  return new;
end $$;

create trigger cuisines_guard_truncate before truncate on public.cuisines
  for each statement execute function public.cuisines_guard();

-- Re-asserted after the replace: trigger functions are never called directly by clients.
revoke execute on function public.cuisines_guard() from public, anon, authenticated;
