import { RefreshControl } from 'react-native';

import { parseActivityView } from '../activity';
import { useActivityRefresh } from '../hooks/useActivityRefresh';

import { ActivitySection } from './ActivitySection';
import { FoodLogFrame } from './FoodLogFrame';

type ActivityYearScreenProps = {
  /** The route's `view` param, unchecked: only "cuisine" opens the Cuisine view (spec 15). */
  view?: string | string[];
};

// "Your year" (spec 14 Decision 6): the last 53 weeks, opened at the current week, with the same
// stats, legend, list view and day panel as Profile. Its chosen day is its own; it opens in the
// view Profile was showing (spec 15).
export function ActivityYearScreen({ view }: ActivityYearScreenProps) {
  const { refreshing, onRefresh } = useActivityRefresh(53);
  return (
    <FoodLogFrame
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />}
    >
      <ActivitySection weeks={53} initialView={parseActivityView(view)} />
    </FoodLogFrame>
  );
}
