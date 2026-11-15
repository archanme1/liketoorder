import { useMutation, useQueryClient } from '@tanstack/react-query';

import { deleteFoodLog, updateFoodLog, type FoodLogFields } from '../api';
import type { FoodLog } from '../schema';
import { runFoodLogCleanup, uploadFoodLog, type UploadFoodLogInput } from '../uploadFoodLog';

import { foodLogKey, foodLogListKey } from './keys';

/** prepare -> begin -> upload -> finish; then the list and the new log's detail are refetched. */
export function useCreateFoodLog() {
  const queryClient = useQueryClient();
  return useMutation<FoodLog, Error, UploadFoodLogInput>({
    mutationFn: (input) => uploadFoodLog(input),
    onSuccess: (log) => {
      void queryClient.invalidateQueries({ queryKey: foodLogListKey });
      void queryClient.invalidateQueries({ queryKey: foodLogKey(log.id) });
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
    },
  });
}
