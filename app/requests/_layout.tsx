import { Stack } from 'expo-router';

// Signed-in, profile-complete access comes from the root layout's `app` guard. Each screen draws
// its own Back control, like the auth screens, so the keyboard-aware forms fill the screen.
export default function RequestsLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
