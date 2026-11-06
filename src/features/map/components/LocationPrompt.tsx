import { StyleSheet, View } from 'react-native';

import { Button, Card, Text } from '@/components/ui';
import { useTheme } from '@/theme/useTheme';

type LocationPromptProps = {
  onAllow: () => void;
  onNotNow: () => void;
};

// Plain-language note shown once, before the system permission prompt.
export function LocationPrompt({ onAllow, onNotNow }: LocationPromptProps) {
  const { space } = useTheme();
  return (
    <Card style={{ gap: space.md }}>
      <Text variant="bodyLg" accessibilityRole="header">
        Show restaurants near you?
      </Text>
      <Text>
        LikeToOrder can centre the map on you to show restaurants nearby. Your location stays on
        your phone and is never sent to us. You can say no.
      </Text>
      <View style={[styles.actions, { gap: space.sm }]}>
        <Button title="Use my location" onPress={onAllow} />
        <Button title="Not now" onPress={onNotNow} variant="secondary" />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'column' },
});
