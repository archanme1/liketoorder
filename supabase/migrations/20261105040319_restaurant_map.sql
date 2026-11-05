-- Spec 07: restaurant map (PR 1, backend).
-- Public map reads for guests and users: pins in a bounding box and one restaurant's details, both
-- behind a 30-day freshness rule (Google lets us cache a Places coordinate for 30 days at most),
-- a per-minute abuse guard, and a scheduled coordinate refresh (cron -> Edge Function places-refresh).
-- Homemade businesses never appear here (spec 08).

-- ── Extensions ────────────────────────────────────────────────────────────────
-- Fails loudly if one is missing on the target database; nothing is skipped silently.
create extension if not exists pg_cron;
create extension if not exists pg_net;
create extension if not exists supabase_vault;

-- ── Freshness and place status on the private location table ──────────────────
alter table public.business_locations
  add column place_status text not null default 'ok'
    check (place_status in ('ok', 'not_found')),
  add column refresh_attempted_at timestamptz;   -- server time; set when a refresh is claimed, null when the owner saves a new address

create index business_locations_refresh_idx on public.business_locations (resolved_at)
  where place_status = 'ok';

-- Bounding-box reads for the map (no spatial extension).
create index businesses_restaurant_map_idx on public.businesses (map_lat, map_lng)
  where is_listed and type = 'restaurant' and map_lat is not null;

-- ── Abuse guard for the public map functions ──────────────────────────────────
create table public.map_rate_limits (
  caller_key    text not null,       -- 'u:<uid>', 'ip:<address>' or 'guest:all' (global guest ceiling)
  kind          text not null check (kind in ('pins', 'details')),
  window_start  timestamptz not null,   -- start of the 1-minute window (server time)
  calls         integer not null default 0,
  primary key (caller_key, kind, window_start)
);

-- ── Refresh job quota (separate from the user quotas of spec 05) ──────────────
create table public.places_refresh_quota (
  day    date primary key,           -- UTC day
  calls  integer not null default 0 check (calls >= 0)
);

alter table public.map_rate_limits enable row level security;
alter table public.places_refresh_quota enable row level security;
revoke all on public.map_rate_limits from anon, authenticated;
revoke all on public.places_refresh_quota from anon, authenticated;
-- No policies: only the security-definer functions below touch these tables.

-- ── Freshness rule (one definition, used by both public functions) ────────────
create function private.restaurant_is_fresh(p_business_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from public.businesses b
      join public.business_locations l on l.business_id = b.id
     where b.id = p_business_id
       and b.is_listed
       and b.type = 'restaurant'
       and b.map_lat is not null
       and l.place_status = 'ok'
       and l.resolved_at > now() - interval '30 days'
  );
$$;
revoke execute on function private.restaurant_is_fresh(uuid) from public, anon, authenticated, service_role;

