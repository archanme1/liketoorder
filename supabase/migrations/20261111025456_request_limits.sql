-- Spec 11b: request limits. submit_pickup_request and submit_table_request are re-created with the
-- same signature, return type and security settings; only the limits change:
--   * pending cap: 3 per customer (was 5), still 1 per restaurant, pickup and table counted apart;
--   * the 10-submits-an-hour limit is gone;
--   * new backstop: at most 10 submits per customer per restaurant per kind in a rolling 24 hours,
--     any status counts, raised as rate_limited (so a loop of submit and cancel cannot flood one inbox).
-- Bodies are copied from the latest definitions: pickup from 20261108225156_seller_request_inbox.sql,
-- table from 20261110012046_table_requests.sql.

-- -- submit_pickup_request --------------------------------------------------------------
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
  v_day_b     integer;
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
    if v_pending >= 3 or v_pending_b >= 1 then raise exception 'too_many_pending'; end if;

    -- Backstop: at most 10 submits per customer per restaurant in a rolling 24 hours. The
    -- customer's own rows are the counter, every status counts (cancelled and expired too),
    -- and replays above never reach here.
    select count(*) into v_day_b
      from public.pickup_requests r
     where r.customer_id = v_uid and r.business_id = p_business_id
       and r.created_at > v_now - interval '24 hours';
    if v_day_b >= 10 then raise exception 'rate_limited'; end if;

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

-- -- submit_table_request --------------------------------------------------------------
create or replace function public.submit_table_request(
  p_business_id uuid,
  p_idempotency_key uuid,
  p_table_at timestamptz,
  p_party_size integer,
  p_note text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid       uuid := auth.uid();
  v_now       timestamptz := now();
  v_id        uuid;
  b           record;
  v_note      text;
  v_pending   integer;
  v_pending_b integer;
  v_day_b     integer;
  c_ctrl      constant text := '[\x00-\x09\x0B-\x1F\u007F-\u009F\u200B-\u200D\u202A-\u202E\u2066-\u2069\uFEFF]';
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;
  if not exists (select 1 from public.profiles where id = v_uid and username is not null) then
    raise exception 'profile_incomplete';
  end if;
  if p_idempotency_key is null then raise exception 'invalid_input'; end if;

  -- One submit at a time per customer: the limits below and the idempotency lookup hold under
  -- concurrent calls (a second call waits here, then finds the first call's row).
  perform pg_advisory_xact_lock(hashtextextended('table_request:' || v_uid::text, 0));

  -- Idempotency: the same key returns the same request, unchanged, before any other check.
  select r.id into v_id
    from public.table_requests r
   where r.customer_id = v_uid and r.idempotency_key = p_idempotency_key;

  if v_id is null then
    -- Business: one error for every reason it cannot take table requests.
    select x.id, x.owner_id, x.accepts_table_requests into b
      from public.businesses x where x.id = p_business_id;
    if not found then raise exception 'business_unavailable'; end if;
    if not private.restaurant_is_fresh(b.id) then raise exception 'business_unavailable'; end if;
    if not b.accepts_table_requests then raise exception 'business_unavailable'; end if;
    if b.owner_id = v_uid then raise exception 'own_business'; end if;

    -- Table time: 30 minutes to 30 days ahead of the server clock.
    if p_table_at is null
       or p_table_at < v_now + interval '30 minutes'
       or p_table_at > v_now + interval '30 days' then
      raise exception 'invalid_table_time';
    end if;

    if p_party_size is null or p_party_size < 1 or p_party_size > 20 then
      raise exception 'invalid_party_size';
    end if;

    -- Free text: spaces and newlines at the ends are trimmed, blank means none.
    v_note := nullif(btrim(p_note, E' \n'), '');
    if char_length(v_note) > 300 or v_note ~ c_ctrl then
      raise exception 'invalid_text';
    end if;

    -- Limits. A pending request past its expires_at is already expired for the customer, even if
    -- the cron job has not swept it yet, so it does not count.
    select count(*), count(*) filter (where r.business_id = p_business_id)
      into v_pending, v_pending_b
      from public.table_requests r
     where r.customer_id = v_uid and r.status = 'pending' and r.expires_at > v_now;
    if v_pending >= 3 or v_pending_b >= 1 then raise exception 'too_many_pending'; end if;

    -- Backstop: at most 10 submits per customer per restaurant in a rolling 24 hours. The
    -- customer's own rows are the counter, every status counts (cancelled and expired too),
    -- and replays above never reach here.
    select count(*) into v_day_b
      from public.table_requests r
     where r.customer_id = v_uid and r.business_id = p_business_id
       and r.created_at > v_now - interval '24 hours';
    if v_day_b >= 10 then raise exception 'rate_limited'; end if;

    insert into public.table_requests
      (business_id, customer_id, table_at, party_size, note, idempotency_key, expires_at)
    values
      (p_business_id, v_uid, p_table_at, p_party_size, v_note, p_idempotency_key,
       private.table_request_expiry(p_table_at, v_now))
    on conflict (customer_id, idempotency_key) do nothing
    returning id into v_id;

    if v_id is null then      -- a concurrent duplicate won the race
      select r.id into v_id
        from public.table_requests r
       where r.customer_id = v_uid and r.idempotency_key = p_idempotency_key;
    end if;
  end if;

  return private.table_request_json(v_id, v_now, false);
end $$;
revoke execute on function public.submit_table_request(uuid, uuid, timestamptz, integer, text)
  from public, anon, authenticated;
grant execute on function public.submit_table_request(uuid, uuid, timestamptz, integer, text)
  to authenticated;
