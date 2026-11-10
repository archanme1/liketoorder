import { useLocalSearchParams, useRouter } from 'expo-router';

import { RequestDetailScreen } from '@/features/requests/components/RequestDetailScreen';
import { parseKind } from '@/features/requests/kind';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// One request of the signed-in customer. A bad id gets the same calm "not found" as an unknown one.
// ?kind= is only a hint for which read to use (the list row's kind); anything else is ignored.
export default function RequestDetailRoute() {
  const router = useRouter();
  const { id, kind } = useLocalSearchParams<{ id?: string; kind?: string }>();
  const valid = typeof id === 'string' && UUID.test(id);
  return (
    <RequestDetailScreen
      requestId={valid ? id : null}
      kind={parseKind(kind)}
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/requests'))}
    />
  );
}
