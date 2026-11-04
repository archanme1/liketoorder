-- Spec 06 PR 1 code review fixes (Decisions 25–27).
--
-- 25. begin_photo_upload raises cleanup_required while the business has 20 or more queued files
--     that still exist in storage. Before this, a client that never ran the cleanup could keep
--     reserving (a cover retry, or delete_business_photo + a new reservation) and leave a 2 MB file
--     behind on each cycle. The first migration's comment on begin_photo_upload ("every stored
--     object is capped by these row limits") was wrong for that reason. Objects are capped by the
--     row limits plus at most 19 queued files that are still present (see the comment on the
--     function below).
-- 26. claim_photo_cleanup drops a queue row only when it is older than 10 minutes and its object is
--     gone. A younger row may belong to an upload still in flight (the insert policy passed before
--     the row was deleted); dropping it early would leave a file in neither table. It returns only
--     paths whose object exists.
-- 27. create_menu_item / update_menu_item store the trimmed description (blank → null), instead of
--     raising 23514 for leading or trailing spaces.
--
-- The repeated "lock the caller's business" prologue and the UUID regex in the storage policies are
-- kept inline on purpose: a shared helper would be a sixth function in `private`, and spec 06 allows
-- exactly five.

create or replace function public.begin_photo_upload(p_kind text, p_menu_item_id uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b      public.businesses;
  v_id   uuid := gen_random_uuid();
  v_path text;
begin
  select * into b from public.businesses where owner_id = (select auth.uid()) for update;
  if not found then raise exception 'no_business'; end if;

  if p_kind is null or p_kind not in ('cover', 'gallery', 'menu', 'item') then
    raise exception 'invalid_input';
  end if;
  if (p_kind = 'item') <> (p_menu_item_id is not null) then
    raise exception 'invalid_input';
  end if;
  if p_kind = 'item'
     and not exists (select 1 from public.menu_items where id = p_menu_item_id and business_id = b.id) then
    raise exception 'invalid_input';
  end if;

  -- Expired reservations stop counting; the trigger queues their paths for cleanup.
  delete from public.business_photos
   where business_id = b.id and status = 'pending' and created_at <= now() - interval '1 hour';

  -- Files whose row is gone but which are still in storage: the app must run the cleanup first.
  if (select count(*) from public.storage_cleanup_queue q
       where q.business_id = b.id
         and exists (select 1 from storage.objects o
                      where o.bucket_id = 'business-media' and o.name = q.path)) >= 20 then
    raise exception 'cleanup_required';
  end if;

  -- Cover and item: one slot each. A new reservation replaces the pending one (retry); the ready
  -- photo is replaced only on finish.
  if p_kind = 'cover' then
    delete from public.business_photos
     where business_id = b.id and kind = 'cover' and status = 'pending';
  elsif p_kind = 'item' then
    delete from public.business_photos
     where menu_item_id = p_menu_item_id and kind = 'item' and status = 'pending';
  elsif (p_kind = 'gallery'
           and (select count(*) from public.business_photos
                 where business_id = b.id and kind = 'gallery') >= 6)
        or (p_kind = 'menu'
           and (select count(*) from public.business_photos
                 where business_id = b.id and kind = 'menu') >= 10) then
    raise exception 'photo_limit';
  end if;

  v_path := b.id::text || '/' || v_id::text || '.jpg';
  insert into public.business_photos (id, business_id, kind, menu_item_id, path)
  values (v_id, b.id, p_kind, p_menu_item_id, v_path);

  return jsonb_build_object('photo_id', v_id, 'path', v_path);
end $$;
comment on function public.begin_photo_upload(text, uuid) is
  'Reserves a server-made path. Stored objects per business are capped by the photo-row limits plus '
  'fewer than 20 queued files still present (cleanup_required), not by the row limits alone.';
revoke execute on function public.begin_photo_upload(text, uuid) from public, anon, authenticated;
grant execute on function public.begin_photo_upload(text, uuid) to authenticated;

create or replace function public.claim_photo_cleanup() returns setof text
language plpgsql security definer set search_path = '' as $$
declare
  b public.businesses;
begin
  select * into b from public.businesses where owner_id = (select auth.uid()) for update;
  if not found then raise exception 'no_business'; end if;

  -- Only rows older than 10 minutes: a younger one may still have an upload in flight.
  delete from public.storage_cleanup_queue q
   where q.business_id = b.id
     and q.queued_at < now() - interval '10 minutes'
     and not exists (select 1 from storage.objects o
                      where o.bucket_id = 'business-media' and o.name = q.path);

  return query
    select q.path from public.storage_cleanup_queue q
     where q.business_id = b.id
       and exists (select 1 from storage.objects o
                    where o.bucket_id = 'business-media' and o.name = q.path)
     order by q.queued_at, q.path;
end $$;
revoke execute on function public.claim_photo_cleanup() from public, anon, authenticated;
grant execute on function public.claim_photo_cleanup() to authenticated;

create or replace function public.create_menu_item(
  p_name text,
  p_description text,
  p_price_minor integer,
  p_is_available boolean default true
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  b    public.businesses;
  v_id uuid;
begin
  select * into b from public.businesses where owner_id = (select auth.uid()) for update;
  if not found then raise exception 'no_business'; end if;

  if (select count(*) from public.menu_items where business_id = b.id) >= 100 then
    raise exception 'item_limit';
  end if;
  if p_price_minor is not null and b.currency_code is null then
    raise exception 'currency_required';
  end if;

  insert into public.menu_items (business_id, name, description, price_minor, is_available, position)
  values (b.id, p_name, nullif(btrim(p_description), ''),
          p_price_minor, coalesce(p_is_available, true),
          coalesce((select max(position) from public.menu_items where business_id = b.id), 0) + 1)
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.create_menu_item(text, text, integer, boolean) from public, anon, authenticated;
grant execute on function public.create_menu_item(text, text, integer, boolean) to authenticated;

create or replace function public.update_menu_item(
  p_item_id uuid,
  p_name text,
  p_description text,
  p_price_minor integer,
  p_is_available boolean
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  b public.businesses;
begin
  select * into b from public.businesses where owner_id = (select auth.uid()) for update;
  if not found then raise exception 'no_business'; end if;

  if not exists (select 1 from public.menu_items where id = p_item_id and business_id = b.id) then
    raise exception 'not_found';
  end if;
  if p_price_minor is not null and b.currency_code is null then
    raise exception 'currency_required';
  end if;

  update public.menu_items
     set name = p_name,
         description = nullif(btrim(p_description), ''),
         price_minor = p_price_minor,
         is_available = coalesce(p_is_available, true)
   where id = p_item_id and business_id = b.id;
end $$;
revoke execute on function public.update_menu_item(uuid, text, text, integer, boolean) from public, anon, authenticated;
grant execute on function public.update_menu_item(uuid, text, text, integer, boolean) to authenticated;
