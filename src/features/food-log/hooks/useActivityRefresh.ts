import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';

import { foodLogActivityPrefix, foodLogDayPrefix } from './keys';

/**
 * Pull to refresh for the screens that show the activity grid (Profile, Your year): refetches the
 * activity and the open day panel that are on screen, nothing else.
 */
export function useActivityRefresh() {
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        queryClient.refetchQueries({ queryKey: foodLogActivityPrefix, type: 'active' }),
        queryClient.refetchQueries({ queryKey: foodLogDayPrefix, type: 'active' }),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [queryClient]);
  return { refreshing, onRefresh };
}
