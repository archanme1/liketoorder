import { useLocalSearchParams, useRouter } from 'expo-router';

import { TableRequestScreen } from '@/features/requests/components/TableRequestScreen';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// New table request for ?businessId=<uuid>. A missing or malformed id gets the same calm "not
// available" state as any other place that can't be asked for a table.
export default function NewTableRequestRoute() {
  const router = useRouter();
  const { businessId } = useLocalSearchParams<{ businessId?: string }>();
  const valid = typeof businessId === 'string' && UUID.test(businessId);
  const onClose = () => (router.canGoBack() ? router.back() : router.replace('/restaurants'));
  return <TableRequestScreen businessId={valid ? businessId : null} onClose={onClose} />;
}
