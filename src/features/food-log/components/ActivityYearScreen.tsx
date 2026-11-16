import { RefreshControl } from 'react-native';

import { useActivityRefresh } from '../hooks/useActivityRefresh';

import { ActivitySection } from './ActivitySection';
import { FoodLogFrame } from './FoodLogFrame';

// "Your year" (spec 14 Decision 6): the last 53 weeks, opened at the current week, with the same
// stats, legend, list view and day panel as Profile. Its chosen day is its own.
export function ActivityYearScreen() {
  const { refreshing, onRefresh } = useActivityRefresh();
  return (
    <FoodLogFrame
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />}
    >
      <ActivitySection weeks={53} />
    </FoodLogFrame>
  );
}
