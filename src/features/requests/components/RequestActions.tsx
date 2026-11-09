import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Banner, Button, Card, Text } from '@/components/ui';
import { useTheme } from '@/theme/useTheme';

import { useMarkRequestOutcome } from '../hooks/useMarkRequestOutcome';
import { useRespondToRequest } from '../hooks/useRespondToRequest';
import type { SellerRequest } from '../schema';
import {
  actionErrorMessage,
  confirmCopy,
  customerLabel,
  type SellerAction,
} from '../sellerMessages';
import { formatDateTime, type TimeOptions } from '../time';

type RequestActionsProps = TimeOptions & {
  request: SellerRequest;
  /** The server-corrected "pickup time has passed" hint. The server checks again. */
  pickupPassed: boolean;
};

const BUTTON_TITLE: Record<SellerAction, string> = {
  accepted: 'Accept',
  declined: 'Decline',
  completed: 'Mark completed',
  no_show: 'Mark no-show',
};

const CONFIRM_TITLE: Record<SellerAction, string> = {
  accepted: 'Yes, accept request',
  declined: 'Yes, decline request',
  completed: 'Yes, mark completed',
  no_show: 'Yes, mark no-show',
};

// The actions valid for the request's status, in the FIXED part of the detail screen (outside the
// scrolling body), so they stay on screen at any text size. A press opens a short confirm in the
// same place, because every answer is final in v1. No text input here, so no keyboard to avoid.
// Actions come from the server's display_status: a pending request past its expiry is "expired"
// and has none. Completed / No-show also wait for the pickup-time hint (the server re-checks).
export function RequestActions({ request, pickupPassed, timeZone, locale }: RequestActionsProps) {
  const { space, size } = useTheme();
  const respond = useRespondToRequest();
  const outcome = useMarkRequestOutcome();
  const [confirming, setConfirming] = useState<SellerAction | null>(null);

  const running = respond.isPending || outcome.isPending;
  const name = customerLabel(request.customer_name);
  const pickup = formatDateTime(request.pickup_at, { timeZone, locale });
  const status = request.display_status;
  const available: SellerAction[] =
    status === 'pending'
      ? ['accepted', 'declined']
      : status === 'accepted' && pickupPassed
        ? ['completed', 'no_show']
        : [];

  const errorCode = (respond.error ?? outcome.error)?.code;
  // A failed action leaves the banner up even if the refetched status has no actions any more.
  const banner = errorCode ? <Banner message={actionErrorMessage(errorCode)} /> : null;

  const run = (action: SellerAction) => {
    if (running) return;
    const done = { onSettled: () => setConfirming(null) };
    if (action === 'accepted' || action === 'declined') {
      respond.respond(request.id, action, undefined, done);
    } else {
      outcome.markOutcome(request.id, action, done);
    }
  };

  const open = (action: SellerAction) => {
    respond.reset();
    outcome.reset();
    setConfirming(action);
  };

  if (available.length === 0) return banner ? <View>{banner}</View> : null;

  const primary: SellerAction = available[0];
  const label = (action: SellerAction) =>
    action === 'accepted' || action === 'declined'
      ? `${BUTTON_TITLE[action]} request from ${name}, pickup ${pickup}`
      : `${BUTTON_TITLE[action]} for request from ${name}, pickup ${pickup}`;

  if (confirming && available.includes(confirming)) {
    const copy = confirmCopy(confirming, request.business_type === 'homemade');
    return (
      <View testID="request-actions" style={{ gap: space.sm }}>
        <Card style={{ gap: space.md }}>
          <Text accessibilityRole="header">{copy.title}</Text>
          <Text color="textMuted">{copy.body}</Text>
          <Button
            title={CONFIRM_TITLE[confirming]}
            accessibilityLabel={`${CONFIRM_TITLE[confirming]} from ${name}`}
            variant={confirming === primary ? 'primary' : 'secondary'}
            onPress={() => run(confirming)}
            loading={running}
            disabled={running}
          />
          <Button
            title="Go back"
            variant="ghost"
            onPress={() => setConfirming(null)}
            disabled={running}
          />
        </Card>
        {banner}
      </View>
    );
  }

  return (
    <View testID="request-actions" style={{ gap: space.sm }}>
      <View style={[styles.row, { gap: space.md }]}>
        {available.map((action) => (
          <View key={action} style={[styles.action, { minWidth: size.touch }]}>
            <Button
              title={BUTTON_TITLE[action]}
              accessibilityLabel={label(action)}
              variant={action === primary ? 'primary' : 'secondary'}
              onPress={() => open(action)}
              disabled={running}
            />
          </View>
        ))}
      </View>
      {banner}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap' },
  action: { flexGrow: 1, flexBasis: 0 },
});
