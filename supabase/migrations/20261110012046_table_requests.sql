-- Spec 11 (PR 1, backend): table requests.
-- A signed-in customer asks a restaurant that accepts tables for a table (a day and time, a party
-- size, an optional note). The table has no client grants and no policies: every read and every
-- status change is a security-definer function that filters on auth.uid() and returns the server's
-- clock, so a wrong phone clock never changes what a request looks like. The same functions that
-- answer pickup requests (respond_to_request, mark_request_outcome, the seller lists and counts)
-- now take or cover both kinds, and every request object gains a `kind` key.
-- Every time rule below reads now(), never clock_timestamp(): now() is the transaction start, so
-- the edges of the arrival window and the expiry are exact and testable.
-- The app on main still calls the old list_my_pickup_requests: it is kept working here (it goes
-- through the shared builder, so its objects gain `kind`) and is dropped by spec 11 PR 2 once the
-- app uses list_my_requests. No existing migration is edited.

-- -- Table ------------------------------------------------------------------------
-- Hidden characters are refused in note and response_note (same class as pickup_requests): ASCII
-- controls except newline, DEL, C1 controls, zero-width, bidi overrides and isolates.
create table public.table_requests (
  id              uuid primary key default gen_random_uuid(),
  customer_id     uuid not null references public.profiles(id) on delete cascade,
  business_id     uuid not null references public.businesses(id) on delete cascade,
  idempotency_key uuid not null,
  status          text not null default 'pending'
                  check (status in ('pending', 'accepted', 'declined', 'expired', 'cancelled', 'completed', 'no_show')),
  table_at        timestamptz not null,
  party_size      smallint not null check (party_size between 1 and 20),
  note            text check (char_length(note) between 1 and 300 and note = btrim(note)
                              and note !~ '[\x00-\x09\x0B-\x1F\u007F-\u009F\u200B-\u200D\u202A-\u202E\u2066-\u2069\uFEFF]'),
  decline_reason  text check (decline_reason is null or decline_reason in
                              ('fully_booked', 'closed_then', 'too_busy', 'time_not_possible', 'other')),
  response_note   text check (char_length(response_note) between 1 and 200 and response_note = btrim(response_note)
                              and response_note !~ '[\x00-\x09\x0B-\x1F\u007F-\u009F\u200B-\u200D\u202A-\u202E\u2066-\u2069\uFEFF]'),
  expires_at      timestamptz not null,
  responded_at    timestamptz,
  arrived_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint table_requests_idem unique (customer_id, idempotency_key),
  constraint table_requests_expiry_order check (expires_at <= table_at)
);

-- -- Table checks (same rules as pickup_requests 10b, with the table reason list) -----
-- IS (NOT) DISTINCT FROM wherever a column can be null: with a null, "= 'other'" is NULL and a CHECK
-- that is NULL passes.
alter table public.table_requests
  add constraint table_requests_reason_on_declined
    check (decline_reason is null or status = 'declined'),
  add constraint table_requests_note_on_answered
    check (response_note is null or status in ('accepted', 'declined', 'completed', 'no_show')),
  add constraint table_requests_other_has_note
    check (decline_reason is distinct from 'other' or response_note is not null),
  add constraint table_requests_declined_note_is_other
    check (status <> 'declined' or response_note is null or decline_reason is not distinct from 'other'),
  add constraint table_requests_arrived_status
    check (arrived_at is null or status in ('accepted', 'completed', 'no_show'));

-- -- Indexes (keyset: (created_at, id) is the cursor) --------------------------------
create index table_requests_customer_keyset_idx on public.table_requests (customer_id, created_at desc, id desc);
create index table_requests_business_keyset_idx on public.table_requests (business_id, created_at desc, id desc);
create index table_requests_pending_expiry_idx on public.table_requests (expires_at) where status = 'pending';
create trigger table_requests_set_updated_at before update on public.table_requests
  for each row execute function public.set_updated_at();

-- -- RLS and grants ------------------------------------------------------------------
-- RLS on with no policy and no grant: nobody reads or writes the table directly.
alter table public.table_requests enable row level security;
revoke all on public.table_requests from anon, authenticated;

