import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui';
import { useTheme } from '@/theme/useTheme';

import type { InboxFilter as Filter } from '../schema';

const OPTIONS: { value: Filter; label: string }[] = [
  { value: 'waiting', label: 'Waiting' },
  { value: 'all', label: 'All' },
];

type InboxFilterProps = {
  value: Filter;
  onChange: (value: Filter) => void;
};

// Waiting / All. The selected one is a word ("Waiting, selected"), a check mark and bold text,
// never colour alone. Each target is at least 44 pt and the pair wraps at large text.
export function InboxFilter({ value, onChange }: InboxFilterProps) {
  const { colors, space, radius, size, type, weight } = useTheme();
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel="Show requests"
      style={[styles.group, { gap: space.sm }]}
    >
      {OPTIONS.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            accessibilityRole="radio"
            accessibilityLabel={selected ? `${option.label}, selected` : option.label}
            accessibilityState={{ selected }}
            style={[
              styles.option,
              {
                minHeight: size.touch,
                gap: space.xs,
                paddingHorizontal: space.lg,
                paddingVertical: space.sm,
                borderRadius: radius.pill,
                borderColor: selected ? colors.primary : colors.border,
                backgroundColor: selected ? colors.surface : 'transparent',
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
              maxFontSizeMultiplier={1.6}
              style={selected ? { fontWeight: weight.semibold } : undefined}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { flexDirection: 'row', flexWrap: 'wrap' },
  option: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
});
