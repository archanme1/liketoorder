import { StyleSheet, View } from 'react-native';

import { Button, Card, Text } from '@/components/ui';
import { useTheme } from '@/theme/useTheme';

type LocationPromptProps = {
  /** What the map shows, e.g. "restaurants" (the default). */
  things?: string;
  onAllow: () => void;
  onNotNow: () => void;
};

// Plain-language note shown once, before the system permission prompt.
export function LocationPrompt({ onAllow, onNotNow, things = 'restaurants' }: LocationPromptProps) {
  const { space } = useTheme();
  return (
    <Card style={{ gap: space.md }}>
      <Text variant="bodyLg" accessibilityRole="header">
        {`Show ${things} near you?`}
      </Text>
      <Text>
        {`LikeToOrder can centre the map on you to show ${things} nearby. Your exact location stays on your phone. We only receive the map area you're looking at. You can say no.`}
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
