import { homemadeMapConfig } from '../homemadeMapConfig';
import type { OfferTarget } from '../offerTarget';

import { BusinessMapScreen } from './BusinessMapScreen';

type Props = {
  /** Spec 16: a home cook to open, from an Offers card. */
  offerTarget?: OfferTarget | null;
  onOfferTargetHandled?: () => void;
};

// The Homemade tab: the shared map screen with the homemade config. Public, like Restaurants.
export function HomemadeMapScreen({ offerTarget, onOfferTargetHandled }: Props) {
  return (
    <BusinessMapScreen
      config={homemadeMapConfig}
      offerTarget={offerTarget}
      onOfferTargetHandled={onOfferTargetHandled}
    />
  );
}
