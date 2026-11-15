import { useEffect } from 'react';

import { runFoodLogCleanup } from '../uploadFoodLog';

/**
 * Drains the cleanup outbox once when the Food log list opens, so a removal that failed earlier is
 * retried. Fire and forget: it never blocks the screen or shows an error.
 */
export function useFoodLogCleanup(): void {
  useEffect(() => {
    void runFoodLogCleanup();
  }, []);
}
