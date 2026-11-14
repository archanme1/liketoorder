import { useMutation, useQueryClient } from '@tanstack/react-query';

import { NotificationAppError, setNotificationSettings } from '../api';
import type { NotificationSettings } from '../schema';

import { notificationKeys } from './keys';

const SAVE_KEY = ['notifications', 'settings', 'save'] as const;

type Context = { previous: NotificationSettings | undefined };

/**
 * Flips one switch. The switch moves at once (optimistic) and moves back if the save fails. The
 * server takes all four switches at once, so saves run one after another (one scope): each sends
 * the switches as they are on screen when it runs, and a quick second tap never races the first.
 */
export function useSetNotificationSetting() {
  const client = useQueryClient();
  return useMutation<
    NotificationSettings,
    NotificationAppError,
    Partial<NotificationSettings>,
    Context
  >({
    mutationKey: SAVE_KEY,
    scope: { id: 'notification-settings' },
    onMutate: async (patch) => {
      await client.cancelQueries({ queryKey: notificationKeys.settings });
      const previous = client.getQueryData<NotificationSettings>(notificationKeys.settings);
      if (previous) client.setQueryData(notificationKeys.settings, { ...previous, ...patch });
      return { previous };
    },
    mutationFn: async (patch) => {
      const current = client.getQueryData<NotificationSettings>(notificationKeys.settings);
      if (!current) throw new NotificationAppError('unknown');
      return setNotificationSettings({ ...current, ...patch });
    },
    onError: (_error, patch, context) => {
      // Put back only the switch that failed, so a later queued change stays on screen.
      const current = client.getQueryData<NotificationSettings>(notificationKeys.settings);
      if (!current || !context?.previous) return;
      const restored = { ...current };
      for (const key of Object.keys(patch) as (keyof NotificationSettings)[]) {
        restored[key] = context.previous[key];
      }
      client.setQueryData(notificationKeys.settings, restored);
    },
    onSettled: () => {
      // Re-read the server only when no other save is still queued (it would undo its switch).
      if (client.isMutating({ mutationKey: SAVE_KEY }) <= 1) {
        void client.invalidateQueries({ queryKey: notificationKeys.settings });
      }
    },
  });
}
