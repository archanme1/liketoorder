-- Spec 10b (PR 1): decline reason and answer note — the two columns and their table checks,
-- the four-argument respond_to_request, the single overload, the two new request-object keys,
-- and that outsiders can neither read nor write them.
-- Own fixtures, one rolled-back transaction. now() is frozen inside it, so responded_at = now().
-- Every call that is expected to fail goes through a wrapper that returns the error text (or the
-- violated constraint's name), so a broken function or table turns a NAMED assertion red instead of
-- aborting the file.
begin;
select plan(151);

-- ── Helpers (pg_temp) ───────────────────────────────────────────────────────
-- Ids:  users 00000000-0000-0000-0011-<n>   businesses …-0411-<n>   requests …-0611-<n>   keys …-0711-<n>
create function pg_temp.u(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0011-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.b(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0411-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.r(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0611-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.k(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0711-' || lpad(n::text, 12, '0'))::uuid $$;

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

-- One fixture request: pickup and expiry are offsets from now(); snap is the stored address snapshot.
create function pg_temp.mk(n int, biz int, cust int, st text, pickup interval, exp interval, snap text default null)
returns void language sql as $$
  insert into public.pickup_requests (id, business_id, customer_id, status, pickup_at, order_text, idempotency_key,
                                      expires_at, accepted_address)
  values (pg_temp.r(n), pg_temp.b(biz), pg_temp.u(cust), st, now() + pickup, 'fixture', pg_temp.k(n),
          now() + exp, snap);
$$;

-- Reads of the closed table for assertions (security definer, so they work while impersonating).
create function pg_temp.st(n int) returns text language sql security definer set search_path = '' as $$
  select status from public.pickup_requests where id = pg_temp.r(n); $$;
create function pg_temp.snap(n int) returns text language sql security definer set search_path = '' as $$
  select accepted_address from public.pickup_requests where id = pg_temp.r(n); $$;
-- status | reason | note | answered-now, with '-' for null
create function pg_temp.sig(n int) returns text language sql security definer set search_path = '' as $$
  select status || '|' || coalesce(decline_reason, '-') || '|' || coalesce(response_note, '-') || '|'
         || coalesce((responded_at = now())::text, 'false')
    from public.pickup_requests where id = pg_temp.r(n); $$;

-- Error-returning wrappers: 'OK' or the error message.
create function pg_temp.resp(n int, decision text, reason text default null, note text default null)
returns text language plpgsql as $$
begin perform public.respond_to_request(pg_temp.r(n), decision, reason, note); return 'OK';
exception when others then return sqlerrm; end $$;
create function pg_temp.resp_j(n int, decision text, reason text default null, note text default null)
returns jsonb language plpgsql as $$
begin return public.respond_to_request(pg_temp.r(n), decision, reason, note);
exception when others then return jsonb_build_object('error', sqlerrm); end $$;
-- The two-argument call an old app build makes.
create function pg_temp.old2(n int, decision text) returns text language plpgsql as $$
begin perform public.respond_to_request(pg_temp.r(n), decision); return 'OK';
exception when others then return sqlerrm; end $$;
create function pg_temp.cancel_err(n int) returns text language plpgsql as $$
begin perform public.cancel_pickup_request(pg_temp.r(n)); return 'OK';
exception when others then return sqlerrm; end $$;
create function pg_temp.get_j(n int) returns jsonb language plpgsql as $$
begin return public.get_business_request(pg_temp.r(n));
exception when others then return jsonb_build_object('error', sqlerrm); end $$;
create function pg_temp.get_ju(p_id uuid) returns jsonb language plpgsql as $$
begin return public.get_business_request(p_id) -> 'request';
exception when others then return jsonb_build_object('error', sqlerrm); end $$;
create function pg_temp.list_j() returns jsonb language plpgsql as $$
begin return public.list_business_requests();
exception when others then return jsonb_build_object('error', sqlerrm); end $$;
create function pg_temp.sub_j(p_biz int, p_key int, p_text text) returns jsonb language plpgsql as $$
begin return public.submit_pickup_request(pg_temp.b(p_biz), pg_temp.k(p_key), now() + interval '2 hours', null, p_text, null);
exception when others then return jsonb_build_object('error', sqlerrm); end $$;
create function pg_temp.myget_j(p_id uuid) returns jsonb language plpgsql as $$
begin return public.get_my_pickup_request(p_id) -> 'request';
exception when others then return jsonb_build_object('error', sqlerrm); end $$;
create function pg_temp.mylist_j() returns jsonb language plpgsql as $$
begin return public.list_my_pickup_requests();
exception when others then return jsonb_build_object('error', sqlerrm); end $$;
create function pg_temp.mycancel_j(p_id uuid) returns jsonb language plpgsql as $$
begin return public.cancel_pickup_request(p_id);
exception when others then return jsonb_build_object('error', sqlerrm); end $$;
-- Everything the public map reads return for the two fixture businesses, as one text.
create function pg_temp.map_text() returns text language plpgsql as $$
begin
  return coalesce(public.get_restaurant_details(pg_temp.b(1))::text, '') || coalesce(public.get_homemade_details(pg_temp.b(2))::text, '')
      || coalesce(public.map_restaurants_in_bounds(70, 73, 100, 103)::text, '') || coalesce(public.map_homemade_in_bounds(70, 73, 100, 103)::text, '');
exception when others then return 'error: ' || sqlerrm; end $$;

-- Runs one statement and always rolls it back. 'OK' if it was accepted, else the violated
-- constraint's name, else "<sqlstate>: <message>".
create function pg_temp.try(p_sql text) returns text language plpgsql as $$
declare c text;
begin
  begin
    execute p_sql;
    raise exception using errcode = 'P0099', message = '__accepted__';
  exception when others then
    if sqlstate = 'P0099' then return 'OK'; end if;
    get stacked diagnostics c = constraint_name;
    return coalesce(nullif(c, ''), sqlstate || ': ' || sqlerrm);
  end;
end $$;
create function pg_temp.upd(n int, set_clause text) returns text language sql as $$
  select pg_temp.try('update public.pickup_requests set ' || set_clause || ' where id = ' || quote_literal(pg_temp.r(n)::text) || '::uuid');
$$;

-- The lock clause for real (as spec 10): comments are stripped, then the row select must end in
-- `for update` and come before the first update of the table.
create function pg_temp.locks_first(p_fn regprocedure, p_filter text) returns boolean language sql as $$
  with d as (select regexp_replace(regexp_replace(pg_get_functiondef(p_fn), '/\*.*?\*/', '', 'g'), '--[^\n]*', '', 'g') as t),
       m as (select t, (regexp_match(t, '(' || p_filter || '\s+for update)'))[1] as clause from d)
  select coalesce(clause is not null
                  and position(clause in t) < position('update public.pickup_requests' in t), false)
    from m;
$$;

-- True while a request is exactly as the fixture made it: still pending, no reason, no note.
create function pg_temp.untouched(n int) returns boolean language sql security definer set search_path = '' as $$
  select status = 'pending' and decline_reason is null and response_note is null and responded_at is null
    from public.pickup_requests where id = pg_temp.r(n); $$;

create temp table res (label text primary key, j jsonb);
grant all on res to public;

-- ── Fixtures (as postgres) ──────────────────────────────────────────────────
-- Users:  1 C1 (display name "Cust One")   2 C2   3 owner of B1   4 owner of B2   5 owner of B3 (outsider seller)
--         6 signed in, no business   7 submitter
-- Businesses: 1 Resto One   2 Home One (exact address "2 Secret Rd, Homeville")   3 Resto Two
insert into auth.users (id, email)
select pg_temp.u(n), 'p10b_' || n || '@example.test' from generate_series(1, 7) n;
update public.profiles set username = 'p10b_' || right(id::text, 3) where id::text like '00000000-0000-0000-0011-%';
update public.profiles set display_name = 'Cust One' where id = pg_temp.u(1);

insert into public.businesses (id, owner_id, type, name, cuisine_code, map_lat, map_lng, public_address, is_listed, currency_code) values
  (pg_temp.b(1), pg_temp.u(3), 'restaurant', 'Resto One', 'IT', 71.1, 101.1, '1 Main St, Tromso', true, 'CAD'),
  (pg_temp.b(2), pg_temp.u(4), 'homemade',   'Home One',  'IT', 71.2, 101.2, null,                true, 'CAD'),
  (pg_temp.b(3), pg_temp.u(5), 'restaurant', 'Resto Two', 'IT', 71.3, 101.3, '3 Main St',         true, null);
insert into public.business_locations (business_id, place_id, formatted_address, lat, lng, resolved_at, place_status) values
  (pg_temp.b(1), 'q1', '1 Main St, Tromso',      71.1,      101.1,      now() - interval '1 day', 'ok'),
  (pg_temp.b(2), 'q2', '2 Secret Rd, Homeville', 71.987654, 101.123456, now() - interval '1 day', 'ok'),
  (pg_temp.b(3), 'q3', '3 Main St',              71.3,      101.3,      now() - interval '1 day', 'ok');

-- Requests by C1 (user 1) to B1 unless noted.
select pg_temp.mk(n, 1, 1, 'pending', interval '2 hours', interval '30 minutes') from generate_series(1, 6) n;   -- six decline reasons
select pg_temp.mk(7, 2, 1, 'pending', interval '2 hours', interval '30 minutes');                                  -- homemade accept
select pg_temp.mk(8, 2, 1, 'pending', interval '2 hours', interval '30 minutes');                                  -- homemade decline
select pg_temp.mk(10, 1, 1, 'pending', interval '2 hours', interval '30 minutes');                                 -- refusals: must stay untouched
select pg_temp.mk(n, 1, 1, 'pending', interval '2 hours', interval '30 minutes') from generate_series(20, 24) n;  -- accepts and trimming
select pg_temp.mk(30, 1, 1, 'declined', interval '2 hours', interval '30 minutes');                                -- declined before 10b: no reason
select pg_temp.mk(40, 1, 1, 'pending', interval '2 hours', interval '30 minutes');                                 -- outsider target
select pg_temp.mk(n, 1, 1, 'pending', interval '2 hours', interval '30 minutes') from generate_series(50, 52) n;  -- races, double answers
select pg_temp.mk(53, 1, 1, 'pending', interval '2 hours', interval '-1 minute');                                  -- past expiry, cron has not run
select pg_temp.mk(54, 1, 1, 'pending', interval '2 hours', interval '30 minutes');
select pg_temp.mk(60, 1, 1, 'pending', interval '2 hours', interval '30 minutes');                                 -- old two-argument accept
select pg_temp.mk(61, 1, 1, 'pending', interval '2 hours', interval '30 minutes');                                 -- old two-argument decline
select pg_temp.mk(70, 1, 1, 'accepted', interval '-25 hours', interval '-26 hours', 'Old Addr');                   -- retention
update public.pickup_requests set response_note = 'Bring a bag', responded_at = now() - interval '27 hours' where id = pg_temp.r(70);
-- One row per status for the table-check tests (rolled back by pg_temp.try).
select pg_temp.mk(80, 1, 1, 'pending',   interval '2 hours', interval '30 minutes');
select pg_temp.mk(81, 1, 1, 'accepted',  interval '2 hours', interval '30 minutes');
select pg_temp.mk(82, 1, 1, 'declined',  interval '2 hours', interval '30 minutes');
select pg_temp.mk(83, 1, 1, 'expired',   interval '2 hours', interval '-1 minute');
select pg_temp.mk(84, 1, 1, 'cancelled', interval '2 hours', interval '30 minutes');
select pg_temp.mk(85, 1, 1, 'completed', interval '-1 hour', interval '-2 hours');
select pg_temp.mk(86, 1, 1, 'no_show',   interval '-1 hour', interval '-2 hours');

-- ── 1. Structure and grants ─────────────────────────────────────────────────
select is(
  (select array_agg(column_name::text || ':' || data_type order by column_name) from information_schema.columns
    where table_schema = 'public' and table_name = 'pickup_requests' and column_name in ('decline_reason', 'response_note')),
  array['decline_reason:text', 'response_note:text'], 'pickup_requests has the text columns decline_reason and response_note');
select ok(exists (select 1 from pg_constraint where conrelid = 'public.pickup_requests'::regclass and conname = 'pickup_requests_reason_on_declined'),
  'check 1 exists: a reason only on a declined row');
select ok(exists (select 1 from pg_constraint where conrelid = 'public.pickup_requests'::regclass and conname = 'pickup_requests_note_on_answered'),
  'check 2 exists: a note only on an answered row');
select ok(exists (select 1 from pg_constraint where conrelid = 'public.pickup_requests'::regclass and conname = 'pickup_requests_other_has_note'),
  'check 3 exists: other always carries its text');
select ok(exists (select 1 from pg_constraint where conrelid = 'public.pickup_requests'::regclass and conname = 'pickup_requests_fixed_reason_no_note'),
  'check 4 exists: a fixed reason carries no note');
select ok(exists (select 1 from pg_constraint where conrelid = 'public.pickup_requests'::regclass and conname = 'pickup_requests_declined_note_is_other'),
  'check 5 exists: a declined row with a note must be other');
select ok(not has_column_privilege('anon', 'public.pickup_requests', 'decline_reason', 'SELECT, INSERT, UPDATE, REFERENCES')
      and not has_column_privilege('authenticated', 'public.pickup_requests', 'decline_reason', 'SELECT, INSERT, UPDATE, REFERENCES'),
  'no API role has any privilege on decline_reason');
select ok(not has_column_privilege('anon', 'public.pickup_requests', 'response_note', 'SELECT, INSERT, UPDATE, REFERENCES')
      and not has_column_privilege('authenticated', 'public.pickup_requests', 'response_note', 'SELECT, INSERT, UPDATE, REFERENCES'),
  'no API role has any privilege on response_note');
select ok(not has_table_privilege('anon', 'public.pickup_requests', 'SELECT, INSERT, UPDATE, DELETE, REFERENCES')
      and not has_table_privilege('authenticated', 'public.pickup_requests', 'SELECT, INSERT, UPDATE, DELETE, REFERENCES'),
  'anon and authenticated still hold no table privilege on pickup_requests');
select ok((select relrowsecurity from pg_class where oid = 'public.pickup_requests'::regclass)
      and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'pickup_requests'),
  'pickup_requests still has RLS on and no policy');

-- ── 2. The table checks hold even for the superuser ─────────────────────────
select is(pg_temp.upd(80, $$decline_reason = 'sold_out'$$), 'pickup_requests_reason_on_declined', 'a reason on a pending row is refused');
select is(pg_temp.upd(81, $$decline_reason = 'sold_out'$$), 'pickup_requests_reason_on_declined', 'a reason on an accepted row is refused');
select is(pg_temp.upd(84, $$decline_reason = 'sold_out'$$), 'pickup_requests_reason_on_declined', 'a reason on a cancelled row is refused');
select is(pg_temp.upd(82, $$decline_reason = 'nope'$$), 'pickup_requests_decline_reason_check', 'an unknown reason code is refused');
select is(pg_temp.upd(80, $$response_note = 'x'$$), 'pickup_requests_note_on_answered', 'a note on a pending row is refused');
select is(pg_temp.upd(83, $$response_note = 'x'$$), 'pickup_requests_note_on_answered', 'a note on an expired row is refused');
select is(pg_temp.upd(84, $$response_note = 'x'$$), 'pickup_requests_note_on_answered', 'a note on a cancelled row is refused');
select is(pg_temp.upd(82, $$decline_reason = 'other'$$), 'pickup_requests_other_has_note', 'other without a note is refused');
select ok(pg_temp.upd(82, $$decline_reason = 'sold_out', response_note = 'why'$$)
          in ('pickup_requests_fixed_reason_no_note', 'pickup_requests_declined_note_is_other'),
  'a fixed reason with a note is refused (checks 4 and 5 both reject it, so either name is correct)');
select is(pg_temp.upd(82, $$response_note = 'x'$$), 'pickup_requests_declined_note_is_other', 'a declined row with a note but no reason is refused');
select is(pg_temp.upd(81, $$response_note = ''$$), 'pickup_requests_response_note_check', 'an empty note is refused');
select is(pg_temp.upd(81, $$response_note = repeat('a', 201)$$), 'pickup_requests_response_note_check', 'a 201-character note is refused');
select is(pg_temp.upd(81, $$response_note = ' x'$$), 'pickup_requests_response_note_check', 'a note with a leading space is refused');
select is(pg_temp.upd(81, $$response_note = 'x '$$), 'pickup_requests_response_note_check', 'a note with a trailing space is refused');
select is(
  (select array_agg(pg_temp.try(format('update public.pickup_requests set response_note = %L where id = %L', 'a' || chr(cp), pg_temp.r(81))) order by cp)
     from unnest(array[1, 11, 127, 133, 8203, 8205, 8238, 8294, 65279]) cp),
  array_fill('pickup_requests_response_note_check'::text, array[9]),
  'each hidden-character class (control, VT, DEL, C1, zero-width, bidi override, isolate, BOM) is refused in a note');
select is(pg_temp.upd(81, $$response_note = 'Please bring a bag'$$), 'OK', 'a note on an accepted row is accepted');
select is(pg_temp.upd(85, $$response_note = 'Please bring a bag'$$), 'OK', 'a note on a completed row is accepted');
select is(pg_temp.upd(86, $$response_note = 'Please bring a bag'$$), 'OK', 'a note on a no_show row is accepted');
select is(pg_temp.upd(82, $$decline_reason = 'other', response_note = 'Out of rice'$$), 'OK', 'other with a note on a declined row is accepted');
select is(pg_temp.upd(82, $$decline_reason = 'sold_out'$$), 'OK', 'a fixed reason without a note on a declined row is accepted');
select is(pg_temp.upd(81, $$response_note = 'a'$$), 'OK', 'a 1-character note is accepted');
select is(pg_temp.upd(81, $$response_note = repeat('a', 200)$$), 'OK', 'a 200-character note is accepted');
select is(pg_temp.upd(81, format('response_note = %L', E'two\nlines')), 'OK', 'a note may contain a newline');

-- ── 3. respond_to_request refuses bad input; the row stays pending ──────────
set local role authenticated;
select pg_temp.as_user(3);
select is(pg_temp.resp(10, 'declined'), 'decline_reason_required', 'decline without a reason is refused');
select is(pg_temp.resp(10, 'declined', ''), 'decline_reason_required', 'decline with an empty reason is refused');
select is(pg_temp.resp(10, 'declined', '   '), 'decline_reason_required', 'decline with a blank reason is refused');
select is(pg_temp.resp(10, 'declined', null, 'a note'), 'decline_reason_required', 'a note does not stand in for a missing reason');
select is(pg_temp.resp(10, 'declined', 'nope'), 'invalid_input', 'an unknown reason code is refused');
select is(pg_temp.resp(10, 'declined', 'SOLD_OUT'), 'invalid_input', 'a reason code in the wrong case is refused');
select is(pg_temp.resp(10, 'declined', 'sold_out '), 'invalid_input', 'a reason code with a trailing space is refused');
select is(pg_temp.resp(10, 'declined', 'other'), 'decline_reason_required', 'other without a note is refused');
select is(pg_temp.resp(10, 'declined', 'other', E' \n '), 'decline_reason_required', 'other with a blank note is refused');
select is(pg_temp.resp(10, 'declined', 'other', repeat('a', 201)), 'invalid_text', 'other with a 201-character note is refused');
select is(pg_temp.resp(10, 'declined', 'other', 'a' || chr(8203) || 'b'), 'invalid_text', 'other with a zero-width character is refused');
select is(pg_temp.resp(10, 'declined', 'sold_out', 'a note'), 'invalid_input', 'a fixed reason with a note is refused');
select is(pg_temp.resp(10, 'accepted', 'sold_out'), 'invalid_input', 'a reason sent with accepted is refused');
select is(pg_temp.resp(10, 'accepted', ''), 'invalid_input', 'an empty reason sent with accepted is refused');
select is(pg_temp.resp(10, 'accepted', null, repeat('a', 201)), 'invalid_text', 'an accept with a 201-character note is refused');
select is(pg_temp.resp(10, 'accepted', null, 'a' || chr(8238) || 'b'), 'invalid_text', 'an accept with a bidi override is refused');
select is(pg_temp.resp(10, 'cancelled', 'sold_out'), 'invalid_input', 'any other decision is refused');
select is(pg_temp.resp(10, null, 'sold_out'), 'invalid_input', 'a missing decision is refused');
select pg_temp.as_user(6);
select is(pg_temp.resp(10, 'declined'), 'decline_reason_required', 'input is validated before the business is looked up (a caller with no business still sees the input error)');
select pg_temp.as_nobody();
select is(pg_temp.resp(10, 'declined', 'sold_out'), 'not_signed_in', 'a call with no signed-in user is refused');
reset role;
select ok(pg_temp.untouched(10), 'every refused answer left the request pending with no reason and no note');

-- ── 4. Valid answers store the reason and the note ──────────────────────────
set local role authenticated;
select pg_temp.as_user(3);
insert into res select 'dec1', pg_temp.resp_j(1, 'declined', 'sold_out');
select is(pg_temp.resp(2, 'declined', 'closed_then'), 'OK', 'decline: closed_then');
select is(pg_temp.resp(3, 'declined', 'too_busy'), 'OK', 'decline: too_busy');
select is(pg_temp.resp(4, 'declined', 'cannot_prepare'), 'OK', 'decline: cannot_prepare');
select is(pg_temp.resp(5, 'declined', 'time_not_possible', '   '), 'OK', 'decline: time_not_possible (a blank note counts as none)');
insert into res select 'dec6', pg_temp.resp_j(6, 'declined', 'other', 'Closed for a wedding');
select is(pg_temp.resp(24, 'declined', 'other', E'  Out of rice\nback Monday \n'), 'OK', 'decline: other with a note padded by spaces and newlines');
insert into res select 'acc20', pg_temp.resp_j(20, 'accepted', null, 'Please bring a bag');
select is(pg_temp.resp(21, 'accepted', null, E' \n '), 'OK', 'accept with a blank note');
select is(pg_temp.resp(22, 'accepted'), 'OK', 'accept with no note');
reset role;
select is(pg_temp.sig(1), 'declined|sold_out|-|true', 'sold_out stored, no note, answered now');
select is(pg_temp.sig(2), 'declined|closed_then|-|true', 'closed_then stored');
select is(pg_temp.sig(3), 'declined|too_busy|-|true', 'too_busy stored');
select is(pg_temp.sig(4), 'declined|cannot_prepare|-|true', 'cannot_prepare stored');
select is(pg_temp.sig(5), 'declined|time_not_possible|-|true', 'time_not_possible stored, the blank note stored as null');
select is(pg_temp.sig(6), 'declined|other|Closed for a wedding|true', 'other stored with its written reason');
select is(pg_temp.sig(24), E'declined|other|Out of rice\nback Monday|true', 'the note is trimmed at the ends and keeps its inner newline');
select is(pg_temp.sig(20), 'accepted|-|Please bring a bag|true', 'accept stores the note');
select is(pg_temp.sig(21), 'accepted|-|-|true', 'a blank accept note is stored as null');
select is(pg_temp.sig(22), 'accepted|-|-|true', 'an accept with no note stores null');
set local role authenticated;
select pg_temp.as_user(4);
select is(pg_temp.resp(7, 'accepted', null, 'Ring the bell'), 'OK', 'a cook accepts a homemade request with a note');
select is(pg_temp.resp(8, 'declined', 'too_busy'), 'OK', 'a cook declines a homemade request');
reset role;
select is(pg_temp.sig(7), 'accepted|-|Ring the bell|true', 'the homemade accept stored its note');
select is(pg_temp.snap(7), '2 Secret Rd, Homeville', 'and still copied the exact address onto the request');
select is(pg_temp.sig(8), 'declined|too_busy|-|true', 'the homemade decline stored its reason');
select is(pg_temp.snap(8), null::text, 'and copied no address');

-- ── 5. An old app build (two arguments) ─────────────────────────────────────
set local role authenticated;
select pg_temp.as_user(3);
select is(pg_temp.old2(60, 'accepted'), 'OK', 'a two-argument accept still works');
select is(pg_temp.old2(61, 'declined'), 'decline_reason_required', 'a two-argument decline gets decline_reason_required');
reset role;
select is(pg_temp.sig(60), 'accepted|-|-|true', 'the old-build accept stored no note');
select ok(pg_temp.untouched(61), 'the old-build decline left the request pending');

-- ── 6. Exactly one respond_to_request, with the right privileges ────────────
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'respond_to_request'),
  1, 'exactly one respond_to_request exists');
select ok(to_regprocedure('public.respond_to_request(uuid, text)') is null, 'the old two-argument respond_to_request is gone');
select ok(to_regprocedure('public.respond_to_request(uuid, text, text, text)') is not null, 'the four-argument respond_to_request exists');
select is((select pronargdefaults::int from pg_proc where oid = 'public.respond_to_request(uuid, text, text, text)'::regprocedure),
  2, 'the reason and the note both default to null');
select ok((select prosecdef and proconfig = array['search_path=""'] from pg_proc
            where oid = 'public.respond_to_request(uuid, text, text, text)'::regprocedure),
  'respond_to_request is security definer with an empty search_path');
select ok(has_function_privilege('authenticated', 'public.respond_to_request(uuid, text, text, text)', 'execute'),
  'authenticated can execute respond_to_request');
select ok(not has_function_privilege('anon', 'public.respond_to_request(uuid, text, text, text)', 'execute')
      and not exists (select 1 from pg_proc p, aclexplode(p.proacl) a
                       where p.oid = 'public.respond_to_request(uuid, text, text, text)'::regprocedure and a.grantee = 0),
  'anon and PUBLIC cannot execute respond_to_request');
select ok(pg_temp.locks_first('public.respond_to_request(uuid, text, text, text)'::regprocedure, 'r\.business_id = v_b\.id'),
  'respond_to_request still locks the row before it updates');
select ok(not has_function_privilege('anon', 'private.pickup_request_json(uuid, timestamptz, boolean)', 'execute')
      and not has_function_privilege('authenticated', 'private.pickup_request_json(uuid, timestamptz, boolean)', 'execute')
      and not has_function_privilege('service_role', 'private.pickup_request_json(uuid, timestamptz, boolean)', 'execute'),
  'the request-object builder is still executable by none of anon, authenticated, service_role');

-- ── 7. Outsiders: they cannot answer, write or read ─────────────────────────
set local role authenticated;
select pg_temp.as_user(5);
select is(pg_temp.resp(40, 'declined', 'sold_out'), 'not_found', 'another seller cannot decline with a reason');
select is(pg_temp.resp(40, 'accepted', null, 'hello'), 'not_found', 'another seller cannot accept with a note');
select is(pg_temp.resp(40, 'declined', 'other', 'my own words'), 'not_found', 'another seller cannot decline with other');
select pg_temp.as_user(4);
select is(pg_temp.resp(40, 'declined', 'sold_out'), 'not_found', 'a cook cannot answer a restaurant''s request either');
select pg_temp.as_user(1);
select is(pg_temp.resp(40, 'declined', 'sold_out'), 'not_found', 'the requesting customer cannot answer their own request');
select pg_temp.as_user(2);
select is(pg_temp.resp(40, 'declined', 'sold_out'), 'not_found', 'another customer cannot answer it');
select pg_temp.as_user(6);
select is(pg_temp.resp(40, 'accepted', null, 'hello'), 'not_found', 'a user with no business cannot answer it');
select pg_temp.as_user(3);
select is(pg_temp.resp(99, 'declined', 'sold_out'), 'not_found', 'an unknown request id gives the same not_found');
reset role;
select ok(pg_temp.untouched(40), 'no outsider changed the request: still pending, no reason, no note');
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok($$ select public.respond_to_request(pg_temp.r(40), 'declined', 'sold_out', null) $$, '42501', null, 'anon cannot call respond_to_request');
select ok(not exists (select 1 from unnest(array[
  pg_temp.try('select decline_reason from public.pickup_requests'),
  pg_temp.try('select response_note from public.pickup_requests'),
  pg_temp.try($$update public.pickup_requests set response_note = 'x'$$),
  pg_temp.try($$insert into public.pickup_requests (business_id, customer_id, pickup_at, expires_at, idempotency_key, order_text, decline_reason)
                values (gen_random_uuid(), gen_random_uuid(), now(), now(), gen_random_uuid(), 'x', 'sold_out')$$),
  pg_temp.try('delete from public.pickup_requests')]) t where t not like '42501%'),
  'anon cannot select, update, insert or delete the two columns');
reset role;
set local role authenticated;
select pg_temp.as_user(1);
select ok(not exists (select 1 from unnest(array[
  pg_temp.try('select decline_reason from public.pickup_requests'),
  pg_temp.try('select response_note from public.pickup_requests'),
  pg_temp.try($$update public.pickup_requests set decline_reason = 'sold_out'$$),
  pg_temp.try($$insert into public.pickup_requests (business_id, customer_id, pickup_at, expires_at, idempotency_key, order_text, response_note)
                values (gen_random_uuid(), gen_random_uuid(), now(), now(), gen_random_uuid(), 'x', 'x')$$),
  pg_temp.try('delete from public.pickup_requests')]) t where t not like '42501%'),
  'the requesting customer cannot select, update, insert or delete the two columns');
select pg_temp.as_user(3);
select ok(not exists (select 1 from unnest(array[
  pg_temp.try('select decline_reason from public.pickup_requests'),
  pg_temp.try('select response_note from public.pickup_requests'),
  pg_temp.try($$update public.pickup_requests set response_note = 'x'$$),
  pg_temp.try($$insert into public.pickup_requests (business_id, customer_id, pickup_at, expires_at, idempotency_key, order_text, decline_reason)
                values (gen_random_uuid(), gen_random_uuid(), now(), now(), gen_random_uuid(), 'x', 'sold_out')$$),
  pg_temp.try('delete from public.pickup_requests')]) t where t not like '42501%'),
  'the business owner cannot select, update, insert or delete the two columns directly either');
-- Another customer, another seller and the public map never see the reason or the note.
select pg_temp.as_user(2);
select is(pg_temp.myget_j(pg_temp.r(6)), 'null'::jsonb, 'another customer gets a null request for someone else''s answered request');
select is(position('Closed for a wedding' in pg_temp.mylist_j()::text) + position('Please bring a bag' in pg_temp.mylist_j()::text),
  0, 'another customer''s list holds neither the reason text nor the note');
insert into res select 'map', to_jsonb(pg_temp.map_text());
select is(position('Closed for a wedding' in (select j #>> '{}' from res where label = 'map'))
        + position('Please bring a bag' in (select j #>> '{}' from res where label = 'map')), 0,
  'the public map reads never carry a note');
select ok((select length(j #>> '{}') > 20 and (j #>> '{}') not like 'error:%' from res where label = 'map'), 'and those map reads did return data');
select pg_temp.as_user(5);
select is(pg_temp.get_j(6) -> 'request', 'null'::jsonb, 'another seller gets a null request for someone else''s answered request');
select is(position('Closed for a wedding' in pg_temp.list_j()::text), 0, 'another seller''s list holds no foreign note');
reset role;

-- ── 8. The two request objects ──────────────────────────────────────────────
set local role authenticated;
select pg_temp.as_user(7);
insert into res select 'c_submit', pg_temp.sub_j(3, 1, 'lunch');
insert into res select 'c_get',  pg_temp.myget_j((select (j ->> 'id')::uuid from res where label = 'c_submit'));
insert into res select 'c_list', (pg_temp.mylist_j() -> 'requests' -> 0);
insert into res select 'c_cancel', pg_temp.mycancel_j((select (j ->> 'id')::uuid from res where label = 'c_submit'));
select pg_temp.as_user(1);
insert into res select 'c_answered', pg_temp.myget_j(pg_temp.r(6));
insert into res select 'c_accepted', pg_temp.myget_j(pg_temp.r(20));
insert into res select 'c_pending',  pg_temp.myget_j(pg_temp.r(10));
insert into res select 'c_home',     pg_temp.myget_j(pg_temp.r(7));
select pg_temp.as_user(5);
insert into res select 's_get', pg_temp.get_ju((select (j ->> 'id')::uuid from res where label = 'c_submit'));
insert into res select 's_list', (pg_temp.list_j() -> 'requests' -> 0);
select pg_temp.as_user(3);
insert into res select 's_answered', pg_temp.get_ju(pg_temp.r(6));
reset role;
select is(pg_temp.keys((select j from res where label = 'c_submit')),
  array['business_id', 'business_name', 'business_type', 'created_at', 'currency_code', 'decline_reason', 'display_status',
        'expires_at', 'id', 'items', 'note', 'order_text', 'pickup_at', 'response_note', 'status'],
  'submit returns exactly the 15 customer keys');
select is(pg_temp.keys((select j from res where label = 'c_get')), pg_temp.keys((select j from res where label = 'c_submit')), 'the customer get has the same 15 keys');
select is(pg_temp.keys((select j from res where label = 'c_list')), pg_temp.keys((select j from res where label = 'c_submit')), 'the customer list rows have the same 15 keys');
select is(pg_temp.keys((select j from res where label = 'c_cancel')), pg_temp.keys((select j from res where label = 'c_submit')), 'cancel returns the same 15 keys');
select is(pg_temp.keys((select j from res where label = 's_get')),
  array['business_id', 'business_name', 'business_type', 'created_at', 'currency_code', 'customer_name', 'decline_reason', 'display_status',
        'expires_at', 'id', 'items', 'note', 'order_text', 'pickup_at', 'responded_at', 'response_note', 'status'],
  'the seller get returns the 15 customer keys plus customer_name and responded_at');
select is(pg_temp.keys((select j from res where label = 's_list')), pg_temp.keys((select j from res where label = 's_get')), 'the seller list rows have the same 17 keys');
select is(pg_temp.keys((select j from res where label = 'dec6')), pg_temp.keys((select j from res where label = 's_get')), 'respond_to_request returns the same 17 keys');
select is((select j from res where label = 'c_pending') -> 'decline_reason', 'null'::jsonb, 'a pending request has decline_reason null');
select is((select j from res where label = 'c_pending') -> 'response_note', 'null'::jsonb, 'and response_note null');
select is((select j ->> 'decline_reason' from res where label = 'c_answered'), 'other', 'the customer sees decline_reason after the answer');
select is((select j ->> 'response_note' from res where label = 'c_answered'), 'Closed for a wedding', 'and the written reason');
select is((select j ->> 'response_note' from res where label = 'c_accepted'), 'Please bring a bag', 'the customer sees the accept note');
select is((select j -> 'decline_reason' from res where label = 'c_accepted'), 'null'::jsonb, 'an accepted request has decline_reason null');
select is((select j ->> 'decline_reason' from res where label = 's_answered'), 'other', 'the seller sees the reason on the same request');
select is((select j ->> 'decline_reason' from res where label = 'dec1'), 'sold_out', 'respond_to_request returns the stored reason');
select is((select j ->> 'response_note' from res where label = 'acc20'), 'Please bring a bag', 'respond_to_request returns the stored note');
select is(position('Secret Rd' in (select j::text from res where label = 'c_home')), 0, 'the customer object of an accepted homemade request holds no address');

-- ── 9. Rows declined before 10b ─────────────────────────────────────────────
select is(pg_temp.sig(30), 'declined|-|-|false', 'a row declined before 10b has no reason, no note and was not answered through the function');
set local role authenticated;
select pg_temp.as_user(3);
select is(pg_temp.get_j(30) -> 'request' -> 'decline_reason', 'null'::jsonb, 'the seller object of an old declined row has decline_reason null');
select pg_temp.as_user(1);
select is(pg_temp.myget_j(pg_temp.r(30)) -> 'response_note', 'null'::jsonb, 'and so does the customer object');
select pg_temp.as_user(3);
select is(pg_temp.resp(30, 'declined', 'sold_out'), 'invalid_transition', 'an old declined row cannot be given a reason afterwards');
reset role;
select is(pg_temp.sig(30), 'declined|-|-|false', 'and it is unchanged');

-- ── 10. Races and finality ──────────────────────────────────────────────────
set local role authenticated;
select pg_temp.as_user(1);
select is(pg_temp.cancel_err(50), 'OK', 'the customer cancels first');
select pg_temp.as_user(3);
select is(pg_temp.resp(50, 'declined', 'sold_out'), 'invalid_transition', 'the seller then loses with a reason: invalid_transition');
select is(pg_temp.resp(51, 'declined', 'other', 'Gone for today'), 'OK', 'the seller declines first');
select pg_temp.as_user(1);
select is(pg_temp.cancel_err(51), 'invalid_transition', 'the customer then loses against the decline');
select pg_temp.as_user(3);
select is(pg_temp.resp(52, 'declined', 'sold_out'), 'OK', 'a decline is answered once');
select is(pg_temp.resp(52, 'declined', 'too_busy'), 'invalid_transition', 'a second decline with another reason loses');
select is(pg_temp.resp(52, 'accepted', null, 'changed my mind'), 'invalid_transition', 'an accept after a decline loses');
select is(pg_temp.resp(54, 'accepted', null, 'Please bring a bag'), 'OK', 'an accept is answered once');
select is(pg_temp.resp(54, 'declined', 'sold_out'), 'invalid_transition', 'a decline after an accept loses');
select is(pg_temp.resp(53, 'declined', 'sold_out'), 'invalid_transition', 'a pending request past its expiry cannot be answered');
reset role;
select is(pg_temp.sig(50), 'cancelled|-|-|false', 'the loser of the cancel race stored no reason and no note');
select is(pg_temp.sig(51), 'declined|other|Gone for today|true', 'the decline that won keeps its reason and note');
select is(pg_temp.sig(52), 'declined|sold_out|-|true', 'the first reason is kept; a reason never changes');
select is(pg_temp.sig(54), 'accepted|-|Please bring a bag|true', 'the first accept note is kept');
select is(pg_temp.sig(53), 'pending|-|-|false', 'the expired request got no reason');

-- ── 11. Retention ───────────────────────────────────────────────────────────
select is(pg_temp.snap(70), 'Old Addr', 'the old accepted request still holds its address snapshot');
select private.expire_pickup_requests();
select is(pg_temp.snap(70), null::text, 'the expiry job clears the address snapshot 24 hours after the pickup');
select is(pg_temp.sig(70), 'accepted|-|Bring a bag|false', 'but the note stays');

-- ── 12. Every row declined through respond_to_request has a reason ──────────
-- Rows answered by the function have responded_at set; rows declined before 10b do not.
select is_empty(
  $$ select id from public.pickup_requests where status = 'declined' and responded_at is not null and decline_reason is null $$,
  'no row declined through respond_to_request lacks a reason');
select ok((select count(*) from public.pickup_requests where status = 'declined' and responded_at is not null) >= 9,
  'and that check looked at the declines made in this file (not an empty set)');

select * from finish();
rollback;
