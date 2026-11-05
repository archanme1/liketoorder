-- Spec 07 (PR 1) code-review fixes. Fix-forward on 20261105040319_restaurant_map.sql, which is not edited.
--  1. Public map data is read only through the two rate-limited, freshness-checked functions.
--  2. The guest address is read in one small private function, so launch can change it alone.
--  3. A refresh result is applied once: the claim is cleared by every applied outcome.
--  4. Where the 3 s call limit really comes from (comments only).

-- ── 1. No direct reads of the map point or the Google address ─────────────────
-- map_lat / map_lng / public_address come from Google Places (a restaurant's exact Places point and
-- formatted address; a homemade point is derived from one). Granted to anon and authenticated by
-- spec 05, they let anyone page through every listed restaurant, including hidden ones (stale or
-- not_found) and without the rate limit. The map reads them through map_restaurants_in_bounds and
-- get_restaurant_details (security definer, so these grants are not needed), and the owner reads
-- them through get_my_business. The other readable columns (id, type, name, cuisine_code,
-- accepts_table_requests, currency_code) are chosen by the owner or by us, not taken from Google.
revoke select (map_lat, map_lng, public_address) on public.businesses from anon, authenticated;

-- ── 2. The guest address in one place ─────────────────────────────────────────
-- First X-Forwarded-For value as an address, or null when the header is missing, is not JSON, or
-- does not parse. Not yet confirmed to be a value a client cannot choose (docs/product/v1.md §16,
-- launch blocker): when it is, only this function changes.
create function private.caller_ip() returns inet
language plpgsql stable security definer set search_path = '' as $$
begin
  return nullif(btrim(split_part(
           (nullif(current_setting('request.headers', true), '')::jsonb) ->> 'x-forwarded-for',
           ',', 1)), '')::inet;
exception when others then
  return null;
end $$;
revoke execute on function private.caller_ip() from public, anon, authenticated, service_role;

-- Same as before, except the address comes from private.caller_ip().
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
    when 'pins'    then v_limit := 120; v_guest_limit := 2000;
    when 'details' then v_limit := 30;  v_guest_limit := 600;
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

-- ── 3. A claim is used once ───────────────────────────────────────────────────
-- Same as before, except both outcomes clear refresh_attempted_at. A second apply for the same
-- claim (a retry or a late duplicate) finds no outstanding claim and does nothing. A row that
-- failed is not touched, so it still waits a day. 'ok' rows are no longer due (resolved_at is
-- fresh) and 'not_found' rows are never due, so clearing the stamp cannot make a row come back early.
create or replace function public.apply_places_refresh(
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
       set lat = p_lat, lng = p_lng, resolved_at = now(), place_status = 'ok', refresh_attempted_at = null
     where business_id = p_business_id;
    if v_type = 'restaurant' then
      update public.businesses set map_lat = p_lat, map_lng = p_lng where id = p_business_id;
    end if;
  else
    update public.business_locations
       set place_status = 'not_found', refresh_attempted_at = null
     where business_id = p_business_id;
  end if;
end $$;
revoke execute on function public.apply_places_refresh(uuid, text, double precision, double precision)
  from public, anon, authenticated;
grant execute on function public.apply_places_refresh(uuid, text, double precision, double precision)
  to service_role;

-- ── 4. What bounds the call time ──────────────────────────────────────────────
-- 'set statement_timeout = 3s' on a function applies to the statements inside it. Postgres starts the
-- timer when the outer statement (the RPC call) begins, so the function setting does not shorten the
-- call itself. Today the role-level timeouts bound it (Supabase defaults: anon 3 s, authenticated 8 s).
-- Role settings are not changed here.
comment on function public.map_restaurants_in_bounds(double precision, double precision, double precision, double precision) is
  'Pins in a bounding box (spec 07). The call is bounded by the role-level statement_timeout, not by this function''s own setting.';
comment on function public.get_restaurant_details(uuid) is
  'One restaurant''s public details, or null (spec 07). The call is bounded by the role-level statement_timeout, not by this function''s own setting.';
