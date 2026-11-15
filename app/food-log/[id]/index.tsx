import { useLocalSearchParams } from 'expo-router';

import { FoodLogDetailScreen } from '@/features/food-log/components/FoodLogDetailScreen';

// A bad or missing id gets the same "This photo isn't available." as an unknown one.
export default function FoodLogDetailRoute() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  return <FoodLogDetailScreen id={typeof id === 'string' ? id : ''} />;
}
