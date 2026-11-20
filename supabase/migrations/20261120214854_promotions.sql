-- Spec 16: promotions (PR 1, backend).
-- A seller asks for a fixed-price, fixed-length campaign; Archan approves it with one SQL call after
-- payment outside the app. While a campaign runs (approved and starts_at <= now() < ends_at, by the
-- server clock at read time, no job) the place is marked `promoted` on its map, `sponsored` in its
-- details, and listed by list_offers_near. Both tables are closed: every read and write goes through
-- the functions below. Fix-forward on specs 07 and 08: no existing migration is edited.

create extension if not exists btree_gist with schema extensions;   -- for promotions_no_overlap

-- -- Settings: one row, edited by Archan. No row = promotions not configured ----
create table public.promotion_settings (
  id            boolean primary key default true check (id),
  price_cents   integer not null check (price_cents > 0),
  currency_code text    not null references public.currencies(code),
  length_days   integer not null check (length_days between 1 and 60)
);

-- -- Campaigns -----------------------------------------------------------------
-- Stored states: requested, approved, rejected, cancelled. Scheduled, active and ended are derived
-- from an approved row's window by the clock (see private.promotion_json).
-- The headline uses the shared hidden-character rule (spec 09 note): no ASCII or C1 controls except
-- newline, no zero-width or bidi controls, and no blank-like character at either edge.
create table public.promotions (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses(id) on delete cascade,
  category        text not null check (category in ('new_dish', 'special_offer', 'featured')),
  headline        text not null check (char_length(headline) between 1 and 60
                                      and headline = btrim(headline)
                                      and headline !~ '[\x00-\x09\x0B-\x1F\u007F-\u009F\u200B-\u200D\u202A-\u202E\u2066-\u2069\uFEFF]'
                                      and headline !~ '^[ \n\u00A0\u115F\u1160\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\u3164\uFFA0]+|[ \n\u00A0\u115F\u1160\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\u3164\uFFA0]+$'
                                      and headline !~ '[\n\r]'),   -- one line on a card
  preferred_start date,
  status          text not null default 'requested'
                    check (status in ('requested', 'approved', 'rejected', 'cancelled')),
  -- Snapshot of promotion_settings when requested (the price may change later).
  price_cents     integer not null check (price_cents > 0),
  currency_code   text    not null references public.currencies(code),
  length_days     integer not null check (length_days between 1 and 60),
  starts_at       timestamptz,
  ends_at         timestamptz,
  reject_reason   text check (reject_reason in ('headline', 'not_paid', 'not_eligible', 'other')),
  cancelled_by    text check (cancelled_by in ('seller', 'admin')),
  cancelled_at    timestamptz,
  reviewed_at     timestamptz,
  created_at      timestamptz not null default now(),
  constraint promotions_window_pair     check ((starts_at is null) = (ends_at is null)),
  constraint promotions_window_order    check (ends_at is null or ends_at > starts_at),
  constraint promotions_approved_window check (status <> 'approved' or starts_at is not null),
  constraint promotions_rejected_reason check ((status = 'rejected') = (reject_reason is not null)),
  constraint promotions_cancel_fields   check ((status = 'cancelled') = (cancelled_by is not null)
                                               and (cancelled_by is null) = (cancelled_at is null)),
  -- Two approved campaigns of one business can never overlap in time ([starts_at, ends_at)).
  constraint promotions_no_overlap exclude using gist
    (business_id with =, tstzrange(starts_at, ends_at) with &&) where (status = 'approved')
);
-- At most one waiting request per business (also the backstop for two simultaneous requests).
create unique index promotions_one_request on public.promotions (business_id) where status = 'requested';
create index promotions_approved_ends on public.promotions (ends_at) where status = 'approved';
-- A business's campaigns, newest first: get_my_promotion, the request cap, the cascade and the runbook.
create index promotions_business_created_idx on public.promotions (business_id, created_at desc);

alter table public.promotion_settings enable row level security;
alter table public.promotions enable row level security;
revoke all on public.promotion_settings from anon, authenticated;
revoke all on public.promotions from anon, authenticated;
-- No policies: only the security-definer functions below touch these tables.

