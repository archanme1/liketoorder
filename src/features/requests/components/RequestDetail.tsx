import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Banner, Button, Card, Text } from '@/components/ui';
import { deviceLocale, useCurrencies } from '@/features/menu/hooks/useCurrencies';
import { useTheme } from '@/theme/useTheme';

import { useCancelPickupRequest } from '../hooks/useCancelPickupRequest';
import { canShowAddress, useAddressCacheGuard } from '../hooks/usePickupAddress';
import { NO_PRICE_NOTE, PAY_NOTE, requestErrorMessage } from '../messages';
import type { PickupRequest } from '../schema';
import { statusSentence } from '../status';
import { summarizeOrder } from '../summary';
import { formatDateTime, type TimeOptions } from '../time';

import { RequestAddressCard } from './RequestAddressCard';
import { RequestStatusChip } from './RequestStatusChip';

export const TITLE_MAX_FONT_MULTIPLIER = 1.6;

type RequestDetailProps = TimeOptions & {
  request: PickupRequest;
};

// One request: the server's status, what was asked, when, and (pending only) a Cancel with a
// confirm step. For an accepted or completed homemade request, the cook's exact address.
export function RequestDetail({ request, timeZone, locale = deviceLocale() }: RequestDetailProps) {
  const { space } = useTheme();
  const cancel = useCancelPickupRequest();
  useAddressCacheGuard(request.id, request);
  const currencies = useCurrencies();
  const [confirming, setConfirming] = useState(false);

  const options = { timeZone, locale };
  const status = request.display_status;
  const currency = (() => {
    const found = currencies.data?.find((entry) => entry.code === request.currency_code);
    return found ? { code: found.code, minorUnits: found.minor_units } : null;
  })();
  const summary = summarizeOrder(
    (request.items ?? []).map((line) => ({
      id: line.item_id,
      name: line.name,
      price_minor: line.unit_price_minor,
    })),
    Object.fromEntries((request.items ?? []).map((line) => [line.item_id, line.quantity])),
    currency,
    locale,
  );

  const cancelError = cancel.error ? requestErrorMessage(cancel.error.code) : null;

  return (
    <ScrollView contentContainerStyle={{ gap: space.lg, paddingBottom: space.xxl }}>
      <View style={{ gap: space.sm }}>
        <Text
          variant="title"
          accessibilityRole="header"
          maxFontSizeMultiplier={TITLE_MAX_FONT_MULTIPLIER}
        >
          {request.business_name}
        </Text>
        <RequestStatusChip status={status} />
        <Text variant="bodyLg">{statusSentence(status, request.business_name)}</Text>
        {status === 'pending' ? (
          <Text color="textMuted">
            {`If there is no answer by ${formatDateTime(request.expires_at, options)}, this request expires.`}
          </Text>
        ) : null}
      </View>

      <Card style={{ gap: space.sm }}>
        <Text accessibilityRole="header">Pickup</Text>
        <Text>{formatDateTime(request.pickup_at, options)}</Text>
        <Text color="textMuted">{`Sent ${formatDateTime(request.created_at, options)}`}</Text>
      </Card>

      <Card style={{ gap: space.sm }}>
        <Text accessibilityRole="header">Your order</Text>
        {summary.lines.map((line) => (
          <View key={line.itemId} style={[styles.line, { gap: space.md }]}>
            <Text style={styles.grow}>{`${line.quantity} × ${line.name}`}</Text>
            {line.price ? <Text>{line.price}</Text> : null}
          </View>
        ))}
        {request.order_text ? <Text>{request.order_text}</Text> : null}
        {summary.total ? (
          <View style={{ gap: space.xs }}>
            <Text accessibilityRole="header">{`Estimated total: ${summary.total}`}</Text>
            {summary.excludesUnpriced ? <Text color="textMuted">{NO_PRICE_NOTE}</Text> : null}
            <Text color="textMuted">{PAY_NOTE}</Text>
          </View>
        ) : null}
        {request.note ? (
          <View style={{ gap: space.xs }}>
            <Text accessibilityRole="header">Your note</Text>
            <Text>{request.note}</Text>
          </View>
        ) : null}
      </Card>

      {canShowAddress(request) ? <RequestAddressCard request={request} /> : null}

      {cancelError ? <Banner message={cancelError} /> : null}

      {status === 'pending' ? (
        confirming ? (
          <Card style={{ gap: space.md }}>
            <Text accessibilityRole="header">Cancel this request?</Text>
            <Text color="textMuted">{`${request.business_name} will not see it any more.`}</Text>
            <Button
              title="Yes, cancel request"
              onPress={() =>
                cancel.cancelRequest(request.id, { onSettled: () => setConfirming(false) })
              }
              loading={cancel.isPending}
              disabled={cancel.isPending}
            />
            <Button
              title="Keep request"
              variant="secondary"
              onPress={() => setConfirming(false)}
              disabled={cancel.isPending}
            />
          </Card>
        ) : (
          <Button
            title="Cancel request"
            variant="secondary"
            onPress={() => {
              cancel.reset();
              setConfirming(true);
            }}
          />
        )
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  line: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  grow: { flex: 1 },
});
