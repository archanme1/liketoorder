import type { SupabaseClient } from '@supabase/supabase-js';

export type QuotaKind = 'autocomplete' | 'resolve';

// True while the user is within the per-minute and per-day limits for this kind.
export type ConsumeQuota = (userId: string, kind: QuotaKind) => Promise<boolean>;

// `admin` must be the service-role client: consume_places_quota is not executable by app users.
// An RPC error throws, so the request fails closed (500) instead of skipping the limit.
export function createConsumeQuota(admin: SupabaseClient): ConsumeQuota {
  return async (userId, kind) => {
    const { data, error } = await admin.rpc('consume_places_quota', {
      p_user_id: userId,
      p_kind: kind,
    });
    if (error) throw new Error('quota_unavailable');
    return data === true;
  };
}
