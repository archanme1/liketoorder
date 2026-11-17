import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { deleteFoodLog, updateFoodLog, type FoodLogFields } from '../api';
import type { FoodLog } from '../schema';
import { FOOD_LOG_BUCKET } from '../shared';
import { runFoodLogCleanup, uploadFoodLog, type UploadFoodLogInput } from '../uploadFoodLog';

import {
  foodLogActivityPrefix,
  foodLogCuisineDaysPrefix,
  foodLogDayPrefix,
  foodLogKey,
  foodLogListKey,
} from './keys';

/**
 * The activity grid, its Cuisine view and the day panels (specs 14 and 15) count and list ready
 * logs, so every change to a log marks them stale too; a cuisine edit changes a day's glyph. Not
 * awaited: a mutation never waits for these refetches. The open day panel sits under the detail
 * page, so after a delete it refetches like the list does.
 */
function invalidateActivity(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: foodLogActivityPrefix });
  void queryClient.invalidateQueries({ queryKey: foodLogCuisineDaysPrefix });
  void queryClient.invalidateQueries({ queryKey: foodLogDayPrefix });
}

/** prepare -> begin -> upload -> finish; then the list and the new log's detail are refetched. */
export function useCreateFoodLog() {
  const queryClient = useQueryClient();
  return useMutation<FoodLog, Error, UploadFoodLogInput>({
    mutationFn: (input) => uploadFoodLog(input),
    onSuccess: (log) => {
      void queryClient.invalidateQueries({ queryKey: foodLogListKey });
      void queryClient.invalidateQueries({ queryKey: foodLogKey(log.id) });
      invalidateActivity(queryClient);
    },
  });
}

/** Changes the cuisine, description and visibility of one of my logs. */
export function useUpdateFoodLog(id: string) {
  const queryClient = useQueryClient();
  return useMutation<FoodLog, Error, FoodLogFields>({
    mutationFn: (fields) => updateFoodLog(id, fields),
    onSuccess: (log) => {
      queryClient.setQueryData(foodLogKey(id), log);
      void queryClient.invalidateQueries({ queryKey: foodLogListKey });
      void queryClient.invalidateQueries({ queryKey: foodLogKey(id) });
      invalidateActivity(queryClient);
    },
  });
}

/** Deletes one of my logs, then removes its file (row first, file later). */
export function useDeleteFoodLog(id: string) {
  const queryClient = useQueryClient();
  return useMutation<void, Error, void>({
    mutationFn: () => deleteFoodLog(id),
    onSuccess: () => {
      void runFoodLogCleanup();
      // Not awaited: the mutation must not wait for the list refetch.
      void queryClient.invalidateQueries({ queryKey: foodLogListKey });
      // Marked stale but not refetched: the detail screen is still open while it closes, and a
      // refetch would flash "This photo isn't available." before it goes.
      void queryClient.invalidateQueries({ queryKey: foodLogKey(id), refetchType: 'none' });
      invalidateActivity(queryClient);
    },
  });
}

/**
 * Drops a deleted log's cached detail and every signed URL batch holding its path, so opening its
 * id again shows not-found at once, never its old data. Called once the detail screen has closed:
 * removing the detail while that screen is still mounted would refetch it there.
 */
export function forgetFoodLog(queryClient: QueryClient, id: string, path: string) {
  queryClient.removeQueries({ queryKey: foodLogKey(id), exact: true });
  queryClient.removeQueries({
    queryKey: ['media', 'signed', FOOD_LOG_BUCKET],
    predicate: (query) => query.queryKey.includes(path),
  });
}
