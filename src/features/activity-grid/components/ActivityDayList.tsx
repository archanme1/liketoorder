import { Pressable, StyleSheet, View } from 'react-native';

import { EmptyState, Text } from '@/components/ui';
import { useTheme } from '@/theme/useTheme';

export type ActivityDayRow = { date: string; label: string };

type ActivityDayListProps = {
  /** The days to list, in the order to show them. */
  rows: readonly ActivityDayRow[];
  selectedDate: string | null;
  onSelectDate: (date: string) => void;
  emptyMessage: string;
};

// The grid as a list (spec 14 Decision 11): the text and 44 pt alternative to the small squares.
// Bounded by the grid's range (at most 371 rows), so it does not page.
export function ActivityDayList({
  rows,
  selectedDate,
  onSelectDate,
  emptyMessage,
}: ActivityDayListProps) {
  const { colors, space, size, radius, stroke, opacity } = useTheme();
  if (rows.length === 0) return <EmptyState message={emptyMessage} />;
  return (
    <View style={{ gap: space.sm }}>
      {rows.map((row) => {
        const selected = row.date === selectedDate;
        return (
          <Pressable
            key={row.date}
            testID={`activity-day-${row.date}`}
            onPress={() => onSelectDate(row.date)}
            accessibilityRole="button"
            accessibilityLabel={row.label}
            accessibilityState={{ selected }}
            style={({ pressed }) => [
              styles.row,
              {
                minHeight: size.touch,
                minWidth: size.touch,
                paddingHorizontal: space.md,
                borderRadius: radius.md,
                backgroundColor: colors.surface,
                borderWidth: selected ? stroke.selected : StyleSheet.hairlineWidth,
                borderColor: selected ? colors.text : colors.border,
                opacity: pressed ? opacity.pressed : 1,
              },
            ]}
          >
            <Text>{row.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { justifyContent: 'center' },
});
