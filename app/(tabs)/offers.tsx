import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';

import { offerTargetParams } from '@/features/map/offerTarget';
import { OffersScreen } from '@/features/promotions/components/OffersScreen';
import type { Offer } from '@/features/promotions/schema';

// The Offers tab (spec 16): customers and guests. The tab layout's maps guard hides it in seller
// mode and sends /offers to /requests there.
export default function OffersRoute() {
  const router = useRouter();
  const [focused, setFocused] = useState(true);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  // A card opens its place on its map tab with the sheet open (Decision D15). Stable, so the
  // memoized cards do not re-render with this screen.
  const onOpenOffer = useCallback(
    (offer: Offer) =>
      router.navigate({
        pathname: offer.type === 'homemade' ? '/homemade' : '/restaurants',
        params: offerTargetParams({ business: offer.business_id, lat: offer.lat, lng: offer.lng }),
      }),
    [router],
  );
  const onBrowseMap = useCallback(() => router.navigate('/restaurants'), [router]);
  return <OffersScreen focused={focused} onOpenOffer={onOpenOffer} onBrowseMap={onBrowseMap} />;
}
