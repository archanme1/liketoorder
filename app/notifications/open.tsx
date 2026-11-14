import { useLocalSearchParams } from 'expo-router';

import { NotificationOpenResolver } from '@/features/notifications/components/NotificationOpenResolver';

export default function OpenNotificationScreen() {
  const params = useLocalSearchParams();
  return <NotificationOpenResolver params={params} />;
}
