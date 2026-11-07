import { useLocalSearchParams, useRouter } from 'expo-router';

import { NewRequestScreen } from '@/features/requests/components/NewRequestScreen';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// New pickup request for ?businessId=<uuid>. A missing or malformed id gets the same calm
// "not available" state as any other business that can't be requested from.
export default function NewRequestRoute() {
  const router = useRouter();
  const { businessId } = useLocalSearchParams<{ businessId?: string }>();
  const valid = typeof businessId === 'string' && UUID.test(businessId);
  const onClose = () => (router.canGoBack() ? router.back() : router.replace('/restaurants'));
  return <NewRequestScreen businessId={valid ? businessId : null} onClose={onClose} />;
}
