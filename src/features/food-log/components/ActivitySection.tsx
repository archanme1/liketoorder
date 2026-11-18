import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { View } from 'react-native';

import { Button, ErrorState, Skeleton, Text } from '@/components/ui';
import { ActivityDayList } from '@/features/activity-grid/components/ActivityDayList';
import { ActivityGrid, type ActivityCell } from '@/features/activity-grid/components/ActivityGrid';
import { ActivityStats } from '@/features/activity-grid/components/ActivityStats';
import { buildWeeks } from '@/features/activity-grid/grid';
import { useCuisines } from '@/features/cuisines/hooks/useCuisines';
import { compareDates } from '@/lib/localDate';
import { useTheme } from '@/theme/useTheme';

import {
  ACTIVITY_EMPTY,
  ACTIVITY_LEGEND,
  ACTIVITY_LIST_EMPTY,
  buildActivityView,
  buildCuisineView,
  cuisineSummaryLabel,
  isEmptyActivity,
  statItems,
  summaryLabel,
  type ActivityViewName,
} from '../activity';
import { useFoodLogActivity } from '../hooks/useFoodLogActivity';
import { useFoodLogCuisineDays } from '../hooks/useFoodLogCuisineDays';
import { foodLogErrorMessage } from '../messages';

import { ActivityViewSwitch } from './ActivityViewSwitch';
import { CuisineDayGlyph, CuisineLegend } from './CuisineDayGlyph';
import { DayPanel } from './DayPanel';
import { FoodLogRefreshError } from './FoodLogRefreshError';

type ActivitySectionProps = {
  /** 17 on Profile, 53 on Your year (Decision 1). */
  weeks: number;
  /** Profile shows the "View full year" button and a heading; Your year does not. */
  showFullYear?: boolean;
  /** The view shown first (spec 15): Your year opens in the view Profile was showing. */
  initialView?: ActivityViewName;
};

