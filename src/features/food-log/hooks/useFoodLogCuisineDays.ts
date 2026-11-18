import { useQuery } from '@tanstack/react-query';

import { getMyFoodLogCuisineDays, type FoodLogAppError } from '../api';
import type { FoodLogCuisineDays } from '../schema';
import { phoneTimeZone } from '../uploadFoodLog';

import { foodLogCuisineDaysKey } from './keys';

/**
 * Each day's cuisines for the Cuisine view (spec 15). Sent only while that view is on screen
 * (`enabled`). Like useFoodLogActivity: the phone sends only its zone name, no polling, stale after
 * 60 s, refetched on foreground (appFocus), on pull to refresh, and after a create, update or delete.
 */
export function useFoodLogCuisineDays(weeks: number, enabled: boolean) {
  return useQuery<FoodLogCuisineDays, FoodLogAppError>({
    queryKey: foodLogCuisineDaysKey(weeks),
    queryFn: () => getMyFoodLogCuisineDays(phoneTimeZone(), weeks),
    staleTime: 60_000,
    enabled,
  });
}
