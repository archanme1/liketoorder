import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';
import { AppState } from 'react-native';

import { readPermission, requestPermission, type PermissionState } from '../pushModule';

import { notificationKeys } from './keys';

/**
 * The phone's notification permission: `undetermined` (never asked), `granted` or `denied`;
 * undefined while it is first read. Read again whenever the app comes back to the foreground,
 * so a change made in the phone's Settings shows at once.
 */
export function useNotificationPermission() {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: notificationKeys.permission,
    queryFn: readPermission,
    staleTime: Infinity,
  });

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        void client.invalidateQueries({ queryKey: notificationKeys.permission });
      }
    });
    return () => subscription.remove();
  }, [client]);

  /** Shows the system prompt. Returns the state afterwards. */
  const request = useCallback(async (): Promise<PermissionState> => {
    const next = await requestPermission();
    client.setQueryData(notificationKeys.permission, next);
    return next;
  }, [client]);

  return { state: query.data, request };
}
