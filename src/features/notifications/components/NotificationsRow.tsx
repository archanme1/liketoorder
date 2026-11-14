import { useRouter } from 'expo-router';

import { NavRow, Skeleton } from '@/components/ui';
import { useTheme } from '@/theme/useTheme';

import { useNotificationPermission } from '../hooks/useNotificationPermission';
import { permissionValue } from '../messages';

// The Profile row: the phone's permission in words (On, Off, Off in Settings); opens the settings.
export function NotificationsRow() {
  const { type } = useTheme();
  const router = useRouter();
  const { state } = useNotificationPermission();
  return (
    <NavRow
      label="Notifications"
      value={state ? permissionValue(state) : undefined}
      valueSlot={state ? undefined : <Skeleton width="40%" height={type.body} />}
      accessibilityHint="Opens your notification settings."
      onPress={() => router.push('/profile/notifications')}
    />
  );
}
