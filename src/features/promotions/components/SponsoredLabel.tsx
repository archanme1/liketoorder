import { View } from 'react-native';

import { Text } from '@/components/ui';
import { useTheme } from '@/theme/useTheme';

export const SPONSORED_TEXT = 'Sponsored';

// The written "Sponsored" on a promoted place (spec 16 M3): at the top of the map sheet, on the
// places list row and on the Offers card. Always text, never colour alone, and it scales with the
// system text size. Hidden from screen readers on purpose: whoever shows it also ends the place's
// spoken label with ", sponsored", so it is heard once, in the same breath as the name.
export function SponsoredLabel() {
  const { space, radius, colors, weight } = useTheme();
  return (
    <View
      testID="sponsored-label"
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        alignSelf: 'flex-start',
        paddingHorizontal: space.sm,
        borderRadius: radius.sm,
        backgroundColor: colors.surfaceAlt,
      }}
    >
      <Text variant="caption" color="textMuted" style={{ fontWeight: weight.semibold }}>
        {SPONSORED_TEXT}
      </Text>
    </View>
  );
}
