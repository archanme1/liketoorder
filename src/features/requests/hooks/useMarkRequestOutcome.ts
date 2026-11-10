import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef } from 'react';

import { markRequestOutcome, type RequestAppError } from '../api';
import type { RequestKind } from '../kind';
import type { BusinessRequest, SellerOutcome } from '../schema';

import { invalidateSellerRequests, writeAnswer } from './invalidateSellerRequests';

type Variables = { requestId: string; outcome: SellerOutcome };

/**
 * Marks an accepted request completed or no-show (the server checks the pickup time has passed).
 * `markOutcome` ignores a second call while one is running. Every outcome re-reads the inbox, the
 * request and the waiting count.
 */
export function useMarkRequestOutcome(kind: RequestKind = 'pickup') {
  const queryClient = useQueryClient();
  const inFlight = useRef(false);
  const mutation = useMutation<BusinessRequest, RequestAppError, Variables>({
    // A pickup call stays exactly what it was before spec 11 (no kind; the server defaults to pickup).
    mutationFn: ({ requestId, outcome }) =>
      kind === 'table'
        ? markRequestOutcome(requestId, outcome, kind)
        : markRequestOutcome(requestId, outcome),
    onSuccess: (request, { requestId }) => writeAnswer(queryClient, requestId, request),
    onSettled: async (_data, _error, { requestId }) => {
      inFlight.current = false;
      await invalidateSellerRequests(queryClient, requestId);
    },
  });

  const { mutate, reset } = mutation;
  const markOutcome = useCallback(
    (requestId: string, outcome: SellerOutcome, options?: Parameters<typeof mutate>[1]) => {
      if (inFlight.current) return;
      inFlight.current = true;
      // After the guard: a second tap must not detach the mutation that is still running.
      reset();
      mutate({ requestId, outcome }, options);
    },
    [mutate, reset],
  );

  return { ...mutation, markOutcome };
}
