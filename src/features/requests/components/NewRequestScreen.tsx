import { StyleSheet, View } from 'react-native';

import { Button, ErrorState, Screen, Skeleton, Text } from '@/components/ui';
import { useKeyboardVisible } from '@/lib/useKeyboardVisible';
import { useTheme } from '@/theme/useTheme';

import { useRequestMenu } from '../hooks/useRequestMenu';
import { NOT_AVAILABLE } from '../messages';

import { PickupRequestForm } from './PickupRequestForm';

type NewRequestScreenProps = {
  /** The business to request from; null when the link had no valid id. */
  businessId: string | null;
  onClose: () => void;
};

// The form screen's four states: loading the menu, the calm "not available" answer (one message
// for every cause, including a bad link), an error with Retry, and the form itself.
export function NewRequestScreen({ businessId, onClose }: NewRequestScreenProps) {
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
        <MenuGate businessId={businessId} onClose={onClose} />
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

function MenuGate({ businessId, onClose }: { businessId: string; onClose: () => void }) {
  const { space, type } = useTheme();
  const state = useRequestMenu(businessId);

  if (state.status === 'loading') {
    return (
      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel="Loading menu"
        style={{ gap: space.md }}
      >
        <Skeleton height={type.title} width="60%" />
        <Skeleton height={type.bodyLg} />
        <Skeleton height={type.bodyLg} />
        <Skeleton height={type.bodyLg} />
      </View>
    );
  }
  if (state.status === 'error') {
    return (
      <ErrorState
        message="We couldn't load this menu. Try again."
        onRetry={state.retry}
        retrying={state.retrying}
      />
    );
  }
  if (state.status === 'unavailable') return <NotAvailable onClose={onClose} />;
  return <PickupRequestForm menu={state.menu} onClose={onClose} />;
}

const styles = StyleSheet.create({
  back: { alignItems: 'flex-start' },
});
