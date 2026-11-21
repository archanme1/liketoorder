import { useQuery } from '@tanstack/react-query';

import { useSession } from '@/features/auth/hooks/useSession';

import { fetchMyPromotion, type PromotionAppError } from '../api';
import type { MyPromotion } from '../schema';

// One key per signed-in user: sign-out clears the whole cache (AuthProvider), so another account's
// campaign is never shown from it.
export const myPromotionKey = ['promotion', 'me'] as const;

/** The seller's own latest campaign, the settings and eligibility. Disabled for guests and mid-recovery. */
export function useMyPromotion() {
  const { session, isRecovering } = useSession();
  return useQuery<MyPromotion, PromotionAppError>({
    queryKey: myPromotionKey,
    queryFn: fetchMyPromotion,
    enabled: session !== null && !isRecovering,
  });
}
