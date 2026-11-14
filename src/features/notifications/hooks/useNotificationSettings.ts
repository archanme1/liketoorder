import { useQuery } from '@tanstack/react-query';

import { useSession } from '@/features/auth/hooks/useSession';

import { getNotificationSettings, type NotificationAppError } from '../api';
import type { NotificationSettings } from '../schema';

import { notificationKeys } from './keys';

/** The signed-in person's four switches (every switch is on until they change one). */
export function useNotificationSettings() {
  const { session, isRecovering } = useSession();
  return useQuery<NotificationSettings, NotificationAppError>({
    queryKey: notificationKeys.settings,
    queryFn: getNotificationSettings,
    enabled: session !== null && !isRecovering,
  });
}
