-- Spec 14: activity grid (PR 1, database only).
--
-- Two read-only security-definer functions over spec 13's food_logs. No new table, no new column,
-- no change to food_logs or to any spec 13 function (Decision 7). food_logs keeps RLS on with no
-- policies and no client grants, so these functions are the only new surface.
--
-- A day is the stored local_date (the author's local day at upload, set by the server in spec 13),
-- never the date of created_at. The server works out every count, every streak and "today"; the
-- phone sends only its time-zone name. The caller is always auth.uid(); neither function takes a
-- user id. Private uploads count on the owner's own grid (Decision 4). A grid for another person
-- does not exist in v1; a later spec that adds one gets its own function and counts is_public rows
-- only.
--
-- The start of the year is make_date(<year of today>, 1, 1), not date_trunc('year', ...): on a date,
-- date_trunc goes through timestamptz in the session time zone, while make_date is pure date
-- arithmetic. The 14 pgTAP file pins this with a source check.

-- -- Functions ----------------------------------------------------------------
-- The caller's activity for the last p_weeks weeks (Sunday to Saturday) ending in the week of the
-- server's today in p_time_zone, plus four stats. Cheap input checks first, then the zone, which
-- reads the whole pg_timezone_names list on every call (accepted, Decision 7).
-- Error codes: invalid_input, invalid_time_zone.
create function public.get_my_food_log_activity(p_time_zone text, p_weeks integer) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid        uuid := auth.uid();
  v_today      date;
  v_from       date;
  v_year_start date;
  v_days       jsonb;
  v_total      integer;
  v_current    integer;
  v_longest    integer;
  v_cuisines   integer;
begin
  if p_weeks is null or p_weeks < 1 or p_weeks > 53 then raise exception 'invalid_input'; end if;
  if p_time_zone is null
     or not exists (select 1 from pg_catalog.pg_timezone_names where name = p_time_zone) then
    raise exception 'invalid_time_zone';
  end if;

  v_today      := (now() at time zone p_time_zone)::date;
  v_from       := v_today - extract(dow from v_today)::int - 7 * (p_weeks - 1);   -- a Sunday; at most 371 days
  v_year_start := make_date(extract(year from v_today)::int, 1, 1);

  if v_uid is null then
    return jsonb_build_object(
      'today', v_today, 'from', v_from, 'days', '[]'::jsonb,
      'stats', jsonb_build_object('total_this_year', 0, 'current_streak', 0,
                                  'longest_streak', 0, 'cuisines_tried', 0));
  end if;

  -- d: one row per date with a ready upload, up to today (a later local_date, logged in a zone
  -- ahead, counts nowhere until its day comes). At most one row per day of the account's life,
  -- read through food_logs_author_date_idx. islands: runs of consecutive dates (gaps and islands).
  with d as (
    select l.local_date, count(*)::int as n
      from public.food_logs l
     where l.author_id = v_uid and l.status = 'ready' and l.local_date <= v_today
     group by l.local_date
  ), islands as (
    select max(g.local_date) as last_date, count(*)::int as len
      from (select d.local_date, d.local_date - (row_number() over (order by d.local_date))::int as grp
              from d) g
     group by g.grp
  )
  select coalesce((select jsonb_agg(jsonb_build_object('date', d.local_date, 'count', d.n) order by d.local_date)
                     from d where d.local_date >= v_from), '[]'::jsonb),
         coalesce((select sum(d.n)::int from d where d.local_date >= v_year_start), 0),
         -- The run ending today, or ending yesterday when today has none yet; otherwise 0.
         coalesce((select i.len from islands i where i.last_date = v_today),
                  (select i.len from islands i where i.last_date = v_today - 1), 0),
         coalesce((select max(i.len) from islands i), 0)
    into v_days, v_total, v_current, v_longest;

  -- Every code counts once, the neutral ones included.
  select count(distinct l.cuisine_code)::int into v_cuisines
    from public.food_logs l
   where l.author_id = v_uid and l.status = 'ready' and l.local_date <= v_today;

  return jsonb_build_object(
    'today', v_today, 'from', v_from, 'days', v_days,
    'stats', jsonb_build_object('total_this_year', v_total, 'current_streak', v_current,
                                'longest_streak', v_longest, 'cuisines_tried', v_cuisines));
end $$;
revoke execute on function public.get_my_food_log_activity(text, integer) from public, anon, authenticated;
grant execute on function public.get_my_food_log_activity(text, integer) to authenticated;

-- The caller's ready logs on one local date, oldest first, as spec 13's 8-key log object (the same
-- literal as list_my_food_logs; path is always the caller's own). Bounded, no cursor (Decision 13).
-- The date picks a day to show; it never decides "today" or a count.
create function public.list_my_food_logs_on(p_date date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
begin
  if p_date is null then raise exception 'invalid_input'; end if;
  if v_uid is null then
    return jsonb_build_object('items', '[]'::jsonb);
  end if;

  return jsonb_build_object(
    'items', coalesce((select jsonb_agg(jsonb_build_object(
                                 'id', l.id, 'cuisine_code', l.cuisine_code, 'description', l.description,
                                 'is_public', l.is_public, 'local_date', l.local_date,
                                 'created_at', l.created_at, 'path', l.path, 'is_mine', true)
                               order by l.created_at, l.id)
                         from (select f.id, f.cuisine_code, f.description, f.is_public, f.local_date,
                                      f.created_at, f.path
                                 from public.food_logs f
                                where f.author_id = v_uid and f.status = 'ready' and f.local_date = p_date
                                order by f.created_at, f.id
                                -- A local_date is within the UTC date +/-1 of created_at (food_logs_local_date_near), so one date's uploads all started within 72 hours, and begin_food_log_upload allows 20 starts per rolling 24 hours: at most 60. If that cap or that check changes, change this limit.
                                limit 60) l), '[]'::jsonb));
end $$;
revoke execute on function public.list_my_food_logs_on(date) from public, anon, authenticated;
grant execute on function public.list_my_food_logs_on(date) to authenticated;
