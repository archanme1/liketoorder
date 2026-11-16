import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui';
import { CuisineLabel } from '@/features/cuisines/components/CuisineLabel';
import { useCuisine } from '@/features/cuisines/hooks/useCuisines';
import { PhotoTile } from '@/features/media/components/PhotoTile';
import { useTheme } from '@/theme/useTheme';

import { NO_DESCRIPTION } from '../messages';
import type { FoodLog } from '../schema';
import { cuisineName } from '../shared';

/** "Food photo, Italy. Pasta. Private" (Private only when private). No date and no time. */
export function dayPanelRowLabel(log: FoodLog, cuisineName: string): string {
  const description = log.description?.replace(/\s+/g, ' ') ?? NO_DESCRIPTION;
  return `Food photo, ${cuisineName}. ${description}.${log.is_public ? '' : ' Private'}`;
}

type DayPanelRowProps = {
  log: FoodLog;
  uri: string | null | undefined;
  onExpired: (path: string) => void;
  onPress: (log: FoodLog) => void;
};

// One upload in the day panel (spec 14): thumbnail, cuisine, one line of the description and the
// word "Private" on private rows. No time is shown (Decision 12): a time from created_at in the
// phone's zone could contradict the stored day after travel. The whole row is one button with one
// spoken label, as in FoodLogRow; the flag is decorative and hidden.
export const DayPanelRow = memo(function DayPanelRow({
  log,
  uri,
  onExpired,
  onPress,
}: DayPanelRowProps) {
  const { colors, space, size, radius, opacity, weight } = useTheme();
  const cuisine = useCuisine(log.cuisine_code);
  const label = dayPanelRowLabel(log, cuisineName(cuisine));

  return (
    <Pressable
      testID={`day-panel-row-${log.id}`}
      onPress={() => onPress(log)}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="Opens the photo."
      style={({ pressed }) => [
        styles.row,
        {
          gap: space.md,
          padding: space.sm,
          minHeight: size.touch,
          minWidth: size.touch,
          borderRadius: radius.md,
          backgroundColor: colors.surface,
          borderColor: colors.border,
          opacity: pressed ? opacity.pressed : 1,
        },
      ]}
    >
      <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        {log.path ? (
          <PhotoTile
            path={log.path}
            uri={uri}
            accessibilityLabel={label}
            onExpired={onExpired}
            size={size.photoMini}
          />
        ) : null}
      </View>
      <View
        style={[styles.text, { gap: space.xs }]}
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
      >
        <CuisineLabel code={log.cuisine_code} />
        {log.description ? <Text numberOfLines={1}>{log.description}</Text> : null}
        {log.is_public ? null : <Text style={{ fontWeight: weight.semibold }}>Private</Text>}
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', borderWidth: StyleSheet.hairlineWidth },
  text: { flex: 1 },
});
