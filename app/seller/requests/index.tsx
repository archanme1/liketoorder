import { useRouter } from 'expo-router';
import { useCallback } from 'react';

import { SellerRequestsScreen } from '@/features/requests/components/SellerRequestsScreen';
import type { SellerRequest } from '@/features/requests/schema';
import { SellerScreenGate } from '@/features/sellers/components/SellerScreenGate';

// The seller's inbox. Signed in with a complete profile (root `app` guard); without a business the
// gate redirects to onboarding once it has loaded. Seller mode is not checked here: the server lets
// a seller answer requests already sent (spec 10 Decision 11).
export default function SellerRequestsRoute() {
  const router = useRouter();
  // Stable, so a re-render of this route does not rebuild the list's renderItem and re-render
  // every memoized row.
  const onOpen = useCallback(
    (request: SellerRequest) =>
      router.push({ pathname: '/seller/requests/[id]', params: { id: request.id } }),
    [router],
  );
  return (
    <SellerScreenGate screen="requests">
      {() => <SellerRequestsScreen onOpen={onOpen} />}
    </SellerScreenGate>
  );
}
