import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui';
import { useTheme } from '@/theme/useTheme';

import type { BusinessType } from '../schema';

const OPTIONS: readonly {
  type: BusinessType;
  title: string;
  description: string;
  icon: 'restaurant-outline' | 'home-outline';
}[] = [
  {
    type: 'restaurant',
    title: 'Restaurant',
    description: 'A place customers visit. Your address is shown on the map.',
    icon: 'restaurant-outline',
  },
  {
    type: 'homemade',
    title: 'Homemade',
    description: 'Food you cook at home. The map shows an approximate area only.',
    icon: 'home-outline',
  },
];

type BusinessTypePickerProps = {
  value: BusinessType | null;
  onChange: (type: BusinessType) => void;
  error?: string;
};

// Two large radio cards. Selection shows as a check icon and a thicker border, never color alone.
export function BusinessTypePicker({ value, onChange, error }: BusinessTypePickerProps) {
  const { colors, space, radius, size, type, weight, opacity, stroke } = useTheme();

  return (
    <View style={{ gap: space.sm }}>
      <Text style={{ fontWeight: weight.semibold }}>What do you sell?</Text>
      <View accessibilityRole="radiogroup" style={{ gap: space.sm }}>
        {OPTIONS.map((option) => {
          const checked = value === option.type;
          return (
            <Pressable
              key={option.type}
              onPress={() => onChange(option.type)}
              accessibilityRole="radio"
              accessibilityState={{ checked }}
              accessibilityLabel={option.title}
              accessibilityHint={option.description}
              style={({ pressed }) => [
                styles.card,
                {
                  minHeight: size.touch,
                  gap: space.md,
                  padding: space.lg,
                  borderRadius: radius.lg,
                  borderWidth: checked ? stroke.selected : StyleSheet.hairlineWidth,
                  borderColor: checked ? colors.primary : colors.border,
                  backgroundColor: colors.surface,
                  opacity: pressed ? opacity.pressed : 1,
                },
              ]}
            >
              <Ionicons
                name={option.icon}
                size={type.h1}
                color={colors.text}
                accessibilityElementsHidden
                importantForAccessibility="no"
              />
              <View style={[styles.flex, { gap: space.xs }]}>
                <Text variant="bodyLg" style={{ fontWeight: weight.semibold }}>
                  {option.title}
                </Text>
                <Text color="textMuted">{option.description}</Text>
              </View>
              <Ionicons
                name={checked ? 'checkmark-circle' : 'ellipse-outline'}
                size={type.title}
                color={checked ? colors.primary : colors.textMuted}
                accessibilityElementsHidden
                importantForAccessibility="no"
              />
            </Pressable>
          );
        })}
      </View>
      {error ? (
        <Text variant="caption" color="danger" accessibilityLiveRegion="polite">
          {`⚠ ${error}`}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { flexDirection: 'row', alignItems: 'center' },
});
