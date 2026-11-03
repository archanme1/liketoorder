import { useQuery } from '@tanstack/react-query';

import { useSession } from '@/features/auth/hooks/useSession';

import { getMyBusiness, type SellerAppError } from '../api';
import type { MyBusiness } from '../schema';

export const myBusinessKey = ['business', 'me'] as const;

/** The signed-in user's own business, or null. Disabled for guests and mid-recovery. */
export function useMyBusiness() {
  const { session, isRecovering } = useSession();
  return useQuery<MyBusiness | null, SellerAppError>({
    queryKey: myBusinessKey,
    queryFn: getMyBusiness,
    enabled: session !== null && !isRecovering,
  });
}
