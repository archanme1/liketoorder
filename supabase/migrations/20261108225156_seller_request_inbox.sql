-- Spec 10 (PR 1, backend): seller request inbox.
-- A seller answers the pickup requests sent to their business, by function only: pickup_requests
-- keeps RLS on with no policy and no grant. The business is always derived from auth.uid(), never
-- passed by the client. respond_to_request snapshots a homemade cook's exact address onto the
-- request, and get_my_pickup_address returns that snapshot. The request object now comes from one
-- helper (private.pickup_request_json) instead of four copies. No existing migration is edited.

-- ── Address snapshot ──────────────────────────────────────────────────────────
-- Written only by respond_to_request when a homemade request is accepted. Plain text on purpose:
-- the customer reads only the address, and no place_id or coordinates are copied.
alter table public.pickup_requests
  add column accepted_address text
    check (accepted_address is null or char_length(accepted_address) between 1 and 300);
alter table public.pickup_requests
  add constraint pickup_requests_address_status
    check (accepted_address is null or status in ('accepted', 'completed', 'no_show'));

-- Seller inbox keyset: (created_at, id) is the cursor, so rows sharing one timestamp are never skipped.
create index pickup_requests_business_keyset_idx
  on public.pickup_requests (business_id, created_at desc, id desc);

-- ── Request object (one definition) ───────────────────────────────────────────
-- Customer view: id, business_id, business_name, business_type, status, display_status, pickup_at,
-- items, order_text, note, currency_code, expires_at, created_at (exactly the spec 09 keys).
-- Seller view: the same plus customer_name (display name, else username) and responded_at.
-- Never contains accepted_address, place_id, coordinates, the customer's id or email.
create function private.pickup_request_json(p_request_id uuid, p_now timestamptz, p_seller_view boolean)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select o.j || case when p_seller_view
                     then jsonb_build_object('customer_name', coalesce(p.display_name, p.username),
                                             'responded_at', r.responded_at)
                     else '{}'::jsonb end
    from public.pickup_requests r
    join public.businesses bz on bz.id = r.business_id
    join public.profiles p on p.id = r.customer_id
   cross join lateral (
     select jsonb_build_object(
              'id', r.id, 'business_id', r.business_id, 'business_name', bz.name, 'business_type', bz.type,
              'status', r.status,
              'display_status', case when r.status = 'pending' and r.expires_at <= p_now then 'expired' else r.status end,
              'pickup_at', r.pickup_at, 'items', r.items, 'order_text', r.order_text, 'note', r.note,
              'currency_code', r.currency_code, 'expires_at', r.expires_at, 'created_at', r.created_at) as j) o
   where r.id = p_request_id;
$$;
revoke execute on function private.pickup_request_json(uuid, timestamptz, boolean)
  from public, anon, authenticated, service_role;

