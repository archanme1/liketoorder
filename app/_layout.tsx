import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { Banner, Button, ErrorState, Screen } from '@/components/ui';
import { AuthProvider } from '@/features/auth/components/AuthProvider';
import { useSession } from '@/features/auth/hooks/useSession';
import { useSignOut } from '@/features/auth/hooks/useSignOut';
import { authErrorMessage } from '@/features/auth/messages';
import { getHomeRoute, getPostAuthRoute, getRouteAccess } from '@/features/auth/routeAccess';
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
  const { space } = useTheme();
  const { session, isLoading, isRecovering } = useSession();
  const signedIn = session !== null && !isRecovering;
  const profile = useMyProfile({ enabled: signedIn });
  const signOut = useSignOut();

  // Only block on the first profile load; background refetches keep the current screen.
  if (isLoading || (signedIn && profile.isPending)) return <LoadingScreen />;
  if (signedIn && profile.isError && profile.data === undefined) {
    // Sign out is the way out if the profile keeps failing to load.
    return (
      <Screen style={[styles.errorScreen, { gap: space.lg }]}>
        <ErrorState
          message={profileErrorMessage(profile.error.code)}
          onRetry={() => {
            signOut.reset();
            void profile.refetch();
          }}
          retrying={profile.isRefetching}
        />
        {signOut.error ? <Banner message={authErrorMessage(signOut.error.code)} /> : null}
        <Button
          title="Sign out"
          variant="secondary"
          loading={signOut.isPending}
          onPress={() => signOut.mutate()}
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
  // Signing in, finishing setup and saving a new password all land on the Profile tab.
  const postAuth = getPostAuthRoute(access);

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected
        guard={access.signedOutScreens || access.resetPassword}
        redirectTo={postAuth}
      >
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
      <Stack.Protected guard={access.setupProfile} redirectTo={postAuth}>
        <Stack.Screen name="setup-profile" />
      </Stack.Protected>
      <Stack.Protected guard={access.tabs} redirectTo={home}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(tabs)" />
      </Stack.Protected>
      <Stack.Protected guard={access.app} redirectTo={home}>
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
  errorScreen: { justifyContent: 'center' },
});
