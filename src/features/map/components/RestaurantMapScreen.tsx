import { restaurantMapConfig } from '../businessMapConfig';

import { BusinessMapScreen } from './BusinessMapScreen';

// The Restaurants tab: the shared map screen with the restaurant config.
export function RestaurantMapScreen() {
  return <BusinessMapScreen config={restaurantMapConfig} />;
}
