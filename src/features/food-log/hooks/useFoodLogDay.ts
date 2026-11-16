import { useQuery } from '@tanstack/react-query';

import { listMyFoodLogsOn, type FoodLogAppError } from '../api';
import type { FoodLogDay } from '../schema';

import { foodLogDayKey } from './keys';

/** My ready logs on one local date, oldest first; idle until a day is chosen. */
export function useFoodLogDay(date: string | null) {
  return useQuery<FoodLogDay, FoodLogAppError>({
    queryKey: foodLogDayKey(date ?? ''),
    queryFn: () => listMyFoodLogsOn(date ?? ''),
    enabled: date !== null,
  });
}