// My activity grid (spec 14): stats, the grid or its list view, and the chosen day's panel. The
// four states cover this section only, so the rest of Profile always renders. Every date and
// bound comes from the server's today and from, never from the phone clock.
//
// Spec 15 adds the Activity / Cuisine switch. The view lives in this state only (Decision 5). The
// stats and the empty state always come from the activity query; the grid on screen, its today,
// the day panel's Previous / Next limits and the selected day use the range of the query that
// drew it, so a selection outside that range is cleared after a switch (not after a refresh).
export function ActivitySection({
  weeks,
  showFullYear = false,
  initialView = 'activity',
}: ActivitySectionProps) {
  const router = useRouter();
  const { space, size } = useTheme();
  const [view, setView] = useState<ActivityViewName>(initialView);
  const cuisineShown = view === 'cuisine';
  const query = useFoodLogActivity(weeks);
  const activity = query.data;
  // Only while Cuisine is on screen over a loaded, non-empty activity: no cuisine request is sent
  // in Activity, before the activity loads, or for an empty account.
  const cuisineEnabled = cuisineShown && activity !== undefined && !isEmptyActivity(activity);
  const cuisineQuery = useFoodLogCuisineDays(weeks, cuisineEnabled);
  const catalog = useCuisines({ enabled: cuisineEnabled });
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [showList, setShowList] = useState(false);
  // Set by a switch: once the new view's grid has its range, a chosen day outside it is cleared.
  // A refresh never clears it (spec 14 review Q7: the chosen day stays, Previous / Next follow).
  const [checkRange, setCheckRange] = useState(false);
  const cuisineDays = cuisineQuery.data;
  const cuisineList = catalog.data;

  const activityView = useMemo(() => (activity ? buildActivityView(activity) : null), [activity]);
  const cuisineView = useMemo(
    () => (cuisineDays && cuisineList ? buildCuisineView(cuisineDays, cuisineList) : null),
    [cuisineDays, cuisineList],
  );
  // Built once per data change, so the memoized grid squares keep the same glyph elements.
  const cuisineCells = useMemo(() => {
    if (!cuisineView) return null;
    const cells: Record<string, ActivityCell> = {};
    for (const [date, cell] of Object.entries(cuisineView.cells)) {
      cells[date] = {
        level: 0,
        label: cell.label,
        glyph: cell.glyph ? <CuisineDayGlyph glyph={cell.glyph} /> : undefined,
      };
    }
    return cells;
  }, [cuisineView]);

  // The range of the grid on screen; null while the Cuisine grid is loading or failed.
  const range = cuisineShown ? (cuisineView && cuisineDays ? cuisineDays : null) : activity;
  const rangeFrom = range?.from;
  const rangeToday = range?.today;
  const gridWeeks = useMemo(
    () => (rangeFrom && rangeToday ? buildWeeks(rangeFrom, rangeToday) : []),
    [rangeFrom, rangeToday],
  );
  const onSelectDate = useCallback((date: string) => setSelectedDate(date), []);
  const onChangeView = useCallback((next: ActivityViewName) => {
    setView(next);
    setCheckRange(true);
  }, []);
  // React Query keeps each refetch function stable, so this callback is too.
  const refetchCatalog = catalog.refetch;
  const refetchCuisineDays = cuisineQuery.refetch;
  const retryCuisine = useCallback(
    () => void Promise.all([refetchCatalog(), refetchCuisineDays()]),
    [refetchCatalog, refetchCuisineDays],
  );

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

  if (!activity || !activityView) {
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
  // An empty section hides the list toggle, so it goes back to the grid: the next photo after
  // deleting the last one shows the grid, never a list the person can't switch off. It hides the
  // view switch too, so it goes back to Activity.
  if (empty && showList) setShowList(false); // guarded, converges in one pass
  if (empty && cuisineShown) setView('activity'); // guarded, converges in one pass
  // After a switch, a day outside the new view's range (midnight passed between the two queries)
  // is cleared and the panel closes. Waits while the Cuisine grid loads or has failed: there is
  // no range yet to check the day against, so the day is kept and its panel hidden until the grid
  // is drawn, then it comes back if it is still in range.
  if (checkRange && rangeFrom && rangeToday) {
    setCheckRange(false); // guarded, converges in one pass
    if (
      selectedDate &&
      (compareDates(selectedDate, rangeFrom) < 0 || compareDates(selectedDate, rangeToday) > 0)
    ) {
      setSelectedDate(null); // guarded, converges in one pass
    }
  }

  let gridArea: ReactNode;
  if (!cuisineShown) {
    gridArea =
      showList && !empty ? (
        <ActivityDayList
          rows={activityView.rows}
          selectedDate={selectedDate}
          onSelectDate={onSelectDate}
          emptyMessage={ACTIVITY_LIST_EMPTY}
        />
      ) : (
        <ActivityGrid
          weeks={gridWeeks}
          cells={activityView.cells}
          today={activity.today}
          selectedDate={selectedDate}
          onSelectDate={onSelectDate}
          summaryLabel={summaryLabel(weeks, activityView.total)}
          legendLabels={ACTIVITY_LEGEND}
        />
      );
  } else if (cuisineView && cuisineCells && cuisineDays) {
    gridArea = showList ? (
      <ActivityDayList
        rows={cuisineView.rows}
        selectedDate={selectedDate}
        onSelectDate={onSelectDate}
        emptyMessage={ACTIVITY_LIST_EMPTY}
      />
    ) : (
      <ActivityGrid
        weeks={gridWeeks}
        cells={cuisineCells}
        today={cuisineDays.today}
        selectedDate={selectedDate}
        onSelectDate={onSelectDate}
        summaryLabel={cuisineSummaryLabel(weeks, cuisineView.total)}
        legend={<CuisineLegend />}
      />
    );
  } else if ((cuisineQuery.isError && !cuisineDays) || (catalog.isError && !cuisineList)) {
    // The cuisine days or the catalog failed: Retry reloads both.
    gridArea = (
      <ErrorState
        message={foodLogErrorMessage(
          cuisineQuery.error?.code ?? (catalog.error?.code === 'network' ? 'network' : 'unknown'),
        )}
        onRetry={retryCuisine}
        retrying={cuisineQuery.isFetching || catalog.isFetching}
      />
    );
  } else {
    gridArea = (
      <View accessible accessibilityRole="progressbar" accessibilityLabel="Loading cuisines">
        <Skeleton height={size.photoLarge} rounded="md" />
      </View>
    );
  }

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
      {cuisineShown && cuisineQuery.isRefetchError ? (
        <FoodLogRefreshError
          message={foodLogErrorMessage(cuisineQuery.error.code)}
          onRetry={() => void cuisineQuery.refetch()}
          retrying={cuisineQuery.isFetching}
          retryLabel="Try loading your cuisines again"
        />
      ) : null}
      <ActivityStats stats={statItems(activity.stats)} />
      {empty ? null : <ActivityViewSwitch value={view} onChange={onChangeView} />}
      {gridArea}
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
              onPress={() =>
                cuisineShown
                  ? router.push({ pathname: '/food-log/year', params: { view: 'cuisine' } })
                  : router.push('/food-log/year')
              }
            />
          ) : null}
          <Button
            title={showList ? 'Show as grid' : 'Show as list'}
            variant="secondary"
            onPress={() => setShowList((shown) => !shown)}
          />
        </View>
      )}
      {selectedDate && rangeFrom && rangeToday ? (
        <DayPanel
          date={selectedDate}
          from={rangeFrom}
          today={rangeToday}
          onChangeDate={onSelectDate}
        />
      ) : null}
    </View>
  );
}