-- ── Rate limit ────────────────────────────────────────────────────────────────
-- Signed in: key 'u:<uid>' only. Guest: the global 'guest:all' ceiling first (so a flood past it
-- creates no new rows), then 'ip:<address>' when the first X-Forwarded-For value parses as an
-- address. A guest with no readable address is counted against the ceiling only.
-- A refused call raises, which rolls back its own increment, so counts stop at the limit.
-- Nothing is deleted here; old rows are removed by the cron jobs below.
create function private.consume_map_quota(p_kind text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_window       timestamptz := date_trunc('minute', now(), 'UTC');
  v_uid          uuid := auth.uid();
  v_limit        integer;
  v_guest_limit  integer;
  v_keys         text[];
  v_key          text;
  v_ip           inet;
  v_calls        integer;
  v_max          integer;
begin
  case p_kind
    when 'pins'    then v_limit := 120; v_guest_limit := 2000;
    when 'details' then v_limit := 30;  v_guest_limit := 600;
    else raise exception 'invalid_kind';
  end case;

  if v_uid is not null then
    v_keys := array['u:' || v_uid::text];
  else
    v_keys := array['guest:all'];
    begin
      v_ip := nullif(btrim(split_part(
                (nullif(current_setting('request.headers', true), '')::jsonb) ->> 'x-forwarded-for',
                ',', 1)), '')::inet;
    exception when others then
      v_ip := null;     -- missing header, bad JSON or not an address: counts against the ceiling only
    end;
    if v_ip is not null then
      v_keys := v_keys || ('ip:' || host(v_ip));
    end if;
  end if;

  foreach v_key in array v_keys loop
    insert into public.map_rate_limits (caller_key, kind, window_start, calls)
    values (v_key, p_kind, v_window, 1)
    on conflict (caller_key, kind, window_start)
      do update set calls = public.map_rate_limits.calls + 1
    returning calls into v_calls;
    v_max := case when v_key = 'guest:all' then v_guest_limit else v_limit end;
    if v_calls > v_max then
      raise exception 'rate_limited';
    end if;
  end loop;
end $$;
revoke execute on function private.consume_map_quota(text) from public, anon, authenticated, service_role;

-- ── map_restaurants_in_bounds ─────────────────────────────────────────────────
-- Pins hold only id, name, cuisine_code and the public map point; never place_id or an address.
create function public.map_restaurants_in_bounds(
  p_min_lat double precision,
  p_max_lat double precision,
  p_min_lng double precision,
  p_max_lng double precision
) returns jsonb
language plpgsql security definer set search_path = '' set statement_timeout = '3s' as $$
declare
  c_max_span  constant double precision := 90;
  c_cap       constant integer := 500;
  v_min_lat   double precision;
  v_max_lat   double precision;
  v_min_lng   double precision;
  v_max_lng   double precision;
  v_lng_span  double precision;
  v_cross     boolean;
  v_pins      jsonb;
  v_count     integer;
begin
  if exists (select 1 from unnest(array[p_min_lat, p_max_lat, p_min_lng, p_max_lng]) v
              where v is null or v = 'NaN'::double precision or abs(v) = 'Infinity'::double precision)
     or p_min_lat > p_max_lat then
    raise exception 'invalid_bounds';
  end if;

  perform private.consume_map_quota('pins');

  -- Spans are measured on the raw numbers. A raw min_lng above max_lng means the box wraps
  -- across the 180 degree line, so its span is max - min + 360.
  v_lng_span := case when p_min_lng <= p_max_lng then p_max_lng - p_min_lng
                     else p_max_lng - p_min_lng + 360 end;
  if p_max_lat - p_min_lat > c_max_span or v_lng_span > c_max_span then
    return jsonb_build_object('pins', '[]'::jsonb, 'capped', false, 'too_large', true);
  end if;

  v_min_lat := greatest(-90, least(90, p_min_lat));
  v_max_lat := greatest(-90, least(90, p_max_lat));
  v_min_lng := p_min_lng - 360 * floor((p_min_lng + 180) / 360);
  v_max_lng := p_max_lng - 360 * floor((p_max_lng + 180) / 360);
  v_cross   := v_min_lng > v_max_lng;

  with hits as (
    select b.id, b.name, b.cuisine_code, b.map_lat, b.map_lng
      from public.businesses b
     where b.is_listed
       and b.type = 'restaurant'
       and b.map_lat is not null
       and b.map_lat between v_min_lat and v_max_lat
       and ((not v_cross and b.map_lng between v_min_lng and v_max_lng)
            or (v_cross and (b.map_lng >= v_min_lng or b.map_lng <= v_max_lng)))
       and private.restaurant_is_fresh(b.id)
     order by b.id
     limit c_cap + 1
  ), numbered as (
    select h.*, row_number() over (order by h.id) as rn from hits h
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'name', n.name, 'cuisine_code', n.cuisine_code,
                                                'lat', n.map_lat, 'lng', n.map_lng) order by n.id)
                    filter (where n.rn <= c_cap), '[]'::jsonb),
         count(*)
    into v_pins, v_count
    from numbered n;

  return jsonb_build_object('pins', v_pins, 'capped', v_count > c_cap, 'too_large', false);