-- -- Rate-limit kind for Offers (same numbers as pins) -------------------------
alter table public.map_rate_limits drop constraint map_rate_limits_kind_check;
alter table public.map_rate_limits
  add constraint map_rate_limits_kind_check
  check (kind in ('pins', 'details', 'homemade_pins', 'homemade_details', 'offers'));

-- Same as 20261107041120_homemade_map.sql, plus the kind 'offers' (the pins numbers).
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
    when 'pins'             then v_limit := 120; v_guest_limit := 2000;
    when 'details'          then v_limit := 30;  v_guest_limit := 600;
    when 'homemade_pins'    then v_limit := 120; v_guest_limit := 2000;
    when 'homemade_details' then v_limit := 30;  v_guest_limit := 600;
    when 'offers'           then v_limit := 120; v_guest_limit := 2000;
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

-- -- Private helpers -----------------------------------------------------------
-- A campaign is running right now (server clock).
create function private.promotion_is_active(p_business_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.promotions p
     where p.business_id = p_business_id
       and p.status = 'approved'
       and p.starts_at <= now()
       and now() < p.ends_at
  );
$$;
revoke execute on function private.promotion_is_active(uuid) from public, anon, authenticated, service_role;

-- Listed, has a map point, and shown on its map (the 30-day freshness rule of its type).
create function private.business_can_promote(p_business_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select case b.type when 'restaurant' then private.restaurant_is_fresh(b.id)
                                      else private.homemade_is_fresh(b.id) end
                     from public.businesses b
                    where b.id = p_business_id), false);
$$;
revoke execute on function private.business_can_promote(uuid) from public, anon, authenticated, service_role;

-- The seller's view of one campaign, with the derived state. One definition for every answer.
create function private.promotion_json(p_promotion_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
           'id', p.id,
           'category', p.category,
           'headline', p.headline,
           'preferred_start', p.preferred_start,
           'state', case when p.status <> 'approved' then p.status
                         when now() < p.starts_at then 'scheduled'
                         when now() < p.ends_at then 'active'
                         else 'ended' end,
           'starts_at', p.starts_at,
           'ends_at', p.ends_at,
           'reject_reason', p.reject_reason,
           'price_cents', p.price_cents,
           'currency_code', p.currency_code,
           'length_days', p.length_days,
           'created_at', p.created_at)
    from public.promotions p
   where p.id = p_promotion_id;
$$;
revoke execute on function private.promotion_json(uuid) from public, anon, authenticated, service_role;

-- -- get_my_promotion ----------------------------------------------------------
-- The caller's latest campaign (or null), the current settings (or null) and whether the business
-- may ask for one now. No business: { promotion: null, settings, eligible: false }.
create function public.get_my_promotion() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_business  uuid;
  v_latest    uuid;
begin
  select b.id into v_business from public.businesses b where b.owner_id = auth.uid();

  if v_business is not null then
    select p.id into v_latest
      from public.promotions p
     where p.business_id = v_business
     order by p.created_at desc, p.id desc
     limit 1;
  end if;

  return jsonb_build_object(
    'promotion', case when v_latest is null then null else private.promotion_json(v_latest) end,
    'settings', (select jsonb_build_object('price_cents', s.price_cents, 'currency_code', s.currency_code,
                                           'length_days', s.length_days)
                   from public.promotion_settings s),
    'eligible', v_business is not null and private.business_can_promote(v_business));
end $$;
revoke execute on function public.get_my_promotion() from public, anon, authenticated;
grant execute on function public.get_my_promotion() to authenticated;

