import { homemadeMapConfig } from '../homemadeMapConfig';

import { BusinessMapScreen } from './BusinessMapScreen';

// The Homemade tab: the shared map screen with the homemade config. Public, like Restaurants.
export function HomemadeMapScreen() {
  return <BusinessMapScreen config={homemadeMapConfig} />;
}
