-- Spec 05: seller onboarding (PR 1, database).
-- One business per account with public listing fields; the exact address lives in a private table
-- reachable only through security-definer functions. Location is written only by the places-resolve
-- Edge Function (service role); a homemade seller's public point is shifted once, here in SQL.

-- ── Businesses: one per account, public listing fields ────────────────────────
create table public.businesses (
  id                      uuid primary key default gen_random_uuid(),
  owner_id                uuid not null unique references public.profiles(id) on delete cascade,
  type                    text not null check (type in ('restaurant', 'homemade')),
  name                    text not null check (char_length(name) between 1 and 60 and name = btrim(name)
                                              and name !~ '[[:cntrl:]]'),
  cuisine_code            text not null references public.cuisines(code) on update restrict on delete restrict,
  accepts_table_requests  boolean not null default false,
  -- Public map point. Restaurant: the real location. Homemade: the server-shifted point.
  -- Written only by set_business_location(); null until an address is saved.
  map_lat                 double precision check (map_lat between -90 and 90),
  map_lng                 double precision check (map_lng between -180 and 180),
  -- Restaurant street address shown publicly; always null for homemade.
  public_address          text check (char_length(public_address) <= 200),
  -- Mirrors profiles.is_seller; written only by create_my_business() / set_seller_mode().
  is_listed               boolean not null default true,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint businesses_tables_restaurant_only check (type = 'restaurant' or not accepts_table_requests),
  constraint businesses_homemade_no_public_address check (type = 'restaurant' or public_address is null),
  constraint businesses_map_point_pair check ((map_lat is null) = (map_lng is null))
);
create index businesses_listed_type_idx on public.businesses (type) where is_listed and map_lat is not null;
create trigger businesses_set_updated_at before update on public.businesses
  for each row execute function public.set_updated_at();

-- ── Exact location: private, function access only ─────────────────────────────
create table public.business_locations (
  business_id        uuid primary key references public.businesses(id) on delete cascade,
  place_id           text not null check (char_length(place_id) between 1 and 300),
  formatted_address  text not null check (char_length(formatted_address) between 1 and 200),
  lat                double precision not null check (lat between -90 and 90),
  lng                double precision not null check (lng between -180 and 180),
  resolved_at        timestamptz not null default now()   -- server time; lets the before-launch Places refresh find stale rows (Decision 9)
);

-- ── Per-user rate limit for the Places Edge Functions ─────────────────────────
create table public.places_rate_limits (
  user_id       uuid not null references auth.users(id) on delete cascade,
  kind          text not null check (kind in ('autocomplete', 'resolve')),
  window_start  timestamptz not null,       -- truncated to the minute / day by the function
  window_kind   text not null check (window_kind in ('minute', 'day')),
  count         integer not null default 0,
  primary key (user_id, kind, window_kind, window_start)
);

-- ── RLS and grants ────────────────────────────────────────────────────────────
alter table public.businesses enable row level security;
alter table public.business_locations enable row level security;
alter table public.places_rate_limits enable row level security;

revoke all on public.businesses from anon, authenticated;
revoke all on public.business_locations from anon, authenticated;
revoke all on public.places_rate_limits from anon, authenticated;

-- owner_id and is_listed are not readable: nobody can link a listing to an account or see hidden ones.
grant select (id, type, name, cuisine_code, accepts_table_requests, map_lat, map_lng, public_address)
  on public.businesses to anon, authenticated;
grant update (name, cuisine_code, accepts_table_requests) on public.businesses to authenticated;

create policy businesses_select_public on public.businesses for select to anon, authenticated
  using (is_listed and map_lat is not null);
-- Owner must see their own row (even unlisted / no location) so UPDATE … WHERE id = … can match it.
create policy businesses_select_own on public.businesses for select to authenticated
  using (owner_id = (select auth.uid()));
create policy businesses_update_own on public.businesses for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
-- No insert / delete grants or policies: create via create_my_business(); rows go only with the account (cascade).
-- business_locations and places_rate_limits: no grants or policies; only the functions below touch them.

-- ── Owner view (internal helper) ──────────────────────────────────────────────
-- The one shape returned to an owner, by get_my_business() and set_business_location().
-- Never callable by clients: it takes an owner id.
create function public.business_owner_view(p_owner_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
           'id', b.id,
           'type', b.type,
           'name', b.name,
           'cuisine_code', b.cuisine_code,
           'accepts_table_requests', b.accepts_table_requests,
           'map_lat', b.map_lat,
           'map_lng', b.map_lng,
           'public_address', b.public_address,
           'is_listed', b.is_listed,
           'created_at', b.created_at,
           'updated_at', b.updated_at,
           'location', (select jsonb_build_object('formatted_address', l.formatted_address,
                                                  'lat', l.lat, 'lng', l.lng)
                          from public.business_locations l
                         where l.business_id = b.id))
    from public.businesses b
   where b.owner_id = p_owner_id;
$$;
revoke execute on function public.business_owner_view(uuid) from public, anon, authenticated, service_role;

