import { useQuery } from '@tanstack/react-query';

import { FoodLogAppError, getFoodLog } from '../api';
import type { FoodLog } from '../schema';

import { foodLogKey } from './keys';

/**
 * One of my uploads. In this spec only the owner's own logs are shown: the server also returns
 * someone else's public log (without its path), and storage lets nobody read another person's
 * file, so that case is the same not-found as an unknown or deleted id.
 */
export async function getMyFoodLog(id: string): Promise<FoodLog & { path: string }> {
  const log = await getFoodLog(id);
  if (!log.is_mine || log.path === null) throw new FoodLogAppError('not_found');
  return { ...log, path: log.path };
}

export function useFoodLog(id: string) {
  return useQuery<FoodLog & { path: string }, FoodLogAppError>({
    queryKey: foodLogKey(id),
    queryFn: () => getMyFoodLog(id),
  });
}
