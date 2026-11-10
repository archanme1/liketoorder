import { useMutation, useQueryClient } from '@tanstack/react-query';
import { randomUUID } from 'expo-crypto';
import { useCallback, useRef } from 'react';

import { submitTableRequest, type RequestAppError, type SubmitTableInput } from '../api';
import type { TableRequest } from '../schema';

import { requestKeys } from './keys';

export type SubmitTableArgs = Omit<SubmitTableInput, 'idempotencyKey'>;

// What makes two attempts "the same request". A different one gets a new key.
function fingerprint(input: SubmitTableArgs): string {
  return JSON.stringify([
    input.businessId,
    input.tableAt.toISOString(),
    input.partySize,
    input.note ?? null,
  ]);
}

/**
 * Sends a table request with ONE idempotency key per form session: a retry of the same request
 * (bad connection, double tap) re-uses the key and so creates one request. The key is replaced when
 * the request changes and after a success. A second call while one is running is ignored. The
 * result is `isSuccess` / `data` on the returned mutation, as for pickup.
 */
export function useSubmitTableRequest() {
  const queryClient = useQueryClient();
  const attempt = useRef<{ key: string; print: string } | null>(null);
  const inFlight = useRef(false);

  const mutation = useMutation<TableRequest, RequestAppError, SubmitTableArgs>({
    mutationFn: (input) => {
      const print = fingerprint(input);
      if (attempt.current === null || attempt.current.print !== print) {
        attempt.current = { key: randomUUID(), print };
      }
      return submitTableRequest({ ...input, idempotencyKey: attempt.current.key });
    },
    onSuccess: async (request) => {
      attempt.current = null;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: requestKeys.mine }),
        queryClient.invalidateQueries({ queryKey: requestKeys.detail(request.id) }),
      ]);
    },
    onSettled: () => {
      inFlight.current = false;
    },
  });

  const { mutate } = mutation;
  const submit = useCallback(
    (input: SubmitTableArgs, options?: Parameters<typeof mutate>[1]) => {
      if (inFlight.current) return;
      inFlight.current = true;
      mutate(input, options);
    },
    [mutate],
  );

  return { ...mutation, submit };
}
