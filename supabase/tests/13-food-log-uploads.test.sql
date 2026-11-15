-- Spec 13: food log uploads (PR 1) -- food_logs, food_log_upload_starts, food_log_cleanup_queue,
-- the food-logs bucket and its storage.objects policies, the private helpers and the seven
-- functions. The function allowlist and the exact `private` list live in the 05 file.
--
-- Every non-ASCII character is built with chr(<code point>); this file is ASCII only.
--
-- ORDER-DEPENDENT: the sections share state and must not be reordered. In particular:
--   * the `res` temp table keeps each reservation under a key (h1, h2, f1, l1, ...); a key must be
--     written before a later section reads it with pg_temp.rp / pg_temp.rid (both raise on a
--     missing key, so a failed early step cannot make a later not_found test pass by accident);
--   * the owner (1) runs at most 3 pending reservations at a time: h3 stays pending, h4 and the
--     two zone reservations are deleted again before the next ones are made;
--   * the limits user (5) is wiped (pg_temp.wipe) between the limit, end-to-end cleanup and
--     19/20 cleanup scenarios.
begin;
select plan(291);

-- -- Helpers (pg_temp) -------------------------------------------------------
-- Ids: users 00000000-0000-0000-0013-<n>; direct-insert logs ...-0513-<n>; paging logs ...-0613-<n>;
-- fabricated orphan files ...-0713-<n>.
create function pg_temp.u(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0013-' || lpad(n::text, 12, '0'))::uuid $$;
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
-- Runs one query and returns its single value as text, or 'ERROR <sqlstate> <message>', so an
-- "is accepted" test fails by name instead of aborting the file.
create function pg_temp.try_text(p_sql text) returns text language plpgsql as $$
declare v text;
begin
  execute p_sql into v;
  return v;
exception when others then
  return 'ERROR ' || sqlstate || ' ' || sqlerrm;
end $$;

-- `res` keeps begin_food_log_upload results by key; `walked` keeps the ids seen while paging.
create temp table res (k text primary key, j jsonb);
grant all on res to authenticated, anon;
create temp table walked (ord int primary key, page int not null, id uuid not null);
grant all on walked to authenticated;
create function pg_temp.rp(p_k text) returns text language plpgsql stable as $$
declare v text;
begin
  select j->>'path' into strict v from res where res.k = p_k;
  return v;
exception when no_data_found then
  raise exception 'test fixture: no reservation under key %', p_k;
end $$;
create function pg_temp.rid(p_k text) returns uuid language plpgsql stable as $$
declare v uuid;
begin
  select (j->>'id')::uuid into strict v from res where res.k = p_k;
  return v;
exception when no_data_found then
  raise exception 'test fixture: no reservation under key %', p_k;
end $$;

-- Begins an upload as the current JWT user and keeps the result under p_k.
create function pg_temp.beg(p_k text, p_cuisine text default 'IT', p_desc text default null,
                            p_public boolean default true, p_tz text default 'UTC') returns text
language plpgsql as $$
declare j jsonb;
begin
  j := public.begin_food_log_upload(p_cuisine, p_desc, p_public, p_tz);
  insert into res (k, j) values (p_k, j) on conflict (k) do update set j = excluded.j;
  return j->>'path';
end $$;

-- Storage as the calling role (RLS applies; all SECURITY INVOKER). `put_ret` is the insert with
-- RETURNING that the Storage API may run (Decision 22).
create procedure pg_temp.put(p_path text, p_mime text default 'image/jpeg', p_size bigint default 1000)
  language sql
  as $$ insert into storage.objects (bucket_id, name, metadata)
        values ('food-logs', p_path, jsonb_build_object('mimetype', p_mime, 'size', p_size)) $$;
create function pg_temp.put_ret(p_path text) returns text language sql as $$
  insert into storage.objects (bucket_id, name, metadata)
  values ('food-logs', p_path, '{"mimetype":"image/jpeg","size":1000}'::jsonb)
  returning name $$;
create function pg_temp.seen(p_path text) returns int language sql stable as $$
  select count(*)::int from storage.objects where bucket_id = 'food-logs' and name = p_path $$;
create function pg_temp.del_obj(p_path text) returns int language sql as $$
  with d as (delete from storage.objects where bucket_id = 'food-logs' and name = p_path returning 1)
  select count(*)::int from d $$;
create function pg_temp.upd_obj(p_path text) returns int language sql as $$
  with d as (update storage.objects set metadata = metadata
              where bucket_id = 'food-logs' and name = p_path returning 1)
  select count(*)::int from d $$;
-- The app's cleanup step: remove every path the claim returns, through the delete policy.
create function pg_temp.remove_claimed() returns int language sql as $$
  with d as (delete from storage.objects
              where bucket_id = 'food-logs'
                and name in (select p from public.claim_food_log_cleanup() as p)
             returning 1)
  select count(*)::int from d $$;

-- n begins, each deleted at once (no file).
create function pg_temp.churn(p_count int) returns int language plpgsql as $$
declare j jsonb;
begin
  for i in 1..p_count loop
    j := public.begin_food_log_upload('IT', null, true, 'UTC');
    perform public.delete_food_log((j->>'id')::uuid);
  end loop;
  return p_count;
end $$;
-- n full uploads (begin, upload, finish), each deleted afterwards: n orphan files.
create function pg_temp.cycle(p_count int) returns int language plpgsql as $$
declare j jsonb;
begin
  for i in 1..p_count loop
    j := public.begin_food_log_upload('IT', null, true, 'UTC');
    insert into storage.objects (bucket_id, name, metadata)
    values ('food-logs', j->>'path', '{"mimetype":"image/jpeg","size":1000}'::jsonb);
    perform public.finish_food_log_upload((j->>'id')::uuid);
    perform public.delete_food_log((j->>'id')::uuid);
  end loop;
  return p_count;
end $$;
-- Pages through list_my_food_logs as the current user into `walked`.
create function pg_temp.walk() returns jsonb language plpgsql as $$
declare
  c     text;
  j     jsonb;
  it    jsonb;
  p     int := 0;
  o     int := 0;
  sizes int[] := array[]::int[];
  first text;
begin
  delete from walked;
  loop
    j := public.list_my_food_logs(c);
    p := p + 1;
    sizes := sizes || jsonb_array_length(j->'items');
    for it in select * from jsonb_array_elements(j->'items') loop
      o := o + 1;
      insert into walked (ord, page, id) values (o, p, (it->>'id')::uuid);
    end loop;
    if p = 1 then first := j->>'next_cursor'; end if;
    c := j->>'next_cursor';
    exit when c is null or p >= 10;
  end loop;
  return jsonb_build_object('sizes', to_jsonb(sizes), 'first_cursor', first, 'last_cursor', c);
end $$;

-- Runs 'a' || chr(code) || 'b' through begin (as the current user, deleting what it makes), update
-- (the owner's h1) or a direct table insert (as postgres), and returns the codes whose outcome is
-- not the expected one (refused: invalid_text / 23514; allowed: no error).
create function pg_temp.hidden_check(p_via text, p_codes int[], p_refused boolean) returns text[]
language plpgsql as $$
declare
  c   int;
  d   text;
  r   text;
  id  uuid;
  bad text[] := array[]::text[];
begin
  foreach c in array p_codes loop
    d := 'a' || chr(c) || 'b';
    if p_via = 'begin' then
      r := pg_temp.try_text(format('select (public.begin_food_log_upload(%L, %L, true, %L))->>%L', 'IT', d, 'UTC', 'id'));
      if r not like 'ERROR%' then perform public.delete_food_log(r::uuid); end if;
    elsif p_via = 'update' then
      r := pg_temp.try_text(format('select (public.update_food_log(%L::uuid, %L, %L, true))->>%L',
                                   pg_temp.rid('h1'), 'IT', d, 'id'));
    else
      id := gen_random_uuid();
      r := pg_temp.try_text(format(
        'insert into public.food_logs (id, author_id, cuisine_code, description, local_date, path) '
        || 'values (%L::uuid, %L::uuid, %L, %L, (now() at time zone %L)::date, %L) returning id',
        id, pg_temp.u(3), 'IT', d, 'UTC', pg_temp.u(3)::text || '/' || id::text || '.jpg'));
      if r not like 'ERROR%' then delete from public.food_logs where food_logs.id = r::uuid; end if;
    end if;
    if p_refused and not (r like 'ERROR P0001 invalid_text%' or r like 'ERROR 23514 %') then
      bad := bad || to_hex(c);
    elsif not p_refused and r like 'ERROR%' then
      bad := bad || to_hex(c);
    end if;
  end loop;
  return bad;
end $$;

-- Superuser fixtures (run after `reset role`).
create function pg_temp.raw_ins(p_n int, p_author int, p_desc text, p_path text default null,
                                p_date date default null, p_status text default 'ready') returns void
language plpgsql as $$
declare v_id uuid := ('00000000-0000-0000-0513-' || lpad(p_n::text, 12, '0'))::uuid;
begin
  insert into public.food_logs (id, author_id, cuisine_code, description, local_date, path, status)
  values (v_id, pg_temp.u(p_author), 'IT', p_desc,
          coalesce(p_date, (now() at time zone 'UTC')::date),
          coalesce(p_path, pg_temp.u(p_author)::text || '/' || v_id::text || '.jpg'), p_status);
end $$;
create procedure pg_temp.wipe(p_n int) language plpgsql as $$
begin
  delete from public.food_logs where author_id = pg_temp.u(p_n);
  delete from public.food_log_cleanup_queue where author_id = pg_temp.u(p_n);
  delete from storage.objects where bucket_id = 'food-logs' and name like pg_temp.u(p_n)::text || '/%';
  delete from public.food_log_upload_starts where author_id = pg_temp.u(p_n);
end $$;
create procedure pg_temp.orphans(p_n int, p_from int, p_to int, p_with_object boolean) language plpgsql as $$
declare v_path text;
begin
  for i in p_from..p_to loop
    v_path := pg_temp.u(p_n)::text || '/00000000-0000-0000-0713-' || lpad(i::text, 12, '0') || '.jpg';
    insert into public.food_log_cleanup_queue (path, author_id) values (v_path, pg_temp.u(p_n));
    if p_with_object then
      insert into storage.objects (bucket_id, name, metadata)
      values ('food-logs', v_path, '{"mimetype":"image/jpeg","size":1000}'::jsonb);
    end if;
  end loop;
end $$;

-- -- Fixtures (as postgres) ---------------------------------------------------
-- 1 owner   2 second user   3 outsider   4 no username   5 limits   6 paging   7 account deletion
insert into auth.users (id, email)
select pg_temp.u(n), 'flog13_' || n || '@example.test' from generate_series(1, 7) n;
update public.profiles set username = 'flog13_' || right(id::text, 2)
 where id in (select pg_temp.u(n) from generate_series(1, 7) n where n <> 4);

-- Supabase blocks direct SQL deletes on storage.objects; turn that guard off so the delete tests
-- exercise OUR policy.
set local storage.allow_delete_query = 'true';

-- -- 1. Structure --------------------------------------------------------------
select ok((select relrowsecurity from pg_class where oid = 'public.food_logs'::regclass), 'RLS is enabled on food_logs');
select ok((select relrowsecurity from pg_class where oid = 'public.food_log_upload_starts'::regclass), 'RLS is enabled on food_log_upload_starts');
select ok((select relrowsecurity from pg_class where oid = 'public.food_log_cleanup_queue'::regclass), 'RLS is enabled on food_log_cleanup_queue');
select table_privs_are('public', 'food_logs', 'anon', array[]::text[], 'anon has no privilege on food_logs');
select table_privs_are('public', 'food_logs', 'authenticated', array[]::text[], 'authenticated has no privilege on food_logs');
select table_privs_are('public', 'food_log_upload_starts', 'anon', array[]::text[], 'anon has no privilege on food_log_upload_starts');
select table_privs_are('public', 'food_log_upload_starts', 'authenticated', array[]::text[], 'authenticated has no privilege on food_log_upload_starts');
select table_privs_are('public', 'food_log_cleanup_queue', 'anon', array[]::text[], 'anon has no privilege on food_log_cleanup_queue');
select table_privs_are('public', 'food_log_cleanup_queue', 'authenticated', array[]::text[], 'authenticated has no privilege on food_log_cleanup_queue');
select is_empty(
  $$ select r || ':' || c.relname || ':' || a.attname
       from unnest(array['anon', 'authenticated']) r,
            pg_class c join pg_attribute a on a.attrelid = c.oid
      where c.oid in ('public.food_logs'::regclass, 'public.food_log_upload_starts'::regclass,
                      'public.food_log_cleanup_queue'::regclass)
        and a.attnum > 0 and not a.attisdropped
        and has_column_privilege(r, c.oid, a.attname, 'SELECT, INSERT, UPDATE, REFERENCES') $$,
  'anon and authenticated hold no column privilege on the three food log tables');
select is((select count(*)::int from pg_policies
            where schemaname = 'public' and tablename in ('food_logs', 'food_log_upload_starts', 'food_log_cleanup_queue')),
  0, 'the three food log tables have no policies');

select is((select public from storage.buckets where id = 'food-logs'), false, 'food-logs bucket is private');
select is((select file_size_limit from storage.buckets where id = 'food-logs'), 2097152::bigint,
  'food-logs bucket limit is 2 MB (2097152 bytes)');
select is((select allowed_mime_types from storage.buckets where id = 'food-logs'), array['image/jpeg'],
  'food-logs allows exactly image/jpeg');
select is((select array_agg(policyname || ':' || cmd || ':' || array_to_string(roles, ',') order by policyname)
             from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'food\_logs%'),
  array['food_logs_delete_own:DELETE:authenticated', 'food_logs_insert_own:INSERT:authenticated',
        'food_logs_select:SELECT:authenticated'],
  'food-logs has exactly an insert, a select and a delete policy, for authenticated only');
select is((select count(*)::int from pg_policies
            where schemaname = 'storage' and tablename = 'objects' and cmd in ('UPDATE', 'ALL')
              and (policyname || ' ' || coalesce(qual, '') || ' ' || coalesce(with_check, '')) ilike '%food%log%'),
  0, 'there is no UPDATE or ALL policy on storage.objects for food-logs');
select hasnt_function('private', 'food_log_is_readable', array['text'],
  'there is no food_log_is_readable helper (others read no food-logs file, Decision 23)');

select is_empty(
  $$ select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where ((n.nspname = 'public' and p.proname in ('begin_food_log_upload', 'finish_food_log_upload',
               'update_food_log', 'delete_food_log', 'get_food_log', 'list_my_food_logs',
               'claim_food_log_cleanup', 'food_logs_queue_cleanup'))
             or (n.nspname = 'private' and p.proname like 'food\_log\_%'))
        and (not p.prosecdef or p.proconfig is distinct from array['search_path=""']) $$,
  'every spec 13 function and helper is security definer with an empty search_path');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('begin_food_log_upload', 'finish_food_log_upload',
               'update_food_log', 'delete_food_log', 'get_food_log', 'list_my_food_logs', 'claim_food_log_cleanup')),
  7, 'each of the seven spec 13 functions exists once (no overloads)');
