import { getTabVisibility, type TabVisibility } from '@/features/auth/routeAccess';

import { useTabAccess } from './useIsSeller';

/** The one place that says which tabs show for a guest, a customer and a seller. */
export function useTabVisibility(): TabVisibility {
  return getTabVisibility(useTabAccess());
}
