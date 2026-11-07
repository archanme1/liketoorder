-- Spec 09: pickup requests (PR 1, backend).
-- A signed-in customer sends a pickup request to a restaurant or a homemade cook; the request waits
-- for the seller and expires on its own. The table has no client grants and no policies: every read
-- and every status change is a security-definer function that filters on auth.uid() and returns the
-- server's clock (`server_now`) and a server-computed `display_status`, so a wrong phone clock can
-- never make a request look expired or live. Seller-side reads and responses are spec 10.
-- No existing migration is edited.

-- ── Table ─────────────────────────────────────────────────────────────────────
create table public.pickup_requests (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid not null references public.businesses(id) on delete cascade,
  customer_id      uuid not null references public.profiles(id) on delete cascade,
  status           text not null default 'pending'
                   check (status in ('pending', 'accepted', 'declined', 'expired', 'cancelled', 'completed', 'no_show')),
  pickup_at        timestamptz not null,
  -- Snapshot read from menu_items inside submit_pickup_request, so later menu edits never rewrite
  -- history: [{ "item_id", "name", "unit_price_minor" (null = no price), "quantity" }]. Null when free text only.
  items            jsonb check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) between 1 and 30),
  order_text       text check (char_length(order_text) between 1 and 500 and order_text = btrim(order_text)
                               and order_text !~ '[\x00-\x09\x0B-\x1F\x7F]'),   -- newlines allowed
  note             text check (char_length(note) between 1 and 300 and note = btrim(note)
                               and note !~ '[\x00-\x09\x0B-\x1F\x7F]'),
  currency_code    text references public.currencies(code),        -- copied from the business at submit; null if it has none
  idempotency_key  uuid not null,
  expires_at       timestamptz not null,
  responded_at     timestamptz,                                    -- set by spec 10
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint pickup_requests_has_order check (items is not null or order_text is not null),
  constraint pickup_requests_expiry_order check (expires_at <= pickup_at),
  constraint pickup_requests_idem unique (customer_id, idempotency_key)
);
create index pickup_requests_customer_idx on public.pickup_requests (customer_id, created_at desc);
create index pickup_requests_business_idx on public.pickup_requests (business_id, status, created_at desc);
create index pickup_requests_pending_expiry_idx on public.pickup_requests (expires_at) where status = 'pending';
create trigger pickup_requests_set_updated_at before update on public.pickup_requests
  for each row execute function public.set_updated_at();

-- ── RLS and grants ────────────────────────────────────────────────────────────
-- RLS on with no policy and no grant: nobody reads or writes the table directly. Seller access is
-- added by spec 10 with its own function.
alter table public.pickup_requests enable row level security;
revoke all on public.pickup_requests from anon, authenticated;

-- ── Expiry rule (one definition) ──────────────────────────────────────────────
-- 30 minutes after the request, or the pickup time if that is earlier (Decision 2).
create function private.pickup_request_expiry(p_pickup_at timestamptz, p_created_at timestamptz)
returns timestamptz
language sql stable security definer set search_path = '' as $$
  select least(p_created_at + interval '30 minutes', p_pickup_at);
$$;
revoke execute on function private.pickup_request_expiry(timestamptz, timestamptz)
  from public, anon, authenticated, service_role;

-- ── submit_pickup_request ─────────────────────────────────────────────────────
-- Request object shape (also used by list/get/cancel; keep the four in step, a pgTAP test compares keys):
--   id, business_id, business_name, business_type, status, display_status, pickup_at, items,
--   order_text, note, currency_code, expires_at, created_at
-- p_items is [{ "item_id": uuid, "quantity": 1..20 }]; any other key (a price, a name) is ignored.
-- Error codes: not_signed_in, profile_incomplete, invalid_input, business_unavailable, own_business,
-- invalid_pickup_time, invalid_items, invalid_text, item_unavailable, empty_order, too_many_pending,
-- rate_limited.
create function public.submit_pickup_request(
  p_business_id uuid,
  p_idempotency_key uuid,
  p_pickup_at timestamptz,
  p_items jsonb,
  p_order_text text,
  p_note text
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
  c_ctrl      constant text := '[\x00-\x09\x0B-\x1F\x7F]';
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

  return (
    select jsonb_build_object(
             'id', r.id, 'business_id', r.business_id, 'business_name', bz.name, 'business_type', bz.type,
             'status', r.status,
             'display_status', case when r.status = 'pending' and r.expires_at <= v_now then 'expired' else r.status end,
             'pickup_at', r.pickup_at, 'items', r.items, 'order_text', r.order_text, 'note', r.note,
             'currency_code', r.currency_code, 'expires_at', r.expires_at, 'created_at', r.created_at)
      from public.pickup_requests r
      join public.businesses bz on bz.id = r.business_id
     where r.id = v_id
  );
end $$;
revoke execute on function public.submit_pickup_request(uuid, uuid, timestamptz, jsonb, text, text)
  from public, anon, authenticated;
grant execute on function public.submit_pickup_request(uuid, uuid, timestamptz, jsonb, text, text)
  to authenticated;

-- ── list_my_pickup_requests ───────────────────────────────────────────────────
-- { server_now, requests: [...] }: the caller's requests, newest first, 50 a page.
create function public.list_my_pickup_requests(p_before timestamptz default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;

  return jsonb_build_object(
    'server_now', v_now,
    'requests', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'id', r.id, 'business_id', r.business_id, 'business_name', bz.name, 'business_type', bz.type,
                 'status', r.status,
                 'display_status', case when r.status = 'pending' and r.expires_at <= v_now then 'expired' else r.status end,
                 'pickup_at', r.pickup_at, 'items', r.items, 'order_text', r.order_text, 'note', r.note,
                 'currency_code', r.currency_code, 'expires_at', r.expires_at, 'created_at', r.created_at)
               order by r.created_at desc, r.id desc)
        from (select x.*
                from public.pickup_requests x
               where x.customer_id = v_uid
                 and (p_before is null or x.created_at < p_before)
               order by x.created_at desc, x.id desc
               limit 50) r
        join public.businesses bz on bz.id = r.business_id
    ), '[]'::jsonb));
