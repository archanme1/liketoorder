import { useQuery } from '@tanstack/react-query';
import { useCallback } from 'react';

import { listCuisines, type CuisineAppError } from '../api';
import type { Cuisine } from '../schema';

export const cuisinesKey = ['cuisines'] as const;

// Shared by both hooks so they always read the same cache entry.
const cuisinesQueryOptions = {
  queryKey: cuisinesKey,
  queryFn: listCuisines,
  staleTime: Infinity,
} as const;

/** The list only changes with a migration, so it loads once per app launch. */
export function useCuisines() {
  return useQuery<Cuisine[], CuisineAppError>(cuisinesQueryOptions);
}

/** One cuisine from the cached list; no extra request. `undefined` for an unknown or missing code. */
export function useCuisine(code: string | null | undefined) {
  // Stable per code, so react-query re-runs the lookup only when the code or the list changes.
  const select = useCallback(
    (list: Cuisine[]) => (code ? list.find((cuisine) => cuisine.code === code) : undefined),
    [code],
  );
  return useQuery<Cuisine[], CuisineAppError, Cuisine | undefined>({
    ...cuisinesQueryOptions,
    select,
  });
}
