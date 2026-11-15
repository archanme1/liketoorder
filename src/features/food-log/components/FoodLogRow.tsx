import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui';
import { CuisineLabel } from '@/features/cuisines/components/CuisineLabel';
import { useCuisine } from '@/features/cuisines/hooks/useCuisines';
import { PhotoTile } from '@/features/media/components/PhotoTile';
import { useTheme } from '@/theme/useTheme';

import { formatLocalDate } from '../date';
import { NO_DESCRIPTION } from '../messages';
import type { FoodLog } from '../schema';
import { cuisineName } from '../shared';

/** "Food photo, Italy, Sat, Nov 14, 2026. Pasta. Private" (Private only when private). */
export function foodLogRowLabel(log: FoodLog, cuisineName: string, locale?: string): string {
  const description = log.description ?? NO_DESCRIPTION;
  const date = formatLocalDate(log.local_date, locale);
  return `Food photo, ${cuisineName}, ${date}. ${description}.${log.is_public ? '' : ' Private'}`;
}

type FoodLogRowProps = {
  log: FoodLog;
  uri: string | null | undefined;
  onExpired: (path: string) => void;
  onPress: (log: FoodLog) => void;
  locale?: string;
};

// One upload in my list: square thumbnail, cuisine, date, one line of the description and the word
// "Private" on private rows. The whole row is one button with one spoken label.
export const FoodLogRow = memo(function FoodLogRow({
  log,
  uri,
  onExpired,
  onPress,
  locale,
}: FoodLogRowProps) {
  const { colors, space, size, radius, opacity, weight } = useTheme();
  const cuisine = useCuisine(log.cuisine_code);
  const label = foodLogRowLabel(log, cuisineName(cuisine), locale);

  return (
    <Pressable
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
            size={size.photoThumb}
          />
        ) : null}
      </View>
      <View
        style={[styles.text, { gap: space.xs }]}
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
      >
        <CuisineLabel code={log.cuisine_code} />
        <Text color="textMuted">{formatLocalDate(log.local_date, locale)}</Text>
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