select is_empty(
  $$ select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where ((n.nspname = 'public' and p.proname in ('begin_food_log_upload', 'finish_food_log_upload',
               'update_food_log', 'delete_food_log', 'get_food_log', 'list_my_food_logs',
               'claim_food_log_cleanup', 'food_logs_queue_cleanup'))
             or (n.nspname = 'private' and p.proname like 'food\_log\_%'))
        and has_function_privilege('anon', p.oid, 'execute') $$,
  'anon can execute no spec 13 function or helper');
select is_empty(
  $$ select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where ((n.nspname = 'public' and p.proname in ('begin_food_log_upload', 'finish_food_log_upload',
               'update_food_log', 'delete_food_log', 'get_food_log', 'list_my_food_logs', 'claim_food_log_cleanup'))
             or (n.nspname = 'private' and p.proname like 'food\_log\_%'))
        and not has_function_privilege('authenticated', p.oid, 'execute') $$,
  'authenticated can execute the seven functions and the two helpers');
select ok(not has_function_privilege('authenticated', 'public.food_logs_queue_cleanup()', 'execute'),
  'authenticated cannot execute the cleanup trigger function');
select is_empty(
  $$ select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('begin_food_log_upload', 'finish_food_log_upload',
               'update_food_log', 'delete_food_log', 'get_food_log', 'list_my_food_logs', 'claim_food_log_cleanup')
        and exists (select 1 from unnest(p.proargtypes::oid[]) t
                     where t in ('date'::regtype, 'timestamptz'::regtype, 'timestamp'::regtype,
                                 'time'::regtype, 'timetz'::regtype, 'interval'::regtype)) $$,
  'no spec 13 function accepts a date or a time');

-- -- 2. Happy path: begin -> upload -> finish (owner 1) ---------------------------
set local role authenticated;
select pg_temp.as_user(1);
select lives_ok($$ select pg_temp.beg('h1', 'IT', '  Ramen night  ', true, 'UTC') $$, 'the owner begins an upload');
select is(pg_temp.keys((select j from res where k = 'h1')), array['id', 'path'], 'begin returns exactly id and path');
select is(pg_temp.rp('h1'), pg_temp.u(1)::text || '/' || pg_temp.rid('h1')::text || '.jpg',
  'the server makes the path <author_id>/<log_id>.jpg');
