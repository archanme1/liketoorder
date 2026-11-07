import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, View } from 'react-native';

import { Button, Card, Text } from '@/components/ui';
import { useTheme } from '@/theme/useTheme';

import type { MapStatus } from '../schema';

export const MAP_STATUS_MESSAGE: Record<MapStatus, string> = {
  visible: 'Showing on the map',
  place_not_found:
    "Hidden from the map: Google can't find your address any more. Choose your address again to put it back.",
  needs_refresh:
    'Hidden from the map for now while we re-check your address. Choosing your address again puts it back at once.',
};

export const CHOOSE_ADDRESS_LABEL = 'Choose your address again';

type MapStatusLineProps = {
  /** Null when there is nothing to say: no saved address yet, or not a restaurant. */
  status: MapStatus | null | undefined;
  onChooseAddress: () => void;
};

// Spec 07 / Decision 13: whether the owner's restaurant is on the map right now. Text and an
// icon carry the meaning, never colour alone. A hidden pin always offers the way back.
export function MapStatusLine({ status, onChooseAddress }: MapStatusLineProps) {
  const { colors, space, size } = useTheme();
  if (!status) return null;
  const visible = status === 'visible';

  return (
    <Card style={{ gap: space.md }}>
      <View style={[styles.row, { gap: space.sm }]}>
        <Ionicons
          name={visible ? 'checkmark-circle-outline' : 'eye-off-outline'}
          size={size.tabIcon}
          color={visible ? colors.success : colors.warning}
        />
        <Text style={styles.message} accessibilityRole="text">
          {MAP_STATUS_MESSAGE[status]}
        </Text>
      </View>
      {visible ? null : <Button title={CHOOSE_ADDRESS_LABEL} onPress={onChooseAddress} />}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  message: { flex: 1 },
});
