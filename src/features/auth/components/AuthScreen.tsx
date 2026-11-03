import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';

import { Button, Screen, Text } from '@/components/ui';
import { useTheme } from '@/theme/useTheme';

type AuthScreenProps = {
  title: string;
  subtitle?: string;
  /** Shows a Close control, e.g. so guests can go back to browsing. */
  onClose?: () => void;
  children: ReactNode;
};

// Shared scrollable, keyboard-aware frame for the auth forms.
export function AuthScreen({ title, subtitle, onClose, children }: AuthScreenProps) {
  const { space } = useTheme();
  return (
    <Screen>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ gap: space.lg, paddingVertical: space.xl }}
        >
          {onClose ? (
            <View style={styles.close}>
              <Button
                title="Close"
                variant="ghost"
                accessibilityLabel="Close and keep browsing"
                onPress={onClose}
              />
            </View>
          ) : null}
          <Text variant="h1" accessibilityRole="header">
            {title}
          </Text>
          {subtitle ? <Text color="textMuted">{subtitle}</Text> : null}
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  close: { alignItems: 'flex-start' },
});
