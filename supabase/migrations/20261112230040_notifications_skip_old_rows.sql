-- Spec 12 (PR 2): rows too old to be useful are skipped, not sent late.
-- While push-sender is not deployed (or is down), queued rows pile up; on its first run every old
-- answer, cancel and arrival would buzz a phone hours or weeks after the event, and use up the
-- hourly cap. claim_push_batch is replaced with the body of 20261112043422_notifications.sql plus
-- step 0 below; everything else is unchanged. A legitimate row never reaches an hour: the retry
-- waits add up to 15 minutes and a hold to 5.
--
-- claim_push_batch: takes due rows (queued and due, or sending with a claim over 5 minutes old: a
-- crashed sender) and decides each one, by the server clock:
--   0. any queued row (held ones included), or sending row with a claim over 5 minutes old, created
--      1 hour or more ago: skipped/stale, every event (arrived included);
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
create or replace function public.claim_push_batch(p_limit integer) returns jsonb
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

  -- 0. Too old to be useful (the sender was down or not yet deployed): skipped/stale. A sending row
  -- claimed in the last 5 minutes is in flight and left to record_push_results.
  update private.notification_outbox o
     set status = 'skipped', skip_reason = 'stale'
   where o.id in (select x.id from private.notification_outbox x
                   where x.created_at <= v_now - interval '1 hour'
                     and (x.status = 'queued'
                          or (x.status = 'sending' and x.claimed_at <= v_now - interval '5 minutes'))
                     for update skip locked);

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
