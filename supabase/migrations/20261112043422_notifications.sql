-- Spec 12: notifications (PR 1, backend).
-- Request events (new, cancelled, arrived, accepted, declined, expired) are written to an outbox by
-- row triggers in the same transaction as the change, so nothing is lost and a rolled-back change
-- sends nothing. The push-sender Edge Function claims due rows (settings, staleness, throttling and
-- collapsing are decided here, by the server clock), sends them through Expo and records the result.
-- The outbox holds no text: titles and bodies are built at send time from fixed templates.
-- The customer's "changed" badge moves from the phone to a server-side seen flag, and the submit
-- functions gain a daily cap across places (30 requests of both kinds in a rolling 24 hours).
-- No existing migration is edited.

-- -- Tables -----------------------------------------------------------------------------
create table public.push_tokens (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.profiles(id) on delete cascade,
  token              text not null unique
                     check (token ~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]{1,200}\]$'),
  platform           text not null check (platform in ('ios', 'android')),
  created_at         timestamptz not null default now(),
  last_registered_at timestamptz not null default now()
);
create index push_tokens_user_idx on public.push_tokens (user_id, last_registered_at desc);

-- A missing row means every switch is on.
create table public.notification_settings (
  user_id       uuid primary key references public.profiles(id) on delete cascade,
  answers       boolean not null default true,   -- customer: accepted, declined, expired
  new_requests  boolean not null default true,   -- business owner
  cancellations boolean not null default true,   -- business owner
  arrivals      boolean not null default true,   -- business owner
  updated_at    timestamptz not null default now()
);

create table private.notification_outbox (
  id              bigint generated always as identity primary key,
  recipient_id    uuid not null references public.profiles(id) on delete cascade,
  event           text not null check (event in
                    ('new_request', 'cancelled', 'arrived', 'accepted', 'declined', 'expired')),
  request_kind    text not null check (request_kind in ('pickup', 'table')),
  request_id      uuid not null,
  business_id     uuid not null references public.businesses(id) on delete cascade,
  status          text not null default 'queued'
                    check (status in ('queued', 'sending', 'sent', 'skipped', 'failed')),
  skip_reason     text check (skip_reason is null or skip_reason in
                    ('setting_off', 'no_token', 'stale', 'collapsed', 'throttled', 'cancelled_before_send')),
  -- How many events one push stands for: more than 1 only on the lead row of a collapsed group.
  group_count     smallint not null default 1 check (group_count >= 1),
  attempts        smallint not null default 0,
  next_attempt_at timestamptz not null default now(),
  -- Set when a row is claimed for sending: the push time used by the 5-minute window and the hourly cap.
  claimed_at      timestamptz,
  sent_at         timestamptz,
  created_at      timestamptz not null default now(),
  constraint notification_outbox_skip_reason check ((status = 'skipped') = (skip_reason is not null))
);
create index notification_outbox_due_idx on private.notification_outbox (next_attempt_at, id)
  where status in ('queued', 'sending');
create index notification_outbox_recipient_idx on private.notification_outbox (recipient_id, event, claimed_at);
create index notification_outbox_request_idx on private.notification_outbox (request_kind, request_id);

create table private.push_tickets (
  ticket_id  text primary key,
  outbox_id  bigint not null references private.notification_outbox(id) on delete cascade,
  token_id   uuid references public.push_tokens(id) on delete set null,
  created_at timestamptz not null default now(),
  checked_at timestamptz
);
create index push_tickets_unchecked_idx on private.push_tickets (created_at) where checked_at is null;
create index push_tickets_outbox_idx on private.push_tickets (outbox_id);

-- -- Seen flag on both request tables ---------------------------------------------------
-- Defaults to false, so every request that exists at release starts as seen (no badge flood).
alter table public.pickup_requests add column customer_unseen boolean not null default false;
alter table public.table_requests  add column customer_unseen boolean not null default false;
create index pickup_requests_unseen_idx on public.pickup_requests (customer_id) where customer_unseen;
create index table_requests_unseen_idx on public.table_requests (customer_id) where customer_unseen;

-- -- RLS and grants -----------------------------------------------------------------------
-- RLS on with no policy and no grant: every read and write is a security-definer function.
alter table public.push_tokens enable row level security;
alter table public.notification_settings enable row level security;
alter table private.notification_outbox enable row level security;
alter table private.push_tickets enable row level security;
revoke all on public.push_tokens from public, anon, authenticated;
revoke all on public.notification_settings from public, anon, authenticated;
revoke all on private.notification_outbox from public, anon, authenticated, service_role;
revoke all on private.push_tickets from public, anon, authenticated, service_role;

