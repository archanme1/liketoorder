import { useLocalSearchParams } from 'expo-router';

import { NotificationsPrimer } from '@/features/notifications/components/NotificationsPrimer';

export default function AllowNotificationsScreen() {
  const { role } = useLocalSearchParams<{ role?: string }>();
  return <NotificationsPrimer role={role === 'owner' ? 'owner' : 'customer'} />;
}