-- ── submit_pickup_request (re-created on private.pickup_request_json; logic unchanged) ──
-- p_items is [{ "item_id": uuid, "quantity": 1..20 }]; any other key (a price, a name) is ignored.
-- p_items, p_order_text and p_note default to null so the generated types make them optional.
-- Error codes: not_signed_in, profile_incomplete, invalid_input, business_unavailable, own_business,
-- invalid_pickup_time, invalid_items, invalid_text, item_unavailable, empty_order, too_many_pending,
-- rate_limited.
create or replace function public.submit_pickup_request(
  p_business_id uuid,
  p_idempotency_key uuid,
  p_pickup_at timestamptz,
  p_items jsonb default null,
  p_order_text text default null,
  p_note text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid       uuid := auth.uid();
  v_now       timestamptz := now();
  v_id        uuid;
  b           record;
  v_text      text;
  v_note      text;
  v_n         integer := 0;
  v_el        jsonb;
  v_qty       integer;
  v_found     integer;
  v_snapshot  jsonb;
  v_pending   integer;
  v_pending_b integer;
  v_recent    integer;
  c_uuid      constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  c_ctrl      constant text := '[\x00-\x09\x0B-\x1F\u007F-\u009F\u200B-\u200D\u202A-\u202E\u2066-\u2069\uFEFF]';
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;
  if not exists (select 1 from public.profiles where id = v_uid and username is not null) then
    raise exception 'profile_incomplete';
  end if;
  if p_idempotency_key is null then raise exception 'invalid_input'; end if;

  -- One submit at a time per customer: the limits below and the idempotency lookup hold under
  -- concurrent calls (a second call waits here, then finds the first call's row).
  perform pg_advisory_xact_lock(hashtextextended('pickup_request:' || v_uid::text, 0));

  -- Idempotency: the same key returns the same request, unchanged, before any other check.
  select r.id into v_id
    from public.pickup_requests r
   where r.customer_id = v_uid and r.idempotency_key = p_idempotency_key;

  if v_id is null then
    -- Business: one error for every reason it cannot take requests.
    select x.id, x.owner_id, x.type, x.currency_code into b
      from public.businesses x where x.id = p_business_id;
    if not found then raise exception 'business_unavailable'; end if;
    if not (case b.type when 'restaurant' then private.restaurant_is_fresh(b.id)
                        else private.homemade_is_fresh(b.id) end) then
      raise exception 'business_unavailable';
    end if;
    if b.owner_id = v_uid then raise exception 'own_business'; end if;

    -- Pickup time: 15 minutes to 7 days ahead. Quarter-hour steps are a UI choice only.
    if p_pickup_at is null
       or p_pickup_at < v_now + interval '15 minutes'
       or p_pickup_at > v_now + interval '7 days' then
      raise exception 'invalid_pickup_time';
    end if;

    -- Items: shape first (nothing is read from the client except ids and quantities).
    if p_items is not null then
      if jsonb_typeof(p_items) <> 'array' then raise exception 'invalid_items'; end if;
      v_n := jsonb_array_length(p_items);
      if v_n > 30 then raise exception 'invalid_items'; end if;
      for v_el in select e from jsonb_array_elements(p_items) e loop
        if jsonb_typeof(v_el) <> 'object'
           or jsonb_typeof(v_el -> 'item_id') is distinct from 'string'
           or (v_el ->> 'item_id') !~ c_uuid
           or jsonb_typeof(v_el -> 'quantity') is distinct from 'number'
           or (v_el ->> 'quantity') !~ '^[0-9]{1,2}$' then
          raise exception 'invalid_items';
        end if;
        v_qty := (v_el ->> 'quantity')::integer;
        if v_qty < 1 or v_qty > 20 then raise exception 'invalid_items'; end if;
      end loop;
      if v_n > 0 and (select count(distinct (e ->> 'item_id')::uuid)
                        from jsonb_array_elements(p_items) e) <> v_n then
        raise exception 'invalid_items';          -- the same item twice
      end if;
    end if;

    -- Free text: spaces and newlines at the ends are trimmed, blank means none.
    v_text := nullif(btrim(p_order_text, E' \n'), '');
    v_note := nullif(btrim(p_note, E' \n'), '');
    if char_length(v_text) > 500 or char_length(v_note) > 300
       or v_text ~ c_ctrl or v_note ~ c_ctrl then
      raise exception 'invalid_text';
    end if;

    -- Items: each must belong to this business and be available now. Name and price are read here.
    if v_n > 0 then
      select count(*), jsonb_agg(jsonb_build_object('item_id', i.id, 'name', i.name,
                                                    'unit_price_minor', i.price_minor,
                                                    'quantity', (t.l ->> 'quantity')::integer)
                                 order by t.ord)
        into v_found, v_snapshot
        from jsonb_array_elements(p_items) with ordinality as t(l, ord)
        join public.menu_items i
          on i.id = (t.l ->> 'item_id')::uuid
         and i.business_id = p_business_id
         and i.is_available;
      if v_found <> v_n then raise exception 'item_unavailable'; end if;
    end if;

    if v_n = 0 and v_text is null then raise exception 'empty_order'; end if;

    -- Limits. A pending request past its expires_at is already expired for the customer, even if
    -- the cron job has not swept it yet, so it does not count.
    select count(*), count(*) filter (where r.business_id = p_business_id)
      into v_pending, v_pending_b
      from public.pickup_requests r
     where r.customer_id = v_uid and r.status = 'pending' and r.expires_at > v_now;
    if v_pending >= 5 or v_pending_b >= 1 then raise exception 'too_many_pending'; end if;

    -- 10 submits an hour: the customer's own rows are the counter (sliding window; replays above
    -- never reach here; cancelled and expired rows still count).
    select count(*) into v_recent
      from public.pickup_requests r
     where r.customer_id = v_uid and r.created_at > v_now - interval '1 hour';
    if v_recent >= 10 then raise exception 'rate_limited'; end if;

    insert into public.pickup_requests
      (business_id, customer_id, pickup_at, items, order_text, note, currency_code, idempotency_key, expires_at)
    values
      (p_business_id, v_uid, p_pickup_at, v_snapshot, v_text, v_note, b.currency_code, p_idempotency_key,
       private.pickup_request_expiry(p_pickup_at, v_now))
    on conflict (customer_id, idempotency_key) do nothing
    returning id into v_id;

    if v_id is null then      -- a concurrent duplicate won the race
      select r.id into v_id
        from public.pickup_requests r
       where r.customer_id = v_uid and r.idempotency_key = p_idempotency_key;
    end if;
  end if;

  return private.pickup_request_json(v_id, v_now, false);
end $$;
revoke execute on function public.submit_pickup_request(uuid, uuid, timestamptz, jsonb, text, text)
  from public, anon, authenticated;
grant execute on function public.submit_pickup_request(uuid, uuid, timestamptz, jsonb, text, text)
  to authenticated;

-- ── list_my_pickup_requests (re-created on the helper; logic unchanged) ───────
-- Known limit (unchanged): the cursor is created_at alone while the order is (created_at desc, id desc).
create or replace function public.list_my_pickup_requests(p_before timestamptz default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;

  return jsonb_build_object(
    'server_now', v_now,
    'requests', coalesce((
      select jsonb_agg(private.pickup_request_json(r.id, v_now, false) order by r.created_at desc, r.id desc)
        from (select x.id, x.created_at
                from public.pickup_requests x
               where x.customer_id = v_uid
                 and (p_before is null or x.created_at < p_before)
               order by x.created_at desc, x.id desc
               limit 50) r
    ), '[]'::jsonb));
end $$;
revoke execute on function public.list_my_pickup_requests(timestamptz) from public, anon, authenticated;
grant execute on function public.list_my_pickup_requests(timestamptz) to authenticated;

-- ── get_my_pickup_request (re-created on the helper; logic unchanged) ─────────
-- { server_now, request }; request is null for an unknown id and for someone else's, identically.
create or replace function public.get_my_pickup_request(p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;

  return jsonb_build_object(
    'server_now', v_now,
    'request', (
      select private.pickup_request_json(r.id, v_now, false)
        from public.pickup_requests r
       where r.id = p_request_id and r.customer_id = v_uid));
end $$;
revoke execute on function public.get_my_pickup_request(uuid) from public, anon, authenticated;
grant execute on function public.get_my_pickup_request(uuid) to authenticated;

-- ── cancel_pickup_request (re-created on the helper; logic unchanged) ─────────
-- pending -> cancelled, by the customer, while the request has not expired.
create or replace function public.cancel_pickup_request(p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
  v_r   public.pickup_requests;
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;

  select r.* into v_r
    from public.pickup_requests r
   where r.id = p_request_id and r.customer_id = v_uid
     for update;
  if not found then raise exception 'not_found'; end if;     -- unknown and someone else's look the same

  if v_r.status <> 'pending' or v_r.expires_at <= v_now then
    raise exception 'invalid_transition';
  end if;

  update public.pickup_requests set status = 'cancelled' where id = v_r.id;

  return private.pickup_request_json(v_r.id, v_now, false);
end $$;
revoke execute on function public.cancel_pickup_request(uuid) from public, anon, authenticated;
grant execute on function public.cancel_pickup_request(uuid) to authenticated;

-- ── get_my_pickup_address (now returns the snapshot) ──────────────────────────
-- Same gates as spec 09: the requesting customer, accepted or completed, homemade and listed, until
-- 24 hours after the pickup time; null for every other reason, identically; not behind the 30-day
-- map guard. It returns the address copied when the cook accepted. A row accepted before this
-- migration has no snapshot, so it falls back to the cook's current address (Decision 16).
-- Known: while the cook is unlisted an accepted customer gets null (the is_listed gate stays; v1 §16).
create or replace function public.get_my_pickup_address(p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := auth.uid();
  v_addr text;
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;

  select coalesce(r.accepted_address, l.formatted_address) into v_addr
    from public.pickup_requests r
    join public.businesses b on b.id = r.business_id
    left join public.business_locations l on l.business_id = b.id
   where r.id = p_request_id
     and r.customer_id = v_uid
     and r.status in ('accepted', 'completed')
     and r.pickup_at > now() - interval '24 hours'
     and b.type = 'homemade'
     and b.is_listed;

  if v_addr is null then return null; end if;
  return jsonb_build_object('formatted_address', v_addr);
end $$;
revoke execute on function public.get_my_pickup_address(uuid) from public, anon, authenticated;
grant execute on function public.get_my_pickup_address(uuid) to authenticated;

-- ── Seller functions ──────────────────────────────────────────────────────────
-- None takes a business id: the business is the caller's own (businesses.owner_id is unique).
-- They check ownership, status and expiry, never is_listed, freshness or seller mode (Decision 11),
-- so a seller can still answer requests already sent to an unlisted or stale business.
-- Error codes: not_signed_in, invalid_input, not_found (identical for unknown and someone else's),
-- invalid_transition.

-- respond_to_request: pending -> accepted | declined. The row is locked first (the same lock
-- cancel_pickup_request takes), so a customer cancel and a seller answer cannot both win.
create function public.respond_to_request(p_request_id uuid, p_decision text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
  v_b   record;
  v_r   public.pickup_requests;
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;
  if p_decision is null or p_decision not in ('accepted', 'declined') then raise exception 'invalid_input'; end if;

  select b.id, b.type into v_b from public.businesses b where b.owner_id = v_uid;
  if not found then raise exception 'not_found'; end if;

  select r.* into v_r
    from public.pickup_requests r
   where r.id = p_request_id and r.business_id = v_b.id
     for update;
  if not found then raise exception 'not_found'; end if;

  if v_r.status <> 'pending' or v_r.expires_at <= v_now then
    raise exception 'invalid_transition';
  end if;

  update public.pickup_requests
     set status = p_decision,
         responded_at = v_now,
         accepted_address = case when p_decision = 'accepted' and v_b.type = 'homemade'
                                 then (select l.formatted_address from public.business_locations l
                                        where l.business_id = v_b.id) end
   where id = v_r.id;

  return private.pickup_request_json(v_r.id, v_now, true);
end $$;
revoke execute on function public.respond_to_request(uuid, text) from public, anon, authenticated;
grant execute on function public.respond_to_request(uuid, text) to authenticated;

-- mark_request_outcome: accepted -> completed | no_show, once the pickup time has passed.
-- responded_at stays as it was. There is no time limit for marking an outcome in v1 (Decision 12).
create function public.mark_request_outcome(p_request_id uuid, p_outcome text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
  v_biz uuid;
  v_r   public.pickup_requests;
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;
  if p_outcome is null or p_outcome not in ('completed', 'no_show') then raise exception 'invalid_input'; end if;

  select b.id into v_biz from public.businesses b where b.owner_id = v_uid;
  if not found then raise exception 'not_found'; end if;

  select r.* into v_r
    from public.pickup_requests r
   where r.id = p_request_id and r.business_id = v_biz
     for update;
  if not found then raise exception 'not_found'; end if;

  if v_r.status <> 'accepted' or v_r.pickup_at > v_now then
    raise exception 'invalid_transition';
  end if;

  update public.pickup_requests set status = p_outcome where id = v_r.id;

  return private.pickup_request_json(v_r.id, v_now, true);
end $$;
revoke execute on function public.mark_request_outcome(uuid, text) from public, anon, authenticated;
grant execute on function public.mark_request_outcome(uuid, text) to authenticated;

-- list_business_requests: { server_now, requests, next_cursor }, the caller's business only, newest
-- first, 50 a page. p_status: null = all, 'waiting' = display status pending, or one display status.
-- The cursor is text "<created_at UTC, microseconds>|<id>" sent back untouched by the app (a JS Date
-- would cut the microseconds). next_cursor is null on the last page; 51 rows are read to know that.
create function public.list_business_requests(p_status text default null, p_before text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := auth.uid();
  v_now    timestamptz := now();
  v_biz    uuid;
  v_status text;
  v_at     timestamptz;
  v_cid    uuid;
  v_ids    uuid[];
  v_next   text;
  c_cursor constant text := '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z\|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;

  v_status := case p_status when 'waiting' then 'pending' else p_status end;
  if v_status is not null
     and v_status not in ('pending', 'accepted', 'declined', 'expired', 'cancelled', 'completed', 'no_show') then
    raise exception 'invalid_input';
  end if;
  if p_before is not null then
    if p_before !~ c_cursor then raise exception 'invalid_input'; end if;
    begin
      v_at  := split_part(p_before, '|', 1)::timestamptz;
      v_cid := split_part(p_before, '|', 2)::uuid;
    exception when others then
      raise exception 'invalid_input';
    end;
  end if;

  select b.id into v_biz from public.businesses b where b.owner_id = v_uid;
  if v_biz is null then
    return jsonb_build_object('server_now', v_now, 'requests', '[]'::jsonb, 'next_cursor', null);
  end if;

  select array_agg(t.id order by t.created_at desc, t.id desc) into v_ids
    from (select x.id, x.created_at
            from public.pickup_requests x
           where x.business_id = v_biz
             and (v_at is null or (x.created_at, x.id) < (v_at, v_cid))
             and (v_status is null
                  or (case when x.status = 'pending' and x.expires_at <= v_now then 'expired' else x.status end) = v_status)
           order by x.created_at desc, x.id desc
           limit 51) t;

  if coalesce(cardinality(v_ids), 0) > 50 then
    v_ids := v_ids[1:50];
    select to_char(x.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') || '|' || x.id::text
      into v_next from public.pickup_requests x where x.id = v_ids[50];
  end if;

  return jsonb_build_object(
    'server_now', v_now,
    'requests', coalesce((select jsonb_agg(private.pickup_request_json(u.id, v_now, true) order by u.ord)
                            from unnest(coalesce(v_ids, array[]::uuid[])) with ordinality as u(id, ord)), '[]'::jsonb),
    'next_cursor', v_next);
end $$;
revoke execute on function public.list_business_requests(text, text) from public, anon, authenticated;
grant execute on function public.list_business_requests(text, text) to authenticated;

-- get_business_request: { server_now, request }; request is null for an unknown id, for someone
-- else's, and for a caller with no business, identically.
create function public.get_business_request(p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;

  return jsonb_build_object(
    'server_now', v_now,
    'request', (
      select private.pickup_request_json(r.id, v_now, true)
        from public.pickup_requests r
        join public.businesses b on b.id = r.business_id
       where r.id = p_request_id and b.owner_id = v_uid));
end $$;
revoke execute on function public.get_business_request(uuid) from public, anon, authenticated;
grant execute on function public.get_business_request(uuid) to authenticated;

-- count_waiting_requests: { server_now, waiting }, pending requests of the caller's business that
-- are not past expires_at. A count, never a list.
create function public.count_waiting_requests() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;

  return jsonb_build_object(
    'server_now', v_now,
    'waiting', (select count(*)
                  from public.pickup_requests r
                  join public.businesses b on b.id = r.business_id
                 where b.owner_id = v_uid and r.status = 'pending' and r.expires_at > v_now));
end $$;
revoke execute on function public.count_waiting_requests() from public, anon, authenticated;
grant execute on function public.count_waiting_requests() to authenticated;