reset role;
select is((select status from public.food_logs where id = pg_temp.rid('h1')), 'pending', 'a begun upload is pending');
select is((select author_id from public.food_logs where id = pg_temp.rid('h1')), pg_temp.u(1), 'the author is the caller');
select is((select description from public.food_logs where id = pg_temp.rid('h1')), 'Ramen night', 'the description is stored trimmed');
select is((select created_at from public.food_logs where id = pg_temp.rid('h1')), now(), 'created_at is the server now()');
select is((select local_date from public.food_logs where id = pg_temp.rid('h1')), (now() at time zone 'UTC')::date,
  'local_date is the server date in the given zone');
select is((select count(*)::int from public.food_log_upload_starts where author_id = pg_temp.u(1) and started_at = now()), 1,
  'begin records one start at the server time');

set local role authenticated;
select pg_temp.as_user(1);
select lives_ok($$ call pg_temp.put(pg_temp.rp('h1')) $$, 'the owner uploads to a fresh reservation');
select is(pg_temp.keys(public.finish_food_log_upload(pg_temp.rid('h1'))),
  array['created_at', 'cuisine_code', 'description', 'id', 'is_mine', 'is_public', 'local_date', 'path'],
  'finish returns the log object with exactly the eight keys');
select is((public.get_food_log(pg_temp.rid('h1')))->>'is_mine', 'true', 'the owner reads their ready log, is_mine true');
select is((public.get_food_log(pg_temp.rid('h1')))->>'path', pg_temp.rp('h1'), 'the owner gets their own path');
select is(pg_temp.keys(public.get_food_log(pg_temp.rid('h1'))),
  array['created_at', 'cuisine_code', 'description', 'id', 'is_mine', 'is_public', 'local_date', 'path'],
  'get returns exactly the eight keys');
select throws_ok($$ select public.finish_food_log_upload(pg_temp.rid('h1')) $$, 'P0001', 'not_found',
  'a ready log cannot be finished again');
select throws_ok($$ call pg_temp.put(pg_temp.rp('h1')) $$, '42501', null,
  'the owner cannot upload at the path of their own ready log (only pending reservations)');
reset role;
select is((select status from public.food_logs where id = pg_temp.rid('h1')), 'ready', 'finish marks the log ready');

set local role authenticated;
select pg_temp.as_user(1);
select lives_ok($$ select pg_temp.beg('h2', 'FR', null, false) $$, 'the owner begins a private upload');
select is(pg_temp.try_text($$ select pg_temp.put_ret(pg_temp.rp('h2')) $$), pg_temp.rp('h2'),
  'the owner uploads with RETURNING to their own pending reservation (Decision 22)');
select lives_ok($$ select public.finish_food_log_upload(pg_temp.rid('h2')) $$, 'the private upload is finished');
select lives_ok($$ select pg_temp.beg('h3') $$, 'the owner begins a third upload');
select lives_ok($$ call pg_temp.put(pg_temp.rp('h3')) $$, 'the owner uploads it but does not finish (stays pending)');
select lives_ok($$ select pg_temp.beg('h4') $$, 'the owner reserves h4 and uploads nothing');

-- -- 3. Reads, storage listing and the outsider ------------------------------------------
select throws_ok($$ select public.get_food_log(pg_temp.rid('h3')) $$, 'P0001', 'not_found',
  'the owner gets not_found for their own pending log');
select is(pg_temp.seen(pg_temp.rp('h1')) + pg_temp.seen(pg_temp.rp('h2')) + pg_temp.seen(pg_temp.rp('h3')), 3,
  'the owner sees their public, private and pending files');
select is((select count(*)::int from storage.search('', 'food-logs') s where s.name = pg_temp.u(1)::text), 1,
  'a root listing shows the owner their own folder');
select is((select count(*)::int from storage.search(pg_temp.u(1)::text || '/', 'food-logs')), 3,
  'a prefix listing shows the owner their three files');
select is(pg_temp.del_obj(pg_temp.rp('h1')), 0, 'the owner cannot delete a live file');
select is(pg_temp.upd_obj(pg_temp.rp('h1')), 0, 'the owner cannot update any object (no update policy)');

select pg_temp.as_user(2);
select is((public.get_food_log(pg_temp.rid('h1')))->>'is_mine', 'false', 'another user reads a public ready log, is_mine false');
select is(pg_temp.keys(public.get_food_log(pg_temp.rid('h1'))),
  array['created_at', 'cuisine_code', 'description', 'id', 'is_mine', 'is_public', 'local_date', 'path'],
  'another user''s get still has exactly the eight keys');
select ok((public.get_food_log(pg_temp.rid('h1'))) ? 'path' and (public.get_food_log(pg_temp.rid('h1')))->'path' = 'null'::jsonb,
  'another user gets path null (the path holds the author''s id)');
select throws_ok($$ select public.get_food_log(pg_temp.rid('h2')) $$, 'P0001', 'not_found',
  'another user gets not_found for a private log');
select throws_ok($$ select public.get_food_log(pg_temp.rid('h3')) $$, 'P0001', 'not_found',
  'another user gets not_found for a pending log');
select throws_ok($$ select public.get_food_log(gen_random_uuid()) $$, 'P0001', 'not_found',
  'an unknown id gives not_found');
select is(pg_temp.seen(pg_temp.rp('h1')), 0, 'another user does not see a ready public file (Decision 23)');
select is(pg_temp.seen(pg_temp.rp('h2')), 0, 'another user does not see a private file');
select is(pg_temp.seen(pg_temp.rp('h3')), 0, 'another user does not see a pending file');

select pg_temp.as_user(3);
select is(pg_temp.seen(pg_temp.rp('h1')), 0, 'the outsider does not see a ready public file');
select is(pg_temp.seen(pg_temp.rp('h2')), 0, 'the outsider does not see a private file');
select is(pg_temp.seen(pg_temp.rp('h3')), 0, 'the outsider does not see a pending file');
select is((select count(*)::int from storage.objects where bucket_id = 'food-logs'), 0,
  'the outsider sees no food-logs file at all');
select is((select count(*)::int from storage.search('', 'food-logs')), 0,
  'a root listing of food-logs shows the outsider nothing (no folders, no user ids)');
select is((select count(*)::int from storage.search(pg_temp.u(1)::text || '/', 'food-logs')), 0,
  'a prefix listing of the owner''s folder shows the outsider nothing');
select is((select count(*)::int from storage.list_objects_with_delimiter('food-logs', '', '/')), 0,
  'a delimiter listing of food-logs shows the outsider nothing');
select is(jsonb_array_length((public.list_my_food_logs())->'items'), 0, 'the outsider lists none of the owner''s logs');
select throws_ok($$ select public.update_food_log(pg_temp.rid('h1'), 'JP', 'mine now', false) $$, 'P0001', 'not_found',
  'the outsider cannot update another person''s log');
select throws_ok($$ select public.delete_food_log(pg_temp.rid('h1')) $$, 'P0001', 'not_found',
  'the outsider cannot delete another person''s log');
select throws_ok($$ select public.delete_food_log(pg_temp.rid('h3')) $$, 'P0001', 'not_found',
  'the outsider cannot delete another person''s pending log');
select throws_ok($$ select public.finish_food_log_upload(pg_temp.rid('h3')) $$, 'P0001', 'not_found',
  'the outsider cannot finish another person''s reservation');
select throws_ok($$ call pg_temp.put(pg_temp.rp('h4')) $$, '42501', null,
  'the outsider cannot upload into another person''s fresh reservation');
select throws_ok($$ call pg_temp.put(pg_temp.u(1)::text || '/' || gen_random_uuid()::text || '.jpg') $$, '42501', null,
  'the outsider cannot upload into another person''s folder');
select throws_ok($$ call pg_temp.put(pg_temp.u(3)::text || '/' || gen_random_uuid()::text || '.jpg') $$, '42501', null,
  'nobody can upload to an unreserved path, even in their own folder');
select throws_ok($$ call pg_temp.put('not-a-uuid/x.jpg') $$, '42501', null,
  'nobody can upload into a malformed (non-UUID) folder');
select is(pg_temp.del_obj(pg_temp.rp('h1')), 0, 'the outsider deletes no file of another person');
select is(pg_temp.upd_obj(pg_temp.rp('h1')), 0, 'the outsider updates no object');
select throws_ok($$ select count(*) from public.food_logs $$, '42501', null, 'authenticated cannot read food_logs');
select throws_ok($$ insert into public.food_logs (author_id, cuisine_code, local_date, path) values
                    ('00000000-0000-0000-0013-000000000003', 'IT', current_date, 'x') $$,
  '42501', null, 'authenticated cannot insert into food_logs');
select throws_ok($$ update public.food_logs set is_public = true $$, '42501', null, 'authenticated cannot update food_logs');
select throws_ok($$ delete from public.food_logs $$, '42501', null, 'authenticated cannot delete from food_logs');
select throws_ok($$ select count(*) from public.food_log_upload_starts $$, '42501', null,
  'authenticated cannot read food_log_upload_starts');
