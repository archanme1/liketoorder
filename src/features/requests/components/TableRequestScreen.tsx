import { StyleSheet, View } from 'react-native';

import { Button, ErrorState, Screen, Skeleton, Text } from '@/components/ui';
import { useRestaurantDetails } from '@/features/map/hooks/useRestaurantDetails';
import { useKeyboardVisible } from '@/lib/useKeyboardVisible';
import { useTheme } from '@/theme/useTheme';

import { NOT_AVAILABLE } from '../messages';
import type { TimeOptions } from '../time';

import { TableRequestForm } from './TableRequestForm';

type TableRequestScreenProps = TimeOptions & {
  /** The restaurant to ask; null when the link had no valid id. */
  businessId: string | null;
  onClose: () => void;
};

// The table form screen's four states: loading the restaurant, the calm "not available" answer (one
// message for every cause: a bad link, a homemade seller, an unlisted place, or a restaurant that
// does not take table requests), an error with Retry, and the form itself.
export function TableRequestScreen({ businessId, onClose, ...time }: TableRequestScreenProps) {
  // While typing, the Back row steps aside too, leaving the Send bar and the field the room.
  const keyboardVisible = useKeyboardVisible();
  return (
    <Screen>
      {keyboardVisible ? null : (
        <View style={styles.back}>
          <Button
            title="Back"
            variant="ghost"
            accessibilityLabel="Back to the map"
            onPress={onClose}
          />
        </View>
      )}
      {businessId ? (
        <RestaurantGate businessId={businessId} onClose={onClose} {...time} />
      ) : (
        <NotAvailable onClose={onClose} />
      )}
    </Screen>
  );
}

function NotAvailable({ onClose }: { onClose: () => void }) {
  const { space } = useTheme();
  return (
    <View style={{ gap: space.md }}>
      <Text accessibilityRole="alert">{NOT_AVAILABLE}</Text>
      <Button title="Close" variant="secondary" onPress={onClose} />
    </View>
  );
}

function RestaurantGate({
  businessId,
  onClose,
  ...time
}: TimeOptions & { businessId: string; onClose: () => void }) {
  const { space, type } = useTheme();
  const details = useRestaurantDetails(businessId);

  if (details.isPending) {
    return (
      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel="Loading restaurant"
        style={{ gap: space.md }}
      >
        <Skeleton height={type.title} width="60%" />
        <Skeleton height={type.bodyLg} />
        <Skeleton height={type.bodyLg} />
      </View>
    );
  }
  if (details.isError) {
    return (
      <ErrorState
        message="We couldn't load this restaurant. Try again."
        onRetry={() => void details.refetch()}
        retrying={details.isFetching}
      />
    );
  }
  // null: not a listed restaurant (a homemade seller, an unlisted place, or no such id).
  if (!details.data || !details.data.accepts_table_requests) {
    return <NotAvailable onClose={onClose} />;
  }
  return (
    <TableRequestForm
      business={{ id: details.data.id, name: details.data.name }}
      onClose={onClose}
      {...time}
    />
  );
}

const styles = StyleSheet.create({
  back: { alignItems: 'flex-start' },
});
