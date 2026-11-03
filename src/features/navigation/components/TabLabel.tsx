import { StyleSheet } from 'react-native';

import { Text } from '@/components/ui';
import { weight } from '@/theme/tokens';

type TabLabelProps = {
  label: string;
  focused: boolean;
};

// Always visible; bold when focused so focus isn't shown by color alone.
export function TabLabel({ label, focused }: TabLabelProps) {
  return (
    <Text
      variant="caption"
      color={focused ? 'primary' : 'textMuted'}
      style={focused ? styles.focused : styles.unfocused}
    >
      {label}
    </Text>
  );
}

const styles = StyleSheet.create({
  focused: { fontWeight: weight.bold },
  unfocused: { fontWeight: weight.regular },
});
