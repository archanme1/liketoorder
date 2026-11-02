import { useState } from 'react';
import { View } from 'react-native';

import { Button, Card, Screen, Text } from '@/components/ui';
import { useTheme } from '@/theme/useTheme';

// Placeholder home screen. Replaced by the auth flow and tabs in specs 02–03.
export default function HomeScreen() {
  const { space } = useTheme();
  const [taps, setTaps] = useState(0);

  return (
    <Screen>
      <View style={{ gap: space.lg }}>
        <Text variant="h1" accessibilityRole="header">
          LikeToOrder
        </Text>
        <Text color="textMuted">Discover food on the map. Coming soon.</Text>
        <Card>
          <Text>{taps === 0 ? 'Base components are working.' : `Tapped ${taps} times.`}</Text>
        </Card>
        <Button
          title="Say hello"
          accessibilityHint="Counts taps to check the button works"
          onPress={() => setTaps((count) => count + 1)}
        />
      </View>
    </Screen>
  );
}
