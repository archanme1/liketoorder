import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import { StyleSheet, View } from 'react-native';

import { useTheme } from '@/theme/useTheme';

import { Text } from './Text';

export type StatusChipTone = 'warning' | 'success' | 'danger' | 'muted' | 'info';
export type StatusChipIcon = ComponentProps<typeof Ionicons>['name'];

type StatusChipProps = {
  /** The status as a word. Always shown and always spoken: colour and icon never carry it alone. */
  label: string;
  tone: StatusChipTone;
  icon: StatusChipIcon;
};

// A small read-only chip: icon + word, tinted by the tone. Used for request statuses (specs 09, 10).
export function StatusChip({ label, tone, icon }: StatusChipProps) {
  const { colors, space, radius, size } = useTheme();
  const accent = {
    warning: colors.warning,
    success: colors.success,
    danger: colors.danger,
    muted: colors.textMuted,
    info: colors.info,
  }[tone];
  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={`Status: ${label}`}
      style={[
        styles.root,
        {
          gap: space.xs,
          paddingHorizontal: space.md,
          paddingVertical: space.xs,
          borderRadius: radius.pill,
          borderColor: accent,
          backgroundColor: colors.surface,
          minHeight: size.touch / 2,
        },
      ]}
    >
      <Ionicons name={icon} size={size.tabIcon * 0.7} color={accent} />
      <Text variant="caption" style={styles.label}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderWidth: StyleSheet.hairlineWidth * 2,
  },
  label: { flexShrink: 1 },
});
