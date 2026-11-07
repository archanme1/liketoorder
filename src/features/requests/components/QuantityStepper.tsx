import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui';
import { useTheme } from '@/theme/useTheme';

import { MAX_QUANTITY } from '../schema';

type QuantityStepperProps = {
  itemName: string;
  quantity: number;
  onChange: (quantity: number) => void;
};

export function QuantityStepper({ itemName, quantity, onChange }: QuantityStepperProps) {
  const { colors, space, radius, size, opacity } = useTheme();
  const canDecrease = quantity > 0;
  const canIncrease = quantity < MAX_QUANTITY;
  const button = (disabled: boolean) => [
    styles.button,
    {
      minHeight: size.touch,
      minWidth: size.touch,
      borderRadius: radius.md,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      opacity: disabled ? opacity.disabled : 1,
    },
  ];
  return (
    <View style={[styles.row, { gap: space.sm }]}>
      <Pressable
        onPress={() => onChange(quantity - 1)}
        disabled={!canDecrease}
        accessibilityRole="button"
        accessibilityLabel={`Decrease ${itemName} quantity, now ${quantity}`}
        accessibilityState={{ disabled: !canDecrease }}
        style={button(!canDecrease)}
      >
        <Ionicons name="remove" size={size.tabIcon} color={colors.text} />
      </Pressable>
      <Text
        style={[styles.count, { minWidth: space.xl }]}
        accessibilityLabel={`${quantity} ${itemName}`}
      >
        {quantity}
      </Text>
      <Pressable
        onPress={() => onChange(quantity + 1)}
        disabled={!canIncrease}
        accessibilityRole="button"
        accessibilityLabel={`Increase ${itemName} quantity, now ${quantity}`}
        accessibilityState={{ disabled: !canIncrease }}
        style={button(!canIncrease)}
      >
        <Ionicons name="add" size={size.tabIcon} color={colors.text} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  button: { alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth },
  count: { textAlign: 'center' },
});
