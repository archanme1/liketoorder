import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo } from 'react';

import { RestaurantMapScreen } from '@/features/map/components/RestaurantMapScreen';
import { parseOfferTarget } from '@/features/map/offerTarget';

export default function RestaurantRoute() {
  // Spec 16: an Offers card opens a restaurant here (?business=&lat=&lng=). Bad params are ignored;
  // the params are cleared once the map has taken the place in, so a refocus does not reopen it.
  const router = useRouter();
  const { business, lat, lng } = useLocalSearchParams<{
    business?: string;
    lat?: string;
    lng?: string;
  }>();
  const target = useMemo(() => parseOfferTarget({ business, lat, lng }), [business, lat, lng]);
  const onHandled = useCallback(
    () => router.setParams({ business: undefined, lat: undefined, lng: undefined }),
    [router],
  );
  return <RestaurantMapScreen offerTarget={target} onOfferTargetHandled={onHandled} />;
}
