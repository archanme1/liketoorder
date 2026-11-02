import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet } from 'react-native';

import { Screen, Text } from '@/components/ui';
import { useTheme } from '@/theme/useTheme';

type AuthScreenProps = {
  title: string;
  subtitle?: string;
  children: ReactNode;
};

// Shared scrollable, keyboard-aware frame for the auth forms.
export function AuthScreen({ title, subtitle, children }: AuthScreenProps) {
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
});