select throws_ok($$ select count(*) from public.food_log_cleanup_queue $$, '42501', null,
  'authenticated cannot read food_log_cleanup_queue');
reset role;
select is((select row(cuisine_code, description, is_public, status)::text from public.food_logs where id = pg_temp.rid('h1')),
  row('IT', 'Ramen night', true, 'ready')::text, 'the outsider''s refused update and delete left h1 unchanged');

-- A caller with no user id.
set local role authenticated;
select pg_temp.as_nobody();
select throws_ok($$ select public.finish_food_log_upload(pg_temp.rid('h3')) $$, 'P0001', 'not_found', 'no user id: finish gives not_found');
select throws_ok($$ select public.update_food_log(pg_temp.rid('h1'), 'IT', null, true) $$, 'P0001', 'not_found', 'no user id: update gives not_found');
select throws_ok($$ select public.delete_food_log(pg_temp.rid('h1')) $$, 'P0001', 'not_found', 'no user id: delete gives not_found');
select throws_ok($$ select public.get_food_log(pg_temp.rid('h1')) $$, 'P0001', 'not_found', 'no user id: get gives not_found');
select is((select count(*)::int from public.claim_food_log_cleanup()), 0, 'no user id: claim returns nothing');
select is(public.list_my_food_logs(), '{"items": [], "next_cursor": null}'::jsonb, 'no user id: list returns an empty page');

reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select is((select count(*)::int from storage.objects where bucket_id = 'food-logs'), 0, 'anon reads no food-logs object');
select throws_ok($$ call pg_temp.put(pg_temp.rp('h4')) $$, '42501', null, 'anon cannot upload to food-logs');
select is(pg_temp.try_text($$ select pg_temp.del_obj(pg_temp.rp('h1'))::text $$), '0', 'anon deletes no food-logs object');
select is(pg_temp.try_text($$ select pg_temp.upd_obj(pg_temp.rp('h1'))::text $$), '0', 'anon updates no food-logs object');
select throws_ok($$ select count(*) from public.food_logs $$, '42501', null, 'anon cannot read food_logs');
select throws_ok($$ select public.begin_food_log_upload('IT', null, true, 'UTC') $$, '42501', null, 'anon cannot begin an upload');
select throws_ok($$ select public.finish_food_log_upload(gen_random_uuid()) $$, '42501', null, 'anon cannot finish an upload');
select throws_ok($$ select public.update_food_log(gen_random_uuid(), 'IT', null, true) $$, '42501', null, 'anon cannot update a log');
select throws_ok($$ select public.delete_food_log(gen_random_uuid()) $$, '42501', null, 'anon cannot delete a log');
select throws_ok($$ select public.get_food_log(gen_random_uuid()) $$, '42501', null, 'anon cannot get a log');
select throws_ok($$ select public.list_my_food_logs() $$, '42501', null, 'anon cannot list logs');
select throws_ok($$ select public.claim_food_log_cleanup() $$, '42501', null, 'anon cannot claim the cleanup');
select throws_ok($$ select private.food_log_upload_allowed('x') $$, '42501', null, 'anon cannot call a private helper');

-- -- 4. Zones and input validation ---------------------------------------------------
reset role;
set local role authenticated;
select pg_temp.as_user(1);
select lives_ok($$ select public.delete_food_log(pg_temp.rid('h4')) $$, 'the owner deletes their pending h4');
-- The zone is checked after the limits (S6), so these run while the owner has one pending upload.
select throws_ok($$ select public.begin_food_log_upload('IT', null, true, 'Mars/Olympus') $$, 'P0001', 'invalid_time_zone',
  'an unknown zone gives invalid_time_zone');
select throws_ok($$ select public.begin_food_log_upload('IT', null, true, null) $$, 'P0001', 'invalid_time_zone',
  'a null zone gives invalid_time_zone');
select throws_ok($$ select public.begin_food_log_upload('IT', null, true, '') $$, 'P0001', 'invalid_time_zone',
  'an empty zone gives invalid_time_zone');
select lives_ok($$ select pg_temp.beg('kir', 'IT', null, true, 'Pacific/Kiritimati') $$, 'begin in Pacific/Kiritimati');
select lives_ok($$ select pg_temp.beg('pago', 'IT', null, true, 'Pacific/Pago_Pago') $$, 'begin in Pacific/Pago_Pago');
select throws_ok($$ select public.begin_food_log_upload('ZZ', null, true, 'UTC') $$, 'P0001', 'invalid_input',
  'an unknown cuisine gives invalid_input');
select throws_ok($$ select public.begin_food_log_upload(null, null, true, 'UTC') $$, 'P0001', 'invalid_input',
  'a null cuisine gives invalid_input');
select throws_ok($$ select public.begin_food_log_upload('IT', null, null, 'UTC') $$, 'P0001', 'invalid_input',
  'a null visibility gives invalid_input');
select pg_temp.as_user(4);
select throws_ok($$ select public.begin_food_log_upload('IT', null, true, 'UTC') $$, 'P0001', 'profile_incomplete',
  'a user without a username gets profile_incomplete');
select throws_ok($$ select public.begin_food_log_upload('IT', repeat('x', 1001), true, 'UTC') $$, 'P0001', 'invalid_input',
  'the 1000-character cap is checked first, before the profile');
select pg_temp.as_nobody();
select throws_ok($$ select public.begin_food_log_upload('IT', null, true, 'UTC') $$, 'P0001', 'profile_incomplete',
  'a caller without a user id gets profile_incomplete');
reset role;
select is((select local_date from public.food_logs where id = pg_temp.rid('kir')), (now() at time zone 'Pacific/Kiritimati')::date,
  'local_date follows Pacific/Kiritimati');
select is((select local_date from public.food_logs where id = pg_temp.rid('pago')), (now() at time zone 'Pacific/Pago_Pago')::date,
  'local_date follows Pacific/Pago_Pago');
select isnt((select local_date from public.food_logs where id = pg_temp.rid('kir')),
            (select local_date from public.food_logs where id = pg_temp.rid('pago')),
  'the two zones (25 hours apart) give different dates');
set local role authenticated;
select pg_temp.as_user(1);
select lives_ok($$ select public.delete_food_log(pg_temp.rid('kir')), public.delete_food_log(pg_temp.rid('pago')) $$,
  'the owner deletes the two zone reservations');

-- Known limit (S2, v1 16): the zone is the caller's choice, so at one instant the far-west and
-- far-east zones give dates about a day apart, both inside the table's UTC date +-1.
select pg_temp.as_user(2);
select lives_ok($$ select pg_temp.beg('west', 'IT', null, true, 'Etc/GMT+12') $$, 'begin in Etc/GMT+12 (UTC-12)');
select lives_ok($$ select pg_temp.beg('east', 'IT', null, true, 'Etc/GMT-14') $$, 'begin in Etc/GMT-14 (UTC+14)');
reset role;
select is((select local_date from public.food_logs where id = pg_temp.rid('west')), (now() at time zone 'Etc/GMT+12')::date,
  'a far-west zone gives its own date');
select ok((select local_date from public.food_logs where id = pg_temp.rid('west')) < (select local_date from public.food_logs where id = pg_temp.rid('east'))
          and (select local_date from public.food_logs where id = pg_temp.rid('west')) >= (now() at time zone 'UTC')::date - 1,
  'pinned: the chosen zone can move local_date by about one day, never past the UTC date - 1');
set local role authenticated;
select pg_temp.as_user(2);
select lives_ok($$ select public.delete_food_log(pg_temp.rid('west')), public.delete_food_log(pg_temp.rid('east')) $$,
  'the second user deletes the two zone reservations');

-- -- 5. Descriptions (Decisions 2, 11) ---------------------------------------------
select pg_temp.as_user(1);
-- Refused by begin (validation runs before any limit, so these cost no start).
select throws_ok($$ select public.begin_food_log_upload('IT', repeat('x', 281), true, 'UTC') $$, 'P0001', 'invalid_input',
  'a 281-character description gives invalid_input');
select throws_ok($$ select public.begin_food_log_upload('IT', repeat('x', 1000) || chr(8238), true, 'UTC') $$, 'P0001', 'invalid_input',
  'begin refuses 1001 characters before anything else (cap before the hidden-character check)');
select throws_ok($$ select public.begin_food_log_upload('IT', repeat('x', 999) || chr(8238), true, 'UTC') $$, 'P0001', 'invalid_text',
  'at 1000 characters the hidden-character check still runs');
select throws_ok($$ select public.begin_food_log_upload('IT', 'call 123-456-7890', true, 'UTC') $$, 'P0001', 'contact_info',
  'a 10-digit run with dashes gives contact_info');
select throws_ok($$ select public.begin_food_log_upload('IT', '(123) [456].7890', true, 'UTC') $$, 'P0001', 'contact_info',
  'a 10-digit run with brackets and dots gives contact_info');