-- -- Kick (pg_net) ------------------------------------------------------------------------
-- Same shape as private.invoke_places_refresh: POSTs to push-sender with the shared secret, both
-- read from the Vault (push_sender_url, push_sender_secret). Without them, or without pg_net
-- (CI, tests, local), it does nothing. pg_net queues the call in the current transaction, so a
-- rolled-back change sends no kick.
create function private.invoke_push_sender() returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_url     text;
  v_secret  text;
begin
  if not exists (select 1 from pg_catalog.pg_extension where extname = 'pg_net') then return; end if;
  select s.decrypted_secret into v_url from vault.decrypted_secrets s where s.name = 'push_sender_url';
  select s.decrypted_secret into v_secret from vault.decrypted_secrets s where s.name = 'push_sender_secret';
  if v_url is null or v_secret is null then return; end if;

  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  );
end $$;
revoke execute on function private.invoke_push_sender() from public, anon, authenticated, service_role;

-- -- Seen flag trigger ----------------------------------------------------------------------
-- Every status change the customer did not make sets the flag. The customer's only own change is a
-- cancel, which never matches (spec 10b Decision 18).
create function private.flag_customer_unseen() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status is distinct from old.status
     and new.status in ('accepted', 'declined', 'expired', 'completed', 'no_show') then
    new.customer_unseen := true;
  end if;
  return new;
end $$;
revoke execute on function private.flag_customer_unseen() from public, anon, authenticated, service_role;

create trigger pickup_requests_flag_customer_unseen before update of status on public.pickup_requests
  for each row execute function private.flag_customer_unseen();
create trigger table_requests_flag_customer_unseen before update of status on public.table_requests
  for each row execute function private.flag_customer_unseen();

-- -- Event trigger ------------------------------------------------------------------------
-- Writes outbox rows only. It never raises for delivery reasons, so it cannot block the user's
-- action: a missing recipient writes nothing, and the kick is wrapped. The owner is read at event
-- time. completed and no_show write no row (Decision 1). The kick runs at most once per transaction.
create function private.enqueue_request_event() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_kind      text := case tg_table_name when 'pickup_requests' then 'pickup' else 'table' end;
  v_event     text;
  v_owner     uuid;
  v_wrote     boolean := false;
begin
  select b.owner_id into v_owner from public.businesses b where b.id = new.business_id;

  if tg_op = 'INSERT' then
    if new.status = 'pending' then v_event := 'new_request'; end if;
  elsif new.status is distinct from old.status and old.status = 'pending' then
    v_event := case new.status
                 when 'cancelled' then 'cancelled'
                 when 'accepted'  then 'accepted'
                 when 'declined'  then 'declined'
                 when 'expired'   then 'expired'
               end;
  end if;

  if v_event is not null then
    if v_event in ('new_request', 'cancelled') then
      if v_owner is not null then
        insert into private.notification_outbox (recipient_id, event, request_kind, request_id, business_id)
        values (v_owner, v_event, v_kind, new.id, new.business_id);
        v_wrote := true;
      end if;
    else
      insert into private.notification_outbox (recipient_id, event, request_kind, request_id, business_id)
      values (new.customer_id, v_event, v_kind, new.id, new.business_id);
      v_wrote := true;
    end if;
  end if;

  -- arrived_at exists only on table_requests; the nested if keeps the field out of pickup rows.
  if tg_op = 'UPDATE' and tg_table_name = 'table_requests' then
    if old.arrived_at is null and new.arrived_at is not null and v_owner is not null then
      insert into private.notification_outbox (recipient_id, event, request_kind, request_id, business_id)
      values (v_owner, 'arrived', v_kind, new.id, new.business_id);
      v_wrote := true;
    end if;
  end if;

  if v_wrote and current_setting('liketoorder.push_kick', true) is distinct from '1' then
    perform set_config('liketoorder.push_kick', '1', true);
    begin
      perform private.invoke_push_sender();
    exception when others then
      -- Delivery only: the 1-minute sweeper sends the row anyway.
      null;
    end;
  end if;
  return null;
end $$;
revoke execute on function private.enqueue_request_event() from public, anon, authenticated, service_role;

