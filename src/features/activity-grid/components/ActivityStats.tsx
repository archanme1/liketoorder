import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui';
import { maxFontMultiplier } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';

export type ActivityStat = {
  /** Visible label under the value, e.g. "Current streak". */
  label: string;
  /** Visible value, e.g. "4". */
  value: string;
  /** One spoken element, e.g. "Current streak, 4 days". */
  spokenLabel: string;
};

// A row of stats as text: each one is a single accessible element (spec 14).
export function ActivityStats({ stats }: { stats: readonly ActivityStat[] }) {
  const { space } = useTheme();
  return (
    <View style={[styles.row, { gap: space.md }]}>
      {stats.map((stat) => (
        <View
          key={stat.label}
          accessible
          accessibilityLabel={stat.spokenLabel}
          style={[styles.item, { gap: space.xs, minWidth: space.xxl * 2 }]}
        >
          <Text variant="title" maxFontSizeMultiplier={maxFontMultiplier}>
            {stat.value}
          </Text>
          <Text variant="caption" color="textMuted">
            {stat.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap' },
  item: { flexGrow: 1, flexBasis: 0 },
});