select throws_ok($$ select public.begin_food_log_upload('IT', '123' || chr(10) || '4567890', true, 'UTC') $$, 'P0001', 'contact_info',
  'a 10-digit run split by a newline gives contact_info');
select throws_ok($$ select public.begin_food_log_upload('IT', '123/456/7890', true, 'UTC') $$, 'P0001', 'contact_info',
  'a 10-digit run split by slashes gives contact_info');
select throws_ok($$ select public.begin_food_log_upload('IT', '123_456_7890', true, 'UTC') $$, 'P0001', 'contact_info',
  'a 10-digit run split by underscores gives contact_info');
select throws_ok($$ select public.begin_food_log_upload('IT', '123,456,7890', true, 'UTC') $$, 'P0001', 'contact_info',
  'a 10-digit run split by commas gives contact_info');
select throws_ok($$ select public.begin_food_log_upload('IT', '+1 234 567 890', true, 'UTC') $$, 'P0001', 'contact_info',
  'a 10-digit run with a plus gives contact_info');
select throws_ok($$ select public.begin_food_log_upload('IT', '123' || chr(8195) || '456' || chr(12288) || '7890', true, 'UTC') $$, 'P0001', 'contact_info',
  'a 10-digit run split by Unicode spaces (U+2003, U+3000) gives contact_info');
select throws_ok($$ select public.begin_food_log_upload('IT', 'a@b.co', true, 'UTC') $$, 'P0001', 'contact_info',
  'an email gives contact_info');
select throws_ok($$ select public.begin_food_log_upload('IT', 'write to Me.Here@Example.COM', true, 'UTC') $$, 'P0001', 'contact_info',
  'a mixed-case email gives contact_info');
select throws_ok($$ select public.begin_food_log_upload('IT', 'a @ b.co', true, 'UTC') $$, 'P0001', 'contact_info',
  'an email with spaces around @ gives contact_info');
select throws_ok($$ select public.begin_food_log_upload('IT', 'a' || chr(65312) || 'b.co', true, 'UTC') $$, 'P0001', 'contact_info',
  'an email with a fullwidth @ (U+FF20) gives contact_info');
select throws_ok($$ select public.begin_food_log_upload('IT', 'dinner @ joes.com', true, 'UTC') $$, 'P0001', 'contact_info',
  'a word @ domain gives contact_info');
select throws_ok($$ select public.begin_food_log_upload('IT', '2026-11-14 2026-11-15', true, 'UTC') $$, 'P0001', 'contact_info',
  'two adjacent dates join into 16 digits and give contact_info (known edge)');
select throws_ok($$ select public.begin_food_log_upload('IT', 'a' || chr(8238) || 'b', true, 'UTC') $$, 'P0001', 'invalid_text',
  'U+202E (bidi override) gives invalid_text');
select throws_ok($$ select public.begin_food_log_upload('IT', 'a' || chr(8203) || 'b', true, 'UTC') $$, 'P0001', 'invalid_text',
  'U+200B gives invalid_text');
select throws_ok($$ select public.begin_food_log_upload('IT', 'a' || chr(8294) || 'b', true, 'UTC') $$, 'P0001', 'invalid_text',
  'U+2066 gives invalid_text');
select throws_ok($$ select public.begin_food_log_upload('IT', 'a' || chr(173) || 'b', true, 'UTC') $$, 'P0001', 'invalid_text',
  'U+00AD gives invalid_text');
select throws_ok($$ select public.begin_food_log_upload('IT', 'a' || chr(917607) || 'b', true, 'UTC') $$, 'P0001', 'invalid_text',
  'a tag character (U+E0067) gives invalid_text');
select throws_ok($$ select public.begin_food_log_upload('IT', 'a' || chr(9) || 'b', true, 'UTC') $$, 'P0001', 'invalid_text',
  'a tab gives invalid_text');
select throws_ok($$ select public.begin_food_log_upload('IT', repeat('x', 300) || chr(8238), true, 'UTC') $$, 'P0001', 'invalid_text',
  'a hidden character is reported before the length');
select throws_ok($$ select public.begin_food_log_upload('IT', 'a@b.co ' || chr(8238), true, 'UTC') $$, 'P0001', 'invalid_text',
  'a hidden character is reported before contact info');
select throws_ok($$ select public.begin_food_log_upload('IT', repeat('x', 275) || ' a@b.co', true, 'UTC') $$, 'P0001', 'invalid_input',
  'the length is reported before contact info');

-- Accepted by begin (second user, deleted again).
select pg_temp.as_user(2);
select is(pg_temp.try_text($$ select (public.begin_food_log_upload('IT', 'Ate on 2026-11-14, 9 digits 123 456 789', true, 'UTC') ->> 'path') is not null $$),
  'true', 'begin accepts a date and a 9-digit run');
select is(pg_temp.try_text($$ select (public.begin_food_log_upload('IT', chr(128104) || chr(8205) || chr(127859) || ' ' || chr(10084) || chr(65039), true, 'UTC') ->> 'path') is not null $$),
  'true', 'begin accepts an emoji ZWJ sequence with U+FE0F');
select lives_ok($$ select pg_temp.beg('blank', 'IT', '   ', true) $$, 'begin accepts a blank description');
reset role;
select is((select count(*)::int from public.food_logs
            where author_id = pg_temp.u(2) and description = chr(128104) || chr(8205) || chr(127859) || ' ' || chr(10084) || chr(65039)), 1,
  'the emoji sequence is stored unchanged');
select is((select description from public.food_logs where id = pg_temp.rid('blank')), null, 'begin stores a blank description as null');
delete from public.food_logs where author_id = pg_temp.u(2);

-- Every range edge of the hidden class, through all three copies (begin, update, table check).
set local role authenticated;
select pg_temp.as_user(2);
select is(pg_temp.hidden_check('begin',
            array[1, 9, 11, 13, 31, 127, 128, 159, 173, 1564, 6158, 8203, 8204, 8206, 8207, 8232, 8233, 8234, 8238,
                  8288, 8292, 8294, 8297, 65279, 65529, 65531, 917504, 917631], true),
  array[]::text[], 'begin refuses every edge of the hidden class');
select is(pg_temp.hidden_check('begin', array[10, 160, 8205, 8208, 8293, 65039, 65532, 917632], false),
  array[]::text[], 'begin accepts the allowed neighbours (newline, U+00A0, U+200D, U+2010, U+2065, U+FE0F, U+FFFC, U+E0080)');
select pg_temp.as_user(1);
select is(pg_temp.hidden_check('update',
            array[1, 9, 11, 13, 31, 127, 128, 159, 173, 1564, 6158, 8203, 8204, 8206, 8207, 8232, 8233, 8234, 8238,
                  8288, 8292, 8294, 8297, 65279, 65529, 65531, 917504, 917631], true),
  array[]::text[], 'update refuses every edge of the hidden class');
select is(pg_temp.hidden_check('update', array[10, 160, 8205, 8208, 8293, 65039, 65532, 917632], false),
  array[]::text[], 'update accepts the allowed neighbours');
reset role;
select is(pg_temp.hidden_check('table',
            array[1, 9, 11, 13, 31, 127, 128, 159, 173, 1564, 6158, 8203, 8204, 8206, 8207, 8232, 8233, 8234, 8238,
                  8288, 8292, 8294, 8297, 65279, 65529, 65531, 917504, 917631], true),
  array[]::text[], 'the table check refuses every edge of the hidden class');
select is(pg_temp.hidden_check('table', array[10, 160, 8205, 8208, 8293, 65039, 65532, 917632], false),
  array[]::text[], 'the table check accepts the allowed neighbours');

-- Accepted and refused by update (owner, h1).
set local role authenticated;
select pg_temp.as_user(1);
select is(pg_temp.keys(public.update_food_log(pg_temp.rid('h1'), 'IT', 'Ate on 2026-11-14', true)),
  array['created_at', 'cuisine_code', 'description', 'id', 'is_mine', 'is_public', 'local_date', 'path'],
  'update returns exactly the eight keys');
select is((public.update_food_log(pg_temp.rid('h1'), 'IT', 'Ate on 2026-11-14', true))->>'description', 'Ate on 2026-11-14',
  'update accepts a date');
select is((public.update_food_log(pg_temp.rid('h1'), 'IT', 'call 123 456 789', true))->>'description', 'call 123 456 789',
  'update accepts a 9-digit run');
select is((public.update_food_log(pg_temp.rid('h1'), 'IT', 'ate @ noon. Great', true))->>'description', 'ate @ noon. Great',
  'update accepts an @ that is not an email (no domain after it)');
select is((public.update_food_log(pg_temp.rid('h1'), 'IT', 'mail me @ b .co later', true))->>'description', 'mail me @ b .co later',
  'update accepts a domain with a space inside (no spaces inside the domain)');
select is((public.update_food_log(pg_temp.rid('h1'), 'IT', 'table for 4 at 7:30, 12 people, order 12345 6789', true))->>'description',
  'table for 4 at 7:30, 12 people, order 12345 6789', 'update accepts short digit runs');
