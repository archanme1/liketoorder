import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';

import { foodLogActivityKey, foodLogDayPrefix } from './keys';

/**
 * Pull to refresh for a screen that shows the activity grid (Profile with 17 weeks, Your year with
 * 53): refetches that screen's own activity and the open day panels. Profile stays mounted under
 * Your year, so a day panel open on Profile is refreshed too; that is one small extra request.
 */
export function useActivityRefresh(weeks: number) {
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        queryClient.refetchQueries({ queryKey: foodLogActivityKey(weeks), type: 'active' }),
        queryClient.refetchQueries({ queryKey: foodLogDayPrefix, type: 'active' }),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [queryClient, weeks]);
  return { refreshing, onRefresh };
}