end $$;
revoke execute on function public.map_restaurants_in_bounds(double precision, double precision, double precision, double precision)
  from public, anon, authenticated;
grant execute on function public.map_restaurants_in_bounds(double precision, double precision, double precision, double precision)
  to anon, authenticated;

-- ── get_restaurant_details ────────────────────────────────────────────────────
-- null for every reason a restaurant is not shown (hidden place, unlisted, homemade, stale, no such id).
create function public.get_restaurant_details(p_business_id uuid) returns jsonb
language plpgsql security definer set search_path = '' set statement_timeout = '3s' as $$
begin
  perform private.consume_map_quota('details');

  if not private.restaurant_is_fresh(p_business_id) then
    return null;
  end if;

  return (
    select jsonb_build_object(
             'id', b.id,
             'name', b.name,
             'cuisine_code', b.cuisine_code,
             'accepts_table_requests', b.accepts_table_requests,
             'public_address', b.public_address,
             'place_id', l.place_id,
             'currency_code', b.currency_code,
             'photos', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'kind', p.kind, 'path', p.path,
                                                                    'position', p.position, 'menu_item_id', p.menu_item_id)
                                                  order by p.kind, p.position nulls first, p.id)
                                   from public.business_photos p
                                  where p.business_id = b.id and p.status = 'ready'), '[]'::jsonb),
             'items', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name,
                                                                   'description', i.description,
                                                                   'price_minor', i.price_minor,
                                                                   'is_available', i.is_available,
                                                                   'position', i.position)
                                                 order by i.position)
                                  from public.menu_items i
                                 where i.business_id = b.id), '[]'::jsonb))
      from public.businesses b
      join public.business_locations l on l.business_id = b.id
     where b.id = p_business_id
  );
end $$;
revoke execute on function public.get_restaurant_details(uuid) from public, anon, authenticated;
grant execute on function public.get_restaurant_details(uuid) to anon, authenticated;

