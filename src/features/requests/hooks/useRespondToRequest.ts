import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef } from 'react';

import { respondToRequest, type RequestAppError } from '../api';
import type { SellerDecision, SellerRequest } from '../schema';

import { invalidateSellerRequests, writeAnswer } from './invalidateSellerRequests';

type Variables = { requestId: string; decision: SellerDecision };

/**
 * Accepts or declines a pending request. `respond` ignores a second call while one is running, so a
 * double tap sends one decision. After ANY outcome (also not_found / invalid_transition) the inbox,
 * the request and the waiting count are re-read, so the screen shows the real current status.
 */
export function useRespondToRequest() {
  const queryClient = useQueryClient();
  const inFlight = useRef(false);
  const mutation = useMutation<SellerRequest, RequestAppError, Variables>({
    mutationFn: ({ requestId, decision }) => respondToRequest(requestId, decision),
    onSuccess: (request, { requestId }) => writeAnswer(queryClient, requestId, request),
    onSettled: async (_data, _error, { requestId }) => {
      inFlight.current = false;
      await invalidateSellerRequests(queryClient, requestId);
    },
  });

  const { mutate, reset } = mutation;
  const respond = useCallback(
    (requestId: string, decision: SellerDecision, options?: Parameters<typeof mutate>[1]) => {
      if (inFlight.current) return;
      inFlight.current = true;
      // After the guard: a second tap must not detach the mutation that is still running.
      reset();
      mutate({ requestId, decision }, options);
    },
    [mutate, reset],
  );

  return { ...mutation, respond };
}
