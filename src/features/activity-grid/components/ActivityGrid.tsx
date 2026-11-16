import { memo, useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, View, type ScrollViewInstance } from 'react-native';

import { Text } from '@/components/ui';
import { maxFontMultiplier } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';

import { isAfterToday, monthLabels, type IntensityLevel } from '../grid';

export type ActivityCell = { level: IntensityLevel; label: string };

export type LegendLabels = {
  less: string;
  more: string;
  /** Spoken for the whole legend, e.g. "Fewer to more uploads". */
  spoken: string;
};

type ActivityGridProps = {
  /** Columns of 7 dates, Sunday to Saturday (buildWeeks). */
  weeks: readonly (readonly string[])[];
  /** Every date up to today; a missing date shows as empty and speaks the date itself. */
  cells: Readonly<Record<string, ActivityCell>>;
  today: string;
  selectedDate: string | null;
  onSelectDate: (date: string) => void;
  summaryLabel: string;
  legendLabels: LegendLabels;
  locale?: string;
};

const LEVELS: readonly IntensityLevel[] = [0, 1, 2, 3];
const LEVEL_COLORS = ['grid0', 'grid1', 'grid2', 'grid3'] as const;

// A generic GitHub-style grid: one square per day, shaded by a level the caller works out. It
// knows nothing about uploads (spec 14, roadmap row 14). The squares are 14 pt, the one exception
// to the 44 pt rule (Decision 11): callers must offer every action through 44 pt controls too.
// Nothing animates; the grid opens at the latest week without a scroll animation.
export function ActivityGrid({
  weeks,
  cells,
  today,
  selectedDate,
  onSelectDate,
  summaryLabel,
  legendLabels,
  locale,
}: ActivityGridProps) {
  const { space, size } = useTheme();
  const scroll = useRef<ScrollViewInstance>(null);
  const column = size.gridCell + size.gridGap;
  const months = monthLabels(weeks, locale);

  return (
    <View style={{ gap: space.sm }}>
      <Text variant="caption" color="textMuted" accessibilityRole="summary">
        {summaryLabel}
      </Text>
      <ScrollView
        ref={scroll}
        horizontal
        showsHorizontalScrollIndicator={false}
        onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}
      >
        <View style={{ gap: space.xs }}>
          <View
            style={[
              styles.months,
              { height: size.gridCell + space.xs, width: weeks.length * column },
            ]}
            importantForAccessibility="no-hide-descendants"
            accessibilityElementsHidden
          >
            {months.map((month) => (
              <Text
                key={`${month.index}-${month.label}`}
                variant="caption"
                color="textMuted"
                maxFontSizeMultiplier={maxFontMultiplier}
                style={[styles.month, { left: month.index * column }]}
              >
                {month.label}
              </Text>
            ))}
          </View>
          <View style={[styles.row, { gap: size.gridGap }]}>
            {weeks.map((week) => (
              <View key={week[0]} style={{ gap: size.gridGap }}>
                {week.map((date) =>
                  isAfterToday(date, today) ? (
                    <View
                      key={date}
                      style={{ width: size.gridCell, height: size.gridCell }}
                      importantForAccessibility="no"
                      accessibilityElementsHidden
                    />
                  ) : (
                    <GridCell
                      key={date}
                      date={date}
                      level={cells[date]?.level ?? 0}
                      label={cells[date]?.label ?? date}
                      isToday={date === today}
                      selected={date === selectedDate}
                      onSelectDate={onSelectDate}
                    />
                  ),
                )}
              </View>
            ))}
          </View>
        </View>
      </ScrollView>
      <Legend labels={legendLabels} />
    </View>
  );
}

type GridCellProps = {
  date: string;
  level: IntensityLevel;
  label: string;
  isToday: boolean;
  selected: boolean;
  onSelectDate: (date: string) => void;
};

const GridCell = memo(function GridCell({
  date,
  level,
  label,
  isToday,
  selected,
  onSelectDate,
}: GridCellProps) {
  const { colors, size, radius, stroke } = useTheme();
  // The selected day has a 2 pt text border, today a primary one; an empty day a thin outline so
  // its shape shows (Decision 2). Both states are also in the label, never shown by colour alone.
  const border = selected
    ? { borderWidth: stroke.selected, borderColor: colors.text }
    : isToday
      ? { borderWidth: stroke.selected, borderColor: colors.primary }
      : level === 0
        ? { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.gridOutline }
        : null;

  return (
    <Pressable
      testID={`activity-cell-${date}`}
      onPress={() => onSelectDate(date)}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      style={[
        {
          width: size.gridCell,
          height: size.gridCell,
          borderRadius: radius.grid,
          backgroundColor: colors[LEVEL_COLORS[level]],
        },
        border,
      ]}
    />
  );
});

function Legend({ labels }: { labels: LegendLabels }) {
  const { colors, space, size, radius } = useTheme();
  return (
    <View accessible accessibilityLabel={labels.spoken} style={[styles.row, styles.legend]}>
      <Text variant="caption" color="textMuted" style={{ marginRight: space.xs }}>
        {labels.less}
      </Text>
      {LEVELS.map((level) => (
        <View
          key={level}
          style={{
            width: size.gridCell,
            height: size.gridCell,
            marginRight: size.gridGap,
            borderRadius: radius.grid,
            backgroundColor: colors[LEVEL_COLORS[level]],
            borderWidth: level === 0 ? StyleSheet.hairlineWidth : 0,
            borderColor: colors.gridOutline,
          }}
        />
      ))}
      <Text variant="caption" color="textMuted" style={{ marginLeft: space.xs }}>
        {labels.more}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
  legend: { alignItems: 'center', justifyContent: 'flex-end' },
  months: { position: 'relative' },
  month: { position: 'absolute', top: 0 },
});
