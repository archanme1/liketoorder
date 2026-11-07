import { useMutation, useQueryClient } from '@tanstack/react-query';

import { cancelPickupRequest, type RequestAppError } from '../api';
import type { PickupRequest } from '../schema';

import { requestKeys } from './keys';

/** Cancels a pending request. Both the list and the detail are re-read afterwards. */
export function useCancelPickupRequest() {
  const queryClient = useQueryClient();
  return useMutation<PickupRequest, RequestAppError, string>({
    mutationFn: (requestId) => cancelPickupRequest(requestId),
    // Also after a failure: the request may have expired or changed, and the server knows.
    onSettled: async (_data, _error, requestId) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: requestKeys.mine }),
        queryClient.invalidateQueries({ queryKey: requestKeys.detail(requestId) }),
      ]);
    },
  });
}
