import { StyleSheet, View } from 'react-native';

import { useTheme } from '@/theme/useTheme';

import { Button } from './Button';
import { Text } from './Text';

type EmptyStateProps = {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
};

export function EmptyState({ message, actionLabel, onAction }: EmptyStateProps) {
  const { space } = useTheme();
  return (
    <View style={[styles.root, { gap: space.lg, padding: space.xl }]}>
      <Text variant="bodyLg" color="textMuted" style={styles.message}>
        {message}
      </Text>
      {actionLabel && onAction ? (
        <Button title={actionLabel} onPress={onAction} variant="secondary" />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  message: { textAlign: 'center' },
});
