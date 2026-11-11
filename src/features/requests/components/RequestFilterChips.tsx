import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui';
import { maxFontMultiplier } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';

import { FILTER_LABELS } from '../messages';
import { REQUEST_FILTERS, type RequestFilter } from '../schema';

type RequestFilterChipsProps = {
  value: RequestFilter;
  onChange: (value: RequestFilter) => void;
  /** What the group filters, spoken first ("Filter sent requests"). */
  groupLabel: string;
};

// All / Pending / Accepted / Declined, for Sent and Received alike (spec 11c). No counts. The
// selected one is a word ("Pending, selected"), a check mark and bold text, never colour alone.
// Each target is at least 44 pt and the chips wrap at large text.
export function RequestFilterChips({ value, onChange, groupLabel }: RequestFilterChipsProps) {
  const { colors, space, radius, size, stroke, type, weight } = useTheme();
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={groupLabel}
      style={[styles.group, { gap: space.sm }]}
    >
      {REQUEST_FILTERS.map((filter) => {
        const selected = filter === value;
        const label = FILTER_LABELS[filter];
        return (
          <Pressable
            key={filter}
            onPress={() => onChange(filter)}
            accessibilityRole="radio"
            accessibilityLabel={selected ? `${label}, selected` : label}
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
              {label}
            </Text>
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
