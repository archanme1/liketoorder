import { View } from 'react-native';

import { Banner, Button, Text } from '@/components/ui';
import { useTheme } from '@/theme/useTheme';

import { useArrivalWindow } from '../hooks/useArrivalWindow';
import { useMarkArrived } from '../hooks/useMarkArrived';
import { ARRIVED_DONE, requestErrorMessage } from '../messages';
import type { TableRequest } from '../schema';

type ArrivedButtonProps = {
  request: TableRequest;
  /** The server's clock when the request was read, and when this phone read it. */
  serverNow: string;
  fetchedAt: number;
};

// "I've arrived" on an accepted table request. Shown only while the request is accepted, not yet
// arrived, and the SERVER's clock is inside the window (2 hours before the table time to 4 hours
// after it); the phone's clock only schedules the next look. One tap: the button is off and says
// "Sending..." while it runs, and afterwards the line "You've told the restaurant you arrived"
// stays. The server judges every tap (arrival_window, already_arrived, invalid_transition); after
// any answer the request is re-read, so the screen shows the real state. No location is read.
export function ArrivedButton({ request, serverNow, fetchedAt }: ArrivedButtonProps) {
  const { space } = useTheme();
  const window = useArrivalWindow(request.table_at, serverNow, fetchedAt);
  const mark = useMarkArrived();

  const done = request.arrived_at !== null || mark.isSuccess;
  if (done && request.display_status === 'accepted') {
    return (
      <Text accessibilityLiveRegion="polite" variant="bodyLg">
        {ARRIVED_DONE}
      </Text>
    );
  }
  // Only an accepted request inside the window shows the button. A refused tap leaves its message
  // up even if the re-read request no longer qualifies.
  const error = mark.error ? requestErrorMessage(mark.error.code) : null;
  if (request.display_status !== 'accepted' || window !== 'open') {
    return error ? <Banner message={error} /> : null;
  }

  return (
    <View style={{ gap: space.sm }}>
      <Button
        title={mark.isPending ? 'Sending...' : "I've arrived"}
        accessibilityLabel={
          mark.isPending
            ? `Telling ${request.business_name} you've arrived`
            : `Tell ${request.business_name} you've arrived`
        }
        onPress={() => mark.arrived(request.id)}
        loading={mark.isPending}
        disabled={mark.isPending}
      />
      {error ? <Banner message={error} /> : null}
    </View>
  );
}
