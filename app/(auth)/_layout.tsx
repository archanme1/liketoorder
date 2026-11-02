import { Stack } from 'expo-router';

import { useSession } from '@/features/auth/hooks/useSession';

// Mid-recovery, reset-password is the only reachable auth screen.
export default function AuthLayout() {
  const { isRecovering } = useSession();
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={!isRecovering} redirectTo="/reset-password">
        <Stack.Screen name="sign-in" />
        <Stack.Screen name="sign-up" />
        <Stack.Screen name="verify-email" />
        <Stack.Screen name="forgot-password" />
      </Stack.Protected>
      <Stack.Screen name="reset-password" />
    </Stack>
  );
}
