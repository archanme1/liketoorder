import { useQuery } from '@tanstack/react-query';

import { countWaitingRequests, type RequestAppError } from '../api';
import type { WaitingCount } from '../schema';

import { PENDING_POLL_MS, requestKeys } from './keys';

/** How many requests wait for the seller's answer. Re-read every 30 s: nothing pushes it until spec 12. */
export function useWaitingCount(options: { enabled?: boolean } = {}) {
  return useQuery<WaitingCount, RequestAppError>({
    queryKey: requestKeys.waitingCount,
    queryFn: countWaitingRequests,
    staleTime: 0,
    refetchInterval: PENDING_POLL_MS,
    enabled: options.enabled ?? true,
  });
}
