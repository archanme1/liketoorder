import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { View } from 'react-native';

import { Button, ErrorState, Skeleton, Text } from '@/components/ui';
import { ActivityDayList } from '@/features/activity-grid/components/ActivityDayList';
import { ActivityGrid } from '@/features/activity-grid/components/ActivityGrid';
import { ActivityStats } from '@/features/activity-grid/components/ActivityStats';
import { buildWeeks } from '@/features/activity-grid/grid';
import { useTheme } from '@/theme/useTheme';

import {
  ACTIVITY_EMPTY,
  ACTIVITY_LEGEND,
  ACTIVITY_LIST_EMPTY,
  buildActivityView,
  isEmptyActivity,
  statItems,
  summaryLabel,
} from '../activity';
import { useFoodLogActivity } from '../hooks/useFoodLogActivity';
import { foodLogErrorMessage } from '../messages';

import { DayPanel } from './DayPanel';
import { FoodLogRefreshError } from './FoodLogRefreshError';

type ActivitySectionProps = {
  /** 17 on Profile, 53 on Your year (Decision 1). */
  weeks: number;
  /** Profile shows the "View full year" button and a heading; Your year does not. */
  showFullYear?: boolean;
};

// My activity grid (spec 14): stats, the grid or its list view, and the chosen day's panel. The
// four states cover this section only, so the rest of Profile always renders. Every date and
// bound comes from the server's today and from, never from the phone clock.
export function ActivitySection({ weeks, showFullYear = false }: ActivitySectionProps) {
  const router = useRouter();
  const { space, size } = useTheme();
  const query = useFoodLogActivity(weeks);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [showList, setShowList] = useState(false);
  const activity = query.data;

  const view = useMemo(() => (activity ? buildActivityView(activity) : null), [activity]);
  const gridWeeks = useMemo(
    () => (activity ? buildWeeks(activity.from, activity.today) : []),
    [activity],
  );
  const onSelectDate = useCallback((date: string) => setSelectedDate(date), []);

  const heading = showFullYear ? (
    <Text variant="title" accessibilityRole="header">
      Your activity
    </Text>
  ) : null;

  if (query.isPending) {
    return (
      <View style={{ gap: space.md }}>
        {heading}
        <View
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel="Loading your activity"
          style={{ gap: space.md }}
        >
          <Skeleton height={size.touch} rounded="md" />
          <Skeleton height={size.photoLarge} rounded="md" />
        </View>
      </View>
    );
  }

  if (!activity || !view) {
    return (
      <View style={{ gap: space.md }}>
        {heading}
        <ErrorState
          message={foodLogErrorMessage(query.error?.code ?? 'unknown')}
          onRetry={() => void query.refetch()}
          retrying={query.isFetching}
        />
      </View>
    );
  }

  const empty = isEmptyActivity(activity);

  return (
    <View style={{ gap: space.md }}>
      {heading}
      {query.isRefetchError ? (
        <FoodLogRefreshError
          message={foodLogErrorMessage(query.error.code)}
          onRetry={() => void query.refetch()}
          retrying={query.isFetching}
          retryLabel="Try loading your activity again"
        />
      ) : null}
      <ActivityStats stats={statItems(activity.stats)} />
      {showList && !empty ? (
        <ActivityDayList
          rows={view.rows}
          selectedDate={selectedDate}
          onSelectDate={onSelectDate}
          emptyMessage={ACTIVITY_LIST_EMPTY}
        />
      ) : (
        <ActivityGrid
          weeks={gridWeeks}
          cells={view.cells}
          today={activity.today}
          selectedDate={selectedDate}
          onSelectDate={onSelectDate}
          summaryLabel={summaryLabel(weeks, view.total)}
          legendLabels={ACTIVITY_LEGEND}
        />
      )}
      {empty ? (
        <View style={{ gap: space.sm }}>
          <Text color="textMuted">{ACTIVITY_EMPTY}</Text>
          <Button title="Add photo" onPress={() => router.push('/food-log/new')} />
        </View>
      ) : (
        <View style={{ gap: space.sm }}>
          {showFullYear ? (
            <Button
              title="View full year"
              variant="secondary"
              onPress={() => router.push('/food-log/year')}
            />
          ) : null}
          <Button
            title={showList ? 'Show as grid' : 'Show as list'}
            variant="secondary"
            onPress={() => setShowList((shown) => !shown)}
          />
        </View>
      )}
      {selectedDate ? (
        <DayPanel
          date={selectedDate}
          from={activity.from}
          today={activity.today}
          onChangeDate={onSelectDate}
        />
      ) : null}
    </View>
  );
}
