import { StyleSheet } from 'react-native';

import { Text } from '@/components/ui';
import { weight } from '@/theme/tokens';

// Four tabs share the screen width, so the labels can't grow with the system text size like body
// text: at the largest sizes "Restaurants" would be cut to "Rest". 1.3 keeps every label whole
// on a phone-width bar (the icon and the "<name> tab" accessibility label are unaffected, and
// everything else in the app still scales fully).
export const TAB_LABEL_MAX_FONT_MULTIPLIER = 1.3;

type TabLabelProps = {
  label: string;
  focused: boolean;
};

// Always visible; bold when focused so focus isn't shown by color alone.
export function TabLabel({ label, focused }: TabLabelProps) {
  return (
    <Text
      variant="caption"
      maxFontSizeMultiplier={TAB_LABEL_MAX_FONT_MULTIPLIER}
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
