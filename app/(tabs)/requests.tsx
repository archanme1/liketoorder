import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';

import { RequestsTabScreen } from '@/features/requests/components/RequestsTabScreen';
import type { RequestKind } from '@/features/requests/kind';

// The Requests tab (signed in only: the tab layout's Tabs.Protected sends a guest to
// /restaurants). It also answers /requests, so that link keeps working.
export default function RequestsRoute() {
  const router = useRouter();
  const [focused, setFocused] = useState(true);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  // Stable, so the memoized rows below do not re-render on every render of this screen.
  const onOpenSent = useCallback(
    (request: { id: string; kind: RequestKind }) =>
      router.push({ pathname: '/requests/[id]', params: { id: request.id, kind: request.kind } }),
    [router],
  );
  const onOpenReceived = useCallback(
    (request: { id: string }) =>
      router.push({ pathname: '/seller/requests/[id]', params: { id: request.id } }),
    [router],
  );
  return (
    <RequestsTabScreen focused={focused} onOpenSent={onOpenSent} onOpenReceived={onOpenReceived} />
  );
}
