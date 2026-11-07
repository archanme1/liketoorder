import { useMutation, useQueryClient } from '@tanstack/react-query';
import { randomUUID } from 'expo-crypto';
import { useCallback, useRef } from 'react';

import { submitPickupRequest, type RequestAppError, type SubmitPickupInput } from '../api';
import type { PickupRequest } from '../schema';

import { requestKeys } from './keys';

export type SubmitInput = Omit<SubmitPickupInput, 'idempotencyKey'>;

// What makes two attempts "the same order". A different order gets a new key.
function fingerprint(input: SubmitInput): string {
  return JSON.stringify([
    input.businessId,
    input.pickupAt.toISOString(),
    input.items?.map((line) => [line.itemId.toLowerCase(), line.quantity]) ?? null,
    input.orderText ?? null,
    input.note ?? null,
  ]);
}

/**
 * Sends a pickup request with ONE idempotency key per form session: a retry of the same order
 * (bad connection, double tap) re-uses the key and so creates one request. The key is replaced
 * when the order changes and after a success. A second call while one is running is ignored.
 */
export function useSubmitPickupRequest() {
  const queryClient = useQueryClient();
  const attempt = useRef<{ key: string; print: string } | null>(null);
  const inFlight = useRef(false);

  const mutation = useMutation<PickupRequest, RequestAppError, SubmitInput>({
    mutationFn: (input) => {
      const print = fingerprint(input);
      if (attempt.current === null || attempt.current.print !== print) {
        attempt.current = { key: randomUUID(), print };
      }
      return submitPickupRequest({ ...input, idempotencyKey: attempt.current.key });
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
    (input: SubmitInput, options?: Parameters<typeof mutate>[1]) => {
      if (inFlight.current) return;
      inFlight.current = true;
      mutate(input, options);
    },
    [mutate],
  );

  return { ...mutation, submit };
}
