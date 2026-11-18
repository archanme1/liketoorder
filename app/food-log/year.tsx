import { useLocalSearchParams } from 'expo-router';

import { ActivityYearScreen } from '@/features/food-log/components/ActivityYearScreen';

// A static segment: expo-router matches /food-log/year here, never [id] with id "year". The view
// param is passed on unchecked; the screen checks it (spec 15).
export default function FoodLogYearRoute() {
  const { view } = useLocalSearchParams<{ view?: string | string[] }>();
  return <ActivityYearScreen view={view} />;
}
