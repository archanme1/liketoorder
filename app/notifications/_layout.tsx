import { Stack } from 'expo-router';

// Notification screens draw their own controls. Signed-in, profile-complete access comes from the
// root layout's `app` guard (the tap resolver of gate G will need a signed-out entry here).
export default function NotificationsLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
