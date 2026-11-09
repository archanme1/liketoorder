-- Spec 10b (PR 1, backend): why a request was declined, and an optional note on an answer.
-- Both columns are written only by respond_to_request. pickup_requests keeps RLS on with no policy
-- and no grant, so the new columns have no client access either: they reach the app only through
-- the request objects built by private.pickup_request_json. No existing migration is edited.

-- -- Columns and table checks --------------------------------------------------
-- response_note holds the optional note on an accept, and the written reason when decline_reason is
-- 'other'. The hidden-character class is the same as note and order_text (spec 09): ASCII controls
-- except newline, DEL, C1 controls, zero-width, bidi overrides and isolates.
alter table public.pickup_requests
  add column decline_reason text
    check (decline_reason is null or decline_reason in
      ('sold_out', 'closed_then', 'too_busy', 'cannot_prepare', 'time_not_possible', 'other')),
  add column response_note text
    check (char_length(response_note) between 1 and 200 and response_note = btrim(response_note)
           and response_note !~ '[\x00-\x09\x0B-\x1F\u007F-\u009F\u200B-\u200D\u202A-\u202E\u2066-\u2069\uFEFF]');

-- A reason only on a declined row.
alter table public.pickup_requests
  add constraint pickup_requests_reason_on_declined
    check (decline_reason is null or status = 'declined');
-- A note only on an answered row.
alter table public.pickup_requests
  add constraint pickup_requests_note_on_answered
    check (response_note is null or status in ('accepted', 'declined', 'completed', 'no_show'));
-- 'other' always carries its written text.
alter table public.pickup_requests
  add constraint pickup_requests_other_has_note
    check (decline_reason is distinct from 'other' or response_note is not null);
-- A declined row with a note must be an 'other' decline, so a fixed reason never carries a note
-- (Decision 15). Together with the reason-on-declined check this covers every case. IS NOT DISTINCT
-- FROM matters: with a null reason, "= 'other'" is NULL and a CHECK that is NULL passes.
alter table public.pickup_requests
  add constraint pickup_requests_declined_note_is_other
    check (status <> 'declined' or response_note is null or decline_reason is not distinct from 'other');

-- Rows declined before this migration have no reason, and there is deliberately NO table check that a
-- declined row has one: it would reject those rows' fixtures and seeds, and a cut-off time written into
-- the schema breaks restored data. The rule is kept by respond_to_request, the only writer: it refuses
-- a decline without a reason. The request object shows decline_reason null for an old declined row.

-- -- Request object (the two new keys) -----------------------------------------
-- Customer view: the 13 spec 09 keys plus decline_reason and response_note (15).
-- Seller view: the customer keys plus customer_name and responded_at (17).
-- Never contains accepted_address, place_id, coordinates, the customer's id or email.
-- submit / list / get / cancel and the seller list / get call this helper by name, so they
-- need no re-creation.
create or replace function private.pickup_request_json(p_request_id uuid, p_now timestamptz, p_seller_view boolean)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select o.j || case when p_seller_view
                     then jsonb_build_object('customer_name', coalesce(p.display_name, p.username),
                                             'responded_at', r.responded_at)
                     else '{}'::jsonb end
    from public.pickup_requests r
    join public.businesses bz on bz.id = r.business_id
    left join public.profiles p on p.id = r.customer_id
   cross join lateral (
     select jsonb_build_object(
              'id', r.id, 'business_id', r.business_id, 'business_name', bz.name, 'business_type', bz.type,
              'status', r.status,
              'display_status', case when r.status = 'pending' and r.expires_at <= p_now then 'expired' else r.status end,
              'pickup_at', r.pickup_at, 'items', r.items, 'order_text', r.order_text, 'note', r.note,
              'currency_code', r.currency_code, 'expires_at', r.expires_at, 'created_at', r.created_at,
              'decline_reason', r.decline_reason, 'response_note', r.response_note) as j) o
   where r.id = p_request_id;
$$;
revoke execute on function private.pickup_request_json(uuid, timestamptz, boolean)
  from public, anon, authenticated, service_role;

-- -- respond_to_request (four arguments; the two-argument form is dropped) -----
-- Adding parameters with create or replace would leave two overloads, so the old one goes first.
-- An old app build that sends two arguments still accepts; its decline gets decline_reason_required.
-- Everything is validated before any row is read, so an error says nothing about the row.
-- Error codes: not_signed_in, invalid_input, invalid_text, decline_reason_required, not_found
-- (identical for unknown and someone else's), invalid_transition.
drop function public.respond_to_request(uuid, text);

create function public.respond_to_request(
  p_request_id uuid,
  p_decision text,
  p_decline_reason text default null,
  p_note text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := auth.uid();
  v_now    timestamptz := now();
  v_b      record;
  v_r      public.pickup_requests;
  v_reason text;
  v_note   text;
  c_ctrl   constant text := '[\x00-\x09\x0B-\x1F\u007F-\u009F\u200B-\u200D\u202A-\u202E\u2066-\u2069\uFEFF]';
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;
  if p_decision is null or p_decision not in ('accepted', 'declined') then raise exception 'invalid_input'; end if;

  v_note := nullif(btrim(p_note, E' \n'), '');

  if p_decision = 'accepted' then
    if p_decline_reason is not null then raise exception 'invalid_input'; end if;
    if char_length(v_note) > 200 or v_note ~ c_ctrl then raise exception 'invalid_text'; end if;
  else
    v_reason := nullif(btrim(p_decline_reason, E' \n'), '');
    if v_reason is null then raise exception 'decline_reason_required'; end if;
    if p_decline_reason not in ('sold_out', 'closed_then', 'too_busy', 'cannot_prepare', 'time_not_possible', 'other') then
      raise exception 'invalid_input';
    end if;
    if p_decline_reason = 'other' then
      if v_note is null then raise exception 'decline_reason_required'; end if;
      if char_length(v_note) > 200 or v_note ~ c_ctrl then raise exception 'invalid_text'; end if;
    elsif v_note is not null then
      raise exception 'invalid_input';      -- a fixed reason carries no note
    end if;
  end if;

  select b.id, b.type into v_b from public.businesses b where b.owner_id = v_uid;
  if not found then raise exception 'not_found'; end if;

  select r.* into v_r
    from public.pickup_requests r
   where r.id = p_request_id and r.business_id = v_b.id
     for update;
  if not found then raise exception 'not_found'; end if;

  if v_r.status <> 'pending' or v_r.expires_at <= v_now then
    raise exception 'invalid_transition';
  end if;

  update public.pickup_requests
     set status = p_decision,
         responded_at = v_now,
         decline_reason = case when p_decision = 'declined' then p_decline_reason end,
         response_note = v_note,
         accepted_address = case when p_decision = 'accepted' and v_b.type = 'homemade'
                                 then (select l.formatted_address from public.business_locations l
                                        where l.business_id = v_b.id) end
   where id = v_r.id;

  return private.pickup_request_json(v_r.id, v_now, true);
end $$;
revoke execute on function public.respond_to_request(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.respond_to_request(uuid, text, text, text) to authenticated;
