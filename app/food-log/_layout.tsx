import { Stack } from 'expo-router';

import { useTheme } from '@/theme/useTheme';

// Signed-in, profile-complete access comes from the root layout's `app` guard.
export default function FoodLogLayout() {
  const { colors } = useTheme();
  return (
    <Stack
      screenOptions={{
        headerTintColor: colors.primary,
        headerStyle: { backgroundColor: colors.bg },
        headerTitleStyle: { color: colors.text },
        headerBackButtonDisplayMode: 'minimal',
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Food log' }} />
      <Stack.Screen name="new" options={{ title: 'Add photo' }} />
      <Stack.Screen name="[id]/index" options={{ title: 'Photo' }} />
      <Stack.Screen name="[id]/edit" options={{ title: 'Edit photo' }} />
    </Stack>
  );
}