-- -- Request objects (one definition each) --------------------------------------------
-- Customer view of a table request (15 keys): id, kind, business_id, business_name, business_type,
-- status, display_status, table_at, party_size, note, expires_at, created_at, decline_reason,
-- response_note, arrived_at. Seller view: the same plus customer_name and responded_at (17).
-- Never contains accepted_address, place_id, coordinates, the customer's id or email.
create function private.table_request_json(p_request_id uuid, p_now timestamptz, p_seller_view boolean)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select o.j || case when p_seller_view
                     then jsonb_build_object('customer_name', coalesce(p.display_name, p.username),
                                             'responded_at', r.responded_at)
                     else '{}'::jsonb end
    from public.table_requests r
    join public.businesses bz on bz.id = r.business_id
    left join public.profiles p on p.id = r.customer_id
   cross join lateral (
     select jsonb_build_object(
              'id', r.id, 'kind', 'table', 'business_id', r.business_id, 'business_name', bz.name,
              'business_type', bz.type, 'status', r.status,
              'display_status', case when r.status = 'pending' and r.expires_at <= p_now then 'expired' else r.status end,
              'table_at', r.table_at, 'party_size', r.party_size, 'note', r.note,
              'expires_at', r.expires_at, 'created_at', r.created_at,
              'decline_reason', r.decline_reason, 'response_note', r.response_note,
              'arrived_at', r.arrived_at) as j) o
   where r.id = p_request_id;
$$;
revoke execute on function private.table_request_json(uuid, timestamptz, boolean)
  from public, anon, authenticated, service_role;

-- The pickup object gains `kind` (customer 16 keys, seller 18). Everything else is as in spec 10b.
create or replace function private.pickup_request_json(p_request_id uuid, p_now timestamptz, p_seller_view boolean)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select o.j || case when p_seller_view
                     then jsonb_build_object('customer_name', coalesce(p.display_name, p.username),
                                             'responded_at', r.responded_at)
                     else '{}'::jsonb end
    from public.pickup_requests r
    join public.businesses bz on bz.id = r.business_id
    left join public.profiles p on p.id = r.customer_id
   cross join lateral (
     select jsonb_build_object(
              'id', r.id, 'kind', 'pickup', 'business_id', r.business_id, 'business_name', bz.name, 'business_type', bz.type,
              'status', r.status,
              'display_status', case when r.status = 'pending' and r.expires_at <= p_now then 'expired' else r.status end,
              'pickup_at', r.pickup_at, 'items', r.items, 'order_text', r.order_text, 'note', r.note,
              'currency_code', r.currency_code, 'expires_at', r.expires_at, 'created_at', r.created_at,
              'decline_reason', r.decline_reason, 'response_note', r.response_note) as j) o
   where r.id = p_request_id;
$$;
revoke execute on function private.pickup_request_json(uuid, timestamptz, boolean)
  from public, anon, authenticated, service_role;