select is((public.update_food_log(pg_temp.rid('h1'), 'IT', chr(128104) || chr(8205) || chr(127859) || ' ' || chr(10084) || chr(65039), true))->>'description',
  chr(128104) || chr(8205) || chr(127859) || ' ' || chr(10084) || chr(65039),
  'update accepts an emoji ZWJ sequence with U+FE0F');
select is((public.update_food_log(pg_temp.rid('h1'), 'IT', 'line one' || chr(10) || 'line two', true))->>'description',
  'line one' || chr(10) || 'line two', 'update accepts a newline inside');
select is((public.update_food_log(pg_temp.rid('h1'), 'IT', chr(160) || ' trimmed ' || chr(12288) || chr(10), true))->>'description',
  'trimmed', 'update trims edge spaces, including U+00A0, U+3000 and newlines');
select is((public.update_food_log(pg_temp.rid('h1'), 'IT', chr(8232) || 'x' || chr(8233), true))->>'description',
  'x', 'a leading U+2028 and a trailing U+2029 are trimmed, not refused');
select is((public.update_food_log(pg_temp.rid('h1'), 'IT', '   ', true))->>'description', null, 'a blank description becomes null');
select is((public.update_food_log(pg_temp.rid('h1'), 'IT', '', true))->>'description', null, 'an empty description becomes null');
select is(char_length((public.update_food_log(pg_temp.rid('h1'), 'IT', repeat('y', 280), true))->>'description'), 280,
  'a 280-character description is accepted');
select throws_ok($$ select public.update_food_log(pg_temp.rid('h1'), 'IT', 'a' || chr(8238) || 'b', true) $$, 'P0001', 'invalid_text',
  'update refuses U+202E');
select throws_ok($$ select public.update_food_log(pg_temp.rid('h1'), 'IT', repeat('x', 1000) || chr(8238), true) $$, 'P0001', 'invalid_input',
  'update refuses 1001 characters before anything else');
select throws_ok($$ select public.update_food_log(pg_temp.rid('h1'), 'IT', 'a@b.co', true) $$, 'P0001', 'contact_info',
  'update refuses an email');
select throws_ok($$ select public.update_food_log(pg_temp.rid('h1'), 'IT', '123/456/7890', true) $$, 'P0001', 'contact_info',
  'update refuses a 10-digit run split by slashes');
select throws_ok($$ select public.update_food_log(pg_temp.rid('h1'), 'IT', repeat('x', 281), true) $$, 'P0001', 'invalid_input',
  'update refuses 281 characters');
select throws_ok($$ select public.update_food_log(pg_temp.rid('h1'), 'ZZ', null, true) $$, 'P0001', 'invalid_input',
  'update refuses an unknown cuisine');
select throws_ok($$ select public.update_food_log(pg_temp.rid('h1'), 'IT', null, null) $$, 'P0001', 'invalid_input',
  'update refuses a null visibility');
select throws_ok($$ select public.update_food_log(pg_temp.rid('h3'), 'IT', null, true) $$, 'P0001', 'not_found',
  'update refuses a pending log');

-- Update changes only cuisine, description and visibility.
reset role;
create temp table snap as
  select author_id, path, status, local_date, created_at from public.food_logs where id = pg_temp.rid('h1');
set local role authenticated;
select pg_temp.as_user(1);
select is((public.update_food_log(pg_temp.rid('h1'), 'JP', 'Sushi', false))->>'is_public', 'false', 'update returns the new visibility');
reset role;
select is((select row(author_id, path, status, local_date, created_at)::text from public.food_logs where id = pg_temp.rid('h1')),
          (select row(author_id, path, status, local_date, created_at)::text from snap),
  'update leaves author, path, status, local_date and created_at unchanged');
select is((select row(cuisine_code, description, is_public)::text from public.food_logs where id = pg_temp.rid('h1')),
  row('JP', 'Sushi', false)::text, 'update changes cuisine, description and visibility');

-- Public to private hides the log from others at once, and back again.
set local role authenticated;
select pg_temp.as_user(2);
select throws_ok($$ select public.get_food_log(pg_temp.rid('h1')) $$, 'P0001', 'not_found',
  'once private, another user gets not_found at once');
select pg_temp.as_user(1);
select is((public.update_food_log(pg_temp.rid('h1'), 'JP', 'Sushi', true))->>'is_public', 'true', 'the owner makes it public again');
select pg_temp.as_user(2);
select is((public.get_food_log(pg_temp.rid('h1')))->>'description', 'Sushi', 'once public again, another user reads it');
reset role;

-- The table refuses the same hidden characters on a direct superuser insert (23514).
select throws_ok($$ select pg_temp.raw_ins(1, 3, 'a' || chr(8238) || 'b') $$, '23514', null, 'the table refuses U+202E');
select throws_ok($$ select pg_temp.raw_ins(2, 3, 'a' || chr(8203) || 'b') $$, '23514', null, 'the table refuses U+200B');
select throws_ok($$ select pg_temp.raw_ins(3, 3, 'a' || chr(8294) || 'b') $$, '23514', null, 'the table refuses U+2066');
select throws_ok($$ select pg_temp.raw_ins(4, 3, 'a' || chr(173) || 'b') $$, '23514', null, 'the table refuses U+00AD');
select throws_ok($$ select pg_temp.raw_ins(5, 3, '') $$, '23514', null, 'the table refuses an empty description');
select throws_ok($$ select pg_temp.raw_ins(6, 3, repeat('x', 281)) $$, '23514', null, 'the table refuses 281 characters');
select throws_ok($$ select pg_temp.raw_ins(7, 3, null, '00000000-0000-0000-0013-000000000003/other.jpg') $$, '23514', null,
  'the table refuses a path of another shape');
select throws_ok($$ select pg_temp.raw_ins(8, 3, null, null, (now() at time zone 'UTC')::date + 3) $$, '23514', null,
  'the table refuses a local_date far from the UTC date');
select lives_ok($$ select pg_temp.raw_ins(9, 3, chr(128104) || chr(8205) || chr(127859) || ' ' || chr(10084) || chr(65039)) $$,
  'the table accepts the emoji sequence');

-- -- 6. Finish: object checks (second user 2) -------------------------------------
set local role authenticated;
select pg_temp.as_user(2);
select lives_ok($$ select pg_temp.beg('f1') $$, 'the second user reserves f1');
select throws_ok($$ select public.finish_food_log_upload(pg_temp.rid('f1')) $$, 'P0001', 'upload_missing', 'finish with no object: upload_missing');
reset role;
insert into storage.objects (bucket_id, name, metadata)
values ('business-media', pg_temp.rp('f1'), '{"mimetype":"image/jpeg","size":1000}'::jsonb);
set local role authenticated;
select pg_temp.as_user(2);
select throws_ok($$ select public.finish_food_log_upload(pg_temp.rid('f1')) $$, 'P0001', 'upload_missing',
  'finish with the object in another bucket: upload_missing');
select lives_ok($$ call pg_temp.put(pg_temp.rp('f1'), 'image/png', 1000) $$, 'the second user uploads f1 as image/png');
select throws_ok($$ select public.finish_food_log_upload(pg_temp.rid('f1')) $$, 'P0001', 'upload_missing', 'finish with image/png: upload_missing');
reset role;
update storage.objects set metadata = '{"size":1000}' where bucket_id = 'food-logs' and name = pg_temp.rp('f1');
set local role authenticated;
select pg_temp.as_user(2);
select throws_ok($$ select public.finish_food_log_upload(pg_temp.rid('f1')) $$, 'P0001', 'upload_missing', 'finish with no mimetype: upload_missing');
reset role;
update storage.objects set metadata = '{"mimetype":"image/jpeg","size":0}' where bucket_id = 'food-logs' and name = pg_temp.rp('f1');
set local role authenticated;
select pg_temp.as_user(2);
select throws_ok($$ select public.finish_food_log_upload(pg_temp.rid('f1')) $$, 'P0001', 'upload_missing', 'finish with size 0: upload_missing');
reset role;
update storage.objects set metadata = '{"mimetype":"image/jpeg"}' where bucket_id = 'food-logs' and name = pg_temp.rp('f1');
set local role authenticated;
select pg_temp.as_user(2);
select throws_ok($$ select public.finish_food_log_upload(pg_temp.rid('f1')) $$, 'P0001', 'upload_missing', 'finish with no size: upload_missing');
reset role;
update storage.objects set metadata = '{"mimetype":"image/jpeg","size":"abc"}' where bucket_id = 'food-logs' and name = pg_temp.rp('f1');
set local role authenticated;
select pg_temp.as_user(2);
select throws_ok($$ select public.finish_food_log_upload(pg_temp.rid('f1')) $$, 'P0001', 'upload_missing', 'finish with size ''abc'': upload_missing');
reset role;
update storage.objects set metadata = '{"mimetype":"image/jpeg","size":2097153}' where bucket_id = 'food-logs' and name = pg_temp.rp('f1');
set local role authenticated;
select pg_temp.as_user(2);
select throws_ok($$ select public.finish_food_log_upload(pg_temp.rid('f1')) $$, 'P0001', 'upload_missing', 'finish with 2097153 bytes: upload_missing');
reset role;
update storage.objects set metadata = '{"mimetype":"image/jpeg","size":2097152}' where bucket_id = 'food-logs' and name = pg_temp.rp('f1');
set local role authenticated;
select pg_temp.as_user(2);
select is((public.finish_food_log_upload(pg_temp.rid('f1')))->>'id', pg_temp.rid('f1')::text, 'finish with exactly 2097152 bytes works');
select lives_ok($$ select pg_temp.beg('f2') $$, 'the second user reserves f2');
select lives_ok($$ call pg_temp.put(pg_temp.rp('f2'), 'image/jpeg', 1) $$, 'the second user uploads a 1-byte JPEG');
select is((public.finish_food_log_upload(pg_temp.rid('f2')))->>'id', pg_temp.rid('f2')::text, 'finish with exactly 1 byte works');

