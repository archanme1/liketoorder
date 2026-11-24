-- Spec 16b PR 3 (D15): the promotion price leaves the app's data.
-- private.promotion_json (used by get_my_promotion, request_promotion, cancel_my_promotion and
-- admin_review_promotion) and the settings object of get_my_promotion no longer carry price_cents or
-- currency_code. Every other key, the signatures and the grants are unchanged. The columns stay:
-- approve_headline, begin_promotion_invoice, record_stripe_event, the runbook and the seed read them.
-- No table, constraint, index or row is touched.

-- The seller's view of one campaign, with the derived state: no price, invoice id, link, Stripe id
-- or receipt (spec 16b D15).
create or replace function private.promotion_json(p_promotion_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
           'id', p.id,
           'category', p.category,
           'headline', p.headline,
           'preferred_start', p.preferred_start,
           'state', case p.status
                      when 'approved' then case when now() < p.starts_at then 'scheduled'
                                                when now() < p.ends_at then 'active'
                                                else 'ended' end
                      when 'payment_due' then case when now() < p.pay_by then 'awaiting_payment'
                                                   else 'payment_expired' end
                      else p.status end,
           'starts_at', p.starts_at,
           'ends_at', p.ends_at,
           'reject_reason', p.reject_reason,
           'length_days', p.length_days,
           'paid', p.paid_at is not null,
           'is_free', p.is_free,
           'created_at', p.created_at)
    from public.promotions p
   where p.id = p_promotion_id;
$$;
revoke execute on function private.promotion_json(uuid) from public, anon, authenticated, service_role;

-- get_my_promotion: the caller's latest campaign (or null), the campaign length from the settings
-- (or null) and whether the business may ask for one now. No price (spec 16b D15).
create or replace function public.get_my_promotion() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_business  uuid;
  v_latest    uuid;
begin
  select b.id into v_business from public.businesses b where b.owner_id = auth.uid();

  if v_business is not null then
    select p.id into v_latest
      from public.promotions p
     where p.business_id = v_business
     order by p.created_at desc, p.id desc
     limit 1;
  end if;

  return jsonb_build_object(
    'promotion', case when v_latest is null then null else private.promotion_json(v_latest) end,
    'settings', (select jsonb_build_object('length_days', s.length_days)
                   from public.promotion_settings s),
    'eligible', v_business is not null and private.business_can_promote(v_business));
end $$;
revoke execute on function public.get_my_promotion() from public, anon, authenticated;
grant execute on function public.get_my_promotion() to authenticated;

comment on function public.get_my_promotion() is
  'The caller''s latest promotion with its derived state, the campaign length and eligibility; no price (spec 16, 16b D15).';