-- -- Expiry rule (one definition, separate from pickup's 30 minutes) ----------------------
-- 24 hours after the request, or the table time if that is earlier (Decision 4).
create function private.table_request_expiry(p_table_at timestamptz, p_created_at timestamptz)
returns timestamptz
language sql stable security definer set search_path = '' as $$
  select least(p_created_at + interval '24 hours', p_table_at);
$$;
revoke execute on function private.table_request_expiry(timestamptz, timestamptz)
  from public, anon, authenticated, service_role;

-- -- submit_table_request ---------------------------------------------------------------
-- p_note defaults to null so the generated types make it optional.
-- Error codes: not_signed_in, profile_incomplete, invalid_input, business_unavailable, own_business,
-- invalid_table_time, invalid_party_size, invalid_text, too_many_pending, rate_limited.
-- Pickup and table caps and rate limits are counted separately (Decision 8).
create function public.submit_table_request(
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
  v_recent    integer;
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
    if v_pending >= 5 or v_pending_b >= 1 then raise exception 'too_many_pending'; end if;

    -- 10 submits an hour: the customer's own rows are the counter (sliding window; replays above
    -- never reach here; cancelled and expired rows still count).
    select count(*) into v_recent
      from public.table_requests r
     where r.customer_id = v_uid and r.created_at > v_now - interval '1 hour';
    if v_recent >= 10 then raise exception 'rate_limited'; end if;

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

-- -- cancel_table_request ---------------------------------------------------------------
-- pending -> cancelled, by the customer, while the request has not expired. Not after acceptance
-- (v1 section 16: needs a seller notification, spec 12). The row is locked first, the same lock
-- respond_to_request takes, so a cancel and an answer cannot both win.
create function public.cancel_table_request(p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
  v_r   public.table_requests;
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;

  select t.* into v_r
    from public.table_requests t
   where t.id = p_request_id and t.customer_id = v_uid
     for update;
  if not found then raise exception 'not_found'; end if;     -- unknown and someone else's look the same

  if v_r.status <> 'pending' or v_r.expires_at <= v_now then
    raise exception 'invalid_transition';
  end if;

  update public.table_requests set status = 'cancelled' where id = v_r.id;

  return private.table_request_json(v_r.id, v_now, false);
end $$;
revoke execute on function public.cancel_table_request(uuid) from public, anon, authenticated;
grant execute on function public.cancel_table_request(uuid) to authenticated;

-- -- get_my_table_request -----------------------------------------------------------------
-- { server_now, request }; request is null for an unknown id and for someone else's, identically.
create function public.get_my_table_request(p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;

  return jsonb_build_object(
    'server_now', v_now,
    'request', (
      select private.table_request_json(t.id, v_now, false)
        from public.table_requests t
       where t.id = p_request_id and t.customer_id = v_uid));
end $$;
revoke execute on function public.get_my_table_request(uuid) from public, anon, authenticated;
grant execute on function public.get_my_table_request(uuid) to authenticated;

-- -- mark_arrived ------------------------------------------------------------------------
-- "I've arrived": once, on an accepted request, from 2 hours before the table time until 4 hours
-- after it (both ends allowed), by the server clock. No location, no calendar day, no time zone, no
-- client time. The checks run in this fixed order and the first failure wins: not_found (unknown or
-- not the caller's), invalid_transition (not accepted), already_arrived (even after the window has
-- closed), arrival_window. Returns the customer's table request object.
create function public.mark_arrived(p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
  v_r   public.table_requests;
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;

  select t.* into v_r
    from public.table_requests t
   where t.id = p_request_id and t.customer_id = v_uid
     for update;
  if not found then raise exception 'not_found'; end if;

  if v_r.status <> 'accepted' then raise exception 'invalid_transition'; end if;
  if v_r.arrived_at is not null then raise exception 'already_arrived'; end if;
  if v_now < v_r.table_at - interval '2 hours' or v_now > v_r.table_at + interval '4 hours' then
    raise exception 'arrival_window';
  end if;

  update public.table_requests set arrived_at = v_now where id = v_r.id;

  return private.table_request_json(v_r.id, v_now, false);
end $$;
revoke execute on function public.mark_arrived(uuid) from public, anon, authenticated;
grant execute on function public.mark_arrived(uuid) to authenticated;

-- -- respond_to_request (kind-aware; the four-argument form is dropped) -------------------
-- p_kind picks the table the request lives in and the reason list. An unknown id, someone else's id
-- and an id of the other kind all give not_found. A pickup reason sent with 'table' (or the reverse)
-- is invalid_input. Old app builds send no p_kind and get pickup. The pickup branch is the spec 10b
-- code unchanged and comes first. Everything is validated before any row is read.
-- Error codes: not_signed_in, invalid_input, invalid_text, decline_reason_required, not_found,
-- invalid_transition.
drop function public.respond_to_request(uuid, text, text, text);

create function public.respond_to_request(
  p_request_id uuid,
  p_decision text,
  p_decline_reason text default null,
  p_note text default null,
  p_kind text default 'pickup'
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := auth.uid();
  v_now    timestamptz := now();
  v_b      record;
  v_r      public.pickup_requests;
  v_t      public.table_requests;
  v_reason text;
  v_note   text;
  v_codes  text[];
  c_ctrl   constant text := '[\x00-\x09\x0B-\x1F\u007F-\u009F\u200B-\u200D\u202A-\u202E\u2066-\u2069\uFEFF]';
  c_edge   constant text := '^[ \n\u00A0\u115F\u1160\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\u3164\uFFA0]+|[ \n\u00A0\u115F\u1160\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\u3164\uFFA0]+$';
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;
  if p_kind is null or p_kind not in ('pickup', 'table') then raise exception 'invalid_input'; end if;
  if p_decision is null or p_decision not in ('accepted', 'declined') then raise exception 'invalid_input'; end if;

  v_codes := case p_kind
               when 'table' then array['fully_booked', 'closed_then', 'too_busy', 'time_not_possible', 'other']
               else array['sold_out', 'closed_then', 'too_busy', 'cannot_prepare', 'time_not_possible', 'other'] end;

  v_note := nullif(regexp_replace(p_note, c_edge, '', 'g'), '');

  if p_decision = 'accepted' then
    if p_decline_reason is not null then raise exception 'invalid_input'; end if;
    if char_length(v_note) > 200 or v_note ~ c_ctrl then raise exception 'invalid_text'; end if;
  else
    v_reason := nullif(regexp_replace(p_decline_reason, c_edge, '', 'g'), '');
    if v_reason is null then raise exception 'decline_reason_required'; end if;
    if not (p_decline_reason = any (v_codes)) then
      raise exception 'invalid_input';
    end if;
    if p_decline_reason = 'other' then
      if v_note is null then raise exception 'decline_reason_required'; end if;
      if char_length(v_note) > 200 or v_note ~ c_ctrl then raise exception 'invalid_text'; end if;
    elsif v_note is not null then
      raise exception 'invalid_input';      -- a fixed reason carries no note
    end if;
  end if;

  select b.id, b.type into v_b from public.businesses b where b.owner_id = v_uid;
  if not found then raise exception 'not_found'; end if;

  if p_kind = 'pickup' then
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
           decline_reason = case when p_decision = 'declined' then p_decline_reason end,
           response_note = v_note,
           accepted_address = case when p_decision = 'accepted' and v_b.type = 'homemade'
                                   then (select l.formatted_address from public.business_locations l
                                          where l.business_id = v_b.id) end
     where id = v_r.id;

    return private.pickup_request_json(v_r.id, v_now, true);
  end if;

  select t.* into v_t
    from public.table_requests t
   where t.id = p_request_id and t.business_id = v_b.id
     for update;
  if not found then raise exception 'not_found'; end if;

  if v_t.status <> 'pending' or v_t.expires_at <= v_now then
    raise exception 'invalid_transition';
  end if;

  update public.table_requests
     set status = p_decision,
         responded_at = v_now,
         decline_reason = case when p_decision = 'declined' then p_decline_reason end,
         response_note = v_note
   where id = v_t.id;

  return private.table_request_json(v_t.id, v_now, true);
end $$;
revoke execute on function public.respond_to_request(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.respond_to_request(uuid, text, text, text, text) to authenticated;

-- -- mark_request_outcome (kind-aware; the two-argument form is dropped) --------------------
-- accepted -> completed | no_show once the pickup or table time has passed. responded_at stays as
-- it was. The pickup branch is the spec 10 code unchanged and comes first.
drop function public.mark_request_outcome(uuid, text);

create function public.mark_request_outcome(
  p_request_id uuid,
  p_outcome text,
  p_kind text default 'pickup'
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
  v_biz uuid;
  v_r   public.pickup_requests;
  v_t   public.table_requests;
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;
  if p_kind is null or p_kind not in ('pickup', 'table') then raise exception 'invalid_input'; end if;
  if p_outcome is null or p_outcome not in ('completed', 'no_show') then raise exception 'invalid_input'; end if;

  select b.id into v_biz from public.businesses b where b.owner_id = v_uid;
  if not found then raise exception 'not_found'; end if;

  if p_kind = 'pickup' then
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
  end if;

  select t.* into v_t
    from public.table_requests t
   where t.id = p_request_id and t.business_id = v_biz
     for update;
  if not found then raise exception 'not_found'; end if;

  if v_t.status <> 'accepted' or v_t.table_at > v_now then
    raise exception 'invalid_transition';
  end if;

  update public.table_requests set status = p_outcome where id = v_t.id;

  return private.table_request_json(v_t.id, v_now, true);
end $$;
revoke execute on function public.mark_request_outcome(uuid, text, text) from public, anon, authenticated;
grant execute on function public.mark_request_outcome(uuid, text, text) to authenticated;

-- -- list_my_requests --------------------------------------------------------------------
-- { server_now, requests, next_cursor }: the caller's pickup and table requests merged, newest
-- first, 50 a page. The cursor is text "<created_at UTC, microseconds>|<id>" sent back untouched by
-- the app (the format of list_business_requests). next_cursor is null on the last page; 51 rows are
-- read to know that. list_my_pickup_requests stays until spec 11 PR 2.
create function public.list_my_requests(p_before text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := auth.uid();
  v_now    timestamptz := now();
  v_at     timestamptz;
  v_cid    uuid;
  v_ids    uuid[];
  v_kinds  text[];
  v_ats    timestamptz[];
  v_next   text;
  c_cursor constant text := '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z\|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;

  if p_before is not null then
    if p_before !~ c_cursor then raise exception 'invalid_input'; end if;
    begin
      v_at  := split_part(p_before, '|', 1)::timestamptz;
      v_cid := split_part(p_before, '|', 2)::uuid;
    exception when others then
      raise exception 'invalid_input';
    end;
  end if;

  select array_agg(m.id order by m.created_at desc, m.id desc),
         array_agg(m.kind order by m.created_at desc, m.id desc),
         array_agg(m.created_at order by m.created_at desc, m.id desc)
    into v_ids, v_kinds, v_ats
    from (select u.id, u.kind, u.created_at
            from (
              (select x.id, 'pickup'::text as kind, x.created_at
                 from public.pickup_requests x
                where x.customer_id = v_uid
                  and (v_at is null or (x.created_at, x.id) < (v_at, v_cid))
                order by x.created_at desc, x.id desc
                limit 51)
              union all
              (select x.id, 'table'::text as kind, x.created_at
                 from public.table_requests x
                where x.customer_id = v_uid
                  and (v_at is null or (x.created_at, x.id) < (v_at, v_cid))
                order by x.created_at desc, x.id desc
                limit 51)
            ) u
           order by u.created_at desc, u.id desc
           limit 51) m;

  if coalesce(cardinality(v_ids), 0) > 50 then
    v_ids := v_ids[1:50];
    v_kinds := v_kinds[1:50];
    v_next := to_char(v_ats[50] at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') || '|' || v_ids[50]::text;
  end if;

  return jsonb_build_object(
    'server_now', v_now,
    'requests', coalesce((select jsonb_agg(case when u.kind = 'table'
                                                then private.table_request_json(u.id, v_now, false)
                                                else private.pickup_request_json(u.id, v_now, false) end
                                              order by u.ord)
                            from unnest(coalesce(v_ids, array[]::uuid[]), coalesce(v_kinds, array[]::text[]))
                                 with ordinality as u(id, kind, ord)), '[]'::jsonb),
    'next_cursor', v_next);
end $$;
revoke execute on function public.list_my_requests(text) from public, anon, authenticated;
grant execute on function public.list_my_requests(text) to authenticated;

-- -- list_business_requests (merges both kinds; same cursor and filters) --------------------
-- p_status: null = all, 'waiting' = display status pending, or one display status.
create or replace function public.list_business_requests(p_status text default null, p_before text default null)
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
  v_kinds  text[];
  v_ats    timestamptz[];
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

  select array_agg(m.id order by m.created_at desc, m.id desc),
         array_agg(m.kind order by m.created_at desc, m.id desc),
         array_agg(m.created_at order by m.created_at desc, m.id desc)
    into v_ids, v_kinds, v_ats
    from (select u.id, u.kind, u.created_at
            from (
              (select x.id, 'pickup'::text as kind, x.created_at
                 from public.pickup_requests x
                where x.business_id = v_biz
                  and (v_at is null or (x.created_at, x.id) < (v_at, v_cid))
                  and (v_status is null
                       or (v_status = 'pending' and x.status = 'pending' and x.expires_at > v_now)
                       or (v_status = 'expired' and (x.status = 'expired' or (x.status = 'pending' and x.expires_at <= v_now)))
                       or (v_status not in ('pending', 'expired') and x.status = v_status))
                order by x.created_at desc, x.id desc
                limit 51)
              union all
              (select x.id, 'table'::text as kind, x.created_at
                 from public.table_requests x
                where x.business_id = v_biz
                  and (v_at is null or (x.created_at, x.id) < (v_at, v_cid))
                  and (v_status is null
                       or (v_status = 'pending' and x.status = 'pending' and x.expires_at > v_now)
                       or (v_status = 'expired' and (x.status = 'expired' or (x.status = 'pending' and x.expires_at <= v_now)))
                       or (v_status not in ('pending', 'expired') and x.status = v_status))
                order by x.created_at desc, x.id desc
                limit 51)
            ) u
           order by u.created_at desc, u.id desc
           limit 51) m;

  if coalesce(cardinality(v_ids), 0) > 50 then
    v_ids := v_ids[1:50];
    v_kinds := v_kinds[1:50];
    v_next := to_char(v_ats[50] at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') || '|' || v_ids[50]::text;
  end if;

  return jsonb_build_object(
    'server_now', v_now,
    'requests', coalesce((select jsonb_agg(case when u.kind = 'table'
                                                then private.table_request_json(u.id, v_now, true)
                                                else private.pickup_request_json(u.id, v_now, true) end
                                              order by u.ord)
                            from unnest(coalesce(v_ids, array[]::uuid[]), coalesce(v_kinds, array[]::text[]))
                                 with ordinality as u(id, kind, ord)), '[]'::jsonb),
    'next_cursor', v_next);
end $$;
revoke execute on function public.list_business_requests(text, text) from public, anon, authenticated;
grant execute on function public.list_business_requests(text, text) to authenticated;

-- -- get_business_request (either kind) --------------------------------------------------
-- { server_now, request }; request is null for an unknown id, for someone else's, and for a caller
-- with no business, identically.
create or replace function public.get_business_request(p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;

  return jsonb_build_object(
    'server_now', v_now,
    'request', coalesce(
      (select private.pickup_request_json(r.id, v_now, true)
         from public.pickup_requests r
         join public.businesses b on b.id = r.business_id
        where r.id = p_request_id and b.owner_id = v_uid),
      (select private.table_request_json(t.id, v_now, true)
         from public.table_requests t
         join public.businesses b on b.id = t.business_id
        where t.id = p_request_id and b.owner_id = v_uid)));
end $$;
revoke execute on function public.get_business_request(uuid) from public, anon, authenticated;
grant execute on function public.get_business_request(uuid) to authenticated;

-- -- count_waiting_requests (both kinds) -------------------------------------------------
-- { server_now, waiting }: pending requests of the caller's business that are not past expires_at.
create or replace function public.count_waiting_requests() returns jsonb
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
                 where b.owner_id = v_uid and r.status = 'pending' and r.expires_at > v_now)
             + (select count(*)
                  from public.table_requests t
                  join public.businesses b on b.id = t.business_id
                 where b.owner_id = v_uid and t.status = 'pending' and t.expires_at > v_now));
end $$;
revoke execute on function public.count_waiting_requests() from public, anon, authenticated;
grant execute on function public.count_waiting_requests() to authenticated;

-- -- Auto-expire (cron only) -------------------------------------------------------------
-- Same function and same cron job as spec 09 (pickup-requests-expire, every minute). It now also
-- expires pending table requests, and it keeps the spec 10 address-snapshot retention statement.
create or replace function private.expire_pickup_requests() returns void
language sql security definer set search_path = '' as $$
  update public.pickup_requests set status = 'expired'
   where status = 'pending' and expires_at <= now();
  update public.table_requests set status = 'expired'
   where status = 'pending' and expires_at <= now();
  update public.pickup_requests set accepted_address = null
   where accepted_address is not null and pickup_at <= now() - interval '24 hours';
$$;
revoke execute on function private.expire_pickup_requests() from public, anon, authenticated, service_role;
