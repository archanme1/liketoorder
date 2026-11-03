import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Button, Screen, Text } from '@/components/ui';
import { useTheme } from '@/theme/useTheme';

// The Profile tab for guests. No data, so only the success state.
export function GuestProfilePrompt() {
  const { space } = useTheme();
  const router = useRouter();

  return (
    <Screen>
      <Text variant="h1" accessibilityRole="header">
        Profile
      </Text>
      <View style={[styles.body, { gap: space.lg }]}>
        <Text variant="bodyLg">
          Sign in to see your profile, and later to send requests and log food.
        </Text>
        <Button title="Sign in" onPress={() => router.push('/sign-in')} />
        <Button
          title="Create account"
          variant="secondary"
          onPress={() => router.push('/sign-up')}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, justifyContent: 'center' },
});
