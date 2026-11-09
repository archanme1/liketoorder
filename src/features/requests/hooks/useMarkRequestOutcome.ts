import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef } from 'react';

import { markRequestOutcome, type RequestAppError } from '../api';
import type { SellerOutcome, SellerRequest, SellerRequestDetail } from '../schema';

import { invalidateSellerRequests } from './invalidateSellerRequests';
import { requestKeys } from './keys';

type Variables = { requestId: string; outcome: SellerOutcome };

/**
 * Marks an accepted request completed or no-show (the server checks the pickup time has passed).
 * `markOutcome` ignores a second call while one is running. Every outcome re-reads the inbox, the
 * request and the waiting count.
 */
export function useMarkRequestOutcome() {
  const queryClient = useQueryClient();
  const inFlight = useRef(false);
  const mutation = useMutation<SellerRequest, RequestAppError, Variables>({
    mutationFn: ({ requestId, outcome }) => markRequestOutcome(requestId, outcome),
    onSuccess: (request, { requestId }) => {
      queryClient.setQueryData<SellerRequestDetail>(requestKeys.businessDetail(requestId), (old) =>
        old ? { ...old, request } : old,
      );
    },
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
