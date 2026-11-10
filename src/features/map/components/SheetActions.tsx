import { useHomemadeDetails } from '../hooks/useHomemadeDetails';
import { useRestaurantDetails } from '../hooks/useRestaurantDetails';
import { useSheetActions } from '../hooks/useSheetActions';

import { SheetActionRow } from './SheetActionRow';

/** What the sheet gives its action row: the id of the business that is open. */
export type SheetActionsProps = { id: string };

// The action row for each tab. It reads the same cached details the sheet body shows, so the row
// only appears once the business is known to be available (not while loading, on an error, or on
// the "isn't available" answer).
export function RestaurantSheetActions({ id }: SheetActionsProps) {
  const details = useRestaurantDetails(id);
  const actions = useSheetActions(
    details.data
      ? {
          id: details.data.id,
          name: details.data.name,
          acceptsTableRequests: details.data.accepts_table_requests,
        }
      : null,
  );
  return <SheetActionRow actions={actions} />;
}

export function HomemadeSheetActions({ id }: SheetActionsProps) {
  const details = useHomemadeDetails(id);
  const actions = useSheetActions(
    details.data ? { id: details.data.id, name: details.data.name } : null,
  );
  return <SheetActionRow actions={actions} />;
}