end $$;
revoke execute on function public.list_my_pickup_requests(timestamptz) from public, anon, authenticated;
grant execute on function public.list_my_pickup_requests(timestamptz) to authenticated;

-- ── get_my_pickup_request ─────────────────────────────────────────────────────
-- { server_now, request }; request is null for an unknown id and for someone else's, identically.
create function public.get_my_pickup_request(p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;

  return jsonb_build_object(
    'server_now', v_now,
    'request', (
      select jsonb_build_object(
               'id', r.id, 'business_id', r.business_id, 'business_name', bz.name, 'business_type', bz.type,
               'status', r.status,
               'display_status', case when r.status = 'pending' and r.expires_at <= v_now then 'expired' else r.status end,
               'pickup_at', r.pickup_at, 'items', r.items, 'order_text', r.order_text, 'note', r.note,
               'currency_code', r.currency_code, 'expires_at', r.expires_at, 'created_at', r.created_at)
        from public.pickup_requests r
        join public.businesses bz on bz.id = r.business_id
       where r.id = p_request_id and r.customer_id = v_uid));
end $$;
revoke execute on function public.get_my_pickup_request(uuid) from public, anon, authenticated;
grant execute on function public.get_my_pickup_request(uuid) to authenticated;

-- ── cancel_pickup_request ─────────────────────────────────────────────────────
-- pending -> cancelled, by the customer, while the request has not expired. Spec 10 adds the
-- seller's transitions as their own functions.
create function public.cancel_pickup_request(p_request_id uuid) returns jsonb
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

  return (
    select jsonb_build_object(
             'id', r.id, 'business_id', r.business_id, 'business_name', bz.name, 'business_type', bz.type,
             'status', r.status,
             'display_status', case when r.status = 'pending' and r.expires_at <= v_now then 'expired' else r.status end,
             'pickup_at', r.pickup_at, 'items', r.items, 'order_text', r.order_text, 'note', r.note,
             'currency_code', r.currency_code, 'expires_at', r.expires_at, 'created_at', r.created_at)
      from public.pickup_requests r
      join public.businesses bz on bz.id = r.business_id
     where r.id = v_r.id);
end $$;
revoke execute on function public.cancel_pickup_request(uuid) from public, anon, authenticated;
grant execute on function public.cancel_pickup_request(uuid) to authenticated;

-- ── get_my_pickup_address ─────────────────────────────────────────────────────
-- A homemade cook's exact address, only to the requesting customer and only while the request is
-- accepted or completed. Null for every other reason, identically. Not behind the 30-day map guard
-- (Decision 5): an accepted customer must still find the cook. Restaurants never use it (their
-- address is public). If the legal read of Google's terms overrules Decision 5, change only this function.
create function public.get_my_pickup_address(p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := auth.uid();
  v_addr text;
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;

  select l.formatted_address into v_addr
    from public.pickup_requests r
    join public.businesses b on b.id = r.business_id
    join public.business_locations l on l.business_id = b.id
   where r.id = p_request_id
     and r.customer_id = v_uid
     and r.status in ('accepted', 'completed')
     and b.type = 'homemade'
     and b.is_listed;

  if v_addr is null then return null; end if;
  return jsonb_build_object('formatted_address', v_addr);
end $$;
revoke execute on function public.get_my_pickup_address(uuid) from public, anon, authenticated;
grant execute on function public.get_my_pickup_address(uuid) to authenticated;

-- ── Auto-expire (cron only) ───────────────────────────────────────────────────
-- Sets the stored value; the read functions already show display_status = 'expired' before this runs.
create function private.expire_pickup_requests() returns void
language sql security definer set search_path = '' as $$
  update public.pickup_requests set status = 'expired'
   where status = 'pending' and expires_at <= now();
$$;
revoke execute on function private.expire_pickup_requests() from public, anon, authenticated, service_role;

-- pg_cron was created in the spec 07 migration. Every minute (UTC); upserts by name.
select cron.schedule('pickup-requests-expire', '* * * * *', $$select private.expire_pickup_requests()$$);
