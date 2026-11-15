import { EmptyState } from '@/components/ui';

import { FOOD_LOG_NOT_FOUND } from '../messages';

// Unknown, deleted and someone else's id all look the same.
export function FoodLogNotFound({ onBack }: { onBack: () => void }) {
  return <EmptyState message={FOOD_LOG_NOT_FOUND} actionLabel="Back" onAction={onBack} />;
}
