import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui';
import { maxFontMultiplier } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';

import type { ActivityViewName } from '../activity';

type ActivityViewSwitchProps = {
  value: ActivityViewName;
  onChange: (value: ActivityViewName) => void;
};

const VIEWS: { value: ActivityViewName; label: string }[] = [
  { value: 'activity', label: 'Activity' },
  { value: 'cuisine', label: 'Cuisine' },
];

// Activity / Cuisine for the activity grid (spec 15 Decision 7, the RequestsSwitch pattern). The
// selected view is a word ("Cuisine, selected"), a check mark and bold text, never colour alone.
// Each target is at least 44 pt and the pair wraps at large text. Switching is instant.
export function ActivityViewSwitch({ value, onChange }: ActivityViewSwitchProps) {
  const { colors, space, radius, size, stroke, type, weight } = useTheme();
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel="Grid view"
      style={[styles.group, { gap: space.sm }]}
    >
      {VIEWS.map((view) => {
        const selected = view.value === value;
        return (
          <Pressable
            key={view.value}
            testID={`activity-view-${view.value}`}
            onPress={() => onChange(view.value)}
            accessibilityRole="radio"
            accessibilityLabel={selected ? `${view.label}, selected` : view.label}
            accessibilityState={{ selected }}
            style={[
              styles.option,
              {
                minHeight: size.touch,
                minWidth: size.touch,
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
                testID={`activity-view-check-${view.value}`}
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
              {view.label}
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
