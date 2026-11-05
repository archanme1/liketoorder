import { StyleSheet, Switch, View } from 'react-native';

import { Text } from '@/components/ui';
import { useTheme } from '@/theme/useTheme';

type LabelledSwitchProps = {
  label: string;
  description?: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
};

// A Switch with a visible label and an "On"/"Off" word, so the state never relies on color alone.
export function LabelledSwitch({
  label,
  description,
  value,
  onValueChange,
  disabled = false,
}: LabelledSwitchProps) {
  const { colors, space, size, weight } = useTheme();
  return (
    <View style={[styles.row, { gap: space.md, minHeight: size.touch }]}>
      <View
        style={[styles.flex, { gap: space.xs }]}
        importantForAccessibility="no-hide-descendants"
      >
        <Text style={{ fontWeight: weight.semibold }}>{label}</Text>
        {description ? <Text color="textMuted">{description}</Text> : null}
      </View>
      <Text color="textMuted" importantForAccessibility="no" accessibilityElementsHidden>
        {value ? 'On' : 'Off'}
      </Text>
      <Switch
        // The native switch is about 31pt tall; the slop brings its touch area to 44pt or more.
        hitSlop={{ top: space.sm, bottom: space.sm, left: space.sm, right: space.sm }}
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        accessibilityRole="switch"
        accessibilityLabel={label}
        accessibilityHint={description}
        accessibilityState={{ checked: value, disabled }}
        trackColor={{ false: colors.border, true: colors.primary }}
        thumbColor={colors.surface}
        ios_backgroundColor={colors.border}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
});
