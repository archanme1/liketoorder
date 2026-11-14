import { Stack } from 'expo-router';

import { useSession } from '@/features/auth/hooks/useSession';

// Notification screens draw their own controls. The tap resolver (open) is reachable signed out:
// it sends the person to sign-in itself and runs again afterwards. The permission primer (allow)
// is for a signed-in person only.
export default function NotificationsLayout() {
  const { session, isRecovering } = useSession();
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="open" />
      <Stack.Protected guard={session !== null && !isRecovering}>
        <Stack.Screen name="allow" />
      </Stack.Protected>
    </Stack>
  );
}
