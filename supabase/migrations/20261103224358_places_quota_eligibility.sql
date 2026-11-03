-- Spec 05 PR 1 review (Decision 19): only eligible users may spend the shared Google quota, and
-- the per-user day limits are lower. Also names the shift constants in set_business_location
-- (behaviour unchanged). `create or replace` keeps each function's existing grants.

-- ── consume_places_quota (service role only) ──────────────────────────────────
-- Eligibility first, before anything is counted or Google is called:
--   no username (either kind) → profile_incomplete; resolve with no business → no_business.
-- Per-user limits: autocomplete 30/min and 100/day, resolve 5/min and 5/day.
-- Returns false once either window is over its limit. A refused call still counts toward the day,
-- so hammering through the minute limit also uses up the day.
create or replace function public.consume_places_quota(p_user_id uuid, p_kind text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_now        timestamptz := now();
  v_min_limit  integer;
  v_day_limit  integer;
  v_min_count  integer;
  v_day_count  integer;
begin
  case p_kind
    when 'autocomplete' then v_min_limit := 30; v_day_limit := 100;
    when 'resolve'      then v_min_limit := 5;  v_day_limit := 5;
    else raise exception 'invalid_kind';
  end case;

  if not exists (select 1 from public.profiles where id = p_user_id and username is not null) then
    raise exception 'profile_incomplete';
  end if;
  if p_kind = 'resolve' and not exists (select 1 from public.businesses where owner_id = p_user_id) then
    raise exception 'no_business';
  end if;

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

-- ── set_business_location (service role only) ─────────────────────────────────
-- Same behaviour as in 20261103215641_seller_onboarding.sql; the shift constants are now named.
-- Homemade (Decisions 3, 10): a random point r–R metres away, uniform over the ring's area, with a
-- random bearing, re-rolled only when place_id changes. Offsets are never stored.
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
        resolved_at = now();

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
