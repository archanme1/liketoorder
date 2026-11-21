import { restaurantMapConfig } from '../businessMapConfig';
import type { OfferTarget } from '../offerTarget';

import { BusinessMapScreen } from './BusinessMapScreen';

type Props = {
  /** Spec 16: a place to open, from an Offers card. */
  offerTarget?: OfferTarget | null;
  onOfferTargetHandled?: () => void;
};

// The Restaurants tab: the shared map screen with the restaurant config.
export function RestaurantMapScreen({ offerTarget, onOfferTargetHandled }: Props) {
  return (
    <BusinessMapScreen
      config={restaurantMapConfig}
      offerTarget={offerTarget}
      onOfferTargetHandled={onOfferTargetHandled}
    />
  );
}
