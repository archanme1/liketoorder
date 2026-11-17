import { useQuery } from '@tanstack/react-query';

import { getMyFoodLogActivity, type FoodLogAppError } from '../api';
import type { FoodLogActivity } from '../schema';
import { phoneTimeZone } from '../uploadFoodLog';

import { foodLogActivityKey } from './keys';

/**
 * My activity grid and stats (spec 14). The phone sends only its zone name; the server decides
 * today. No polling (Decision 8): stale after 60 s, refetched when the app returns to the
 * foreground (appFocus, which also covers midnight passing), on pull to refresh, and after a
 * create, update or delete.
 */
export function useFoodLogActivity(weeks: number) {
  return useQuery<FoodLogActivity, FoodLogAppError>({
    queryKey: foodLogActivityKey(weeks),
    queryFn: () => getMyFoodLogActivity(phoneTimeZone(), weeks),
    staleTime: 60_000,
  });
}
