import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { Banner, Button, ErrorState, Screen } from '@/components/ui';
import { AuthProvider } from '@/features/auth/components/AuthProvider';
import { useSession } from '@/features/auth/hooks/useSession';
import { useSignOut } from '@/features/auth/hooks/useSignOut';
import { authErrorMessage } from '@/features/auth/messages';
import {
  getHomeRoute,
  getPostAuthRoute,
  getRouteAccess,
  type RouteAccess,
} from '@/features/auth/routeAccess';
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
  const profileLoading = signedIn && profile.isPending;
  // Set during render (React's "adjust state on change" pattern): true once the Stack first renders.
  const [stackMounted, setStackMounted] = useState(false);
  if (!stackMounted && !isLoading && !profileLoading) setStackMounted(true);

  // Cold start: nothing renders until the guards know the profile, so deep links (e.g. /manage)
  // resolve correctly. Background refetches keep the current screen.
  if (isLoading || (profileLoading && !stackMounted)) return <LoadingScreen />;
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
    // Unknown while loading after sign-in: counts as complete, so sign-in redirects to the Profile
    // tab; an incomplete profile is then sent on to setup-profile once it loads.
    profileComplete: signedIn && !profileLoading ? Boolean(profile.data?.username) : undefined,
  });
  // Explicit redirects: the (auth) group has no index, so the default "first accessible route"
  // redirect would resolve to "/" and show Unmatched Route.
  const home = getHomeRoute(access);
  // Signing in, finishing setup and saving a new password all land on the Profile tab.
  const postAuth = getPostAuthRoute(access);

  // After sign-in or a password reset the profile loads with the Stack still mounted, under an
  // overlay: unmounting it would drop the navigation state and skip the post-auth redirect.
  return (
    <View style={styles.flex}>
      <View
        style={styles.flex}
        accessibilityElementsHidden={profileLoading}
        importantForAccessibility={profileLoading ? 'no-hide-descendants' : 'auto'}
      >
        <RootStack access={access} home={home} postAuth={postAuth} />
      </View>
      {profileLoading ? (
        <View style={StyleSheet.absoluteFill}>
          <LoadingScreen />
        </View>
      ) : null}
    </View>
  );
}

type RootStackProps = {
  access: RouteAccess;
  home: ReturnType<typeof getHomeRoute>;
  postAuth: ReturnType<typeof getPostAuthRoute>;
};

function RootStack({ access, home, postAuth }: RootStackProps) {
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
        {/* No business-based guard: the seller screens redirect after their own data loads. */}
        <Stack.Screen name="seller" />
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
  flex: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  errorScreen: { justifyContent: 'center' },
});
