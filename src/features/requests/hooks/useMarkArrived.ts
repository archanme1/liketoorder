import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef } from 'react';

import { markArrived, type RequestAppError } from '../api';
import type { TableRequest } from '../schema';

import { requestKeys } from './keys';

/**
 * "I've arrived", once. `markArrived` ignores a second call while one is running, so a double tap
 * sends one. After ANY outcome (also already_arrived, arrival_window, invalid_transition, not_found)
 * everything the answer touches is re-read, so the screen shows what the server really has: the
 * Sent list (and the badge made from it), this request, and the restaurant's inbox, request and
 * waiting count when the same person owns both sides.
 */
export function useMarkArrived() {
  const queryClient = useQueryClient();
  const inFlight = useRef(false);
  const mutation = useMutation<TableRequest, RequestAppError, string>({
    mutationFn: (requestId) => markArrived(requestId),
    onSettled: async (_data, _error, requestId) => {
      inFlight.current = false;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: requestKeys.mine }),
        queryClient.invalidateQueries({ queryKey: requestKeys.detail(requestId) }),
        queryClient.invalidateQueries({ queryKey: requestKeys.inboxAll }),
        queryClient.invalidateQueries({ queryKey: requestKeys.businessDetail(requestId) }),
        queryClient.invalidateQueries({ queryKey: requestKeys.waitingCount }),
      ]);
    },
  });

  const { mutate, reset } = mutation;
  const arrived = useCallback(
    (requestId: string) => {
      if (inFlight.current) return;
      inFlight.current = true;
      // After the guard: a second tap must not detach the mutation that is still running.
      reset();
      mutate(requestId);
    },
    [mutate, reset],
  );

  return { ...mutation, arrived };
}
