import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef } from 'react';

import { respondToRequest, type RequestAppError } from '../api';
import type { RequestKind } from '../kind';
import type { BusinessRequest, RespondOptions, SellerDecision, WaitingCount } from '../schema';

import { invalidateSellerRequests, writeAnswer } from './invalidateSellerRequests';
import { requestKeys } from './keys';

type Variables = { requestId: string; decision: SellerDecision; answer?: RespondOptions };

/**
 * Accepts or declines a pending request of this kind (a pickup unless told otherwise). `respond` ignores a second call while one is running, so a
 * double tap sends one decision. After ANY outcome (also not_found / invalid_transition) the inbox,
 * the request and the waiting count are re-read, so the screen shows the real current status.
 */
export function useRespondToRequest(kind: RequestKind = 'pickup') {
  const queryClient = useQueryClient();
  const inFlight = useRef(false);
  const mutation = useMutation<BusinessRequest, RequestAppError, Variables>({
    // The third argument is passed only when there is something to send, so a plain accept is the
    // same two-argument call as before spec 10b.
    mutationFn: ({ requestId, decision, answer }) =>
      kind === 'table'
        ? respondToRequest(requestId, decision, answer ?? {}, kind)
        : answer
          ? respondToRequest(requestId, decision, answer)
          : respondToRequest(requestId, decision),
    onSuccess: (request, { requestId }) => {
      writeAnswer(queryClient, requestId, request);
      // The Requests tab number drops at once; the refetch after this settles it for good.
      queryClient.setQueryData<WaitingCount>(requestKeys.waitingCount, (old) =>
        old ? { ...old, waiting: Math.max(0, old.waiting - 1) } : old,
      );
    },
    onSettled: async (_data, _error, { requestId }) => {
      inFlight.current = false;
      await invalidateSellerRequests(queryClient, requestId);
    },
  });

  const { mutate, reset } = mutation;
  const respond = useCallback(
    (
      requestId: string,
      decision: SellerDecision,
      answer?: RespondOptions,
      options?: Parameters<typeof mutate>[1],
    ) => {
      if (inFlight.current) return;
      inFlight.current = true;
      // After the guard: a second tap must not detach the mutation that is still running.
      reset();
      mutate({ requestId, decision, answer }, options);
    },
    [mutate, reset],
  );

  return { ...mutation, respond };
}
