-- Spec 13: food log uploads (PR 1, database and storage only).
--
-- A personal food log: one photo, a required cuisine, an optional description, public or private.
-- Every read and write goes through the security-definer functions below; the three tables have
-- no client grants and no policies (Decision 10). The photo is reserved -> uploaded -> finished as
-- in spec 06, into the private food-logs bucket, at a server-made path <author_id>/<log_id>.jpg.
--
-- The hidden-character class (Decision 2) is written three times (table check, begin, update)
-- because a shared helper would be a fourth function in `private`, which spec 13 fixes at three.
-- Keep the three copies identical. It allows U+200D and U+FE0F (emoji) and refuses ASCII controls
-- except newline, DEL and C1, U+00AD, U+061C, U+180E, U+200B, U+200C, U+200E, U+200F, U+2028,
-- U+2029, U+202A-U+202E, U+2060-U+2064, U+2066-U+2069, U+FEFF, U+FFF9-U+FFFB and the tag block
-- U+E0000-U+E007F. ASCII only: every code point is an escape.

-- -- Tables -------------------------------------------------------------------
create table public.food_logs (
  id            uuid primary key default gen_random_uuid(),
  author_id     uuid not null references public.profiles(id) on delete cascade,
  cuisine_code  text not null references public.cuisines(code) on update restrict on delete restrict,
  description   text,             -- null or 1..280 chars, trimmed by the functions
  is_public     boolean not null default true,
  local_date    date not null,    -- the author's local date at upload, set by the server (Decision 4)
  path          text not null unique,
  status        text not null default 'pending' check (status in ('pending', 'ready')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint food_logs_path_shape check (path = author_id::text || '/' || id::text || '.jpg'),
  constraint food_logs_description_len check (description is null or char_length(description) between 1 and 280),
  constraint food_logs_description_text check (description is null or description !~
    '[\x00-\x09\x0B-\x1F\u007F-\u009F\u00AD\u061C\u180E\u200B\u200C\u200E\u200F\u2028\u2029\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF\uFFF9-\uFFFB\U000E0000-\U000E007F]'),
  constraint food_logs_local_date_near check (local_date between (created_at at time zone 'UTC')::date - 1
                                                         and (created_at at time zone 'UTC')::date + 1)
);
create trigger food_logs_set_updated_at before update on public.food_logs
  for each row execute function public.set_updated_at();
create index food_logs_author_list_idx on public.food_logs (author_id, created_at desc, id desc) where status = 'ready';
create index food_logs_author_date_idx on public.food_logs (author_id, local_date);   -- spec 14's grid
create index food_logs_author_pending_idx on public.food_logs (author_id, created_at) where status = 'pending';

-- Started uploads in a rolling 24 hours (Decision 9): deleting a log never gives one back.
create table public.food_log_upload_starts (
  author_id   uuid not null references public.profiles(id) on delete cascade,
  started_at  timestamptz not null default now()
);
create index food_log_upload_starts_idx on public.food_log_upload_starts (author_id, started_at);

-- Files whose row is gone (Decision 8; spec 06's queue needs a business_id, so it can't be reused).
create table public.food_log_cleanup_queue (
  path       text primary key,
  author_id  uuid not null,            -- no FK: rows must outlive a deleted account
  queued_at  timestamptz not null default now()
);

-- Every deleted log queues its file in the same transaction, including the profiles cascade from
-- account deletion.
create function public.food_logs_queue_cleanup() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.food_log_cleanup_queue (path, author_id)
  values (old.path, old.author_id)
  on conflict (path) do nothing;
  return old;
end $$;
create trigger food_logs_queue_cleanup after delete on public.food_logs
  for each row execute function public.food_logs_queue_cleanup();
revoke execute on function public.food_logs_queue_cleanup() from public, anon, authenticated;

-- -- RLS and grants -----------------------------------------------------------
-- No grants and no policies: only the functions below touch these tables.
alter table public.food_logs enable row level security;
alter table public.food_log_upload_starts enable row level security;
alter table public.food_log_cleanup_queue enable row level security;

revoke all on public.food_logs from anon, authenticated;
revoke all on public.food_log_upload_starts from anon, authenticated;
revoke all on public.food_log_cleanup_queue from anon, authenticated;

-- -- Private helpers (storage policies) ---------------------------------------
-- A fresh (< 1 hour) pending reservation of this exact path, made by the caller.
create function private.food_log_upload_allowed(p_path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.food_logs l
                  where l.path = p_path
                    and l.status = 'pending'
                    and l.created_at > now() - interval '1 hour'
                    and l.author_id = (select auth.uid()));
$$;

-- A ready log that is the caller's own or public. The select policy adds the caller's own folder
-- (Decisions 22, 23).
create function private.food_log_is_readable(p_path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.food_logs l
                  where l.path = p_path
                    and l.status = 'ready'
                    and (l.author_id = (select auth.uid()) or l.is_public));
$$;

-- Any row (pending or ready) still points at this path: the file must not be deleted.
create function private.food_log_is_live(p_path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.food_logs l where l.path = p_path);
$$;

revoke execute on function private.food_log_upload_allowed(text) from public;
revoke execute on function private.food_log_is_readable(text) from public;
revoke execute on function private.food_log_is_live(text) from public;
grant execute on function private.food_log_upload_allowed(text) to authenticated;
grant execute on function private.food_log_is_readable(text) to authenticated;
grant execute on function private.food_log_is_live(text) to authenticated;

-- -- Functions ----------------------------------------------------------------
-- The author is always auth.uid(); no function takes a user id, a time or a date. An id that is
-- missing, someone else's (writes) or someone else's private one (reads) gives the same not_found.
-- Error codes: profile_incomplete, invalid_input, invalid_text, contact_info, invalid_time_zone,
-- too_many_pending, daily_limit, cleanup_required, not_found, upload_missing.

-- Reserves a server-made path. Validation first, then (under a per-user lock) expiry and limits.
create function public.begin_food_log_upload(
  p_cuisine_code text,
  p_description text,
  p_is_public boolean,
  p_time_zone text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := auth.uid();
  v_id     uuid := gen_random_uuid();
  v_desc   text;
  v_path   text;
  c_hidden constant text := '[\x00-\x09\x0B-\x1F\u007F-\u009F\u00AD\u061C\u180E\u200B\u200C\u200E\u200F\u2028\u2029\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF\uFFF9-\uFFFB\U000E0000-\U000E007F]';
  c_edge   constant text := '^[ \n\u00A0\u115F\u1160\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\u3164\uFFA0]+|[ \n\u00A0\u115F\u1160\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\u3164\uFFA0]+$';
begin
  -- 1. Validate.
  if v_uid is null
     or not exists (select 1 from public.profiles where id = v_uid and username is not null) then
    raise exception 'profile_incomplete';
  end if;
  if p_cuisine_code is null
     or not exists (select 1 from public.cuisines where code = p_cuisine_code) then
    raise exception 'invalid_input';
  end if;
  if p_is_public is null then raise exception 'invalid_input'; end if;
  if p_time_zone is null
     or not exists (select 1 from pg_catalog.pg_timezone_names where name = p_time_zone) then
    raise exception 'invalid_time_zone';
  end if;

  v_desc := nullif(regexp_replace(p_description, c_edge, '', 'g'), '');
  if v_desc ~ c_hidden then raise exception 'invalid_text'; end if;
  if char_length(v_desc) > 280 then raise exception 'invalid_input'; end if;
  -- Decision 11: an email, or 10+ digits once spaces, dots, dashes and brackets are ignored.
  if v_desc ~* '[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}'
     or regexp_replace(v_desc, '[][ .()-]', '', 'g') ~ '[0-9]{10,}' then
    raise exception 'contact_info';
  end if;

  -- 2. One begin at a time per person, so the counts below can't be raced.
  perform pg_advisory_xact_lock(hashtextextended('food_log:' || v_uid::text, 0));

  -- 3. Expired reservations stop counting (the trigger queues their paths); old starts drop out.
  delete from public.food_logs
   where author_id = v_uid and status = 'pending' and created_at <= now() - interval '1 hour';
  delete from public.food_log_upload_starts
   where author_id = v_uid and started_at <= now() - interval '24 hours';

  -- 4. Files whose row is gone but which are still in storage: the app must run the cleanup first.
  if (select count(*) from public.food_log_cleanup_queue q
       where q.author_id = v_uid
         and exists (select 1 from storage.objects o
                      where o.bucket_id = 'food-logs' and o.name = q.path)) >= 20 then
    raise exception 'cleanup_required';
  end if;

  -- 5, 6. Limits (Decision 9).
  if (select count(*) from public.food_logs where author_id = v_uid and status = 'pending') >= 3 then
    raise exception 'too_many_pending';
  end if;
  if (select count(*) from public.food_log_upload_starts where author_id = v_uid) >= 20 then
    raise exception 'daily_limit';
  end if;

  -- 7, 8. The local date comes from the server clock in the caller's zone; the table check bounds it.
  insert into public.food_log_upload_starts (author_id) values (v_uid);
  v_path := v_uid::text || '/' || v_id::text || '.jpg';
  insert into public.food_logs (id, author_id, cuisine_code, description, is_public, local_date, path)
  values (v_id, v_uid, p_cuisine_code, v_desc, p_is_public,
          (now() at time zone p_time_zone)::date, v_path);

  return jsonb_build_object('id', v_id, 'path', v_path);
end $$;
revoke execute on function public.begin_food_log_upload(text, text, boolean, text) from public, anon, authenticated;
grant execute on function public.begin_food_log_upload(text, text, boolean, text) to authenticated;

-- Marks a fresh reservation ready only once its object exists as a JPEG of 1 byte to 2 MB, so a
-- row never points at a missing file.
create function public.finish_food_log_upload(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  l     public.food_logs;
begin
  if v_uid is null then raise exception 'not_found'; end if;

  select * into l from public.food_logs
   where id = p_id and author_id = v_uid and status = 'pending'
     and created_at > now() - interval '1 hour'
   for update;
  if not found then raise exception 'not_found'; end if;

  if not exists (
    select 1 from storage.objects o
     where o.bucket_id = 'food-logs'
       and o.name = l.path
       and o.metadata->>'mimetype' = 'image/jpeg'
       and case when o.metadata->>'size' ~ '^[0-9]{1,12}$'
                then (o.metadata->>'size')::bigint between 1 and 2097152
                else false end
  ) then
    raise exception 'upload_missing';
  end if;

  update public.food_logs set status = 'ready' where id = l.id
  returning * into l;

  return jsonb_build_object('id', l.id, 'cuisine_code', l.cuisine_code, 'description', l.description,
                            'is_public', l.is_public, 'local_date', l.local_date,
                            'created_at', l.created_at, 'path', l.path, 'is_mine', true);
end $$;
revoke execute on function public.finish_food_log_upload(uuid) from public, anon, authenticated;
grant execute on function public.finish_food_log_upload(uuid) to authenticated;

-- Changes only cuisine, description and visibility of the caller's ready log.
create function public.update_food_log(
  p_id uuid,
  p_cuisine_code text,
  p_description text,
  p_is_public boolean
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := auth.uid();
  v_desc   text;
  l        public.food_logs;
  c_hidden constant text := '[\x00-\x09\x0B-\x1F\u007F-\u009F\u00AD\u061C\u180E\u200B\u200C\u200E\u200F\u2028\u2029\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF\uFFF9-\uFFFB\U000E0000-\U000E007F]';
  c_edge   constant text := '^[ \n\u00A0\u115F\u1160\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\u3164\uFFA0]+|[ \n\u00A0\u115F\u1160\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\u3164\uFFA0]+$';
begin
  if p_cuisine_code is null
     or not exists (select 1 from public.cuisines where code = p_cuisine_code) then
    raise exception 'invalid_input';
  end if;
  if p_is_public is null then raise exception 'invalid_input'; end if;

  v_desc := nullif(regexp_replace(p_description, c_edge, '', 'g'), '');
  if v_desc ~ c_hidden then raise exception 'invalid_text'; end if;
  if char_length(v_desc) > 280 then raise exception 'invalid_input'; end if;
  if v_desc ~* '[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}'
     or regexp_replace(v_desc, '[][ .()-]', '', 'g') ~ '[0-9]{10,}' then
    raise exception 'contact_info';
  end if;

  if v_uid is null then raise exception 'not_found'; end if;

  update public.food_logs
     set cuisine_code = p_cuisine_code, description = v_desc, is_public = p_is_public
   where id = p_id and author_id = v_uid and status = 'ready'
  returning * into l;
  if not found then raise exception 'not_found'; end if;

  return jsonb_build_object('id', l.id, 'cuisine_code', l.cuisine_code, 'description', l.description,
                            'is_public', l.is_public, 'local_date', l.local_date,
                            'created_at', l.created_at, 'path', l.path, 'is_mine', true);
end $$;
revoke execute on function public.update_food_log(uuid, text, text, boolean) from public, anon, authenticated;
grant execute on function public.update_food_log(uuid, text, text, boolean) to authenticated;

-- Deletes the caller's log, pending or ready; the trigger queues the file.
create function public.delete_food_log(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_found'; end if;

  delete from public.food_logs where id = p_id and author_id = v_uid;
  if not found then raise exception 'not_found'; end if;
end $$;
revoke execute on function public.delete_food_log(uuid) from public, anon, authenticated;
grant execute on function public.delete_food_log(uuid) to authenticated;

-- A ready log that is the caller's own or public.
create function public.get_food_log(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  l     public.food_logs;
begin
  if v_uid is null then raise exception 'not_found'; end if;

  select * into l from public.food_logs
   where id = p_id and status = 'ready' and (author_id = v_uid or is_public);
  if not found then raise exception 'not_found'; end if;

  return jsonb_build_object('id', l.id, 'cuisine_code', l.cuisine_code, 'description', l.description,
                            'is_public', l.is_public, 'local_date', l.local_date,
                            'created_at', l.created_at, 'path', l.path, 'is_mine', l.author_id = v_uid);
end $$;
revoke execute on function public.get_food_log(uuid) from public, anon, authenticated;
grant execute on function public.get_food_log(uuid) to authenticated;

-- The caller's ready logs, newest first, 50 a page. Same "<created_at>|<id>" cursor as
-- list_my_requests: 51 rows are read to know whether a next page exists.
create function public.list_my_food_logs(p_before text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid    uuid := auth.uid();
  v_at     timestamptz;
  v_cid    uuid;
  v_ids    uuid[];
  v_ats    timestamptz[];
  v_next   text;
  c_cursor constant text := '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z\|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  if p_before is not null then
    if p_before !~ c_cursor then raise exception 'invalid_input'; end if;
    begin
      v_at  := split_part(p_before, '|', 1)::timestamptz;
      v_cid := split_part(p_before, '|', 2)::uuid;
    exception when others then
      raise exception 'invalid_input';
    end;
  end if;
  if v_uid is null then
    return jsonb_build_object('items', '[]'::jsonb, 'next_cursor', null);
  end if;

  select array_agg(m.id order by m.created_at desc, m.id desc),
         array_agg(m.created_at order by m.created_at desc, m.id desc)
    into v_ids, v_ats
    from (select l.id, l.created_at
            from public.food_logs l
           where l.author_id = v_uid and l.status = 'ready'
             and (v_at is null or (l.created_at, l.id) < (v_at, v_cid))
           order by l.created_at desc, l.id desc
           limit 51) m;

  if coalesce(cardinality(v_ids), 0) > 50 then
    v_ids := v_ids[1:50];
    v_next := to_char(v_ats[50] at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') || '|' || v_ids[50]::text;
  end if;

  return jsonb_build_object(
    'items', coalesce((select jsonb_agg(jsonb_build_object(
                                 'id', l.id, 'cuisine_code', l.cuisine_code, 'description', l.description,
                                 'is_public', l.is_public, 'local_date', l.local_date,
                                 'created_at', l.created_at, 'path', l.path, 'is_mine', true)
                               order by u.ord)
                         from unnest(coalesce(v_ids, array[]::uuid[])) with ordinality as u(id, ord)
                         join public.food_logs l on l.id = u.id), '[]'::jsonb),
    'next_cursor', v_next);
end $$;
revoke execute on function public.list_my_food_logs(text) from public, anon, authenticated;
grant execute on function public.list_my_food_logs(text) to authenticated;

-- The app removes the returned paths through the Storage API, then calls again. Rows are dropped
-- only when older than 10 minutes (a younger one may have an upload in flight) and the object is
-- gone, so a file is never marked removed on the client's word.
create function public.claim_food_log_cleanup() returns setof text
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then return; end if;

  delete from public.food_log_cleanup_queue q
   where q.author_id = v_uid
     and q.queued_at < now() - interval '10 minutes'
     and not exists (select 1 from storage.objects o
                      where o.bucket_id = 'food-logs' and o.name = q.path);

  return query
    select q.path from public.food_log_cleanup_queue q
     where q.author_id = v_uid
       and exists (select 1 from storage.objects o
                    where o.bucket_id = 'food-logs' and o.name = q.path)
     order by q.queued_at, q.path;
end $$;
revoke execute on function public.claim_food_log_cleanup() from public, anon, authenticated;
grant execute on function public.claim_food_log_cleanup() to authenticated;

-- -- Storage: private food-logs bucket ----------------------------------------
-- Private, JPEG only, 2 MB; read through 1-hour signed URLs (Decisions 5, 10).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('food-logs', 'food-logs', false, 2097152, array['image/jpeg']);

-- Only at a path reserved by a fresh pending row of the caller.
create policy food_logs_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'food-logs' and (select private.food_log_upload_allowed(name)));

-- Everything in the caller's own folder, and ready public files. No anon policy. The folder clause
-- is needed twice over: Postgres applies select policies to an insert with RETURNING (the owner's
-- upload of a pending reservation, Decision 22) and to a delete with a WHERE clause (the owner's
-- cleanup of files whose row is gone, Decision 23); a delete policy alone is not enough.
create policy food_logs_select on storage.objects for select to authenticated
  using (bucket_id = 'food-logs'
         and ((storage.foldername(name))[1] = (select auth.uid())::text
              or (select private.food_log_is_readable(name))));

-- Only files in the caller's folder whose row is gone. Text-to-text folder comparison, so a
-- malformed name never errors; it just doesn't match (fails closed).
create policy food_logs_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'food-logs'
         and (storage.foldername(name))[1] = (select auth.uid())::text
         and not (select private.food_log_is_live(name)));

-- No update policy: files are never overwritten (upsert false).
