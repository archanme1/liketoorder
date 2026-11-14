import { matchMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { SUBMIT_REQUEST_MUTATION_KEY } from '@/features/requests/hooks/keys';

import { requestPrimer } from '../primerMoment';

/**
 * A customer's request (pickup or table) went through: that is a primer moment. Watching the
 * mutation cache keeps the request forms unaware of notifications; the primer itself waits for
 * the screen to settle (usePrimerOpener).
 */
export function useSubmitPrimerWatcher(): void {
  const client = useQueryClient();
  useEffect(
    () =>
      client.getMutationCache().subscribe((event) => {
        if (
          event.type === 'updated' &&
          event.action.type === 'success' &&
          matchMutation({ mutationKey: SUBMIT_REQUEST_MUTATION_KEY }, event.mutation)
        ) {
          requestPrimer('customer');
        }
      }),
    [client],
  );
}
