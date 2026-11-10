import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui';
import { maxFontMultiplier } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';

export type ReasonOption<T extends string> = { code: T; label: string };

type DeclineReasonListProps<T extends string> = {
  options: readonly ReasonOption<T>[];
  reason: T | null;
  onChange: (reason: T) => void;
};

// The radio rows of one list of decline reasons. It knows nothing about pickups or tables: the
// caller hands in the options of its own kind, so a reason of the other kind cannot be chosen or
// passed back. The chosen row is a word ("selected"), a check mark and bold text, never colour
// alone. Each row is at least 44 pt and wraps at large text.
export function DeclineReasonList<T extends string>({
  options,
  reason,
  onChange,
}: DeclineReasonListProps<T>) {
  const { colors, space, radius, size, stroke, type, weight } = useTheme();
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel="Reason for declining"
      style={{ gap: space.sm }}
    >
      {options.map(({ code, label }) => {
        const selected = code === reason;
        return (
          <Pressable
            key={code}
            onPress={() => onChange(code)}
            accessibilityRole="radio"
            accessibilityLabel={selected ? `${label}, selected` : label}
            accessibilityState={{ selected }}
            style={[
              styles.row,
              {
                minHeight: size.touch,
                gap: space.sm,
                paddingHorizontal: space.md,
                paddingVertical: space.sm,
                borderRadius: radius.md,
                borderWidth: selected ? stroke.selected : StyleSheet.hairlineWidth,
                borderColor: selected ? colors.primary : colors.border,
                backgroundColor: selected ? colors.surface : undefined,
              },
            ]}
          >
            <Ionicons
              name={selected ? 'radio-button-on' : 'radio-button-off'}
              size={type.bodyLg}
              color={selected ? colors.primary : colors.textMuted}
              accessibilityElementsHidden
              importantForAccessibility="no"
            />
            <Text
              style={[styles.label, selected ? { fontWeight: weight.semibold } : undefined]}
              maxFontSizeMultiplier={maxFontMultiplier}
            >
              {label}
            </Text>
            {selected ? (
              <Ionicons
                name="checkmark"
                size={type.bodyLg}
                color={colors.primary}
                accessibilityElementsHidden
                importantForAccessibility="no"
              />
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  label: { flex: 1 },
});
