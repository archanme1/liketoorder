import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef } from 'react';

import { cancelPickupRequest, type RequestAppError } from '../api';
import type { PickupRequest } from '../schema';

import { requestKeys } from './keys';

/**
 * Cancels a pending request. Both the list and the detail are re-read afterwards. `cancelRequest`
 * ignores a second call while one is running, so a double tap sends one cancel.
 */
export function useCancelPickupRequest() {
  const queryClient = useQueryClient();
  const inFlight = useRef(false);
  const mutation = useMutation<PickupRequest, RequestAppError, string>({
    mutationFn: (requestId) => cancelPickupRequest(requestId),
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
