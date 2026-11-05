import { Stack } from 'expo-router';

import { useTheme } from '@/theme/useTheme';

// No guard on business state here (spec 05 Decision 14): each seller screen loads the business
// itself and redirects once it has loaded, so this Stack never swaps or unmounts mid-load.
// Signed-in, profile-complete access comes from the root layout's `app` guard.
export default function SellerLayout() {
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
      <Stack.Screen name="onboarding" options={{ title: 'Start selling' }} />
      <Stack.Screen name="edit" options={{ title: 'Edit details' }} />
      <Stack.Screen name="address" options={{ title: 'Change address' }} />
      <Stack.Screen name="menu/index" options={{ title: 'Menu' }} />
      <Stack.Screen name="menu/new" options={{ title: 'Add item' }} />
      <Stack.Screen name="menu/[itemId]" options={{ title: 'Edit item' }} />
      <Stack.Screen name="photos" options={{ title: 'Photos' }} />
    </Stack>
  );
}
