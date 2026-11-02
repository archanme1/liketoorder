import { StyleSheet, View } from 'react-native';

import { useTheme } from '@/theme/useTheme';

import { Button } from './Button';
import { Text } from './Text';

type ErrorStateProps = {
  onRetry: () => void;
  message?: string;
  retrying?: boolean;
};

export function ErrorState({
  onRetry,
  message = 'Something went wrong.',
  retrying = false,
}: ErrorStateProps) {
  const { space } = useTheme();
  return (
    <View style={[styles.root, { gap: space.lg, padding: space.xl }]} accessibilityRole="alert">
      <Text variant="bodyLg" style={styles.message}>
        {message}
      </Text>
      <Button title="Try again" onPress={onRetry} loading={retrying} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  message: { textAlign: 'center' },
});
