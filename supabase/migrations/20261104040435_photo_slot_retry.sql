-- Spec 06 review fix (A1): a failed cover or item upload can be retried at once.
-- A new reservation for the cover, or for one item's photo, replaces any pending reservation for
-- the same slot instead of raising photo_limit. The deleted row's trigger queues its path, so a
-- file that was already uploaded there is cleaned up by claim_photo_cleanup(). Gallery and menu
-- pending rows still count toward their limits: the app deletes a failed one with
-- delete_business_photo(), and the 1-hour expiry is the backstop.

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
-- Re-asserted after the replace.
revoke execute on function public.begin_photo_upload(text, uuid) from public, anon, authenticated;
grant execute on function public.begin_photo_upload(text, uuid) to authenticated;
