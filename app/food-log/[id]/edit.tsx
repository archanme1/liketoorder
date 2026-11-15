import { useLocalSearchParams } from 'expo-router';

import { FoodLogFormScreen } from '@/features/food-log/components/FoodLogFormScreen';

export default function EditFoodLogRoute() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  return <FoodLogFormScreen mode="edit" id={typeof id === 'string' ? id : ''} />;
}
