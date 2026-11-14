-- Spec 12 (PR 2): claim_push_batch skips rows that are too old to be useful (step 0). Queued rows
-- pile up while push-sender is not deployed or is down; created 1 hour or more ago they become
-- skipped/stale instead of buzzing a phone late. Held rows and every event (arrived included) are
-- covered; a sending row is swept only once its claim is over 5 minutes old (crashed sender), never
-- while in flight. Rows younger than an hour are sent as before.
-- Own fixtures, one rolled-back transaction. now() is frozen inside it, so age is set through the
-- fixture timestamps (no sleeps). All rows are set up first and decided by ONE claim, because the
-- sweep covers every old row in the database. Nothing here depends on pg_net or vault secrets.
begin;
select plan(13);

-- -- Helpers (pg_temp) -------------------------------------------------------
-- Ids:  users 00000000-0000-0000-c112-<n>   businesses ...-c512-<n>   requests ...-cb12-<n>
--       token rows ...-ca12-<n>
create function pg_temp.u(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-c112-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.b(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-c512-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.r(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-cb12-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.tk(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-ca12-' || lpad(n::text, 12, '0'))::uuid $$;

-- One outbox row for request n (event, recipient, status, created, next attempt, claimed, attempts).
create function pg_temp.row(n int, ev text, recipient int, st text, created timestamptz,
                            next_at timestamptz default null, claimed timestamptz default null,
                            tries int default 0) returns void language sql as $$
  insert into private.notification_outbox
    (recipient_id, event, request_kind, request_id, business_id, status, created_at, next_attempt_at, claimed_at, attempts)
  values (pg_temp.u(recipient), ev, 'pickup', pg_temp.r(n), pg_temp.b(1), st, created,
          coalesce(next_at, created), claimed, tries);
$$;
create function pg_temp.oid(n int) returns bigint language sql as $$
  select o.id from private.notification_outbox o where o.request_id = pg_temp.r(n);
$$;
-- status, or status/skip_reason for a skipped row
create function pg_temp.os(n int) returns text language sql as $$
  select o.status || coalesce('/' || o.skip_reason, '') from private.notification_outbox o where o.request_id = pg_temp.r(n);
$$;

-- -- Fixtures (as postgres) --------------------------------------------------
-- Users: 1 customer   2 owner of b1. Both have a token, so nothing is skipped for no_token.
insert into auth.users (id, email)
select pg_temp.u(n), 'p12b_' || n || '@example.test' from unnest(array[1, 2]) n;
update public.profiles set username = 'p12b_' || right(id::text, 3) where id::text like '00000000-0000-0000-c112-%';
insert into public.businesses (id, owner_id, type, name, cuisine_code, map_lat, map_lng, public_address, is_listed, accepts_table_requests)
values (pg_temp.b(1), pg_temp.u(2), 'restaurant', 'Place 12b', 'IT', 63.5, 93.5, '1 Main St', true, true);
insert into public.business_locations (business_id, place_id, formatted_address, lat, lng, resolved_at, place_status)
values (pg_temp.b(1), 'p12b_1', '1 Main St', 63.5, 93.5, now() - interval '1 day', 'ok');
insert into public.push_tokens (id, user_id, token, platform)
values (pg_temp.tk(1), pg_temp.u(1), 'ExponentPushToken[fixture-12b1]', 'ios'),
       (pg_temp.tk(2), pg_temp.u(2), 'ExponentPushToken[fixture-12b2]', 'ios');

-- Rows (request n):
--   1 accepted to the customer, queued, 61 minutes old            -> stale
--   2 declined to the customer, queued, 59 minutes old            -> sent (sending)
--   3 expired to the customer, queued, exactly 1 hour old         -> stale
--   4 new_request to the owner, held 3 more minutes, 2 hours old  -> stale
--   5 arrived to the owner, queued, 61 minutes old                -> stale (arrived is not exempt)
--   6 accepted, sending, 2 hours old, claimed 10 minutes ago      -> stale, attempts unchanged
--   7 accepted, sending, 2 hours old, claimed 1 minute ago        -> untouched (in flight)
--   8 cancelled to the owner, queued, 59 minutes old              -> sent (sending)
select pg_temp.row(1, 'accepted',    1, 'queued',  now() - interval '61 minutes');
select pg_temp.row(2, 'declined',    1, 'queued',  now() - interval '59 minutes');
select pg_temp.row(3, 'expired',     1, 'queued',  now() - interval '1 hour');
select pg_temp.row(4, 'new_request', 2, 'queued',  now() - interval '2 hours', now() + interval '3 minutes');
select pg_temp.row(5, 'arrived',     2, 'queued',  now() - interval '61 minutes');
select pg_temp.row(6, 'accepted',    1, 'sending', now() - interval '2 hours', null, now() - interval '10 minutes', 1);
select pg_temp.row(7, 'accepted',    1, 'sending', now() - interval '2 hours', null, now() - interval '1 minute', 1);
select pg_temp.row(8, 'cancelled',   2, 'queued',  now() - interval '59 minutes');

-- One claim decides every row. Other queued rows left in a local database are claimed too, so the
-- messages are filtered to this file's rows.
create temp table res as select public.claim_push_batch(100) as j;

select is(pg_temp.os(1), 'skipped/stale', 'a queued answer 61 minutes old is skipped as stale');
select is(pg_temp.os(2), 'sending', 'a queued answer 59 minutes old is still sent');
select is(pg_temp.os(3), 'skipped/stale', 'a queued answer exactly 1 hour old is skipped as stale');
select is(pg_temp.os(4), 'skipped/stale', 'a held new request 2 hours old is skipped as stale before its hold ends');
select is(pg_temp.os(5), 'skipped/stale', 'an arrival 61 minutes old is skipped as stale (arrived is not exempt)');
select is(pg_temp.os(6), 'skipped/stale', 'a sending row 2 hours old whose claim is 10 minutes old is skipped as stale, not reclaimed');
select is((select attempts::int from private.notification_outbox where id = pg_temp.oid(6)), 1,
  'the stale sending row is not counted as another attempt');
select is((select o.status || '|' || (o.claimed_at = now() - interval '1 minute') from private.notification_outbox o
            where o.id = pg_temp.oid(7)), 'sending|true',
  'a sending row claimed 1 minute ago is in flight and untouched, however old');
select is(pg_temp.os(8), 'sending', 'a queued cancellation 59 minutes old is still sent');
select is(array(select (m -> 'outbox_ids' ->> 0)::bigint
                  from res, jsonb_array_elements(res.j) m
                 where (m -> 'outbox_ids' ->> 0)::bigint in (select pg_temp.oid(n) from generate_series(1, 8) n)
                 order by 1),
  array[pg_temp.oid(2), pg_temp.oid(8)],
  'only the two rows younger than an hour become messages');

-- -- The function itself is still closed and safe ------------------------------------
select ok(has_function_privilege('service_role', 'public.claim_push_batch(integer)', 'execute')
          and not has_function_privilege('authenticated', 'public.claim_push_batch(integer)', 'execute')
          and not has_function_privilege('anon', 'public.claim_push_batch(integer)', 'execute'),
  'only service_role can execute claim_push_batch after the replace');
select ok((select p.prosecdef and p.proconfig = array['search_path=""'] from pg_proc p
            where p.oid = 'public.claim_push_batch(integer)'::regprocedure),
  'claim_push_batch is still security definer with an empty search_path');
select ok((select position('pg_advisory_xact_lock(hashtextextended(''claim_push_batch'', 0))' in d)
                  between 1 and position('-- 0. Too old' in d)
             from (select pg_get_functiondef('public.claim_push_batch(integer)'::regprocedure) as d) x),
  'claim_push_batch takes the one-claim-at-a-time lock before the old-row sweep');

select * from finish();
rollback;
