-- Spec 15: activity grid cuisine view (PR 1, database only).
--
-- One read-only security-definer function over spec 13's food_logs. No new table, no new column,
-- no change to food_logs, to any spec 13 function or to spec 14's get_my_food_log_activity and
-- list_my_food_logs_on (Decision 1): the activity function's key sets stay as spec 14 pinned them.
-- food_logs keeps RLS on with no policies and no client grants, so this function is the only new
-- surface.
--
-- A day is the stored local_date, never the date of created_at. The server works out "today" and
-- the range exactly as get_my_food_log_activity does; the phone sends only its time-zone name. The
-- caller is always auth.uid(); the function takes no user id. Private uploads count on the owner's
-- own grid. A grid for another person does not exist in v1.

-- -- Functions ----------------------------------------------------------------
-- The caller's cuisine per day for the last p_weeks weeks (Sunday to Saturday) ending in the week
-- of the server's today in p_time_zone. Each day with a ready upload gives its upload count, its
-- number of distinct cuisine codes and, when that number is 1, the code. A neutral code counts like
-- any other (Decision 2): street-food plus IT is 2 cuisines. No stats; they stay in the activity
-- function. Checks in the activity function's order: weeks, then the zone, which reads the whole
-- pg_timezone_names list on every call (accepted, spec 14 Decision 7).
-- The range is two comparisons, not between, so each end reads on its own. The scan reads only
-- the caller's ready rows in the window through food_logs_author_date_idx (at most 371 days of at
-- most 20 starts a day), plus a heap read for cuisine_code.
-- Error codes: invalid_input, invalid_time_zone.
create function public.get_my_food_log_cuisine_days(p_time_zone text, p_weeks integer) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid   uuid := auth.uid();
  v_today date;
  v_from  date;
begin
  if p_weeks is null or p_weeks < 1 or p_weeks > 53 then raise exception 'invalid_input'; end if;
  if p_time_zone is null
     or not exists (select 1 from pg_catalog.pg_timezone_names where name = p_time_zone) then
    raise exception 'invalid_time_zone';
  end if;

  v_today := (now() at time zone p_time_zone)::date;
  v_from  := v_today - extract(dow from v_today)::int - 7 * (p_weeks - 1);   -- a Sunday; at most 371 days

  if v_uid is null then
    return jsonb_build_object('today', v_today, 'from', v_from, 'days', '[]'::jsonb);
  end if;

  -- cuisine_code is not null (spec 13), so min() is the one code whenever c = 1. jsonb_build_object
  -- keeps the cuisine key, as JSON null, on a day of two or more cuisines.
  return jsonb_build_object(
    'today', v_today, 'from', v_from,
    'days', coalesce((select jsonb_agg(jsonb_build_object('date', d.local_date, 'count', d.n,
                                                          'cuisines', d.c,
                                                          'cuisine', case when d.c = 1 then d.code end)
                                       order by d.local_date)
                        from (select l.local_date, count(*)::int as n,
                                     count(distinct l.cuisine_code)::int as c, min(l.cuisine_code) as code
                                from public.food_logs l
                               where l.author_id = v_uid and l.status = 'ready'
                                 and l.local_date >= v_from and l.local_date <= v_today
                               group by l.local_date) d), '[]'::jsonb));
end $$;
revoke execute on function public.get_my_food_log_cuisine_days(text, integer) from public, anon, authenticated;
grant execute on function public.get_my_food_log_cuisine_days(text, integer) to authenticated;
