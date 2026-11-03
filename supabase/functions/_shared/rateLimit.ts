import type { SupabaseClient } from '@supabase/supabase-js';
import { errorResponse } from './http.ts';

export type QuotaKind = 'autocomplete' | 'resolve';

// 'ok' while the user is eligible and within the per-minute and per-day limits for this kind.
// Ineligible users are refused before anything is counted (Decision 19).
export type QuotaResult = 'ok' | 'rate_limited' | 'profile_incomplete' | 'no_business';

export type ConsumeQuota = (userId: string, kind: QuotaKind) => Promise<QuotaResult>;

const REFUSALS = ['profile_incomplete', 'no_business'] as const;

// `admin` must be the service-role client: consume_places_quota is not executable by app users.
// Any other RPC error throws, so the request fails closed (500) instead of skipping the limit.
export function createConsumeQuota(admin: SupabaseClient): ConsumeQuota {
  return async (userId, kind) => {
    const { data, error } = await admin.rpc('consume_places_quota', {
      p_user_id: userId,
      p_kind: kind,
    });
    if (error) {
      const refusal = REFUSALS.find((code) => error.message === code);
      if (refusal) return refusal;
      throw new Error('quota_unavailable');
    }
    return data === true ? 'ok' : 'rate_limited';
  };
}

// The response for a refused quota call.
export function quotaRefusal(result: Exclude<QuotaResult, 'ok'>): Response {
  switch (result) {
    case 'rate_limited':
      return errorResponse(429, 'rate_limited');
    case 'profile_incomplete':
      return errorResponse(403, 'profile_incomplete');
    case 'no_business':
      return errorResponse(404, 'no_business');
  }
}
