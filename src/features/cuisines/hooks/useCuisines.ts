import { useQuery } from '@tanstack/react-query';

import { listCuisines, type CuisineAppError } from '../api';
import type { Cuisine } from '../schema';

export const cuisinesKey = ['cuisines'] as const;

/** The list only changes with a migration, so it loads once per app launch. */
export function useCuisines() {
  return useQuery<Cuisine[], CuisineAppError>({
    queryKey: cuisinesKey,
    queryFn: listCuisines,
    staleTime: Infinity,
  });
}

/** One cuisine from the cached list; no extra request. `undefined` for an unknown or missing code. */
export function useCuisine(code: string | null | undefined) {
  return useQuery<Cuisine[], CuisineAppError, Cuisine | undefined>({
    queryKey: cuisinesKey,
    queryFn: listCuisines,
    staleTime: Infinity,
    select: (list) => (code ? list.find((cuisine) => cuisine.code === code) : undefined),
  });
}