create trigger pickup_requests_enqueue_event after insert or update of status on public.pickup_requests
  for each row execute function private.enqueue_request_event();
create trigger table_requests_enqueue_event after insert or update of status, arrived_at on public.table_requests
  for each row execute function private.enqueue_request_event();

-- -- Tokens (authenticated) -------------------------------------------------------------------
-- Upsert by token: a token held by another user moves to the caller (one phone, new account).
-- At most 10 per user; the oldest by last_registered_at is dropped.
create function public.register_push_token(p_token text, p_platform text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;
  if p_token is null or p_token !~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]{1,200}\]$'
     or p_platform is null or p_platform not in ('ios', 'android') then
    raise exception 'invalid_input';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('push_tokens:' || v_uid::text, 0));

  insert into public.push_tokens (user_id, token, platform)
  values (v_uid, p_token, p_platform)
  on conflict (token) do update
    set user_id = excluded.user_id, platform = excluded.platform, last_registered_at = now();

  delete from public.push_tokens t
   where t.user_id = v_uid
     and t.id not in (select k.id from public.push_tokens k
                       where k.user_id = v_uid
                       order by k.last_registered_at desc, k.id desc
                       limit 10);
end $$;
revoke execute on function public.register_push_token(text, text) from public, anon, authenticated;
grant execute on function public.register_push_token(text, text) to authenticated;

