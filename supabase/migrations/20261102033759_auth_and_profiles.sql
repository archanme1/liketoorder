-- Spec 02: auth and profiles.
-- One profiles row per auth user, created by trigger. Every column is public profile data
-- readable by signed-in users; owners update only username, display_name, bio and city.

create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  username     text unique
               check (username ~ '^[a-z0-9_]{3,20}$'),          -- lowercase only; null until setup
  display_name text check (char_length(btrim(display_name)) between 1 and 50),
  bio          text not null default '' check (char_length(bio) <= 160),
  city         text not null default '' check (char_length(city) <= 60),
  is_seller    boolean not null default false,                  -- flipped only by spec 05's function
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Row is created by the server when the auth user is created, never by the client.
create function public.handle_new_user() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- updated_at is always set by the server.
create function public.set_updated_at() returns trigger
  language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;
create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- Trigger functions are never called directly by clients.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.set_updated_at() from public, anon, authenticated;

-- Explicit grants: no anon access, no client insert/delete, column-level update.
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (username, display_name, bio, city) on public.profiles to authenticated;

create policy "profiles_select_authenticated" on public.profiles for select
  to authenticated
  using (true);

create policy "profiles_update_own" on public.profiles for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));
