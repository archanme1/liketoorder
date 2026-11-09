import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui';
import { TAB_LABEL_MAX_FONT_MULTIPLIER } from '@/features/navigation/components/TabLabel';
import { useTheme } from '@/theme/useTheme';

export const BADGE_CAP = 99;

/** The number shown on the tab: "3", "99+"; nothing for zero or an unknown count. */
export function formatBadge(count: number | undefined): string | null {
  if (count === undefined || count <= 0) return null;
  return count > BADGE_CAP ? `${BADGE_CAP}+` : String(count);
}

/** The same number for the tab's spoken label: "3 new", "more than 99 new". */
export function spokenBadge(count: number | undefined): string | null {
  if (count === undefined || count <= 0) return null;
  return count > BADGE_CAP ? `more than ${BADGE_CAP} new` : `${count} new`;
}

type TabBadgeProps = { count: number | undefined };

// A small number over the tab icon. Hidden from the screen reader because the tab's own
// accessibility label already says it ("Requests tab, 3 new"), so it is not read twice. The word
// "new" lives in that label; the shape here is a number in a filled pill, readable without colour.
export function TabBadge({ count }: TabBadgeProps) {
  const { colors, space, radius, size } = useTheme();
  const text = formatBadge(count);
  if (text === null) return null;
  return (
    <View
      testID="tab-badge"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.badge,
        {
          minWidth: size.tabIcon * 0.75,
          paddingHorizontal: space.xs,
          borderRadius: radius.pill,
          backgroundColor: colors.danger,
          top: -space.xs,
          right: -space.md,
        },
      ]}
    >
      <Text
        variant="caption"
        color="primaryText"
        maxFontSizeMultiplier={TAB_LABEL_MAX_FONT_MULTIPLIER}
        style={styles.text}
      >
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  text: { textAlign: 'center' },
});
