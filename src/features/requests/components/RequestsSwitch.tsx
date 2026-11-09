import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui';
import { formatBadge } from '@/features/navigation/components/TabBadge';
import { maxFontMultiplier } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';

export type RequestsSide = 'received' | 'sent';

type RequestsSwitchProps = {
  value: RequestsSide;
  onChange: (value: RequestsSide) => void;
  /** Requests waiting for this person's answer. Undefined while loading or failed: no number. */
  receivedCount: number | undefined;
  /** Own requests that changed since the Sent list was last opened. Undefined: no number. */
  sentCount: number | undefined;
};

const SIDES: { value: RequestsSide; label: string; unit: string }[] = [
  { value: 'received', label: 'Received', unit: 'need you' },
  { value: 'sent', label: 'Sent', unit: 'updated' },
];

// Received / Sent for a business owner. The selected side is a word ("Received, 3 need you,
// selected"), a check mark and bold text, never colour alone. The number is text too, in the
// spoken label as well. Each target is at least 44 pt and the pair wraps at large text.
export function RequestsSwitch({ value, onChange, receivedCount, sentCount }: RequestsSwitchProps) {
  const { colors, space, radius, size, stroke, type, weight } = useTheme();
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel="Requests"
      style={[styles.group, { gap: space.sm }]}
    >
      {SIDES.map((side) => {
        const selected = side.value === value;
        const count = side.value === 'received' ? receivedCount : sentCount;
        const shown = formatBadge(count);
        const spoken = [
          side.label,
          shown ? `${count} ${side.unit}` : null,
          selected ? 'selected' : null,
        ]
          .filter(Boolean)
          .join(', ');
        return (
          <Pressable
            key={side.value}
            onPress={() => onChange(side.value)}
            accessibilityRole="radio"
            accessibilityLabel={spoken}
            accessibilityState={{ selected }}
            style={[
              styles.option,
              {
                minHeight: size.touch,
                gap: space.xs,
                paddingHorizontal: space.lg,
                paddingVertical: space.sm,
                borderRadius: radius.pill,
                borderWidth: selected ? stroke.selected : StyleSheet.hairlineWidth,
                borderColor: selected ? colors.primary : colors.border,
                backgroundColor: selected ? colors.surface : undefined,
              },
            ]}
          >
            {selected ? (
              <Ionicons
                name="checkmark"
                size={type.bodyLg}
                color={colors.primary}
                accessibilityElementsHidden
                importantForAccessibility="no"
              />
            ) : null}
            <Text
              maxFontSizeMultiplier={maxFontMultiplier}
              style={selected ? { fontWeight: weight.semibold } : undefined}
            >
              {side.label}
            </Text>
            {shown ? (
              <Text
                testID={`switch-count-${side.value}`}
                maxFontSizeMultiplier={maxFontMultiplier}
                style={{ fontWeight: weight.bold }}
                color="primary"
              >
                {shown}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { flexDirection: 'row', flexWrap: 'wrap' },
  option: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
});