-- -- request_promotion ---------------------------------------------------------
-- The business row is locked first, so two requests from one owner run one after the other; the
-- unique index promotions_one_request is the backstop. A preferred start is a calendar day the
-- seller picks; the UTC date runs ahead of Ontario in the evening, so one day before it is allowed.
-- A headline is one line and carries no contact details: c_mail and c_sep are the spec 13 food-log
-- contact rule (20261115040811_food_log_uploads.sql, Decision 11), copied because it has no shared
-- helper: an email, or 10+ digits once separators are ignored. "2 for 1" stays allowed.
-- At most 5 requests per business in 24 hours (any outcome), so request-then-cancel cannot pile up rows.
create function public.request_promotion(p_category text, p_headline text, p_preferred_start date)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c_ctrl   constant text := '[\x00-\x09\x0B-\x1F\u007F-\u009F\u200B-\u200D\u202A-\u202E\u2066-\u2069\uFEFF]';
  c_edge   constant text := '^[ \n\u00A0\u115F\u1160\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\u3164\uFFA0]+|[ \n\u00A0\u115F\u1160\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\u3164\uFFA0]+$';
  c_mail   constant text := '[a-z0-9._%+-]+[ \u00A0\u2000-\u200A\u202F\u3000]*[@\uFF20][ \u00A0\u2000-\u200A\u202F\u3000]*[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}';
  c_sep    constant text := '[][ \n\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000.()/_,+-]';
  c_daily  constant integer := 5;
  v_uid      uuid := auth.uid();
  v_today    date := (now() at time zone 'UTC')::date;
  v_business uuid;
  s          public.promotion_settings;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  select b.id into v_business from public.businesses b where b.owner_id = v_uid for update;
  if v_business is null or not private.business_can_promote(v_business) then
    raise exception 'not_eligible';
  end if;

  select * into s from public.promotion_settings;
  if not found then
    raise exception 'not_configured';
  end if;

  if p_category is null or p_category not in ('new_dish', 'special_offer', 'featured') then
    raise exception 'invalid_category';
  end if;
  if p_headline is null or char_length(p_headline) not between 1 and 60
     or p_headline ~ c_ctrl or p_headline ~ c_edge or p_headline ~ '[\n\r]'
     or p_headline ~* c_mail or regexp_replace(p_headline, c_sep, '', 'g') ~ '[0-9]{10,}' then
    raise exception 'invalid_headline';
  end if;
  if p_preferred_start is not null
     and (p_preferred_start < v_today - 1 or p_preferred_start > v_today + 90) then
    raise exception 'invalid_start';
  end if;

  if exists (select 1 from public.promotions p
              where p.business_id = v_business
                and (p.status = 'requested' or (p.status = 'approved' and p.ends_at > now()))) then
    raise exception 'already_open';
  end if;

  if (select count(*) from public.promotions p
       where p.business_id = v_business and p.created_at > now() - interval '24 hours') >= c_daily then
    raise exception 'too_many_requests';
  end if;

  begin
    insert into public.promotions (business_id, category, headline, preferred_start,
                                   price_cents, currency_code, length_days)
    values (v_business, p_category, p_headline, p_preferred_start,
            s.price_cents, s.currency_code, s.length_days);
  exception when unique_violation then
    raise exception 'already_open';
  end;

  return public.get_my_promotion();
end $$;
revoke execute on function public.request_promotion(text, text, date) from public, anon, authenticated;
grant execute on function public.request_promotion(text, text, date) to authenticated;

