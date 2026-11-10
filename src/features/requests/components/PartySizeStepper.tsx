import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui';
import { maxFontMultiplier } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';

import { MAX_PARTY_SIZE, MIN_PARTY_SIZE } from '../schema';

type PartySizeStepperProps = {
  size: number;
  onChange: (size: number) => void;
  /** Read-only, e.g. while the request is being sent. */
  disabled?: boolean;
};

// How many people: 1 to 20. Not QuantityStepper, which is for menu items (it may go down to 0 and
// speaks an item name); the buttons are the same 44 pt targets and the count is spoken as words.
export function PartySizeStepper({ size, onChange, disabled = false }: PartySizeStepperProps) {
  const { colors, space, radius, size: sizes, opacity } = useTheme();
  const canDecrease = !disabled && size > MIN_PARTY_SIZE;
  const canIncrease = !disabled && size < MAX_PARTY_SIZE;
  const people = size === 1 ? '1 person' : `${size} people`;
  const button = (off: boolean) => [
    styles.button,
    {
      minHeight: sizes.touch,
      minWidth: sizes.touch,
      borderRadius: radius.md,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      opacity: off ? opacity.disabled : 1,
    },
  ];
  return (
    <View style={[styles.row, { gap: space.sm }]}>
      <Pressable
        onPress={() => onChange(size - 1)}
        disabled={!canDecrease}
        accessibilityRole="button"
        accessibilityLabel={`Fewer people, now ${people}`}
        accessibilityState={{ disabled: !canDecrease }}
        style={button(!canDecrease)}
      >
        <Ionicons name="remove" size={sizes.tabIcon} color={colors.text} />
      </Pressable>
      <Text
        style={[styles.count, { minWidth: space.xl }]}
        accessibilityLabel={`Party of ${size}`}
        maxFontSizeMultiplier={maxFontMultiplier}
      >
        {size}
      </Text>
      <Pressable
        onPress={() => onChange(size + 1)}
        disabled={!canIncrease}
        accessibilityRole="button"
        accessibilityLabel={`More people, now ${people}`}
        accessibilityState={{ disabled: !canIncrease }}
        style={button(!canIncrease)}
      >
        <Ionicons name="add" size={sizes.tabIcon} color={colors.text} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  button: { alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth },
  count: { textAlign: 'center' },
});
