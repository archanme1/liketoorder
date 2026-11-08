import { useLocalSearchParams, useRouter } from 'expo-router';

import { RequestDetailScreen } from '@/features/requests/components/RequestDetailScreen';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// One request of the signed-in customer. A bad id gets the same calm "not found" as an unknown one.
export default function RequestDetailRoute() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const valid = typeof id === 'string' && UUID.test(id);
  return (
    <RequestDetailScreen
      requestId={valid ? id : null}
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/requests'))}
    />
  );
}