-- -- cancel_my_promotion -------------------------------------------------------
-- Requested, scheduled or active campaigns of the caller's own business. Someone else's id and an
-- unknown id give the same answer.
create function public.cancel_my_promotion(p_promotion_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_id  uuid;
begin
  select p.id into v_id
    from public.promotions p
    join public.businesses b on b.id = p.business_id
   where p.id = p_promotion_id
     and b.owner_id = auth.uid()
     for update of p;
  if v_id is null then
    raise exception 'not_found';
  end if;

  if private.promotion_json(v_id) ->> 'state' not in ('requested', 'scheduled', 'active') then
    raise exception 'not_cancellable';
  end if;

  update public.promotions
     set status = 'cancelled', cancelled_by = 'seller', cancelled_at = now()
   where id = v_id;

  return public.get_my_promotion();
end $$;
revoke execute on function public.cancel_my_promotion(uuid) from public, anon, authenticated;
grant execute on function public.cancel_my_promotion(uuid) to authenticated;

-- -- admin_review_promotion (database owner only: the dashboard SQL editor) ----
-- See docs/runbooks/promotions-admin.md.
create function private.admin_review_promotion(
  p_promotion_id  uuid,
  p_decision      text,
  p_starts_at     timestamptz default null,
  p_reject_reason text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  p        public.promotions;
  v_state  text;
begin
  select * into p from public.promotions where id = p_promotion_id for update;
  if not found then
    raise exception 'not_found';
  end if;
  v_state := private.promotion_json(p.id) ->> 'state';

  if p_decision = 'approve' and v_state = 'requested' then
    if p_starts_at is null or p_starts_at < now() - interval '1 hour' then
      raise exception 'invalid_start';
    end if;
    begin
      update public.promotions
         set status = 'approved', starts_at = p_starts_at,
             ends_at = p_starts_at + make_interval(days => p.length_days), reviewed_at = now()
       where id = p.id;
    exception when exclusion_violation then
      raise exception 'overlap';
    end;
  elsif p_decision = 'reject' and v_state = 'requested' then
    if p_reject_reason is null or p_reject_reason not in ('headline', 'not_paid', 'not_eligible', 'other') then
      raise exception 'invalid_reason';
    end if;
    update public.promotions
       set status = 'rejected', reject_reason = p_reject_reason, reviewed_at = now()
     where id = p.id;
  elsif p_decision = 'cancel' and v_state in ('requested', 'scheduled', 'active') then
    update public.promotions
       set status = 'cancelled', cancelled_by = 'admin', cancelled_at = now(), reviewed_at = now()
     where id = p.id;
  else
    raise exception 'invalid_transition';
  end if;

  return (select jsonb_build_object('id', x.j -> 'id', 'state', x.j -> 'state',
                                    'starts_at', x.j -> 'starts_at', 'ends_at', x.j -> 'ends_at')
            from (select private.promotion_json(p.id) as j) x);
end $$;
revoke execute on function private.admin_review_promotion(uuid, text, timestamptz, text)
  from public, anon, authenticated, service_role;

-- -- list_offers_near ----------------------------------------------------------
-- Active campaigns of listed, fresh businesses with a map point, near a point on the 0.05 degree
-- grid (the phone never sends its exact position; nothing about it is stored). Searches up to the
-- chosen distance plus a 4 km margin, because the grid point is up to about 3.5 km from the person.
-- Order: band (under 5 km, under 15 km, the rest), then a daily rotation, then id; 20 per page.
-- The cursor is 'YYYY-MM-DD|band|rotation|id'. Its day must be within 1 day of the UTC date, and later
-- pages use that day's rotation, so paging across UTC midnight neither repeats nor skips a row.
-- Each offer carries only public fields: the public map point (shifted for homemade), never the owner,
-- the exact point or address, the price, the status or any admin field.
create function public.list_offers_near(
  p_lat         double precision,
  p_lng         double precision,
  p_distance_km integer,
  p_category    text,
  p_type        text,
  p_tables      boolean,
  p_cursor      text
) returns jsonb
language plpgsql security definer set search_path = '' set statement_timeout = '3s' as $$
declare
  c_page      constant integer := 20;
  c_margin_km constant double precision := 4;
  c_earth_km  constant double precision := 6371.0088;
  c_km_per_deg constant double precision := 111.19508;   -- c_earth_km * pi / 180
  c_min_cos   constant double precision := 0.01;
  v_today     date := (now() at time zone 'UTC')::date;
  v_day       date;
  v_c_band    integer;
  v_c_rot     text;
  v_c_id      uuid;
  v_radius    double precision;
  v_dlat      double precision;
  v_dlng      double precision;
  v_offers    jsonb;
  v_count     integer;
  v_last      jsonb;
begin
  if p_lat is null or p_lng is null
     or p_lat = 'NaN'::double precision or p_lng = 'NaN'::double precision
     or abs(p_lat) > 90 or abs(p_lng) > 180
     or abs(p_lat * 20 - round(p_lat * 20)) > 1e-9
     or abs(p_lng * 20 - round(p_lng * 20)) > 1e-9 then
    raise exception 'invalid_point';
  end if;
  if p_distance_km is null or p_distance_km not in (5, 15, 30) then
    raise exception 'invalid_distance';
  end if;
  if (p_category is not null and p_category not in ('new_dish', 'special_offer', 'featured'))
     or (p_type is not null and p_type not in ('restaurant', 'homemade')) then
    raise exception 'invalid_filter';
  end if;

  v_day := v_today;
  if p_cursor is not null then
    if p_cursor !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}\|[0-2]\|[0-9a-f]{32}\|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'invalid_cursor';
    end if;
    begin
      -- to_date raises on an impossible day such as 2026-02-30; that error becomes invalid_cursor.
      v_day := to_date(split_part(p_cursor, '|', 1), 'YYYY-MM-DD');
    exception when others then
      raise exception 'invalid_cursor';
    end;
    if abs(v_day - v_today) > 1 then
      raise exception 'invalid_cursor';
    end if;
    v_c_band := split_part(p_cursor, '|', 2)::integer;
    v_c_rot  := split_part(p_cursor, '|', 3);
    v_c_id   := split_part(p_cursor, '|', 4)::uuid;
  end if;

  perform private.consume_map_quota('offers');

  -- Bounding box to narrow the rows before the exact distance (no spatial extension).
  v_radius := p_distance_km + c_margin_km;
  v_dlat := v_radius / c_km_per_deg;
  v_dlng := v_radius / (c_km_per_deg * greatest(cos(radians(p_lat)), c_min_cos));

  with near as (
    select b.id, b.type, b.name, b.cuisine_code, b.map_lat, b.map_lng, b.accepts_table_requests,
           p.category, p.headline, p.ends_at,
           2 * c_earth_km * asin(least(1, sqrt(
             sin(radians(b.map_lat - p_lat) / 2) ^ 2
             + cos(radians(p_lat)) * cos(radians(b.map_lat)) * sin(radians(b.map_lng - p_lng) / 2) ^ 2))) as km
      from public.businesses b
      join public.promotions p on p.business_id = b.id
     where b.is_listed
       and b.map_lat is not null
       and b.map_lat between p_lat - v_dlat and p_lat + v_dlat
       and (v_dlng >= 180 or abs(b.map_lng - p_lng) <= v_dlng or abs(b.map_lng - p_lng) >= 360 - v_dlng)
       and p.status = 'approved'
       and p.starts_at <= now()
       and now() < p.ends_at
       and (p_category is null or p.category = p_category)
       and (p_type is null or b.type = p_type)
       and (p_tables is not true or b.accepts_table_requests)
       and case b.type when 'restaurant' then private.restaurant_is_fresh(b.id)
                       else private.homemade_is_fresh(b.id) end
  ), ranked as (
    select n.*,
           case when n.km < 5 then 0 when n.km < 15 then 1 else 2 end as band,
           md5(n.id::text || to_char(v_day, 'YYYY-MM-DD')) collate "C" as rot
      from near n
     where n.km <= v_radius
  ), page as (
    select r.*
      from ranked r
     where p_cursor is null or (r.band, r.rot, r.id) > (v_c_band, v_c_rot collate "C", v_c_id)
     order by r.band, r.rot, r.id
     limit c_page + 1
  ), numbered as (
    select pg.*, row_number() over (order by pg.band, pg.rot, pg.id) as rn from page pg
  )
  select coalesce(jsonb_agg(jsonb_build_object(
             'business_id', n.id,
             'type', n.type,
             'name', n.name,
             'cuisine_code', n.cuisine_code,
             'lat', n.map_lat,
             'lng', n.map_lng,
             'accepts_table_requests', n.accepts_table_requests,
             'category', n.category,
             'headline', n.headline,
             'ends_at', n.ends_at,
             'band', n.band,
             'cover', (select jsonb_build_object('id', ph.id, 'kind', ph.kind, 'path', ph.path,
                                                 'position', ph.position, 'menu_item_id', ph.menu_item_id)
                         from public.business_photos ph
                        where ph.business_id = n.id and ph.kind = 'cover' and ph.status = 'ready'))
           order by n.rn) filter (where n.rn <= c_page), '[]'::jsonb),
         count(*)
    into v_offers, v_count
    from numbered n;

  if v_count <= c_page then
    return jsonb_build_object('offers', v_offers, 'next_cursor', null);
  end if;

  v_last := v_offers -> (c_page - 1);
  return jsonb_build_object(
    'offers', v_offers,
    'next_cursor', to_char(v_day, 'YYYY-MM-DD') || '|' || (v_last ->> 'band') || '|'
                   || md5((v_last ->> 'business_id') || to_char(v_day, 'YYYY-MM-DD')) || '|'
                   || (v_last ->> 'business_id'));
end $$;
revoke execute on function public.list_offers_near(double precision, double precision, integer, text, text, boolean, text)
  from public, anon, authenticated;
grant execute on function public.list_offers_near(double precision, double precision, integer, text, text, boolean, text)
  to anon, authenticated;
comment on function public.list_offers_near(double precision, double precision, integer, text, text, boolean, text) is
  'Active promotions near a 0.05 degree grid point (spec 16), 20 per page. The call is bounded by the role-level statement_timeout, not by this function''s own setting.';

-- -- map_restaurants_in_bounds: + promoted, promoted pins first -----------------
-- Same as 20261105040319_restaurant_map.sql, except each pin gains `promoted` and rows are ordered
-- promoted first before the 500 cap, so the cap never drops a promoted pin.
create or replace function public.map_restaurants_in_bounds(
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

  with active as (
    -- Businesses with a campaign running now (same rule as private.promotion_is_active): one small
    -- read through promotions_approved_ends instead of one call per row before the cap.
    select distinct p.business_id
      from public.promotions p
     where p.status = 'approved'
       and p.starts_at <= now()
       and now() < p.ends_at
  ), hits as (
    select b.id, b.name, b.cuisine_code, b.map_lat, b.map_lng,
           (a.business_id is not null) as promoted
      from public.businesses b
      left join active a on a.business_id = b.id
     where b.is_listed
       and b.type = 'restaurant'
       and b.map_lat is not null
       and b.map_lat between v_min_lat and v_max_lat
       and ((not v_cross and b.map_lng between v_min_lng and v_max_lng)
            or (v_cross and (b.map_lng >= v_min_lng or b.map_lng <= v_max_lng)))
       and private.restaurant_is_fresh(b.id)
     order by promoted desc, b.id
     limit c_cap + 1
  ), numbered as (
    select h.*, row_number() over (order by h.promoted desc, h.id) as rn from hits h
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'name', n.name, 'cuisine_code', n.cuisine_code,
                                                'lat', n.map_lat, 'lng', n.map_lng, 'promoted', n.promoted)
                            order by n.rn)
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

-- -- map_homemade_in_bounds: + promoted, promoted pins first --------------------
-- Same as 20261107041120_homemade_map.sql, with the same change as map_restaurants_in_bounds.
create or replace function public.map_homemade_in_bounds(
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

  with active as (
    -- Businesses with a campaign running now (same rule as private.promotion_is_active): one small
    -- read through promotions_approved_ends instead of one call per row before the cap.
    select distinct p.business_id
      from public.promotions p
     where p.status = 'approved'
       and p.starts_at <= now()
       and now() < p.ends_at
  ), hits as (
    select b.id, b.name, b.cuisine_code, b.map_lat, b.map_lng,
           (a.business_id is not null) as promoted
      from public.businesses b
      left join active a on a.business_id = b.id
     where b.is_listed
       and b.type = 'homemade'
       and b.map_lat is not null
       and b.map_lat between v_min_lat and v_max_lat
       and ((not v_cross and b.map_lng between v_min_lng and v_max_lng)
            or (v_cross and (b.map_lng >= v_min_lng or b.map_lng <= v_max_lng)))
       and private.homemade_is_fresh(b.id)
     order by promoted desc, b.id
     limit c_cap + 1
  ), numbered as (
    select h.*, row_number() over (order by h.promoted desc, h.id) as rn from hits h
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'name', n.name, 'cuisine_code', n.cuisine_code,
                                                'lat', n.map_lat, 'lng', n.map_lng, 'promoted', n.promoted)
                            order by n.rn)
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

-- -- get_restaurant_details: + sponsored ---------------------------------------
-- Same as 20261105040319_restaurant_map.sql, plus `sponsored`.
create or replace function public.get_restaurant_details(p_business_id uuid) returns jsonb
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
             'sponsored', private.promotion_is_active(b.id),
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

-- -- get_homemade_details: + sponsored -----------------------------------------
-- Same as 20261107041120_homemade_map.sql, plus `sponsored`.
create or replace function public.get_homemade_details(p_business_id uuid) returns jsonb
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
             'sponsored', private.promotion_is_active(b.id),
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

comment on function public.request_promotion(text, text, date) is
  'Ask for a promotion for the caller''s business (spec 16). Snapshots the price, currency and length.';
comment on function public.cancel_my_promotion(uuid) is
  'Cancel the caller''s requested, scheduled or active promotion (spec 16).';
comment on function public.get_my_promotion() is
  'The caller''s latest promotion with its derived state, the settings and eligibility (spec 16).';
