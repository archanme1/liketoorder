import { useEffect } from 'react';

import { runPhotoCleanup } from '../uploadBusinessPhoto';

/**
 * Drains the storage cleanup outbox once when the Menu or Photos screen opens, so a removal that
 * failed earlier is retried. Fire and forget: it never blocks the screen or shows an error.
 * Deletes and replaces run it themselves (see the mutation hooks).
 */
export function usePhotoCleanup(): void {
  useEffect(() => {
    void runPhotoCleanup();
  }, []);
}