-- ── create_my_business ────────────────────────────────────────────────────────
create function public.create_my_business(
  p_type text,
  p_name text,
  p_cuisine_code text,
  p_accepts_table_requests boolean default false
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not exists (select 1 from public.profiles where id = v_uid and username is not null) then
    raise exception 'profile_incomplete';
  end if;
  if p_type = 'homemade' and coalesce(p_accepts_table_requests, false) then
    raise exception 'tables_restaurant_only';
  end if;
  if exists (select 1 from public.businesses where owner_id = v_uid) then
    raise exception 'already_has_business';
  end if;

  begin
    insert into public.businesses (owner_id, type, name, cuisine_code, accepts_table_requests, is_listed)
    values (v_uid, p_type, p_name, p_cuisine_code, coalesce(p_accepts_table_requests, false), true)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'already_has_business';   -- a concurrent call won the race on owner_id
  end;

  update public.profiles set is_seller = true where id = v_uid;
  return v_id;
end $$;
revoke execute on function public.create_my_business(text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.create_my_business(text, text, text, boolean) to authenticated;

-- ── set_seller_mode ───────────────────────────────────────────────────────────
-- Off hides the listing and the Manage tab; nothing is deleted.
create function public.set_seller_mode(p_on boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
begin
  update public.businesses set is_listed = p_on where owner_id = v_uid;
  if not found then raise exception 'no_business'; end if;
  update public.profiles set is_seller = p_on where id = v_uid;
end $$;
revoke execute on function public.set_seller_mode(boolean) from public, anon, authenticated;
grant execute on function public.set_seller_mode(boolean) to authenticated;

-- ── get_my_business ───────────────────────────────────────────────────────────
-- The caller's own business, including the exact address; null when they have none.
create function public.get_my_business() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  return public.business_owner_view((select auth.uid()));
end $$;
revoke execute on function public.get_my_business() from public, anon, authenticated;
grant execute on function public.get_my_business() to authenticated;

-- ── set_business_location (service role only) ─────────────────────────────────
-- Called by places-resolve with the verified user id. Restaurant: the exact point is public.
-- Homemade (Decisions 3, 10): a random point 200–500 m away, uniform over the ring's area, with a
-- random bearing. It is re-rolled only when place_id changes; re-rolling on every save would let an
-- observer average shifted points back towards the real one. Offsets are never stored.
create function public.set_business_location(
  p_owner_id uuid,
  p_place_id text,
  p_formatted_address text,
  p_lat double precision,
  p_lng double precision
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b           public.businesses;
  v_old_place text;
  v_theta     double precision;
  v_d         double precision;
  v_lat       double precision;
  v_lng       double precision;
begin
  select * into b from public.businesses where owner_id = p_owner_id for update;
  if not found then raise exception 'no_business'; end if;

  select place_id into v_old_place from public.business_locations where business_id = b.id;

  insert into public.business_locations (business_id, place_id, formatted_address, lat, lng)
  values (b.id, p_place_id, p_formatted_address, p_lat, p_lng)
  on conflict (business_id) do update
    set place_id = excluded.place_id,
        formatted_address = excluded.formatted_address,
        lat = excluded.lat,
        lng = excluded.lng,
        resolved_at = now();

  if b.type = 'restaurant' then
    update public.businesses
       set map_lat = p_lat, map_lng = p_lng, public_address = p_formatted_address
     where id = b.id;
  elsif v_old_place is distinct from p_place_id or b.map_lat is null then
    v_theta := 2 * pi() * random();
    v_d     := sqrt(random() * (500.0 ^ 2 - 200.0 ^ 2) + 200.0 ^ 2);
    v_lat   := p_lat + v_d * cos(v_theta) / 111320;
    -- Keep cos(lat) away from 0 near the poles; clamp lat and wrap lng so the check constraints hold.
    v_lng   := p_lng + v_d * sin(v_theta) / (111320 * greatest(cos(radians(p_lat)), 0.01));
    v_lat   := least(90, greatest(-90, v_lat));
    v_lng   := v_lng - 360 * floor((v_lng + 180) / 360);
    update public.businesses
       set map_lat = v_lat, map_lng = v_lng, public_address = null
     where id = b.id;
  end if;

  return public.business_owner_view(p_owner_id);
end $$;
revoke execute on function public.set_business_location(uuid, text, text, double precision, double precision)
  from public, anon, authenticated;
grant execute on function public.set_business_location(uuid, text, text, double precision, double precision)
  to service_role;

-- ── consume_places_quota (service role only) ──────────────────────────────────
-- Per-user limits (Decision 12): autocomplete 30/min and 300/day, resolve 5/min and 20/day.
-- Returns false once either window is over its limit.
create function public.consume_places_quota(p_user_id uuid, p_kind text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_now        timestamptz := now();
  v_min_limit  integer;
  v_day_limit  integer;
  v_min_count  integer;
  v_day_count  integer;
begin
  case p_kind
    when 'autocomplete' then v_min_limit := 30; v_day_limit := 300;
    when 'resolve'      then v_min_limit := 5;  v_day_limit := 20;
    else raise exception 'invalid_kind';
  end case;

  delete from public.places_rate_limits
   where user_id = p_user_id and window_start < v_now - interval '2 days';

  insert into public.places_rate_limits (user_id, kind, window_kind, window_start, count)
  values (p_user_id, p_kind, 'minute', date_trunc('minute', v_now, 'UTC'), 1)
  on conflict (user_id, kind, window_kind, window_start)
    do update set count = public.places_rate_limits.count + 1
  returning count into v_min_count;

  insert into public.places_rate_limits (user_id, kind, window_kind, window_start, count)
  values (p_user_id, p_kind, 'day', date_trunc('day', v_now, 'UTC'), 1)
  on conflict (user_id, kind, window_kind, window_start)
    do update set count = public.places_rate_limits.count + 1
  returning count into v_day_count;

  return v_min_count <= v_min_limit and v_day_count <= v_day_limit;
end $$;
revoke execute on function public.consume_places_quota(uuid, text) from public, anon, authenticated;
grant execute on function public.consume_places_quota(uuid, text) to service_role;
