import { useRouter } from 'expo-router';

import { SellerRequestsScreen } from '@/features/requests/components/SellerRequestsScreen';
import { SellerScreenGate } from '@/features/sellers/components/SellerScreenGate';

// The seller's inbox. Signed in with a complete profile (root `app` guard); without a business the
// gate redirects to onboarding once it has loaded. Seller mode is not checked here: the server lets
// a seller answer requests already sent (spec 10 Decision 11).
export default function SellerRequestsRoute() {
  const router = useRouter();
  return (
    <SellerScreenGate screen="requests">
      {() => (
        <SellerRequestsScreen
          onOpen={(request) =>
            router.push({ pathname: '/seller/requests/[id]', params: { id: request.id } })
          }
        />
      )}
    </SellerScreenGate>
  );
}
