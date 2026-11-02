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
    // The alert role sits on the message, not the container: an accessible container would
    // merge the Try again button into one element that screen readers can't focus separately.
    <View style={[styles.root, { gap: space.lg, padding: space.xl }]}>
      <Text variant="bodyLg" style={styles.message} accessibilityRole="alert">
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
