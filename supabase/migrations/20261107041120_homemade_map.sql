-- Spec 08: homemade map (PR 1, backend).
-- Public map reads for homemade cooks: pins in a bounding box and one cook's details, behind the
-- same 30-day freshness rule as restaurants (a homemade point is derived from a Google coordinate,
-- so it is treated as Google content). Only the shifted public point is ever returned; never the
-- exact coordinates, place_id or an address. Restaurants never appear here and homemade never
-- appears in the restaurant functions (both freshness rules check `type`).
-- Fix-forward on specs 05 and 07: no existing migration is edited.

-- ── Rate-limit kinds: own counters per tab ────────────────────────────────────
-- The kind check on map_rate_limits was declared inline and is unnamed, so its name is looked up.
-- Old kinds stay valid, so existing rows pass the new check.
do $$
declare
  v_name  text;
  v_count integer;
begin
  select count(*), min(c.conname) into v_count, v_name
    from pg_constraint c
   where c.conrelid = 'public.map_rate_limits'::regclass
     and c.contype = 'c'
     and pg_get_constraintdef(c.oid) like '%kind%';
  if v_count <> 1 then
    raise exception 'expected exactly one check constraint on map_rate_limits.kind, found %', v_count;
  end if;
  execute format('alter table public.map_rate_limits drop constraint %I', v_name);
end $$;

alter table public.map_rate_limits
  add constraint map_rate_limits_kind_check
  check (kind in ('pins', 'details', 'homemade_pins', 'homemade_details'));

-- Same as 20261105043445_restaurant_map_hardening.sql, plus the two homemade kinds (same numbers).
-- caller keys are per kind, so 'guest:all' is a separate ceiling for each kind.
create or replace function private.consume_map_quota(p_kind text) returns void
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
    when 'pins'            then v_limit := 120; v_guest_limit := 2000;
    when 'details'         then v_limit := 30;  v_guest_limit := 600;
    when 'homemade_pins'    then v_limit := 120; v_guest_limit := 2000;
    when 'homemade_details' then v_limit := 30;  v_guest_limit := 600;
    else raise exception 'invalid_kind';
  end case;

  if v_uid is not null then
    v_keys := array['u:' || v_uid::text];
  else
    v_keys := array['guest:all'];
    v_ip := private.caller_ip();     -- null: counted against the ceiling only
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

-- ── Fast bounding-box reads for homemade ──────────────────────────────────────
create index businesses_homemade_map_idx on public.businesses (map_lat, map_lng)
  where is_listed and type = 'homemade' and map_lat is not null;

-- ── Freshness rule for homemade (one definition, used by both public functions) ─
create function private.homemade_is_fresh(p_business_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from public.businesses b
      join public.business_locations l on l.business_id = b.id
     where b.id = p_business_id
       and b.is_listed
       and b.type = 'homemade'
       and b.map_lat is not null
       and l.place_status = 'ok'
       and l.resolved_at > now() - interval '30 days'
  );
$$;
revoke execute on function private.homemade_is_fresh(uuid) from public, anon, authenticated, service_role;

-- ── map_homemade_in_bounds ────────────────────────────────────────────────────
-- Box rules copied from map_restaurants_in_bounds (a pgTAP test keeps the two in step).
-- Pins hold only id, name, cuisine_code and the shifted public point (map_lat / map_lng).
create function public.map_homemade_in_bounds(
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

  perform private.consume_map_quota('homemade_pins');

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
       and b.type = 'homemade'
       and b.map_lat is not null
       and b.map_lat between v_min_lat and v_max_lat
       and ((not v_cross and b.map_lng between v_min_lng and v_max_lng)
            or (v_cross and (b.map_lng >= v_min_lng or b.map_lng <= v_max_lng)))
       and private.homemade_is_fresh(b.id)
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
revoke execute on function public.map_homemade_in_bounds(double precision, double precision, double precision, double precision)
  from public, anon, authenticated;
grant execute on function public.map_homemade_in_bounds(double precision, double precision, double precision, double precision)
  to anon, authenticated;
comment on function public.map_homemade_in_bounds(double precision, double precision, double precision, double precision) is
  'Homemade pins in a bounding box (spec 08): shifted public point only. The call is bounded by the role-level statement_timeout, not by this function''s own setting.';

-- ── get_homemade_details ──────────────────────────────────────────────────────
-- null for every reason a cook is not shown (hidden place, unlisted, restaurant, stale, no such id).
-- No place_id, address, coordinates, resolved_at or place_status; the app already has the shifted point.
create function public.get_homemade_details(p_business_id uuid) returns jsonb
language plpgsql security definer set search_path = '' set statement_timeout = '3s' as $$
begin
  perform private.consume_map_quota('homemade_details');

  if not private.homemade_is_fresh(p_business_id) then
    return null;
  end if;

  return (
    select jsonb_build_object(
             'id', b.id,
             'name', b.name,
             'cuisine_code', b.cuisine_code,
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
     where b.id = p_business_id
  );
end $$;
revoke execute on function public.get_homemade_details(uuid) from public, anon, authenticated;
grant execute on function public.get_homemade_details(uuid) to anon, authenticated;
comment on function public.get_homemade_details(uuid) is
  'One homemade cook''s public details, or null (spec 08). The call is bounded by the role-level statement_timeout, not by this function''s own setting.';

-- ── Owner view: map_status for homemade too ───────────────────────────────────
-- Same as 20261105040319_restaurant_map.sql, except map_status no longer skips homemade: the same
-- three words ('place_not_found', 'needs_refresh', 'visible'), null when there is no saved address.
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
           'map_status', (select case when l.place_status = 'not_found' then 'place_not_found'
                                      when l.resolved_at <= now() - interval '30 days' then 'needs_refresh'
                                      else 'visible' end
                            from public.business_locations l
                           where l.business_id = b.id))
    from public.businesses b
   where b.owner_id = p_owner_id;
$$;
-- Re-asserted after the replace: never callable by clients.
revoke execute on function public.business_owner_view(uuid) from public, anon, authenticated, service_role;
