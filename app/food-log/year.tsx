import { ActivityYearScreen } from '@/features/food-log/components/ActivityYearScreen';

// A static segment: expo-router matches /food-log/year here, never [id] with id "year".
export default function FoodLogYearRoute() {
  return <ActivityYearScreen />;
}
