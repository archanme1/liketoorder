import { useInfiniteQuery, type InfiniteData } from '@tanstack/react-query';
import { useMemo } from 'react';

import { listMyFoodLogs, type FoodLogAppError } from '../api';
import type { FoodLog, FoodLogPage } from '../schema';

import { foodLogListKey } from './keys';

/** All loaded pages as one list in the server's order, each log once (first occurrence wins). */
export function flattenFoodLogPages(
  data: InfiniteData<FoodLogPage, string | null> | undefined,
): FoodLog[] {
  if (!data) return [];
  const seen = new Set<string>();
  const logs: FoodLog[] = [];
  for (const page of data.pages) {
    for (const log of page.items) {
      if (seen.has(log.id)) continue;
      seen.add(log.id);
      logs.push(log);
    }
  }
  return logs;
}

/**
 * My ready uploads, newest first, 50 a page. The cursor is the server's own text, sent back
 * untouched.
 */
export function useMyFoodLogs() {
  const query = useInfiniteQuery<
    FoodLogPage,
    FoodLogAppError,
    InfiniteData<FoodLogPage, string | null>,
    typeof foodLogListKey,
    string | null
  >({
    queryKey: foodLogListKey,
    queryFn: ({ pageParam }) => listMyFoodLogs(pageParam),
    initialPageParam: null,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });
  const logs = useMemo(() => flattenFoodLogPages(query.data), [query.data]);
  return { ...query, logs };
}
