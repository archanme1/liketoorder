import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ErrorState, Screen } from '@/components/ui';
import { AuthProvider } from '@/features/auth/components/AuthProvider';
import { useSession } from '@/features/auth/hooks/useSession';
import { getHomeRoute, getRouteAccess } from '@/features/auth/routeAccess';
import { useMyProfile } from '@/features/profile/hooks/useMyProfile';
import { profileErrorMessage } from '@/features/profile/messages';
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
  const signedIn = session !== null && !isRecovering;
  const profile = useMyProfile({ enabled: signedIn });

  // Only block on the first profile load; background refetches keep the current screen.
  if (isLoading || (signedIn && profile.isPending)) return <LoadingScreen />;
  if (signedIn && profile.isError && profile.data === undefined) {
    return (
      <Screen>
        <ErrorState
          message={profileErrorMessage(profile.error.code)}
          onRetry={() => void profile.refetch()}
          retrying={profile.isRefetching}
        />
      </Screen>
    );
  }

  const access = getRouteAccess({
    hasSession: session !== null,
    isRecovering,
    profileComplete: signedIn ? Boolean(profile.data?.username) : undefined,
  });
  // Explicit redirects: the (auth) group has no index, so the default "first accessible route"
  // redirect would resolve to "/" and show Unmatched Route.
  const home = getHomeRoute(access);

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={access.signedOutScreens || access.resetPassword} redirectTo={home}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
      <Stack.Protected guard={access.setupProfile} redirectTo={home}>
        <Stack.Screen name="setup-profile" />
      </Stack.Protected>
      <Stack.Protected guard={access.app} redirectTo={home}>
        <Stack.Screen name="index" />
        <Stack.Screen name="profile/edit" />
      </Stack.Protected>
    </Stack>
  );
}

function LoadingScreen() {
  const { colors } = useTheme();
  return (
    <Screen style={styles.center}>
      <ActivityIndicator color={colors.primary} accessibilityLabel="Loading" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
});
