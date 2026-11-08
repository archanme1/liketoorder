import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { getMyPickupAddress, type RequestAppError } from '../api';
import type { PickupAddress, PickupRequest } from '../schema';

import { requestKeys } from './keys';

/** Only an accepted or completed HOMEMADE request can show its cook's exact address. */
export function canShowAddress(
  request: Pick<PickupRequest, 'business_type' | 'display_status'> | null | undefined,
): boolean {
  return (
    request?.business_type === 'homemade' &&
    (request.display_status === 'accepted' || request.display_status === 'completed')
  );
}

/**
 * Removes the cached address whenever the request is not accepted/completed homemade. Mounted by
 * the detail screen itself (not only by the address card), so the address is dropped even when the
 * card has just unmounted because the status changed.
 */
export function useAddressCacheGuard(id: string, request: PickupRequest | null | undefined) {
  const queryClient = useQueryClient();
  const allowed = canShowAddress(request);
  useEffect(() => {
    if (request && !allowed) queryClient.removeQueries({ queryKey: requestKeys.address(id) });
  }, [allowed, request, id, queryClient]);
}

/**
 * The exact address for a request. The query is off for every other status, and the answer is
 * dropped from the cache the moment the card unmounts (`gcTime: 0`), so a home address is never
 * kept in memory for later. The screen that shows the card also mounts `useAddressCacheGuard`
 * (once), which removes it if the request leaves accepted/completed while the screen is open.
 */
export function usePickupAddress(id: string, request: PickupRequest | null | undefined) {
  const allowed = canShowAddress(request);

  return useQuery<PickupAddress | null, RequestAppError>({
    queryKey: requestKeys.address(id),
    queryFn: () => getMyPickupAddress(id),
    enabled: allowed,
    staleTime: 0,
    gcTime: 0,
  });
}