-- -- 7. Delete, queue and orphan files (Decision 23) ---------------------------------
select pg_temp.as_user(1);
select lives_ok($$ select public.delete_food_log(pg_temp.rid('h2')) $$, 'the owner deletes their ready private log h2');
reset role;
select is((select count(*)::int from public.food_log_cleanup_queue where path = pg_temp.rp('h2') and author_id = pg_temp.u(1)), 1,
  'deleting a log queues its path');
update public.food_log_cleanup_queue set queued_at = now() - interval '11 minutes' where path = pg_temp.rp('h2');
set local role authenticated;
select pg_temp.as_user(2);
select is(pg_temp.seen(pg_temp.rp('h2')), 0, 'another user does not see the owner''s orphan file');
select is(pg_temp.del_obj(pg_temp.rp('h2')), 0, 'another user cannot delete the owner''s orphan file');
select is((select count(*)::int from public.claim_food_log_cleanup() p where p = pg_temp.rp('h2')), 0,
  'another user''s claim does not return the owner''s path');
select pg_temp.as_user(3);
select is(pg_temp.seen(pg_temp.rp('h2')), 0, 'the outsider does not see the owner''s orphan file');
select is(pg_temp.del_obj(pg_temp.rp('h2')), 0, 'the outsider cannot delete the owner''s orphan file');
select is((select count(*)::int from public.claim_food_log_cleanup() p where p = pg_temp.rp('h2')), 0,
  'the outsider''s claim does not return the owner''s path');
select is((select count(*)::int from storage.objects where bucket_id = 'food-logs' and name like pg_temp.u(1)::text || '/%'), 0,
  'the outsider still sees no file of the owner');
select pg_temp.as_user(1);
select is(pg_temp.seen(pg_temp.rp('h2')), 1, 'the owner sees their own orphan file');
select is((select count(*)::int from public.claim_food_log_cleanup() p where p = pg_temp.rp('h2')), 1,
  'the owner''s claim returns an orphan path older than 10 minutes whose file still exists');
reset role;
select is((select count(*)::int from public.food_log_cleanup_queue where path = pg_temp.rp('h2')), 1,
  'that queue row is kept while its file exists');
set local role authenticated;
select pg_temp.as_user(1);
select is(pg_temp.del_obj(pg_temp.rp('h2')), 1, 'the owner deletes their own orphan file');
select is(pg_temp.del_obj(pg_temp.rp('h3')), 0, 'the owner still cannot delete the file of a pending log');

-- -- 8. Limits (limits user 5) ---------------------------------------------------------
select pg_temp.as_user(5);
select lives_ok($$ select pg_temp.beg('l1') $$, 'pending 1 of 3');
select lives_ok($$ select pg_temp.beg('l2') $$, 'pending 2 of 3');
select lives_ok($$ select pg_temp.beg('l3') $$, 'pending 3 of 3');
select throws_ok($$ select public.begin_food_log_upload('IT', null, true, 'UTC') $$, 'P0001', 'too_many_pending',
  'a 4th pending upload gives too_many_pending');
select throws_ok($$ select public.begin_food_log_upload('ZZ', null, true, 'UTC') $$, 'P0001', 'invalid_input',
  'at the pending limit, a bad cuisine is still reported first (validation before limits)');
select throws_ok($$ select public.begin_food_log_upload('IT', 'a' || chr(8238), true, 'UTC') $$, 'P0001', 'invalid_text',
  'at the pending limit, a bad description is still reported first');
select throws_ok($$ select public.begin_food_log_upload('IT', null, true, 'Mars/Olympus') $$, 'P0001', 'too_many_pending',
  'the one exception: the zone is checked after the limits (S6)');
reset role;
select is((select count(*)::int from public.food_log_upload_starts where author_id = pg_temp.u(5)), 3,
  'refused begins record no start');
update public.food_logs set created_at = now() - interval '61 minutes' where id = pg_temp.rid('l1');
update public.food_logs set created_at = now() - interval '59 minutes' where id = pg_temp.rid('l2');
set local role authenticated;
select pg_temp.as_user(5);
select throws_ok($$ call pg_temp.put(pg_temp.rp('l1')) $$, '42501', null, 'nobody can upload to a 61-minute reservation');
select throws_ok($$ select public.finish_food_log_upload(pg_temp.rid('l1')) $$, 'P0001', 'not_found',
  'a 61-minute reservation cannot be finished');
select lives_ok($$ select pg_temp.beg('l4') $$, 'the next begin expires the 61-minute reservation and succeeds');
reset role;
select is((select count(*)::int from public.food_logs where id = pg_temp.rid('l1')), 0, 'the 61-minute reservation is deleted');
select is((select count(*)::int from public.food_log_cleanup_queue where path = pg_temp.rp('l1')), 1,
  'the 61-minute reservation''s path is queued');
set local role authenticated;
select pg_temp.as_user(5);
select throws_ok($$ select public.begin_food_log_upload('IT', null, true, 'UTC') $$, 'P0001', 'too_many_pending',
  'a 59-minute reservation still counts');
select lives_ok($$ call pg_temp.put(pg_temp.rp('l2')) $$, 'a 59-minute reservation can still be uploaded to');
select lives_ok($$ select public.finish_food_log_upload(pg_temp.rid('l2')) $$, 'a 59-minute reservation can still be finished');

select lives_ok($$ select public.delete_food_log(pg_temp.rid('l3')), public.delete_food_log(pg_temp.rid('l4')) $$,
  'pending logs can be deleted by their author');
select is(pg_temp.churn(16), 16, 'sixteen more begins (each deleted) bring the starts to 20');
reset role;
select is((select count(*)::int from public.food_log_upload_starts where author_id = pg_temp.u(5)), 20, 'twenty starts are recorded');
set local role authenticated;
select pg_temp.as_user(5);
select throws_ok($$ select public.begin_food_log_upload('IT', null, true, 'UTC') $$, 'P0001', 'daily_limit',
  'the 21st start in 24 hours gives daily_limit');
select throws_ok($$ select public.begin_food_log_upload('IT', 'a' || chr(8238), true, 'UTC') $$, 'P0001', 'invalid_text',
  'at the daily limit, a bad description is still reported first');
select throws_ok($$ select public.begin_food_log_upload('IT', null, true, 'Mars/Olympus') $$, 'P0001', 'daily_limit',
  'at the daily limit, an invalid zone gets daily_limit (zone after limits)');
select lives_ok($$ select public.delete_food_log(pg_temp.rid('l2')) $$, 'the user deletes a ready log');
select throws_ok($$ select public.begin_food_log_upload('IT', null, true, 'UTC') $$, 'P0001', 'daily_limit',
  'deleting a log gives no start back');
reset role;
update public.food_log_upload_starts set started_at = now() - interval '23 hours 59 minutes'
 where ctid = (select ctid from public.food_log_upload_starts where author_id = pg_temp.u(5) order by started_at limit 1);
set local role authenticated;
select pg_temp.as_user(5);
select throws_ok($$ select public.begin_food_log_upload('IT', null, true, 'UTC') $$, 'P0001', 'daily_limit',
  'a start 23 hours 59 minutes old still counts');
reset role;
update public.food_log_upload_starts set started_at = now() - interval '24 hours'
 where ctid = (select ctid from public.food_log_upload_starts where author_id = pg_temp.u(5) order by started_at limit 1);
set local role authenticated;
select pg_temp.as_user(5);
select lives_ok($$ select pg_temp.beg('l6') $$, 'a start exactly 24 hours old stops counting');
reset role;
select is((select count(*)::int from public.food_log_upload_starts
            where author_id = pg_temp.u(5) and started_at <= now() - interval '24 hours'), 0,
  'begin deletes starts 24 hours old or older');