-- ── set_business_location: saving a new address brings a hidden place back ────
-- Same as 20261103224358_places_quota_eligibility.sql, plus the two reset columns.
create or replace function public.set_business_location(
  p_owner_id uuid,
  p_place_id text,
  p_formatted_address text,
  p_lat double precision,
  p_lng double precision
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c_min_m      constant double precision := 200;     -- r: minimum shift (Decision 10)
  c_max_m      constant double precision := 500;     -- R: maximum shift
  c_m_per_deg  constant double precision := 111320;  -- metres per degree of latitude
  -- Floor for cos(lat) so Δlng stays finite near the poles. Within ~0.6° of a pole the clamp and
  -- the lat clamp below can make the real shift shorter than c_min_m; nobody sells food there.
  c_min_cos    constant double precision := 0.01;
  b            public.businesses;
  v_old_place  text;
  v_theta      double precision;
  v_d          double precision;
  v_lat        double precision;
  v_lng        double precision;
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
        resolved_at = now(),
        place_status = 'ok',                 -- spec 07: a new address un-hides the place
        refresh_attempted_at = null;         -- and cancels any refresh claimed for the old one

  if b.type = 'restaurant' then
    update public.businesses
       set map_lat = p_lat, map_lng = p_lng, public_address = p_formatted_address
     where id = b.id;
  elsif v_old_place is distinct from p_place_id or b.map_lat is null then
    v_theta := 2 * pi() * random();
    v_d     := sqrt(random() * (c_max_m ^ 2 - c_min_m ^ 2) + c_min_m ^ 2);
    v_lat   := p_lat + v_d * cos(v_theta) / c_m_per_deg;
    v_lng   := p_lng + v_d * sin(v_theta) / (c_m_per_deg * greatest(cos(radians(p_lat)), c_min_cos));
    -- Clamp lat and wrap lng across the date line so the check constraints always hold.
    v_lat   := least(90, greatest(-90, v_lat));
    v_lng   := v_lng - 360 * floor((v_lng + 180) / 360);
    update public.businesses
       set map_lat = v_lat, map_lng = v_lng, public_address = null
     where id = b.id;
  end if;

  return public.business_owner_view(p_owner_id);
end $$;
-- Re-asserted after the replace: service role only.
revoke execute on function public.set_business_location(uuid, text, text, double precision, double precision)
  from public, anon, authenticated;
grant execute on function public.set_business_location(uuid, text, text, double precision, double precision)
  to service_role;

-- ── Owner view: add map_status ────────────────────────────────────────────────
-- Restaurants only (null for homemade, and for a restaurant that has no saved address yet):
-- 'place_not_found' when Google no longer knows the place, 'needs_refresh' when the coordinates
-- are over 30 days old (the pin is hidden), otherwise 'visible'. Nothing else about the
-- coordinates or resolved_at is exposed.
create or replace function public.business_owner_view(p_owner_id uuid) returns jsonb
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
           'currency_code', b.currency_code,
           'created_at', b.created_at,
           'updated_at', b.updated_at,
           'location', (select jsonb_build_object('formatted_address', l.formatted_address,
                                                  'lat', l.lat, 'lng', l.lng)
                          from public.business_locations l
                         where l.business_id = b.id),
           'map_status', case when b.type <> 'restaurant' then null
                              else (select case when l.place_status = 'not_found' then 'place_not_found'
                                                when l.resolved_at <= now() - interval '30 days' then 'needs_refresh'
                                                else 'visible' end
                                      from public.business_locations l
                                     where l.business_id = b.id) end)
    from public.businesses b
   where b.owner_id = p_owner_id;
$$;
-- Re-asserted after the replace: never callable by clients.
revoke execute on function public.business_owner_view(uuid) from public, anon, authenticated, service_role;