-- Deletes the row only if it is the caller's. Unknown and someone else's token: the same answer.
create function public.unregister_push_token(p_token text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;
  delete from public.push_tokens t where t.token = p_token and t.user_id = v_uid;
end $$;
revoke execute on function public.unregister_push_token(text) from public, anon, authenticated;
grant execute on function public.unregister_push_token(text) to authenticated;

-- -- Settings (authenticated) -----------------------------------------------------------------
create function public.get_notification_settings() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  s     public.notification_settings;
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;
  select x.* into s from public.notification_settings x where x.user_id = v_uid;
  return jsonb_build_object(
    'answers',       coalesce(s.answers, true),
    'new_requests',  coalesce(s.new_requests, true),
    'cancellations', coalesce(s.cancellations, true),
    'arrivals',      coalesce(s.arrivals, true));
end $$;
revoke execute on function public.get_notification_settings() from public, anon, authenticated;
grant execute on function public.get_notification_settings() to authenticated;

create function public.set_notification_settings(
  p_answers boolean, p_new_requests boolean, p_cancellations boolean, p_arrivals boolean
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;
  if p_answers is null or p_new_requests is null or p_cancellations is null or p_arrivals is null then
    raise exception 'invalid_input';
  end if;
  insert into public.notification_settings (user_id, answers, new_requests, cancellations, arrivals)
  values (v_uid, p_answers, p_new_requests, p_cancellations, p_arrivals)
  on conflict (user_id) do update
    set answers = excluded.answers, new_requests = excluded.new_requests,
        cancellations = excluded.cancellations, arrivals = excluded.arrivals, updated_at = now();
  return public.get_notification_settings();
end $$;
revoke execute on function public.set_notification_settings(boolean, boolean, boolean, boolean)
  from public, anon, authenticated;
grant execute on function public.set_notification_settings(boolean, boolean, boolean, boolean)
  to authenticated;

-- -- Seen flag (authenticated) --------------------------------------------------------------
create function public.count_my_request_updates() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;
  return (select count(*) from public.pickup_requests r where r.customer_id = v_uid and r.customer_unseen)
       + (select count(*) from public.table_requests t where t.customer_id = v_uid and t.customer_unseen);
end $$;
revoke execute on function public.count_my_request_updates() from public, anon, authenticated;
grant execute on function public.count_my_request_updates() to authenticated;

-- Clears the flag only on rows that existed and had last changed when the call started
-- (Decision 18): a change made by a transaction that starts after this call has a later
-- updated_at (set_updated_at uses the writer's now()) and stays flagged.
-- Known limit (accepted): a change whose transaction started before this call but commits while
-- this update waits on the row lock has an earlier updated_at and is cleared too. The app re-reads
-- the Sent list right after marking, so the new status is still on screen.
create function public.mark_my_requests_seen() returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := auth.uid();
  v_start timestamptz := now();
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;
  update public.pickup_requests r set customer_unseen = false
   where r.customer_id = v_uid and r.customer_unseen
     and r.created_at <= v_start and r.updated_at <= v_start;
  update public.table_requests t set customer_unseen = false
   where t.customer_id = v_uid and t.customer_unseen
     and t.created_at <= v_start and t.updated_at <= v_start;
end $$;
revoke execute on function public.mark_my_requests_seen() from public, anon, authenticated;
grant execute on function public.mark_my_requests_seen() to authenticated;

-- -- Sender (service role) ----------------------------------------------------------------
-- claim_push_batch: takes due rows (queued and due, or sending with a claim over 5 minutes old: a
-- crashed sender) and decides each one, by the server clock:
--   1. a queued cancelled row whose new_request row is still queued: both skipped/cancelled_before_send;
--   2. the recipient's switch for the event is off: skipped/setting_off;
--   3. a new_request whose request is no longer pending, or is past expires_at: skipped/stale;
--   4. the recipient has no token: skipped/no_token;
--   5. 20 pushes to the recipient in the last hour (arrived is exempt and not counted): skipped/throttled;
--   6. new_request and cancelled: if one was pushed to this recipient for this business less than
--      5 minutes ago, the row waits until 5 minutes after that push; otherwise every due row of
--      that bucket becomes one push, led by the NEWEST request (its kind and id go in the message,
--      so a tap opens it), the others skipped/collapsed.
-- Delivery is at least once: a row reclaimed after a crash may already have reached the phone.
-- A reclaim counts as an attempt, so a row that keeps crashing the sender ends as failed.
-- Each message: { outbox_ids (lead first), event, kind, request_id, side, business_name (null for
-- owner events), count, tokens: [{ id, token }] }. Never a note, order text, address, email, phone
-- or customer name.
create function public.claim_push_batch(p_limit integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_now      timestamptz := now();
  v_row      private.notification_outbox;
  v_cur      private.notification_outbox;
  v_lead     private.notification_outbox;
  v_on       boolean;
  v_req      text;
  v_exp      timestamptz;
  v_tokens   jsonb;
  v_hour     integer;
  v_last     timestamptz;
  v_ids      bigint[];
  v_count    integer;
  v_name     text;
  v_messages jsonb := '[]'::jsonb;
begin
  -- One claim at a time. Each committed request kicks its own sender run, so runs can overlap; two
  -- claims at once would not see each other's uncommitted sending rows and could both pass the
  -- 5-minute window and the hourly cap. Waiting is safe: a claim only reads and updates rows and
  -- ends with its transaction; the sending happens later, in the Edge Function.
  perform pg_advisory_xact_lock(hashtextextended('claim_push_batch', 0));
  if p_limit is null or p_limit < 1 or p_limit > 100 then raise exception 'invalid_input'; end if;

  -- 1. Cancelled before the new-request push went out: neither is sent.
  with pairs as (
    select c.id as cid, n.id as nid
      from private.notification_outbox c
      join private.notification_outbox n
        on n.request_kind = c.request_kind and n.request_id = c.request_id
       and n.event = 'new_request' and n.status = 'queued'
     where c.event = 'cancelled' and c.status = 'queued'
       for update of c, n skip locked
  )
  update private.notification_outbox o
     set status = 'skipped', skip_reason = 'cancelled_before_send'
   where o.id in (select p.cid from pairs p union all select p.nid from pairs p);

  for v_row in
    select o.* from private.notification_outbox o
     where (o.status = 'queued' and o.next_attempt_at <= v_now)
        or (o.status = 'sending' and o.claimed_at <= v_now - interval '5 minutes')
     order by o.next_attempt_at, o.id
     limit p_limit
       for update skip locked
  loop
    -- Re-read: an earlier row of this loop may have collapsed or claimed this one.
    select o.* into v_cur from private.notification_outbox o where o.id = v_row.id;
    continue when not (v_cur.status = 'queued'
                       or (v_cur.status = 'sending' and v_cur.claimed_at <= v_now - interval '5 minutes'));

    if v_cur.status = 'sending' then
      if v_cur.attempts + 1 >= 5 then
        update private.notification_outbox set status = 'failed', attempts = attempts + 1 where id = v_cur.id;
        continue;
      end if;
      update private.notification_outbox set attempts = attempts + 1 where id = v_cur.id;
    end if;

    -- 2. Settings (a missing row means on).
    v_on := null;
    select case v_cur.event
             when 'new_request' then s.new_requests
             when 'cancelled'   then s.cancellations
             when 'arrived'     then s.arrivals
             else s.answers
           end
      into v_on
      from public.notification_settings s where s.user_id = v_cur.recipient_id;
    if v_on is not distinct from false then
      update private.notification_outbox set status = 'skipped', skip_reason = 'setting_off' where id = v_cur.id;
      continue;
    end if;

    -- 3. Stale new request.
    if v_cur.event = 'new_request' then
      v_req := null;
      v_exp := null;
      if v_cur.request_kind = 'pickup' then
        select r.status, r.expires_at into v_req, v_exp from public.pickup_requests r where r.id = v_cur.request_id;
      else
        select t.status, t.expires_at into v_req, v_exp from public.table_requests t where t.id = v_cur.request_id;
      end if;
      if v_req is distinct from 'pending' or v_exp <= v_now then
        update private.notification_outbox set status = 'skipped', skip_reason = 'stale' where id = v_cur.id;
        continue;
      end if;
    end if;

    -- 4. Tokens.
    select jsonb_agg(jsonb_build_object('id', t.id, 'token', t.token) order by t.last_registered_at desc, t.id)
      into v_tokens
      from public.push_tokens t where t.user_id = v_cur.recipient_id;
    if v_tokens is null then
      update private.notification_outbox set status = 'skipped', skip_reason = 'no_token' where id = v_cur.id;
      continue;
    end if;

    -- 5. Hourly cap.
    if v_cur.event <> 'arrived' then
      select count(*) into v_hour
        from private.notification_outbox o
       where o.recipient_id = v_cur.recipient_id and o.event <> 'arrived' and o.id <> v_cur.id
         and o.status in ('sending', 'sent') and o.claimed_at > v_now - interval '1 hour';
      if v_hour >= 20 then
        update private.notification_outbox set status = 'skipped', skip_reason = 'throttled' where id = v_cur.id;
        continue;
      end if;
    end if;

    -- 6. Five-minute window and collapsing.
    if v_cur.event in ('new_request', 'cancelled') then
      select max(o.claimed_at) into v_last
        from private.notification_outbox o
       where o.recipient_id = v_cur.recipient_id and o.business_id = v_cur.business_id
         and o.event = v_cur.event and o.id <> v_cur.id and o.status in ('sending', 'sent');
      if v_last > v_now - interval '5 minutes' then
        update private.notification_outbox
           set status = 'queued', next_attempt_at = v_last + interval '5 minutes'
         where id = v_cur.id;
        continue;
      end if;

      -- Other due new requests of the bucket that went stale are dropped, not counted.
      if v_cur.event = 'new_request' then
        update private.notification_outbox o set status = 'skipped', skip_reason = 'stale'
         where o.recipient_id = v_cur.recipient_id and o.business_id = v_cur.business_id
           and o.event = 'new_request' and o.status = 'queued' and o.next_attempt_at <= v_now
           and o.id <> v_cur.id
           and not (case o.request_kind
                      when 'pickup' then exists (select 1 from public.pickup_requests r
                                                  where r.id = o.request_id and r.status = 'pending'
                                                    and r.expires_at > v_now)
                      else exists (select 1 from public.table_requests t
                                    where t.id = o.request_id and t.status = 'pending'
                                      and t.expires_at > v_now)
                    end);
      end if;

      select array_agg(g.id order by g.created_at desc, g.id desc), sum(g.group_count)
        into v_ids, v_count
        from (select o.id, o.created_at, o.group_count
                from private.notification_outbox o
               where o.id = v_cur.id
                  or (o.recipient_id = v_cur.recipient_id and o.business_id = v_cur.business_id
                      and o.event = v_cur.event and o.status = 'queued' and o.next_attempt_at <= v_now)
                 for update skip locked) g;
    else
      v_ids := array[v_cur.id];
      v_count := v_cur.group_count;
    end if;

    select o.* into v_lead from private.notification_outbox o where o.id = v_ids[1];
    update private.notification_outbox
       set status = 'sending', skip_reason = null, claimed_at = v_now, group_count = least(v_count, 32767)
     where id = v_lead.id;
    update private.notification_outbox set status = 'skipped', skip_reason = 'collapsed'
     where id = any(v_ids[2:]);

    v_name := null;
    if v_lead.event in ('accepted', 'declined', 'expired') then
      select b.name into v_name from public.businesses b where b.id = v_lead.business_id;
    end if;

    v_messages := v_messages || jsonb_build_array(jsonb_build_object(
      'outbox_ids',    to_jsonb(v_ids),
      'event',         v_lead.event,
      'kind',          v_lead.request_kind,
      'request_id',    v_lead.request_id,
      'side',          case when v_lead.event in ('accepted', 'declined', 'expired') then 'sent' else 'received' end,
      'business_name', v_name,
      'count',         v_count,
      'tokens',        v_tokens));
  end loop;

  return v_messages;
end $$;
revoke execute on function public.claim_push_batch(integer) from public, anon, authenticated;
grant execute on function public.claim_push_batch(integer) to service_role;

-- record_push_results: one element per message, as the sender saw it:
--   { outbox_ids: [lead, ...], outcome: 'sent' | 'retry' | 'failed',
--     tickets: [{ ticket_id, token_id }], dead_token_ids: [uuid] }
-- Applies only to the lead row while it is still sending (a late or repeated result does nothing).
-- Retry: after the 1st to 4th failure the row waits 1, 2, 4 and 8 minutes; the 5th failure is failed.
-- dead_token_ids (DeviceNotRegistered) are deleted whatever the outcome.
create function public.record_push_results(p_results jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_now     timestamptz := now();
  v_el      jsonb;
  v_outcome text;
  v_lead    bigint;
begin
  if jsonb_typeof(p_results) is distinct from 'array' then raise exception 'invalid_input'; end if;

  for v_el in select e from jsonb_array_elements(p_results) e loop
    v_outcome := v_el ->> 'outcome';
    if jsonb_typeof(v_el -> 'outbox_ids') is distinct from 'array'
       or v_outcome is null or v_outcome not in ('sent', 'retry', 'failed') then
      raise exception 'invalid_input';
    end if;

    if jsonb_typeof(v_el -> 'dead_token_ids') = 'array' then
      delete from public.push_tokens t
       where t.id in (select x::uuid from jsonb_array_elements_text(v_el -> 'dead_token_ids') x);
    end if;

    select o.id into v_lead
      from private.notification_outbox o
     where o.id in (select x::bigint from jsonb_array_elements_text(v_el -> 'outbox_ids') x)
       and o.status = 'sending'
     order by o.id
     limit 1
       for update;
    continue when v_lead is null;

    if v_outcome = 'sent' then
      update private.notification_outbox set status = 'sent', sent_at = v_now where id = v_lead;
      if jsonb_typeof(v_el -> 'tickets') = 'array' then
        insert into private.push_tickets (ticket_id, outbox_id, token_id)
        select t ->> 'ticket_id', v_lead,
               (select k.id from public.push_tokens k where k.id = (t ->> 'token_id')::uuid)
          from jsonb_array_elements(v_el -> 'tickets') t
         where t ->> 'ticket_id' is not null
        on conflict (ticket_id) do nothing;
      end if;
    elsif v_outcome = 'retry' then
      update private.notification_outbox
         set attempts = attempts + 1,
             status = case when attempts + 1 >= 5 then 'failed' else 'queued' end,
             next_attempt_at = case when attempts + 1 >= 5 then next_attempt_at
                                    else v_now + make_interval(mins => (2 ^ attempts)::integer) end
       where id = v_lead;
    else
      update private.notification_outbox set status = 'failed', attempts = attempts + 1 where id = v_lead;
    end if;
  end loop;
end $$;
revoke execute on function public.record_push_results(jsonb) from public, anon, authenticated;
grant execute on function public.record_push_results(jsonb) to service_role;

-- Tickets at least 15 minutes old and not yet checked, oldest first (Expo takes up to 1000 ids).
create function public.claim_push_receipts(p_limit integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if p_limit is null or p_limit < 1 or p_limit > 1000 then raise exception 'invalid_input'; end if;
  return coalesce((
    select jsonb_agg(x.ticket_id order by x.created_at, x.ticket_id)
      from (select t.ticket_id, t.created_at
              from private.push_tickets t
             where t.checked_at is null and t.created_at <= now() - interval '15 minutes'
             order by t.created_at, t.ticket_id
             limit p_limit) x), '[]'::jsonb);
end $$;
revoke execute on function public.claim_push_receipts(integer) from public, anon, authenticated;
grant execute on function public.claim_push_receipts(integer) to service_role;

-- One element per receipt Expo returned: { ticket_id, status: 'ok' | 'error', error: code or null }.
-- A ticket with no receipt yet is left out and asked again later; the cleanup drops it after 24 hours.
create function public.record_push_receipts(p_results jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_el    jsonb;
  v_token uuid;
begin
  if jsonb_typeof(p_results) is distinct from 'array' then raise exception 'invalid_input'; end if;

  for v_el in select e from jsonb_array_elements(p_results) e loop
    if v_el ->> 'ticket_id' is null
       or ((v_el ->> 'status') is distinct from 'ok' and (v_el ->> 'status') is distinct from 'error') then
      raise exception 'invalid_input';
    end if;
    v_token := null;
    update private.push_tickets t set checked_at = now()
     where t.ticket_id = v_el ->> 'ticket_id' and t.checked_at is null
    returning t.token_id into v_token;
    if (v_el ->> 'error') is not distinct from 'DeviceNotRegistered' and v_token is not null then
      delete from public.push_tokens k where k.id = v_token;
    end if;
  end loop;
end $$;
revoke execute on function public.record_push_receipts(jsonb) from public, anon, authenticated;
grant execute on function public.record_push_receipts(jsonb) to service_role;

-- -- Cleanup (cron only) --------------------------------------------------------------------
-- Finished outbox rows and tickets after 7 days, tickets with no receipt after 24 hours, and tokens
-- not registered again for 60 days.
create function private.cleanup_push_outbox() returns void
language sql security definer set search_path = '' as $$
  delete from private.push_tickets
   where created_at < now() - interval '7 days'
      or (checked_at is null and created_at < now() - interval '24 hours');
  delete from private.notification_outbox
   where status in ('sent', 'skipped', 'failed') and created_at < now() - interval '7 days';
  delete from public.push_tokens
   where last_registered_at < now() - interval '60 days';
$$;
revoke execute on function private.cleanup_push_outbox() from public, anon, authenticated, service_role;

-- -- Daily cap across places: submit_pickup_request ------------------------------------------
-- Bodies copied from 20261111025456_request_limits.sql. Two changes only: a shared per-customer
-- lock taken right after the kind lock in both functions (so a pickup and a table submit cannot
-- both pass the cap at 29), and the daily cap after the 11b backstop: at most 30 requests of both
-- kinds together, to all places, in a rolling 24 hours, every status counting (daily_limit).
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
  v_day_all   integer;
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
  -- The daily cap counts both kinds, so a pickup and a table submit also wait for each other.
  -- Always taken after the kind lock, in both submit functions.
  perform pg_advisory_xact_lock(hashtextextended('request_daily:' || v_uid::text, 0));

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

    -- Daily cap (spec 12): at most 30 requests of both kinds, to all places, in a rolling 24 hours.
    select (select count(*) from public.pickup_requests r
             where r.customer_id = v_uid and r.created_at > v_now - interval '24 hours')
         + (select count(*) from public.table_requests t
             where t.customer_id = v_uid and t.created_at > v_now - interval '24 hours')
      into v_day_all;
    if v_day_all >= 30 then raise exception 'daily_limit'; end if;

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

-- -- Daily cap across places: submit_table_request -------------------------------------------
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
  v_day_all   integer;
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
  -- The daily cap counts both kinds, so a pickup and a table submit also wait for each other.
  -- Always taken after the kind lock, in both submit functions.
  perform pg_advisory_xact_lock(hashtextextended('request_daily:' || v_uid::text, 0));

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

    -- Daily cap (spec 12): at most 30 requests of both kinds, to all places, in a rolling 24 hours.
    select (select count(*) from public.pickup_requests r
             where r.customer_id = v_uid and r.created_at > v_now - interval '24 hours')
         + (select count(*) from public.table_requests t
             where t.customer_id = v_uid and t.created_at > v_now - interval '24 hours')
      into v_day_all;
    if v_day_all >= 30 then raise exception 'daily_limit'; end if;

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

-- -- Schedules (UTC) ------------------------------------------------------------------------
-- push-sender: sweeper for retries, held (throttled) rows and receipts; the trigger kick covers
-- new events at once.
select cron.schedule('push-sender', '* * * * *', $$select private.invoke_push_sender()$$);
select cron.schedule('push-outbox-cleanup', '15 4 * * *', $$select private.cleanup_push_outbox()$$);
