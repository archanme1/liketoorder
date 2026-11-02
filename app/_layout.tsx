import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { Screen } from '@/components/ui';
import { AuthProvider } from '@/features/auth/components/AuthProvider';
import { useSession } from '@/features/auth/hooks/useSession';
import { getRouteAccess } from '@/features/auth/routeAccess';
import { queryClient } from '@/lib/queryClient';
// Loaded at startup so missing EXPO_PUBLIC_SUPABASE_* vars fail loudly at launch.
import '@/lib/supabase';
import { useTheme } from '@/theme/useTheme';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <StatusBar style="dark" />
          <RootNavigator />
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

// Guards are for UX only; RLS is what protects the data.
function RootNavigator() {
  const { session, isLoading, isRecovering } = useSession();
  const { colors } = useTheme();

  if (isLoading) {
    return (
      <Screen style={styles.center}>
        <ActivityIndicator color={colors.primary} accessibilityLabel="Loading" />
      </Screen>
    );
  }

  const access = getRouteAccess({ hasSession: session !== null, isRecovering });

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={access.signedOutScreens || access.resetPassword}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
      <Stack.Protected guard={access.app}>
        <Stack.Screen name="index" />
      </Stack.Protected>
    </Stack>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
});
