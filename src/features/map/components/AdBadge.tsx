import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Text } from '@/components/ui';
import { useTheme } from '@/theme/useTheme';

export const AD_BADGE_TEXT = 'Ad';

/** Every promoted marker's spoken name ends with this (spec 16): never colour or size alone. */
export function sponsoredLabel(label: string): string {
  return `${label}, sponsored`;
}

// The small written "Ad" on a promoted marker. Dark text on the ring colour (about 10:1). The
// marker is drawn as a fixed-size picture, so the badge does not grow with the system text size;
// the spoken label carries "sponsored" instead, so the badge itself is hidden from screen readers.
export function AdBadge({ style }: { style?: StyleProp<ViewStyle> }) {
  const { colors, radius, space, weight } = useTheme();
  return (
    <View
      testID="ad-badge"
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.badge,
        { backgroundColor: colors.adRing, borderRadius: radius.sm, paddingHorizontal: space.xs },
        style,
      ]}
    >
      <Text variant="caption" maxFontSizeMultiplier={1} style={{ fontWeight: weight.bold }}>
        {AD_BADGE_TEXT}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { position: 'absolute' },
});
