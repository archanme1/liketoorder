import Ionicons from '@expo/vector-icons/Ionicons';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { useTheme } from '@/theme/useTheme';

import { Text } from './Text';

type NavRowProps = {
  label: string;
  /** The current value or summary, e.g. "12 items · 2 menu photos". */
  value?: string;
  /** Replaces `value` while it loads (e.g. a Skeleton). */
  valueSlot?: ReactNode;
  onPress: () => void;
  /** When set, the row is disabled and this text says why. */
  disabledReason?: string;
  accessibilityHint?: string;
};

// A labelled row that opens another screen or a picker. ≥ 44pt, label + value read as one.
export function NavRow({
  label,
  value,
  valueSlot,
  onPress,
  disabledReason,
  accessibilityHint,
}: NavRowProps) {
  const { colors, space, radius, size, type, weight, opacity } = useTheme();
  const disabled = disabledReason !== undefined;
  return (
    <View style={{ gap: space.xs }}>
      <Pressable
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={value ? `${label}: ${value}` : label}
        accessibilityHint={disabledReason ?? accessibilityHint}
        accessibilityState={{ disabled }}
        style={({ pressed }) => [
          styles.row,
          {
            minHeight: size.touch,
            gap: space.md,
            paddingHorizontal: space.md,
            paddingVertical: space.sm,
            borderRadius: radius.md,
            borderColor: colors.border,
            backgroundColor: colors.surface,
            opacity: disabled ? opacity.disabled : pressed ? opacity.pressed : 1,
          },
        ]}
      >
        <View
          style={[styles.flex, { gap: space.xs }]}
          importantForAccessibility="no-hide-descendants"
        >
          <Text style={{ fontWeight: weight.semibold }}>{label}</Text>
          {valueSlot ?? (value ? <Text color="textMuted">{value}</Text> : null)}
        </View>
        {disabled ? null : (
          <Ionicons
            name="chevron-forward"
            size={type.bodyLg}
            color={colors.textMuted}
            accessibilityElementsHidden
            importantForAccessibility="no"
          />
        )}
      </Pressable>
      {disabledReason ? (
        <Text variant="caption" color="textMuted">
          {disabledReason}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', borderWidth: StyleSheet.hairlineWidth },
});