set local role authenticated;
select pg_temp.as_user(5);
select throws_ok($$ select public.begin_food_log_upload('IT', null, true, 'UTC') $$, 'P0001', 'daily_limit',
  'the limit applies again at 20 starts in the window');

-- -- 9. End-to-end cleanup: 20 deleted logs leave 20 orphan files -----------------------
reset role;
call pg_temp.wipe(5);
set local role authenticated;
select pg_temp.as_user(5);
select is(pg_temp.cycle(20), 20, 'twenty uploads are finished and then deleted');
reset role;
select is((select count(*)::int from public.food_log_cleanup_queue q
            where q.author_id = pg_temp.u(5)
              and exists (select 1 from storage.objects o where o.bucket_id = 'food-logs' and o.name = q.path)), 20,
  'twenty queued paths whose files are still in storage');
set local role authenticated;
select pg_temp.as_user(5);
select throws_ok($$ select public.begin_food_log_upload('IT', null, true, 'UTC') $$, 'P0001', 'cleanup_required',
  'begin gives cleanup_required at 20 orphan files (checked before the daily limit)');
reset role;
create temp table queued5 as select path from public.food_log_cleanup_queue where author_id = pg_temp.u(5);
grant select on queued5 to authenticated;
set local role authenticated;
select pg_temp.as_user(5);
select is((select array_agg(p order by p) from public.claim_food_log_cleanup() p),
          (select array_agg(path order by path) from queued5),
  'claim returns exactly the twenty queued paths');
select is(pg_temp.remove_claimed(), 20, 'the owner removes the twenty claimed files');
select is((select count(*)::int from public.claim_food_log_cleanup()), 0, 'a second claim returns nothing');
select throws_ok($$ select public.begin_food_log_upload('IT', null, true, 'UTC') $$, 'P0001', 'daily_limit',
  'after the cleanup, begin is past cleanup_required (now only the daily limit of the same day)');
reset role;
update public.food_log_upload_starts set started_at = now() - interval '25 hours' where author_id = pg_temp.u(5);
select is((select count(*)::int from public.food_log_cleanup_queue where author_id = pg_temp.u(5)), 20,
  'queue rows younger than 10 minutes stay after their files are gone');
set local role authenticated;
select pg_temp.as_user(5);
select lives_ok($$ select pg_temp.beg('e1') $$, 'a day later, begin works again');
reset role;
update public.food_log_cleanup_queue set queued_at = now() - interval '11 minutes' where author_id = pg_temp.u(5);
set local role authenticated;
select pg_temp.as_user(5);
select is((select count(*)::int from public.claim_food_log_cleanup()), 0, 'claim returns nothing once the files are gone');
reset role;
select is((select count(*)::int from public.food_log_cleanup_queue where author_id = pg_temp.u(5)), 0,
  'claim drops queue rows older than 10 minutes whose file is gone');

-- 19 vs 20 orphan files (queued rows without a file never count), and cleanup before pending.
call pg_temp.wipe(5);
call pg_temp.orphans(5, 1, 19, true);
call pg_temp.orphans(5, 101, 105, false);
set local role authenticated;
select pg_temp.as_user(5);
select lives_ok($$ select pg_temp.beg('c19') $$, '19 orphan files (and 5 queued rows without files) still allow begin');
select lives_ok($$ select pg_temp.beg('c19b'), pg_temp.beg('c19c') $$, 'the user now has 3 pending uploads');
reset role;
call pg_temp.orphans(5, 20, 20, true);
set local role authenticated;
select pg_temp.as_user(5);
select throws_ok($$ select public.begin_food_log_upload('IT', null, true, 'UTC') $$, 'P0001', 'cleanup_required',
  '20 orphan files give cleanup_required, reported before too_many_pending');

-- -- 10. Paging (paging user 6): 123 ready rows, 120 sharing one created_at ------------------
reset role;
insert into public.food_logs (id, author_id, cuisine_code, local_date, path, status, created_at)
select v.id, pg_temp.u(6), 'IT', (v.at at time zone 'UTC')::date, pg_temp.u(6)::text || '/' || v.id::text || '.jpg', 'ready', v.at
  from (select ('00000000-0000-0000-0613-' || lpad(n::text, 12, '0'))::uuid as id,
               case when n <= 120 then now() - interval '1 day' else now() - (124 - n) * interval '1 hour' end as at
          from generate_series(1, 123) n) v;
insert into public.food_logs (id, author_id, cuisine_code, local_date, path, status)
values ('00000000-0000-0000-0613-000000000999', pg_temp.u(6), 'IT', (now() at time zone 'UTC')::date,
        pg_temp.u(6)::text || '/00000000-0000-0000-0613-000000000999.jpg', 'pending');
set local role authenticated;
select pg_temp.as_user(6);
insert into res (k, j) values ('walk', pg_temp.walk());
select is((select j->'sizes' from res where k = 'walk'), '[50, 50, 23]'::jsonb, 'pages of 50, 50 and 23, with no empty last page');
select ok((select j->>'first_cursor' from res where k = 'walk')
            ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z\|[0-9a-f-]{36}$',
  'the cursor is "<UTC microsecond time>|<uuid>"');
select is((select j->>'last_cursor' from res where k = 'walk'), null, 'the last page has no next cursor');
select is(pg_temp.keys((public.list_my_food_logs())->'items'->0),
  array['created_at', 'cuisine_code', 'description', 'id', 'is_mine', 'is_public', 'local_date', 'path'],
  'list items have exactly the eight keys');
select throws_ok($$ select public.list_my_food_logs('garbage') $$, 'P0001', 'invalid_input', 'a malformed cursor gives invalid_input');
select throws_ok($$ select public.list_my_food_logs('2026-11-14T00:00:00.000000Z|not-a-uuid') $$, 'P0001', 'invalid_input',
  'a cursor with a bad id gives invalid_input');
select throws_ok($$ select public.list_my_food_logs('2026-13-45T00:00:00.000000Z|00000000-0000-0000-0613-000000000001') $$,
  'P0001', 'invalid_input', 'a cursor with an impossible date gives invalid_input');
reset role;
select is((select count(distinct id)::int from walked), 123, 'paging returns 123 distinct logs (no repeat)');
select is((select array_agg(id order by ord) from walked),
          (select array_agg(id order by created_at desc, id desc) from public.food_logs
            where author_id = pg_temp.u(6) and status = 'ready'),
  'paging returns every ready log of the caller, newest first, no skip');
select is((select count(*)::int from walked where id = '00000000-0000-0000-0613-000000000999'), 0, 'paging never lists a pending log');

-- Exactly 100, then exactly 50 rows (all sharing one created_at).
delete from public.food_logs where author_id = pg_temp.u(6) and status = 'ready'
   and id > '00000000-0000-0000-0613-000000000100';
set local role authenticated;
select pg_temp.as_user(6);
insert into res (k, j) values ('walk100', pg_temp.walk());
select is((select j->'sizes' from res where k = 'walk100'), '[50, 50]'::jsonb, 'exactly 100 rows: two pages of 50, no empty third');
select is((select j->>'last_cursor' from res where k = 'walk100'), null, 'exactly 100 rows: no cursor after the second page');
reset role;
select is((select count(distinct id)::int from walked), 100, 'exactly 100 rows: 100 distinct logs');
delete from public.food_logs where author_id = pg_temp.u(6) and status = 'ready'
   and id > '00000000-0000-0000-0613-000000000050';
set local role authenticated;
select pg_temp.as_user(6);
insert into res (k, j) values ('walk50', pg_temp.walk());
select is((select j->'sizes' from res where k = 'walk50'), '[50]'::jsonb, 'exactly 50 rows: one page');
select is((select j->>'first_cursor' from res where k = 'walk50'), null, 'exactly 50 rows: no next cursor');

-- -- 11. Account deletion (user 7) -----------------------------------------------------
select pg_temp.as_user(7);
select lives_ok($$ select pg_temp.beg('d1') $$, 'user 7 has a pending log');
select lives_ok($$ select pg_temp.beg('d2') $$, 'user 7 reserves a second log');
select lives_ok($$ call pg_temp.put(pg_temp.rp('d2')) $$, 'user 7 uploads it');
select lives_ok($$ select public.finish_food_log_upload(pg_temp.rid('d2')) $$, 'and finishes it');
reset role;
delete from auth.users where id = pg_temp.u(7);
select is((select array_agg(path order by path) from public.food_log_cleanup_queue where author_id = pg_temp.u(7)),
          (select array_agg(p order by p) from unnest(array[pg_temp.rp('d1'), pg_temp.rp('d2')]) p),
  'deleting the account queues every path, pending and ready');
select is((select count(*)::int from public.food_logs where author_id = pg_temp.u(7)), 0, 'the account''s logs are gone');
select is((select count(*)::int from public.food_log_upload_starts where author_id = pg_temp.u(7)), 0, 'the account''s starts are gone');

select * from finish();
rollback;
