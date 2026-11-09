import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef } from 'react';

import { cancelPickupRequest, type RequestAppError } from '../api';
import { markSeenAt } from '../statusMemory';
import type { PickupRequest } from '../schema';

import { requestKeys } from './keys';
import { useUserId } from './useUserId';

/**
 * Cancels a pending request. Both the list and the detail are re-read afterwards. `cancelRequest`
 * ignores a second call while one is running, so a double tap sends one cancel.
 */
export function useCancelPickupRequest() {
  const queryClient = useQueryClient();
  const userId = useUserId();
  const inFlight = useRef(false);
  const mutation = useMutation<PickupRequest, RequestAppError, string>({
    mutationFn: (requestId) => cancelPickupRequest(requestId),
    // The person's own cancel is not news (Decision 18): remember it as seen BEFORE the list is
    // re-read in onSettled, so the Requests badge never rises for it.
    onSuccess: (_request, requestId) => {
      if (userId) markSeenAt(userId, requestId, 'cancelled');
    },
    // Also after a failure: the request may have expired or changed, and the server knows.
    onSettled: async (_data, _error, requestId) => {
      inFlight.current = false;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: requestKeys.mine }),
        queryClient.invalidateQueries({ queryKey: requestKeys.detail(requestId) }),
      ]);
    },
  });

  const { mutate } = mutation;
  const cancelRequest = useCallback(
    (requestId: string, options?: Parameters<typeof mutate>[1]) => {
      if (inFlight.current) return;
      inFlight.current = true;
      mutate(requestId, options);
    },
    [mutate],
  );

  return { ...mutation, cancelRequest };
}
