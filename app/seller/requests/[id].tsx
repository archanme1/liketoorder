import { useLocalSearchParams, useRouter } from 'expo-router';

import { SellerRequestDetailScreen } from '@/features/requests/components/SellerRequestDetailScreen';
import { SellerScreenGate } from '@/features/sellers/components/SellerScreenGate';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// One request to the seller's own business. A bad id gets the same calm "not found" as an unknown
// one or someone else's (the server answers the same for both).
export default function SellerRequestRoute() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const valid = typeof id === 'string' && UUID.test(id);
  return (
    <SellerScreenGate screen="request">
      {() => (
        <SellerRequestDetailScreen
          requestId={valid ? id : null}
          onClose={() => (router.canGoBack() ? router.back() : router.replace('/seller/requests'))}
        />
      )}
    </SellerScreenGate>
  );
}
