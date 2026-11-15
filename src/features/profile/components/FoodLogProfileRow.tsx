import { useRouter } from 'expo-router';

import { NavRow } from '@/components/ui';

// Profile > Food log (spec 13). No count in v1.
export function FoodLogProfileRow() {
  const router = useRouter();
  return (
    <NavRow
      label="Food log"
      accessibilityHint="Opens your food photos."
      onPress={() => router.push('/food-log')}
    />
  );
}
