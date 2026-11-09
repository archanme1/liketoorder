import { StyleSheet, View } from 'react-native';

import { Button, Screen, Text } from '@/components/ui';

import type { PickupRequest } from '../schema';
import type { TimeOptions } from '../time';

import { MyRequestsList } from './MyRequestsList';

export { LOAD_MORE_ERROR, REFRESH_ERROR } from './MyRequestsList';

type MyRequestsScreenProps = TimeOptions & {
  onBack: () => void;
  onOpen: (request: PickupRequest) => void;
  onFindPlace: () => void;
};

// My requests with a Back button and a title. The list itself is MyRequestsList, which the Sent
// side of the Requests tab uses too.
export function MyRequestsScreen({
  onBack,
  onOpen,
  onFindPlace,
  timeZone,
  locale,
}: MyRequestsScreenProps) {
  return (
    <Screen>
      <View style={styles.back}>
        <Button title="Back" variant="ghost" accessibilityLabel="Back" onPress={onBack} />
      </View>
      <Text variant="title" accessibilityRole="header" maxFontSizeMultiplier={1.6}>
        My requests
      </Text>
      <MyRequestsList
        onOpen={onOpen}
        onFindPlace={onFindPlace}
        timeZone={timeZone}
        locale={locale}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  back: { alignItems: 'flex-start' },
});
