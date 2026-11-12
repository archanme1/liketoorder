-- Spec 12 (PR 1): notifications backend - the closed tables and their grants, the event triggers
-- (one outbox row per event, none for completed / no_show, none after a rollback), the seen flag
-- (set by answers, expiry, completed and no_show, never by the customer's own cancel; cleared only on
-- rows that existed and had changed when mark_my_requests_seen was called), claim_push_batch
-- (settings, staleness, cancelled before send, the 5-minute window and collapsing led by the newest
-- request, the hourly cap with arrived exempt, the exact message key set and no private text),
-- retries and receipts, tokens, settings, the daily cap across places, cleanup and schedules.
-- Own fixtures, one rolled-back transaction. now() is frozen inside it, so time is moved by updating
-- fixture timestamps (no sleeps). Nothing here depends on pg_net or vault secrets: the kick is a
-- quiet no-op without them, and outbox rows are asserted directly.
-- claim_push_batch takes every due row in the database, so pg_temp.claim parks the queued rows of
-- every other recipient first; each scenario has its own recipient and is checked before the next.
begin;
select plan(192);

-- -- Helpers (pg_temp) -------------------------------------------------------
-- Ids:  users 00000000-0000-0000-c012-<n>   businesses ...-c412-<n>   pickup requests ...-c812-<n>
--       table requests ...-c612-<n>            keys ...-c712-<n>         token rows ...-c912-<n>
create function pg_temp.u(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-c012-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.b(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-c412-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.p(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-c812-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.t(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-c612-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.k(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-c712-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.tk(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-c912-' || lpad(n::text, 12, '0'))::uuid $$;

create function pg_temp.as_user(n int) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', pg_temp.u(n)), true);
end $$;
create function pg_temp.as_nobody() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"authenticated"}', true);
end $$;

create function pg_temp.keys(j jsonb) returns text[] language sql immutable as $$
  select coalesce(array_agg(k order by k collate "C"), array[]::text[]) from jsonb_object_keys(j) k;
$$;

create function pg_temp.cron_field(p_name text, p_field text) returns text language plpgsql as $$
declare r text;
begin
  if to_regclass('cron.job') is null then return null; end if;
  execute format('select %I::text from cron.job where jobname = $1', p_field) into r using p_name;
  return r;
end $$;

-- Fixtures. Every request carries private text, so the privacy checks can look for it.
create function pg_temp.mkp(n int, biz int, cust int, st text, created timestamptz default null)
returns void language sql as $$
  insert into public.pickup_requests (id, business_id, customer_id, status, pickup_at, order_text, note, idempotency_key, expires_at, created_at)
  values (pg_temp.p(n), pg_temp.b(biz), pg_temp.u(cust), st, now() + interval '1 day', 'SECRET-ORDER soup',
          'SECRET-NOTE call 555-0100', pg_temp.k(n), now() + interval '30 minutes', coalesce(created, now()));
$$;
create function pg_temp.mkt(n int, biz int, cust int, st text, created timestamptz default null)
returns void language sql as $$
  insert into public.table_requests (id, business_id, customer_id, status, table_at, party_size, note, idempotency_key, expires_at, created_at)
  values (pg_temp.t(n), pg_temp.b(biz), pg_temp.u(cust), st, now() + interval '1 day', 2,
          'SECRET-NOTE call 555-0100', pg_temp.k(1000 + n), now() + interval '30 minutes', coalesce(created, now()));
$$;
create function pg_temp.tok(n int, owner int, age interval default interval '0') returns void language sql as $$
  insert into public.push_tokens (id, user_id, token, platform, last_registered_at)
  values (pg_temp.tk(n), pg_temp.u(owner), 'ExponentPushToken[fixture-' || lpad(n::text, 4, '0') || ']', 'ios', now() - age);
$$;
-- n outbox rows already pushed to a recipient (event, push time).
create function pg_temp.pushed(recipient int, biz int, ev text, n int, at timestamptz) returns void language sql as $$
  insert into private.notification_outbox (recipient_id, event, request_kind, request_id, business_id, status, claimed_at, sent_at)
  select pg_temp.u(recipient), ev, 'pickup', gen_random_uuid(), pg_temp.b(biz), 'sent', at, at from generate_series(1, n);
$$;

-- Outbox reads (security definer, so they work while impersonating).
create function pg_temp.ev(p_req uuid) returns text[] language sql security definer set search_path = '' as $$
  select coalesce(array_agg(o.event || ':' || o.request_kind || ':' || o.recipient_id::text order by o.id), array[]::text[])
    from private.notification_outbox o where o.request_id = p_req;
$$;
create function pg_temp.oid(p_req uuid, p_event text) returns bigint language sql security definer set search_path = '' as $$
  select o.id from private.notification_outbox o where o.request_id = p_req and o.event = p_event order by o.id desc limit 1;
$$;
-- status, or status/skip_reason for a skipped row
create function pg_temp.os(p_id bigint) returns text language sql security definer set search_path = '' as $$
  select o.status || coalesce('/' || o.skip_reason, '') from private.notification_outbox o where o.id = p_id;
$$;
create function pg_temp.ost(p_req uuid, p_event text) returns text language sql as $$
  select pg_temp.os(pg_temp.oid(p_req, p_event));
$$;
create function pg_temp.unseen_p(n int) returns boolean language sql security definer set search_path = '' as $$
  select customer_unseen from public.pickup_requests where id = pg_temp.p(n); $$;
create function pg_temp.unseen_t(n int) returns boolean language sql security definer set search_path = '' as $$
  select customer_unseen from public.table_requests where id = pg_temp.t(n); $$;

-- Parks the queued rows of every other recipient, then claims.
create function pg_temp.claim(p_recipient uuid) returns jsonb language plpgsql as $$
begin
  update private.notification_outbox set next_attempt_at = 'infinity'
   where status = 'queued' and recipient_id <> p_recipient;
  return public.claim_push_batch(100);
end $$;
create function pg_temp.claim_err(p_limit int) returns text language plpgsql as $$
begin perform public.claim_push_batch(p_limit); return 'OK';
exception when others then return sqlerrm; end $$;
create function pg_temp.record_err(p jsonb) returns text language plpgsql as $$
begin perform public.record_push_results(p); return 'OK';
exception when others then return sqlerrm; end $$;
-- One retry result for one row: "status|attempts|seconds until next_attempt_at".
create function pg_temp.fail_once(p_id bigint) returns text language plpgsql as $$
begin
  perform public.record_push_results(jsonb_build_array(jsonb_build_object('outbox_ids', jsonb_build_array(p_id), 'outcome', 'retry')));
  return (select o.status || '|' || o.attempts || '|' || extract(epoch from o.next_attempt_at - now())::int
            from private.notification_outbox o where o.id = p_id);
end $$;
-- The waiting time is over: the row is due again and claimed (it is sending afterwards).
create function pg_temp.due_again(p_id bigint, p_recipient uuid) returns text language plpgsql as $$
begin
  update private.notification_outbox set next_attempt_at = now() where id = p_id and status = 'queued';
  perform pg_temp.claim(p_recipient);
  return pg_temp.os(p_id);
end $$;

-- Error-returning wrappers for the client functions.
create function pg_temp.reg(p_token text, p_platform text default 'ios') returns text language plpgsql as $$
begin perform public.register_push_token(p_token, p_platform); return 'OK';
exception when others then return sqlerrm; end $$;
create function pg_temp.unreg(p_token text) returns text language plpgsql as $$
begin perform public.unregister_push_token(p_token); return 'OK';
exception when others then return sqlerrm; end $$;
create function pg_temp.set_s(a boolean, n boolean, c boolean, r boolean) returns jsonb language plpgsql as $$
begin return public.set_notification_settings(a, n, c, r);
exception when others then return jsonb_build_object('error', sqlerrm); end $$;
create function pg_temp.token_owner(p_token text) returns uuid language sql security definer set search_path = '' as $$
  select user_id from public.push_tokens where token = p_token; $$;
create function pg_temp.token_count(p_user uuid) returns int language sql security definer set search_path = '' as $$
  select count(*)::int from public.push_tokens where user_id = p_user; $$;
-- Submits that return the request, or { "error": message }.
create function pg_temp.sub_p(p_biz uuid, p_key uuid) returns jsonb language plpgsql as $$
begin return public.submit_pickup_request(p_biz, p_key, now() + interval '1 hour', null, 'soup', null);
exception when others then return jsonb_build_object('error', sqlerrm); end $$;
create function pg_temp.sub_t(p_biz uuid, p_key uuid) returns jsonb language plpgsql as $$
begin return public.submit_table_request(p_biz, p_key, now() + interval '2 hours', 2, null);
exception when others then return jsonb_build_object('error', sqlerrm); end $$;
create function pg_temp.day_rows(p_uid uuid) returns int language sql security definer set search_path = '' as $$
  select ((select count(*) from public.pickup_requests where customer_id = p_uid and created_at > now() - interval '24 hours')
        + (select count(*) from public.table_requests where customer_id = p_uid and created_at > now() - interval '24 hours'))::int;
$$;
create function pg_temp.pid_of(p_uid uuid, p_key uuid) returns uuid language sql security definer set search_path = '' as $$
  select id from public.pickup_requests where customer_id = p_uid and idempotency_key = p_key; $$;
-- The kind lock, then the shared daily lock, then the idempotency lookup, each exactly once.
create function pg_temp.lock_order(p_fn regprocedure, p_kind text) returns boolean language sql as $$
  with d as (select pg_get_functiondef(p_fn) as t),
       x as (select t, position('''' || p_kind || ':''' in t) as kind_at, position('''request_daily:''' in t) as daily_at,
                    position('r.idempotency_key = p_idempotency_key' in t) as idem_at,
                    (length(t) - length(replace(t, '''request_daily:''', ''))) / length('''request_daily:''') as daily_n
               from d)
  select kind_at > 0 and kind_at < daily_at and daily_at < idem_at and daily_n = 1 from x;
$$;

-- -- Fixtures (as postgres) --------------------------------------------------
-- Users:  1 C1 trigger-table customer   2 O1 owner b1   3 O2 owner b2   4 outsider   5 C2 seen flag
--   6 C3 daily cap   7, 8, 9 tokens   10 O3 owner b3 (window)   11 O4 owner b4 (cancel collapse)
--   12 O5 owner b5 (cancelled before send, stale)   13 C4 (21st push)   14 C5 (20th push)   15 O6 owner b6 (arrived exempt)
--   16 C6 (answers off)   17 O7 owner b7 (new requests off)   18 O8 owner b8 (no token)   19 C7 (retries)
--   20 C8 (results and receipts)   21 C9 (stuck sending)   30..34 owners of b10..b14 (daily cap places)
-- Businesses: 1..8 restaurants that take tables; 10..14 the daily-cap places.
insert into auth.users (id, email)
select pg_temp.u(n), 'p12_' || n || '@example.test'
  from unnest(array[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,30,31,32,33,34]) n;
update public.profiles set username = 'p12_' || right(id::text, 3), display_name = 'SECRET-NAME'
 where id::text like '00000000-0000-0000-c012-%';

insert into public.businesses (id, owner_id, type, name, cuisine_code, map_lat, map_lng, public_address, is_listed, accepts_table_requests)
select pg_temp.b(n), pg_temp.u(o), 'restaurant', 'Place ' || n, 'IT', 63.0 + n / 10.0, 93.0, 'SECRET-ADDR ' || n || ' Main St', true, true
  from (values (1, 2), (2, 3), (3, 10), (4, 11), (5, 12), (6, 15), (7, 17), (8, 18),
               (10, 30), (11, 31), (12, 32), (13, 33), (14, 34)) as v(n, o);
insert into public.business_locations (business_id, place_id, formatted_address, lat, lng, resolved_at, place_status)
select b.id, 'p12_' || right(b.id::text, 3), b.public_address, b.map_lat, b.map_lng, now() - interval '1 day', 'ok'
  from public.businesses b where b.id::text like '00000000-0000-0000-c412-%';

create temp table res (label text primary key, j jsonb);
grant all on res to public;
-- pg_net queue size before anything happens (null when pg_net is not installed).
insert into res select 'net_before', to_jsonb((select count(*) from net.http_request_queue))
 where to_regclass('net.http_request_queue') is not null;

-- -- 1. Closed tables: RLS on, no policy, no grant -------------------------------
select ok((select relrowsecurity from pg_class where oid = 'public.push_tokens'::regclass), 'RLS is on for push_tokens');
select ok((select relrowsecurity from pg_class where oid = 'public.notification_settings'::regclass), 'RLS is on for notification_settings');
select ok((select relrowsecurity from pg_class where oid = 'private.notification_outbox'::regclass), 'RLS is on for notification_outbox');
select ok((select relrowsecurity from pg_class where oid = 'private.push_tickets'::regclass), 'RLS is on for push_tickets');
select is((select count(*)::int from pg_policies
            where (schemaname, tablename) in (('public', 'push_tokens'), ('public', 'notification_settings'),
                                              ('private', 'notification_outbox'), ('private', 'push_tickets'))),
  0, 'the four new tables have no policies');
select table_privs_are('public', 'push_tokens', 'anon', array[]::text[], 'anon has no privilege on push_tokens');
select table_privs_are('public', 'push_tokens', 'authenticated', array[]::text[], 'authenticated has no privilege on push_tokens');
select table_privs_are('public', 'notification_settings', 'anon', array[]::text[], 'anon has no privilege on notification_settings');
select table_privs_are('public', 'notification_settings', 'authenticated', array[]::text[], 'authenticated has no privilege on notification_settings');
select ok(not has_any_column_privilege('authenticated', 'public.push_tokens', 'SELECT, INSERT, UPDATE, REFERENCES')
          and not has_any_column_privilege('anon', 'public.push_tokens', 'SELECT, INSERT, UPDATE, REFERENCES')
          and not has_any_column_privilege('authenticated', 'public.notification_settings', 'SELECT, INSERT, UPDATE, REFERENCES')
          and not has_any_column_privilege('anon', 'public.notification_settings', 'SELECT, INSERT, UPDATE, REFERENCES'),
  'anon and authenticated have no column privilege on push_tokens or notification_settings');
select ok(not exists (select 1 from unnest(array['anon', 'authenticated', 'service_role']) r,
                                     unnest(array['private.notification_outbox', 'private.push_tickets']) t
                       where has_table_privilege(r, t, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')),
  'nobody but the owner has any privilege on the outbox or the tickets (service_role included)');
select is((select column_default from information_schema.columns
            where table_schema = 'public' and table_name = 'pickup_requests' and column_name = 'customer_unseen'), 'false',
  'pickup_requests.customer_unseen defaults to false (existing rows start as seen)');
select is((select column_default from information_schema.columns
            where table_schema = 'public' and table_name = 'table_requests' and column_name = 'customer_unseen'), 'false',
  'table_requests.customer_unseen defaults to false (existing rows start as seen)');

-- -- 2. Function privileges ----------------------------------------------------
select ok(bool_and(has_function_privilege('authenticated', f, 'execute') and not has_function_privilege('anon', f, 'execute')),
  'authenticated, and not anon, can execute the six client functions')
  from unnest(array['public.register_push_token(text, text)', 'public.unregister_push_token(text)',
                    'public.get_notification_settings()', 'public.set_notification_settings(boolean, boolean, boolean, boolean)',
                    'public.count_my_request_updates()', 'public.mark_my_requests_seen()']) f;
select ok(bool_and(has_function_privilege('service_role', f, 'execute')
                   and not has_function_privilege('authenticated', f, 'execute')
                   and not has_function_privilege('anon', f, 'execute')),
  'only service_role can execute the four sender functions')
  from unnest(array['public.claim_push_batch(integer)', 'public.record_push_results(jsonb)',
                    'public.claim_push_receipts(integer)', 'public.record_push_receipts(jsonb)']) f;
select ok(bool_and(not has_function_privilege('service_role', f, 'execute')
                   and not has_function_privilege('authenticated', f, 'execute')
                   and not has_function_privilege('anon', f, 'execute')),
  'nobody can execute the four private functions (service_role included)')
  from unnest(array['private.enqueue_request_event()', 'private.flag_customer_unseen()',
                    'private.invoke_push_sender()', 'private.cleanup_push_outbox()']) f;
select is_empty(
  $$ select p.oid::regprocedure::text from pg_proc p
      where p.oid in ('public.register_push_token(text, text)'::regprocedure, 'public.unregister_push_token(text)'::regprocedure,
                      'public.get_notification_settings()'::regprocedure,
                      'public.set_notification_settings(boolean, boolean, boolean, boolean)'::regprocedure,
                      'public.count_my_request_updates()'::regprocedure, 'public.mark_my_requests_seen()'::regprocedure,
                      'public.claim_push_batch(integer)'::regprocedure, 'public.record_push_results(jsonb)'::regprocedure,
                      'public.claim_push_receipts(integer)'::regprocedure, 'public.record_push_receipts(jsonb)'::regprocedure,
                      'public.submit_pickup_request(uuid, uuid, timestamptz, jsonb, text, text)'::regprocedure,
                      'public.submit_table_request(uuid, uuid, timestamptz, integer, text)'::regprocedure,
                      'private.enqueue_request_event()'::regprocedure, 'private.flag_customer_unseen()'::regprocedure,
                      'private.invoke_push_sender()'::regprocedure, 'private.cleanup_push_outbox()'::regprocedure)
        and (not p.prosecdef or p.proconfig is distinct from array['search_path=""']) $$,
  'all new and changed functions are security definer with an empty search_path');
select is(pg_temp.cron_field('push-sender', 'schedule'), '* * * * *', 'push-sender runs every minute');
select is(pg_temp.cron_field('push-sender', 'command'), 'select private.invoke_push_sender()', 'push-sender calls the kick');
select is(pg_temp.cron_field('push-outbox-cleanup', 'schedule'), '15 4 * * *', 'push-outbox-cleanup runs at 04:15 UTC');
select is(pg_temp.cron_field('push-outbox-cleanup', 'command'), 'select private.cleanup_push_outbox()', 'push-outbox-cleanup calls the cleanup');
select is((select count(*)::int from vault.secrets where name in ('push_sender_url', 'push_sender_secret')), 0,
  'the test database holds no push_sender vault secrets (the kick is a no-op here)');

-- Outsiders cannot touch the tables directly.
set local role authenticated;
select pg_temp.as_user(4);
select throws_ok($$ select count(*) from public.push_tokens $$, '42501', null, 'a signed-in user cannot read push_tokens');
select throws_ok($$ insert into public.push_tokens (user_id, token, platform) values (auth.uid(), 'ExponentPushToken[test-9999]', 'ios') $$,
  '42501', null, 'a signed-in user cannot write push_tokens directly');
select throws_ok($$ update public.push_tokens set user_id = auth.uid() $$, '42501', null,
  'a signed-in user cannot overwrite another user''s token row directly');
select throws_ok($$ select count(*) from public.notification_settings $$, '42501', null, 'a signed-in user cannot read notification_settings');
select throws_ok($$ select count(*) from private.notification_outbox $$, '42501', null, 'a signed-in user cannot read the outbox');
select throws_ok($$ insert into private.notification_outbox (recipient_id, event, request_kind, request_id, business_id)
                    values (auth.uid(), 'accepted', 'pickup', gen_random_uuid(), gen_random_uuid()) $$,
  '42501', null, 'a signed-in user cannot write the outbox');
select throws_ok($$ select count(*) from private.push_tickets $$, '42501', null, 'a signed-in user cannot read the tickets');
select throws_ok($$ select public.claim_push_batch(10) $$, '42501', null, 'a signed-in user cannot claim pushes');
select throws_ok($$ select public.record_push_results('[]') $$, '42501', null, 'a signed-in user cannot record push results');
select throws_ok($$ select public.claim_push_receipts(10) $$, '42501', null, 'a signed-in user cannot claim receipts');
select throws_ok($$ select public.record_push_receipts('[]') $$, '42501', null, 'a signed-in user cannot record receipts');
select throws_ok($$ select private.invoke_push_sender() $$, '42501', null, 'a signed-in user cannot call the kick');
set local role anon;
select throws_ok($$ select public.register_push_token('ExponentPushToken[test-9998]', 'ios') $$, '42501', null, 'anon cannot register a token');
select throws_ok($$ select public.count_my_request_updates() $$, '42501', null, 'anon cannot count updates');
reset role;

-- -- 3. Event triggers: one outbox row per event ---------------------------------
-- C1 (user 1) to b1 (owner O1, user 2).
select pg_temp.mkp(1, 1, 1, 'pending');
select pg_temp.mkt(1, 1, 1, 'pending');
select pg_temp.mkp(2, 1, 1, 'pending');
update public.pickup_requests set status = 'cancelled' where id = pg_temp.p(2);
select pg_temp.mkp(3, 1, 1, 'pending');
update public.pickup_requests set status = 'accepted', responded_at = now() where id = pg_temp.p(3);
select pg_temp.mkp(4, 1, 1, 'pending');
update public.pickup_requests set status = 'declined', responded_at = now() where id = pg_temp.p(4);
select pg_temp.mkt(2, 1, 1, 'pending');
update public.table_requests set status = 'declined', responded_at = now() where id = pg_temp.t(2);
select pg_temp.mkp(5, 1, 1, 'pending');
select pg_temp.mkt(3, 1, 1, 'pending');
update public.pickup_requests set expires_at = now() where id = pg_temp.p(5);
update public.table_requests set expires_at = now() where id = pg_temp.t(3);
select private.expire_pickup_requests();
select pg_temp.mkt(4, 1, 1, 'accepted');
update public.table_requests set arrived_at = now() where id = pg_temp.t(4);
select pg_temp.mkp(6, 1, 1, 'accepted');
update public.pickup_requests set status = 'completed' where id = pg_temp.p(6);
select pg_temp.mkp(7, 1, 1, 'accepted');
update public.pickup_requests set status = 'no_show' where id = pg_temp.p(7);
select pg_temp.mkp(8, 1, 1, 'declined');
select pg_temp.mkt(5, 1, 1, 'pending');
update public.table_requests set status = 'accepted', responded_at = now() where id = pg_temp.t(5);
update public.table_requests set arrived_at = now() where id = pg_temp.t(5);
update public.table_requests set status = 'completed' where id = pg_temp.t(5);

select is(pg_temp.ev(pg_temp.p(1)), array['new_request:pickup:' || pg_temp.u(2)], 'a new pickup request writes one new_request row for the owner');
select is(pg_temp.ev(pg_temp.t(1)), array['new_request:table:' || pg_temp.u(2)], 'a new table request writes one new_request row for the owner');
select is(pg_temp.ev(pg_temp.p(2)), array['new_request:pickup:' || pg_temp.u(2), 'cancelled:pickup:' || pg_temp.u(2)],
  'pending to cancelled writes one cancelled row for the owner');
select is(pg_temp.ev(pg_temp.p(3)), array['new_request:pickup:' || pg_temp.u(2), 'accepted:pickup:' || pg_temp.u(1)],
  'pending to accepted writes one accepted row for the customer');
select is(pg_temp.ev(pg_temp.p(4)), array['new_request:pickup:' || pg_temp.u(2), 'declined:pickup:' || pg_temp.u(1)],
  'pending to declined writes one declined row for the customer');
select is(pg_temp.ev(pg_temp.t(2)), array['new_request:table:' || pg_temp.u(2), 'declined:table:' || pg_temp.u(1)],
  'a declined table request writes one declined row for the customer');
select is(pg_temp.ev(pg_temp.p(5)), array['new_request:pickup:' || pg_temp.u(2), 'expired:pickup:' || pg_temp.u(1)],
  'the expiry job expiring a pickup request writes one expired row for the customer');
select is(pg_temp.ev(pg_temp.t(3)), array['new_request:table:' || pg_temp.u(2), 'expired:table:' || pg_temp.u(1)],
  'the expiry job expiring a table request writes one expired row for the customer');
select is(pg_temp.ev(pg_temp.t(4)), array['arrived:table:' || pg_temp.u(2)], 'setting arrived_at writes one arrived row for the owner');
select is(pg_temp.ev(pg_temp.p(6)), array[]::text[], 'accepted to completed writes no row');
select is(pg_temp.ev(pg_temp.p(7)), array[]::text[], 'accepted to no_show writes no row');
select is(pg_temp.ev(pg_temp.p(8)), array[]::text[], 'a row inserted with a status other than pending writes no row');
select is(pg_temp.ev(pg_temp.t(5)),
  array['new_request:table:' || pg_temp.u(2), 'accepted:table:' || pg_temp.u(1), 'arrived:table:' || pg_temp.u(2)],
  'a table request through new, accepted, arrived and completed writes exactly three rows');
select is_empty(
  $$ select o.id from private.notification_outbox o
      where o.recipient_id in (pg_temp.u(1), pg_temp.u(2))
        and (o.business_id <> pg_temp.b(1) or o.status <> 'queued' or o.attempts <> 0 or o.claimed_at is not null) $$,
  'every trigger row carries the request''s business and starts queued, unclaimed, with no attempts');

-- A rolled-back change leaves no row.
savepoint before_rollback;
select pg_temp.mkp(9, 1, 1, 'pending');
update public.pickup_requests set status = 'accepted', responded_at = now() where id = pg_temp.p(1);
rollback to savepoint before_rollback;
select is(pg_temp.ev(pg_temp.p(9)), array[]::text[], 'a rolled-back insert leaves no outbox row');
select is(pg_temp.ev(pg_temp.p(1)), array['new_request:pickup:' || pg_temp.u(2)], 'a rolled-back answer leaves no outbox row');

-- -- 4. Seen flag ------------------------------------------------------------
-- C2 (user 5) to b2 (owner O2, user 3).
select pg_temp.mkp(20, 2, 5, 'accepted');
select pg_temp.mkp(21, 2, 5, 'pending');
update public.pickup_requests set status = 'accepted', responded_at = now() where id = pg_temp.p(21);
select pg_temp.mkp(22, 2, 5, 'pending');
update public.pickup_requests set status = 'declined', responded_at = now() where id = pg_temp.p(22);
select pg_temp.mkp(23, 2, 5, 'pending');
update public.pickup_requests set expires_at = now() where id = pg_temp.p(23);
select private.expire_pickup_requests();
select pg_temp.mkp(24, 2, 5, 'accepted');
update public.pickup_requests set status = 'completed' where id = pg_temp.p(24);
select pg_temp.mkp(25, 2, 5, 'accepted');
update public.pickup_requests set status = 'no_show' where id = pg_temp.p(25);
select pg_temp.mkp(26, 2, 5, 'pending');
update public.pickup_requests set status = 'cancelled' where id = pg_temp.p(26);
select pg_temp.mkt(20, 2, 5, 'pending');
update public.table_requests set status = 'accepted', responded_at = now() where id = pg_temp.t(20);
-- Changed after the call starts (updated_at later than now()), and created after it.
select pg_temp.mkp(27, 2, 5, 'pending');
update public.pickup_requests set status = 'accepted', responded_at = now() where id = pg_temp.p(27);
alter table public.pickup_requests disable trigger pickup_requests_set_updated_at;
update public.pickup_requests set updated_at = now() + interval '1 second' where id = pg_temp.p(27);
alter table public.pickup_requests enable trigger pickup_requests_set_updated_at;
insert into public.pickup_requests (id, business_id, customer_id, status, pickup_at, order_text, idempotency_key, expires_at, created_at, customer_unseen)
values (pg_temp.p(28), pg_temp.b(2), pg_temp.u(5), 'accepted', now() + interval '1 day', 'later', pg_temp.k(28),
        now() + interval '30 minutes', now() + interval '1 second', true);

select is(pg_temp.unseen_p(20), false, 'a request that already existed starts as seen (no badge flood)');
select is(pg_temp.unseen_p(21), true, 'an accept sets the seen flag');
select is(pg_temp.unseen_p(22), true, 'a decline sets the seen flag');
select is(pg_temp.unseen_p(23), true, 'an expiry sets the seen flag');
select is(pg_temp.unseen_p(24), true, 'completed sets the seen flag');
select is(pg_temp.unseen_p(25), true, 'no_show sets the seen flag');
select is(pg_temp.unseen_p(26), false, 'the customer''s own cancel does not set the seen flag');
select is(pg_temp.unseen_t(20), true, 'an accepted table request sets the seen flag');

set local role authenticated;
select pg_temp.as_user(4);
select is(public.count_my_request_updates(), 0, 'an outsider counts none of another customer''s updates');
select lives_ok($$ select public.mark_my_requests_seen() $$, 'an outsider can call mark_my_requests_seen');
select pg_temp.as_user(5);
select is(public.count_my_request_updates(), 8, 'the customer counts both kinds (7 pickup, 1 table), untouched by the outsider');
select lives_ok($$ select public.mark_my_requests_seen() $$, 'the customer marks the Sent list seen');
select is(public.count_my_request_updates(), 2, 'afterwards only the two rows newer than the call stay flagged');
select is(pg_temp.unseen_p(21), false, 'a row changed before the call is cleared');
select is(pg_temp.unseen_t(20), false, 'a table row changed before the call is cleared');
select is(pg_temp.unseen_p(27), true, 'a row changed after the call started stays flagged (lost-change test)');
select is(pg_temp.unseen_p(28), true, 'a row created after the call started stays flagged');
select pg_temp.as_nobody();
select throws_ok($$ select public.count_my_request_updates() $$, 'P0001', 'not_signed_in', 'no user: count is not_signed_in');
select throws_ok($$ select public.mark_my_requests_seen() $$, 'P0001', 'not_signed_in', 'no user: mark is not_signed_in');
reset role;

-- -- 5. Tokens ---------------------------------------------------------------
set local role authenticated;
select pg_temp.as_user(7);
select is(pg_temp.reg('ExponentPushToken[test-0001]'), 'OK', 'a valid ExponentPushToken is registered');
select is(pg_temp.reg('ExpoPushToken[test-0002]', 'android'), 'OK', 'a valid ExpoPushToken is registered');
select is_empty(
  $$ select x from unnest(array['ExponentPushToken[]', 'ExponentPushToken[a b]', 'xExponentPushToken[abc]',
                               'ExponentPushToken[abc]x', 'ExponentPushToken[' || repeat('a', 201) || ']', 'PushToken[abc]', '']) x
      where pg_temp.reg(x) is distinct from 'invalid_input' $$,
  'malformed tokens are invalid_input');
select is(pg_temp.reg(null), 'invalid_input', 'a null token is invalid_input');
select is(pg_temp.reg('ExponentPushToken[test-0003]', 'web'), 'invalid_input', 'an unknown platform is invalid_input');
select is(pg_temp.reg('ExponentPushToken[test-0003]', null), 'invalid_input', 'a null platform is invalid_input');
select pg_temp.as_user(8);
select is(pg_temp.reg('ExponentPushToken[test-0001]'), 'OK', 'another user registers the same token');
select is(pg_temp.token_owner('ExponentPushToken[test-0001]'), pg_temp.u(8), 'the token moved to the new user');
select is(pg_temp.token_count(pg_temp.u(7)), 1, 'the old user keeps only their other token');
select pg_temp.as_user(7);
select is(pg_temp.unreg('ExponentPushToken[test-0001]'), 'OK', 'unregistering someone else''s token answers the same as success');
select is(pg_temp.token_owner('ExponentPushToken[test-0001]'), pg_temp.u(8), 'and the token stays with its owner');
select is(pg_temp.unreg('ExponentPushToken[test-7777]'), 'OK', 'unregistering an unknown token answers the same');
select is(pg_temp.unreg('ExpoPushToken[test-0002]'), 'OK', 'a user unregisters their own token');
select is(pg_temp.token_count(pg_temp.u(7)), 0, 'and it is gone');
select pg_temp.as_nobody();
select is(pg_temp.reg('ExponentPushToken[test-0004]'), 'not_signed_in', 'no user: register is not_signed_in');
select is(pg_temp.unreg('ExponentPushToken[test-0001]'), 'not_signed_in', 'no user: unregister is not_signed_in');
reset role;
-- At most 10 per user: user 9 has 10 (1 to 10 minutes old), then registers an 11th.
select pg_temp.tok(100 + i, 9, i * interval '1 minute') from generate_series(1, 10) i;
set local role authenticated;
select pg_temp.as_user(9);
select is(pg_temp.reg('ExponentPushToken[test-0200]'), 'OK', 'an 11th token is registered');
reset role;
select is(pg_temp.token_count(pg_temp.u(9)), 10, 'the user keeps at most 10 tokens');
select is(pg_temp.token_owner('ExponentPushToken[fixture-0110]'), null, 'the oldest token (by last registration) was dropped');
select is(pg_temp.token_owner('ExponentPushToken[test-0200]'), pg_temp.u(9), 'the new token is kept');

-- -- 6. Settings -------------------------------------------------------------
set local role authenticated;
select pg_temp.as_user(7);
select is(public.get_notification_settings(),
  '{"answers": true, "new_requests": true, "cancellations": true, "arrivals": true}'::jsonb, 'no row: every switch is on');
select is(pg_temp.set_s(false, true, false, true),
  '{"answers": false, "new_requests": true, "cancellations": false, "arrivals": true}'::jsonb, 'set returns the saved switches');
select is(public.get_notification_settings(),
  '{"answers": false, "new_requests": true, "cancellations": false, "arrivals": true}'::jsonb, 'get reads them back');
select is(pg_temp.set_s(true, null, true, true) ->> 'error', 'invalid_input', 'a null switch is invalid_input');
select pg_temp.as_user(8);
select is(public.get_notification_settings(),
  '{"answers": true, "new_requests": true, "cancellations": true, "arrivals": true}'::jsonb,
  'another user reads only their own switches (defaults), never the first user''s');
select pg_temp.as_nobody();
select throws_ok($$ select public.get_notification_settings() $$, 'P0001', 'not_signed_in', 'no user: get settings is not_signed_in');
reset role;

-- -- 7. Claim: settings, tokens, staleness, cancelled before send -----------------
select ok(pg_temp.claim_err(0) = 'invalid_input' and pg_temp.claim_err(101) = 'invalid_input' and pg_temp.claim_err(null) = 'invalid_input',
  'claim_push_batch refuses a limit outside 1 to 100');

-- New requests switched off (O7, user 17, b7). The customer is user 16, who switched answers off.
insert into public.notification_settings (user_id, new_requests) values (pg_temp.u(17), false);
insert into public.notification_settings (user_id, answers) values (pg_temp.u(16), false);
select pg_temp.tok(1, 17);
select pg_temp.tok(2, 16);
select pg_temp.mkp(40, 7, 16, 'pending');
insert into res values ('claim_o7', pg_temp.claim(pg_temp.u(17)));
select is(pg_temp.ost(pg_temp.p(40), 'new_request'), 'skipped/setting_off', 'a switch that is off at send time: skipped/setting_off');
update public.pickup_requests set status = 'accepted', responded_at = now() where id = pg_temp.p(40);
insert into res values ('claim_c6', pg_temp.claim(pg_temp.u(16)));
select is(pg_temp.ost(pg_temp.p(40), 'accepted'), 'skipped/setting_off', 'answers off: the accepted push is skipped/setting_off');
select is((select jsonb_array_length(j) from res where label = 'claim_c6'), 0, 'and nothing is sent');

-- No token (O8, user 18, b8).
select pg_temp.mkp(41, 8, 1, 'pending');
insert into res values ('claim_o8', pg_temp.claim(pg_temp.u(18)));
select is(pg_temp.ost(pg_temp.p(41), 'new_request'), 'skipped/no_token', 'a recipient with no token: skipped/no_token');

-- Cancelled before send and stale (O5, user 12, b5).
select pg_temp.tok(3, 12);
select pg_temp.mkp(42, 5, 1, 'pending');
update public.pickup_requests set status = 'cancelled' where id = pg_temp.p(42);
select pg_temp.mkp(43, 5, 1, 'pending');
update public.pickup_requests set expires_at = now() where id = pg_temp.p(43);
select pg_temp.mkt(43, 5, 1, 'pending');
update public.table_requests set status = 'declined', responded_at = now() where id = pg_temp.t(43);
insert into res values ('claim_o5', pg_temp.claim(pg_temp.u(12)));
select is(pg_temp.ost(pg_temp.p(42), 'new_request'), 'skipped/cancelled_before_send',
  'a cancel before the new-request push: the new_request row is skipped/cancelled_before_send');
select is(pg_temp.ost(pg_temp.p(42), 'cancelled'), 'skipped/cancelled_before_send', 'and so is the cancelled row');
select is(pg_temp.ost(pg_temp.p(43), 'new_request'), 'skipped/stale', 'a new request past expires_at when due: skipped/stale');
select is(pg_temp.ost(pg_temp.t(43), 'new_request'), 'skipped/stale', 'a new request no longer pending when due: skipped/stale');
select is((select jsonb_array_length(j) from res where label = 'claim_o5'), 0, 'and nothing is sent to that owner');

-- -- 8. Claim: the 5-minute window and collapsing (O3, user 10, b3) ---------------
select pg_temp.tok(4, 10);
select pg_temp.mkp(50, 3, 1, 'pending');
insert into res values ('claim_w1', pg_temp.claim(pg_temp.u(10)));
select is((select jsonb_array_length(j) from res where label = 'claim_w1'), 1, 'the first new request is sent at once');
select is((select j -> 0 ->> 'count' from res where label = 'claim_w1'), '1', 'as a single push (count 1)');
select is((select j -> 0 ->> 'request_id' from res where label = 'claim_w1'), pg_temp.p(50)::text, 'naming that request');
select lives_ok(format($$ select public.record_push_results('[{"outbox_ids": [%s], "outcome": "sent"}]') $$,
                       pg_temp.oid(pg_temp.p(50), 'new_request')), 'the first push is recorded as sent');
select is(pg_temp.ost(pg_temp.p(50), 'new_request'), 'sent', 'and its row is sent');
-- The first push went out 4:59 ago: two more new requests (a pickup, then a table) are held.
update private.notification_outbox set claimed_at = now() - interval '4 minutes 59 seconds' where id = pg_temp.oid(pg_temp.p(50), 'new_request');
select pg_temp.mkp(51, 3, 1, 'pending');
select pg_temp.mkt(51, 3, 1, 'pending');
insert into res values ('claim_w2', pg_temp.claim(pg_temp.u(10)));
select is((select jsonb_array_length(j) from res where label = 'claim_w2'), 0, 'at 4:59 after the last push nothing is sent');
select is(pg_temp.ost(pg_temp.p(51), 'new_request') || ',' || pg_temp.ost(pg_temp.t(51), 'new_request'), 'queued,queued',
  'both new requests are held (queued)');
select is((select next_attempt_at from private.notification_outbox where id = pg_temp.oid(pg_temp.t(51), 'new_request')),
  now() + interval '1 second', 'until 5 minutes after the last push');
-- 5:00 after the last push: due, and both become one push led by the newest request.
update private.notification_outbox set claimed_at = now() - interval '5 minutes' where id = pg_temp.oid(pg_temp.p(50), 'new_request');
update private.notification_outbox set next_attempt_at = now()
 where id in (pg_temp.oid(pg_temp.p(51), 'new_request'), pg_temp.oid(pg_temp.t(51), 'new_request'));
insert into res values ('claim_w3', pg_temp.claim(pg_temp.u(10)));
select is((select jsonb_array_length(j) from res where label = 'claim_w3'), 1, 'at 5:00 the held requests go out as one push');
select is((select j -> 0 ->> 'count' from res where label = 'claim_w3'), '2', 'the collapsed push counts 2');
select is((select j -> 0 ->> 'request_id' from res where label = 'claim_w3'), pg_temp.t(51)::text,
  'the collapsed push carries the newest request''s id');
select is((select j -> 0 ->> 'kind' from res where label = 'claim_w3'), 'table', 'and its kind');
select is((select j -> 0 -> 'outbox_ids' from res where label = 'claim_w3'),
  jsonb_build_array(pg_temp.oid(pg_temp.t(51), 'new_request'), pg_temp.oid(pg_temp.p(51), 'new_request')),
  'outbox_ids list the lead (newest) first, then the collapsed row');
select is(pg_temp.ost(pg_temp.p(51), 'new_request'), 'skipped/collapsed', 'the older held row is skipped/collapsed');
select is(pg_temp.ost(pg_temp.t(51), 'new_request'), 'sending', 'the newest row is the one sending');
select is((select group_count from private.notification_outbox where id = pg_temp.oid(pg_temp.t(51), 'new_request')), 2::smallint,
  'and it stands for 2 events');

-- -- 9. Claim: cancellations collapse the same way (O4, user 11, b4) -------------
select pg_temp.tok(5, 11);
select pg_temp.mkp(60, 4, 1, 'pending');
select pg_temp.mkt(60, 4, 1, 'pending');
-- Their new-request pushes already went out an hour ago.
update private.notification_outbox set status = 'sent', claimed_at = now() - interval '1 hour', sent_at = now() - interval '1 hour'
 where business_id = pg_temp.b(4) and event = 'new_request';
update public.pickup_requests set status = 'cancelled' where id = pg_temp.p(60);
update public.table_requests set status = 'cancelled' where id = pg_temp.t(60);
insert into res values ('claim_c1', pg_temp.claim(pg_temp.u(11)));
select is((select jsonb_array_length(j) from res where label = 'claim_c1'), 1, 'two due cancellations become one push');
select is((select j -> 0 ->> 'event' from res where label = 'claim_c1'), 'cancelled', 'a cancelled push');
select is((select j -> 0 ->> 'count' from res where label = 'claim_c1'), '2', 'collapsed cancel: count 2');
select is((select j -> 0 ->> 'request_id' from res where label = 'claim_c1'), pg_temp.t(60)::text,
  'collapsed cancel: the newest cancelled request''s id');
select is((select j -> 0 ->> 'kind' from res where label = 'claim_c1'), 'table', 'collapsed cancel: the newest request''s kind');
select is(pg_temp.ost(pg_temp.p(60), 'cancelled'), 'skipped/collapsed', 'the older cancellation is skipped/collapsed');
-- A single cancellation 5 minutes later goes out on its own (count 1).
select lives_ok(format($$ select public.record_push_results('[{"outbox_ids": [%s], "outcome": "sent"}]') $$,
                       pg_temp.oid(pg_temp.t(60), 'cancelled')), 'the collapsed cancel is recorded as sent');
update private.notification_outbox set claimed_at = now() - interval '5 minutes' where id = pg_temp.oid(pg_temp.t(60), 'cancelled');
select pg_temp.mkp(61, 4, 1, 'pending');
update private.notification_outbox set status = 'sent', claimed_at = now() - interval '1 hour' where request_id = pg_temp.p(61);
update public.pickup_requests set status = 'cancelled' where id = pg_temp.p(61);
insert into res values ('claim_c2', pg_temp.claim(pg_temp.u(11)));
select is((select (j -> 0 ->> 'count') || ':' || (j -> 0 ->> 'request_id') from res where label = 'claim_c2'), '1:' || pg_temp.p(61),
  'a single cancellation is a push of count 1 for that request');

-- -- 10. Claim: hourly cap, arrived exempt, and the message shape ------------------
-- C4 (user 13) already had 20 pushes in the last hour: the 21st is throttled.
select pg_temp.tok(6, 13);
select pg_temp.pushed(13, 1, 'accepted', 20, now() - interval '59 minutes');
select pg_temp.mkp(70, 1, 13, 'pending');
update public.pickup_requests set status = 'accepted', responded_at = now() where id = pg_temp.p(70);
insert into res values ('claim_h1', pg_temp.claim(pg_temp.u(13)));
select is(pg_temp.ost(pg_temp.p(70), 'accepted'), 'skipped/throttled', 'the 21st push to one recipient in an hour is skipped/throttled');
-- C5 (user 14): 19 in the last hour and 5 older ones: the 20th is sent.
select pg_temp.tok(7, 14);
select pg_temp.pushed(14, 1, 'declined', 19, now() - interval '59 minutes');
select pg_temp.pushed(14, 1, 'declined', 5, now() - interval '61 minutes');
select pg_temp.mkp(71, 1, 14, 'pending');
update public.pickup_requests set status = 'accepted', responded_at = now() where id = pg_temp.p(71);
insert into res values ('claim_h2', pg_temp.claim(pg_temp.u(14)));
select is(pg_temp.ost(pg_temp.p(71), 'accepted'), 'sending', 'the 20th push in an hour is sent (pushes older than an hour do not count)');
-- O6 (user 15) had 20 pushes in the last hour, but arrived is exempt.
select pg_temp.tok(8, 15);
select pg_temp.pushed(15, 6, 'new_request', 20, now() - interval '30 minutes');
select pg_temp.mkt(72, 6, 1, 'accepted');
update public.table_requests set arrived_at = now() where id = pg_temp.t(72);
insert into res values ('claim_h3', pg_temp.claim(pg_temp.u(15)));
select is(pg_temp.ost(pg_temp.t(72), 'arrived'), 'sending', 'arrived is exempt from the hourly cap');

-- The message shape: the same keys for every message, business_name null for owner events.
select is(pg_temp.keys((select j -> 0 from res where label = 'claim_h2')),
  array['business_name', 'count', 'event', 'kind', 'outbox_ids', 'request_id', 'side', 'tokens'],
  'a customer message has exactly the eight keys');
select is(pg_temp.keys((select j -> 0 from res where label = 'claim_h3')),
  array['business_name', 'count', 'event', 'kind', 'outbox_ids', 'request_id', 'side', 'tokens'],
  'an owner message has exactly the same eight keys');
select is_empty(
  $$ select r.label from res r, jsonb_array_elements(r.j) m
      where r.label like 'claim%'
        and pg_temp.keys(m) <> array['business_name', 'count', 'event', 'kind', 'outbox_ids', 'request_id', 'side', 'tokens'] $$,
  'every message returned in this file has exactly the eight keys');
select is_empty(
  $$ select r.label from res r, jsonb_array_elements(r.j) m, jsonb_array_elements(m -> 'tokens') tk
      where r.label like 'claim%' and pg_temp.keys(tk) <> array['id', 'token'] $$,
  'every token entry is exactly { id, token }');
select is((select j -> 0 -> 'business_name' from res where label = 'claim_h2'), '"Place 1"'::jsonb,
  'a customer message carries the place name');
select is((select j -> 0 -> 'business_name' from res where label = 'claim_h3'), 'null'::jsonb,
  'an owner message carries business_name as null (the key is present)');
select is((select (j -> 0 ->> 'side') || ',' || (j -> 0 ->> 'event') || ',' || (j -> 0 ->> 'kind') from res where label = 'claim_h2'),
  'sent,accepted,pickup', 'a customer message: side sent, event, kind');
select is((select (j -> 0 ->> 'side') || ',' || (j -> 0 ->> 'event') || ',' || (j -> 0 ->> 'kind') from res where label = 'claim_h3'),
  'received,arrived,table', 'an owner message: side received, event, kind');
select is((select j -> 0 -> 'tokens' from res where label = 'claim_h2'),
  jsonb_build_array(jsonb_build_object('id', pg_temp.tk(7), 'token', 'ExponentPushToken[fixture-0007]')),
  'the tokens are the recipient''s own');
select is_empty(
  $$ select r.label from res r
      where r.label like 'claim%'
        and (r.j::text ~ 'SECRET' or r.j::text ~ '555-0100' or r.j::text ~ '@example' or r.j::text ~ 'p12_'
             or r.j::text ~ 'soup' or r.j::text ~ pg_temp.u(1)::text) $$,
  'no message holds a note, order text, address, email, phone, customer name or customer id');

-- -- 11. Retries, results, stuck rows ------------------------------------------------
select is(pg_temp.record_err('{}'), 'invalid_input', 'record_push_results refuses a non-array');
select is(pg_temp.record_err('[{"outbox_ids": [1], "outcome": "maybe"}]'), 'invalid_input', 'and an unknown outcome');
-- C7 (user 19): waits of 1, 2, 4 and 8 minutes after the 1st to 4th failure, failed on the 5th.
select pg_temp.tok(9, 19);
select pg_temp.mkp(80, 1, 19, 'pending');
update public.pickup_requests set status = 'accepted', responded_at = now() where id = pg_temp.p(80);
insert into res values ('claim_r0', pg_temp.claim(pg_temp.u(19)));
create temp table rid as select pg_temp.oid(pg_temp.p(80), 'accepted') as id;
select is(pg_temp.os((select id from rid)), 'sending', 'the row is claimed for sending');
select is(pg_temp.fail_once((select id from rid)), 'queued|1|60', 'after the 1st failure it waits 1 minute');
select is(pg_temp.due_again((select id from rid), pg_temp.u(19)), 'sending', 'then it is claimed again');
select is(pg_temp.fail_once((select id from rid)), 'queued|2|120', 'after the 2nd failure it waits 2 minutes');
select is(pg_temp.due_again((select id from rid), pg_temp.u(19)), 'sending', 'claimed again');
select is(pg_temp.fail_once((select id from rid)), 'queued|3|240', 'after the 3rd failure it waits 4 minutes');
select is(pg_temp.due_again((select id from rid), pg_temp.u(19)), 'sending', 'claimed again');
select is(pg_temp.fail_once((select id from rid)), 'queued|4|480', 'after the 4th failure it waits 8 minutes');
select is(pg_temp.due_again((select id from rid), pg_temp.u(19)), 'sending', 'claimed a 5th time');
select is(split_part(pg_temp.fail_once((select id from rid)), '|', 1) || '|' || split_part(pg_temp.fail_once((select id from rid)), '|', 2),
  'failed|5', 'the 5th failure makes it failed, and a late repeat changes nothing');

-- C8 (user 20): sent with tickets, a dead token deleted, a late result ignored.
select pg_temp.tok(10, 20);
select pg_temp.tok(11, 20);
select pg_temp.mkp(81, 1, 20, 'pending');
update public.pickup_requests set status = 'declined', responded_at = now() where id = pg_temp.p(81);
insert into res values ('claim_s0', pg_temp.claim(pg_temp.u(20)));
select is((select jsonb_array_length(j -> 0 -> 'tokens') from res where label = 'claim_s0'), 2, 'a message lists every token of the recipient');
select lives_ok(format($$ select public.record_push_results(%L) $$, jsonb_build_array(jsonb_build_object(
    'outbox_ids', jsonb_build_array(pg_temp.oid(pg_temp.p(81), 'declined')), 'outcome', 'sent',
    'tickets', jsonb_build_array(jsonb_build_object('ticket_id', 'ticket-0001', 'token_id', pg_temp.tk(10))),
    'dead_token_ids', jsonb_build_array(pg_temp.tk(11))))::text), 'a sent result with a ticket and a dead token is recorded');
select is(pg_temp.ost(pg_temp.p(81), 'declined'), 'sent', 'the row is sent');
select is((select sent_at from private.notification_outbox where id = pg_temp.oid(pg_temp.p(81), 'declined')), now(), 'with sent_at set');
select is((select token_id from private.push_tickets where ticket_id = 'ticket-0001'), pg_temp.tk(10), 'the ticket is stored with its token');
select is(pg_temp.token_count(pg_temp.u(20)), 1, 'the DeviceNotRegistered token from the send is deleted');
select lives_ok(format($$ select public.record_push_results('[{"outbox_ids": [%s], "outcome": "retry"}]') $$,
                       pg_temp.oid(pg_temp.p(81), 'declined')), 'a late retry result for a sent row is accepted');
select is(pg_temp.ost(pg_temp.p(81), 'declined'), 'sent', 'and changes nothing');
select is(pg_temp.record_err(jsonb_build_array(jsonb_build_object('outbox_ids', jsonb_build_array(pg_temp.oid(pg_temp.p(70), 'accepted')),
                                                                  'outcome', 'failed'))), 'OK', 'a failed result for a skipped row is accepted');
select is(pg_temp.ost(pg_temp.p(70), 'accepted'), 'skipped/throttled', 'and changes nothing');

-- C9 (user 21): a sending row is claimable again only after 5 minutes (a crashed sender).
select pg_temp.tok(12, 21);
select pg_temp.mkp(82, 1, 21, 'pending');
update public.pickup_requests set status = 'accepted', responded_at = now() where id = pg_temp.p(82);
insert into res values ('claim_k0', pg_temp.claim(pg_temp.u(21)));
update private.notification_outbox set claimed_at = now() - interval '4 minutes 59 seconds' where id = pg_temp.oid(pg_temp.p(82), 'accepted');
insert into res values ('claim_k1', pg_temp.claim(pg_temp.u(21)));
select is((select jsonb_array_length(j) from res where label = 'claim_k1'), 0, 'a row sending for 4:59 is not claimed again');
update private.notification_outbox set claimed_at = now() - interval '5 minutes' where id = pg_temp.oid(pg_temp.p(82), 'accepted');
insert into res values ('claim_k2', pg_temp.claim(pg_temp.u(21)));
select is((select j -> 0 ->> 'request_id' from res where label = 'claim_k2'), pg_temp.p(82)::text, 'after 5:00 it is claimed again');
select is((select attempts || '|' || (claimed_at = now()) from private.notification_outbox where id = pg_temp.oid(pg_temp.p(82), 'accepted')),
  '1|true', 'the reclaim counts as an attempt and stamps a new claim');

-- -- 12. Receipts ------------------------------------------------------------
insert into private.push_tickets (ticket_id, outbox_id, token_id, created_at)
values ('ticket-0002', pg_temp.oid(pg_temp.p(81), 'declined'), pg_temp.tk(10), now() - interval '14 minutes 59 seconds');
update private.push_tickets set created_at = now() - interval '15 minutes' where ticket_id = 'ticket-0001';
select is(public.claim_push_receipts(10), '["ticket-0001"]'::jsonb, 'only tickets at least 15 minutes old and unchecked are claimed');
select ok(pg_temp.record_err('[]') = 'OK', 'an empty result list is accepted');
select lives_ok($$ select public.record_push_receipts('[{"ticket_id": "ticket-0001", "status": "error", "error": "DeviceNotRegistered"}]') $$,
  'a DeviceNotRegistered receipt is recorded');
select is((select checked_at from private.push_tickets where ticket_id = 'ticket-0001'), now(), 'the ticket is checked');
select is(pg_temp.token_count(pg_temp.u(20)), 0, 'the DeviceNotRegistered token from the receipt is deleted');
select is(public.claim_push_receipts(10), '[]'::jsonb, 'a checked ticket is not claimed again');
select throws_ok($$ select public.record_push_receipts('[{"ticket_id": "ticket-0002", "status": "odd"}]') $$, 'P0001', 'invalid_input',
  'an unknown receipt status is invalid_input');

-- -- 13. Daily cap across places (C3, user 6) -----------------------------------
-- 28 rows in the last 24 hours, every status but pending, both kinds, four places (7 each); plus
-- one pickup exactly 24 hours old and one table 25 hours old, which do not count.
select pg_temp.mkp(100 + i, 10 + (i % 2), 6, (array['cancelled', 'expired', 'completed', 'no_show', 'declined', 'accepted', 'cancelled'])[1 + i % 7],
                   now() - i * interval '45 minutes')
  from generate_series(0, 13) i;
select pg_temp.mkt(100 + i, 12 + (i % 2), 6, (array['cancelled', 'expired', 'completed', 'no_show', 'declined', 'accepted', 'cancelled'])[1 + i % 7],
                   now() - i * interval '45 minutes')
  from generate_series(0, 13) i;
select pg_temp.mkp(120, 10, 6, 'cancelled', now() - interval '24 hours');
select pg_temp.mkt(120, 12, 6, 'cancelled', now() - interval '25 hours');
select is(pg_temp.day_rows(pg_temp.u(6)), 28, 'the customer has 28 requests in the last 24 hours');
set local role authenticated;
select pg_temp.as_user(6);
select is(pg_temp.sub_p(pg_temp.b(14), pg_temp.k(500)) ->> 'status', 'pending', 'the 29th request (a pickup) is accepted');
select is(pg_temp.sub_t(pg_temp.b(14), pg_temp.k(501)) ->> 'status', 'pending', 'the 30th request (a table) is accepted');
select is(pg_temp.sub_p(pg_temp.b(10), pg_temp.k(502)) ->> 'error', 'daily_limit', 'the 31st request (a pickup to another place) is daily_limit');
select is(pg_temp.sub_t(pg_temp.b(13), pg_temp.k(503)) ->> 'error', 'daily_limit', 'a table request at the cap is daily_limit too');
select is(pg_temp.day_rows(pg_temp.u(6)), 30, 'and nothing was written for the refused requests');
select is(pg_temp.sub_p(pg_temp.b(14), pg_temp.k(500)) ->> 'id',
  pg_temp.pid_of(pg_temp.u(6), pg_temp.k(500))::text,
  'a replay at the cap returns the original request, not daily_limit');
select is(pg_temp.sub_t(pg_temp.b(14), pg_temp.k(501)) ->> 'status', 'pending', 'a table replay at the cap returns the original too');
select pg_temp.as_user(4);
select is(pg_temp.sub_p(pg_temp.b(14), pg_temp.k(504)) ->> 'status', 'pending', 'another customer is not affected by the cap');
reset role;
select ok(pg_temp.lock_order('public.submit_pickup_request(uuid, uuid, timestamptz, jsonb, text, text)'::regprocedure, 'pickup_request'),
  'submit_pickup_request takes the shared daily lock once, after its kind lock and before the idempotency lookup');
select ok(pg_temp.lock_order('public.submit_table_request(uuid, uuid, timestamptz, integer, text)'::regprocedure, 'table_request'),
  'submit_table_request takes the shared daily lock once, after its kind lock and before the idempotency lookup');

-- -- 14. Cleanup ---------------------------------------------------------------
insert into private.notification_outbox (recipient_id, event, request_kind, request_id, business_id, status, skip_reason, created_at)
values (pg_temp.u(4), 'accepted', 'pickup', pg_temp.p(900), pg_temp.b(1), 'sent',    null,         now() - interval '8 days'),
       (pg_temp.u(4), 'accepted', 'pickup', pg_temp.p(901), pg_temp.b(1), 'skipped', 'no_token',   now() - interval '8 days'),
       (pg_temp.u(4), 'accepted', 'pickup', pg_temp.p(902), pg_temp.b(1), 'failed',  null,         now() - interval '8 days'),
       (pg_temp.u(4), 'accepted', 'pickup', pg_temp.p(903), pg_temp.b(1), 'queued',  null,         now() - interval '8 days'),
       (pg_temp.u(4), 'accepted', 'pickup', pg_temp.p(904), pg_temp.b(1), 'sent',    null,         now() - interval '6 days');
insert into private.push_tickets (ticket_id, outbox_id, created_at, checked_at)
values ('ticket-0900', pg_temp.oid(pg_temp.p(904), 'accepted'), now() - interval '25 hours', null),
       ('ticket-0901', pg_temp.oid(pg_temp.p(904), 'accepted'), now() - interval '23 hours', null),
       ('ticket-0902', pg_temp.oid(pg_temp.p(904), 'accepted'), now() - interval '8 days', now() - interval '7 days');
select pg_temp.tok(300, 4, interval '61 days');
select pg_temp.tok(301, 4, interval '59 days');
select lives_ok($$ select private.cleanup_push_outbox() $$, 'the cleanup runs');
select is(array(select o.request_id from private.notification_outbox o where o.request_id in
                  (pg_temp.p(900), pg_temp.p(901), pg_temp.p(902), pg_temp.p(903), pg_temp.p(904)) order by o.request_id),
  array[pg_temp.p(903), pg_temp.p(904)], 'finished rows older than 7 days are deleted; queued and younger rows stay');
select is(array(select ticket_id from private.push_tickets where ticket_id like 'ticket-09%' order by ticket_id),
  array['ticket-0901'], 'tickets with no receipt after 24 hours and tickets older than 7 days are deleted');
select is(array(select token from public.push_tokens where user_id = pg_temp.u(4) order by token),
  array['ExponentPushToken[fixture-0301]'], 'tokens not registered for 60 days are deleted');

-- -- 15. No pg_net call was made -------------------------------------------------
select is((select count(*) from net.http_request_queue)::text,
          coalesce((select j::text from res where label = 'net_before'), (select count(*) from net.http_request_queue)::text),
  'no pg_net request was queued by any trigger in this file (no vault secrets)');

select * from finish();
rollback;
