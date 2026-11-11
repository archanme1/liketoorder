-- Spec 11c: requests filters. Both request lists take one status filter, applied on the server
-- inside each per-kind branch together with the keyset, so paging (50 a page, the
-- "<created_at>|<id>" text cursor, 51 rows read to know a next page exists) still skips, repeats
-- and pads nothing under any filter. The cursor does not depend on the filter.
--
-- p_status (both functions, case-sensitive):
--   null       every row (All)
--   'pending'  status pending and expires_at after the server clock ('waiting' is an alias kept
--              for the app on main)
--   'accepted' accepted, completed and no_show
--   'declined' declined only
--   anything else (including the old 'expired', 'cancelled', 'completed', 'no_show'): invalid_input
-- Cancelled, expired and pending-past-expiry rows match only All.
--
-- Bodies are copied from 20261110012046_table_requests.sql; only the parameter, the status
-- mapping and validation, the status predicate and the grants differ. No table, column, policy or
-- index changes.

-- -- list_my_requests: (p_before) becomes (p_before, p_status) --------------------------------
-- p_before stays first, so a positional call list_my_requests(cursor) keeps working. Exactly one
-- overload remains.
drop function public.list_my_requests(text);

create function public.list_my_requests(p_before text default null, p_status text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := auth.uid();
  v_now    timestamptz := now();
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
     and v_status not in ('pending', 'accepted', 'declined') then
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
                  and (v_status is null
                       or (v_status = 'pending' and x.status = 'pending' and x.expires_at > v_now)
                       or (v_status = 'accepted' and x.status in ('accepted', 'completed', 'no_show'))
                       or (v_status = 'declined' and x.status = 'declined'))
                order by x.created_at desc, x.id desc
                limit 51)
              union all
              (select x.id, 'table'::text as kind, x.created_at
                 from public.table_requests x
                where x.customer_id = v_uid
                  and (v_at is null or (x.created_at, x.id) < (v_at, v_cid))
                  and (v_status is null
                       or (v_status = 'pending' and x.status = 'pending' and x.expires_at > v_now)
                       or (v_status = 'accepted' and x.status in ('accepted', 'completed', 'no_show'))
                       or (v_status = 'declined' and x.status = 'declined'))
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
revoke execute on function public.list_my_requests(text, text) from public, anon, authenticated;
grant execute on function public.list_my_requests(text, text) to authenticated;

-- -- list_business_requests: same signature, new filter contract -----------------------------
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
     and v_status not in ('pending', 'accepted', 'declined') then
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
                       or (v_status = 'accepted' and x.status in ('accepted', 'completed', 'no_show'))
                       or (v_status = 'declined' and x.status = 'declined'))
                order by x.created_at desc, x.id desc
                limit 51)
              union all
              (select x.id, 'table'::text as kind, x.created_at
                 from public.table_requests x
                where x.business_id = v_biz
                  and (v_at is null or (x.created_at, x.id) < (v_at, v_cid))
                  and (v_status is null
                       or (v_status = 'pending' and x.status = 'pending' and x.expires_at > v_now)
                       or (v_status = 'accepted' and x.status in ('accepted', 'completed', 'no_show'))
                       or (v_status = 'declined' and x.status = 'declined'))
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