-- ── Refresh job: claim a batch (service role only) ────────────────────────────
-- Takes up to least(p_batch, 25, what is left of today's 100 calls), returns the oldest due rows
-- and charges the quota for the rows actually returned. Rows are stamped so a failing row waits a
-- day. Due = status ok, 25+ days old, not tried within a day.
create function public.claim_places_refresh_batch(p_batch integer)
returns table (business_id uuid, place_id text, type text)
language plpgsql security definer set search_path = '' as $$
declare
  c_batch_max  constant integer := 25;
  c_daily_max  constant integer := 100;
  v_day        date := (now() at time zone 'UTC')::date;
  v_used       integer;
  v_allow      integer;
  v_ids        uuid[];
begin
  insert into public.places_refresh_quota (day, calls) values (v_day, 0) on conflict (day) do nothing;
  select q.calls into v_used from public.places_refresh_quota q where q.day = v_day for update;

  v_allow := least(coalesce(p_batch, 0), c_batch_max, c_daily_max - v_used);
  if v_allow <= 0 then return; end if;

  with due as (
    select l.business_id as bid
      from public.business_locations l
     where l.place_status = 'ok'
       and l.resolved_at < now() - interval '25 days'
       and (l.refresh_attempted_at is null or l.refresh_attempted_at < now() - interval '1 day')
     order by l.resolved_at asc, l.business_id
     limit v_allow
       for update skip locked
  ), stamped as (
    update public.business_locations l
       set refresh_attempted_at = now()
      from due
     where l.business_id = due.bid
    returning l.business_id as bid
  )
  select coalesce(array_agg(s.bid), array[]::uuid[]) into v_ids from stamped s;

  update public.places_refresh_quota q set calls = q.calls + cardinality(v_ids) where q.day = v_day;

  return query
    select l.business_id, l.place_id, b.type
      from public.business_locations l
      join public.businesses b on b.id = l.business_id
     where l.business_id = any (v_ids)
     order by l.resolved_at asc, l.business_id;
end $$;
revoke execute on function public.claim_places_refresh_batch(integer) from public, anon, authenticated;
grant execute on function public.claim_places_refresh_batch(integer) to service_role;

-- ── Refresh job: record one result (service role only) ────────────────────────
-- 'ok' needs a point and moves it; a restaurant's public pin moves with it, a homemade point keeps
-- its shifted public location (Decision 7). 'not_found' hides the place and keeps every row.
-- The result is applied only to a row that still has a claim outstanding: set_business_location
-- clears refresh_attempted_at, so a refresh that was claimed for the owner's old address cannot
-- overwrite the new one. A missing row is a quiet no-op.
create function public.apply_places_refresh(
  p_business_id uuid,
  p_outcome text,
  p_lat double precision,
  p_lng double precision
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_type text;
begin
  if p_outcome not in ('ok', 'not_found') then raise exception 'invalid_outcome'; end if;
  if p_outcome = 'ok' and (p_lat is null or p_lng is null) then raise exception 'invalid_coordinates'; end if;

  select b.type into v_type
    from public.businesses b
    join public.business_locations l on l.business_id = b.id
   where b.id = p_business_id and l.refresh_attempted_at is not null
     for update of l;
  if not found then return; end if;

  if p_outcome = 'ok' then
    update public.business_locations
       set lat = p_lat, lng = p_lng, resolved_at = now(), place_status = 'ok'
     where business_id = p_business_id;
    if v_type = 'restaurant' then
      update public.businesses set map_lat = p_lat, map_lng = p_lng where id = p_business_id;
    end if;
  else
    update public.business_locations set place_status = 'not_found' where business_id = p_business_id;
  end if;
end $$;
revoke execute on function public.apply_places_refresh(uuid, text, double precision, double precision)
  from public, anon, authenticated;
grant execute on function public.apply_places_refresh(uuid, text, double precision, double precision)
  to service_role;

-- ── Cleanup (cron only) ───────────────────────────────────────────────────────
create function private.cleanup_map_rate_limits() returns void
language sql security definer set search_path = '' as $$
  delete from public.map_rate_limits where window_start < now() - interval '1 hour';
$$;
revoke execute on function private.cleanup_map_rate_limits() from public, anon, authenticated, service_role;

create function private.cleanup_places_refresh_quota() returns void
language sql security definer set search_path = '' as $$
  delete from public.places_refresh_quota where day < (now() at time zone 'UTC')::date - 30;
$$;
revoke execute on function private.cleanup_places_refresh_quota() from public, anon, authenticated, service_role;

-- ── Refresh trigger (cron only) ───────────────────────────────────────────────
-- POSTs to the places-refresh Edge Function with the shared secret. Both values live in the Vault
-- (places_refresh_url, places_refresh_secret). Without them (CI, tests, local) it does nothing.
-- The Edge Function refreshes up to 25 rows one after another, so the request gets 60 seconds.
create function private.invoke_places_refresh() returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_url     text;
  v_secret  text;
begin
  select s.decrypted_secret into v_url from vault.decrypted_secrets s where s.name = 'places_refresh_url';
  select s.decrypted_secret into v_secret from vault.decrypted_secrets s where s.name = 'places_refresh_secret';
  if v_url is null or v_secret is null then return; end if;

  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
end $$;
revoke execute on function private.invoke_places_refresh() from public, anon, authenticated, service_role;

-- ── Schedules (UTC) ───────────────────────────────────────────────────────────
select cron.schedule('places-refresh', '0 */6 * * *', $$select private.invoke_places_refresh()$$);
select cron.schedule('map-rate-limits-cleanup', '0 * * * *', $$select private.cleanup_map_rate_limits()$$);
select cron.schedule('places-refresh-quota-cleanup', '30 3 * * *', $$select private.cleanup_places_refresh_quota()$$);
