import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Card, ErrorState, Skeleton, Text } from '@/components/ui';
import { deviceLocale, useCurrencies } from '@/features/menu/hooks/useCurrencies';
import { useTheme } from '@/theme/useTheme';

import { useBusinessRequest } from '../hooks/useBusinessRequest';
import { usePickupPassed } from '../hooks/usePickupPassed';
import type { SellerRequest } from '../schema';
import {
  CUSTOMER_PAYS_NOTE,
  customerLabel,
  inboxErrorMessage,
  NO_PRICE_NOTE,
  NOT_FOUND_MESSAGE,
  sellerStatusSentence,
} from '../sellerMessages';
import { summarizeOrder } from '../summary';
import { formatDateTime, type TimeOptions } from '../time';

import { RequestActions } from './RequestActions';
import { RequestStatusChip } from './RequestStatusChip';

const TITLE_MAX_FONT_MULTIPLIER = 1.6;

type SellerRequestDetailScreenProps = TimeOptions & {
  /** The request id, or null when the link had no valid id. */
  requestId: string | null;
  onClose: () => void;
};

// Request detail, seller view: loading, "not found" (unknown, someone else's, or a bad link: one
// calm answer), error with Retry, or the request with its actions. The seller Stack's header draws
// the title and Back.
export function SellerRequestDetailScreen({
  requestId,
  onClose,
  ...time
}: SellerRequestDetailScreenProps) {
  const { colors, space } = useTheme();
  return (
    <SafeAreaView
      edges={['bottom']}
      style={[styles.root, { backgroundColor: colors.bg, padding: space.lg }]}
    >
      {requestId ? (
        <Loaded requestId={requestId} onClose={onClose} {...time} />
      ) : (
        <NotFound onClose={onClose} />
      )}
    </SafeAreaView>
  );
}

function NotFound({ onClose }: { onClose: () => void }) {
  const { space } = useTheme();
  return (
    <View style={{ gap: space.md }}>
      <Text accessibilityRole="alert">{NOT_FOUND_MESSAGE}</Text>
      <Button title="Close" variant="secondary" onPress={onClose} />
    </View>
  );
}

function Loaded({
  requestId,
  onClose,
  timeZone,
  locale,
}: SellerRequestDetailScreenProps & { requestId: string }) {
  const { space, type } = useTheme();
  const query = useBusinessRequest(requestId);

  if (query.isPending) {
    return (
      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel="Loading request"
        style={{ gap: space.md }}
      >
        <Skeleton height={type.title} width="60%" />
        <Skeleton height={type.bodyLg} />
        <Skeleton height={type.bodyLg} />
        <Skeleton height={type.bodyLg} />
      </View>
    );
  }
  // A failed background refetch keeps the request that was loaded.
  if (query.isError && query.data === undefined) {
    return (
      <ErrorState
        message={inboxErrorMessage(query.error.code)}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
      />
    );
  }
  if (query.data?.request == null) return <NotFound onClose={onClose} />;
  return (
    <RequestView
      request={query.data.request}
      serverNow={query.data.server_now}
      fetchedAt={query.dataUpdatedAt}
      timeZone={timeZone}
      locale={locale}
    />
  );
}

type RequestViewProps = TimeOptions & {
  request: SellerRequest;
  serverNow: string;
  fetchedAt: number;
};

function RequestView({
  request,
  serverNow,
  fetchedAt,
  timeZone,
  locale = deviceLocale(),
}: RequestViewProps) {
  const { space } = useTheme();
  const currencies = useCurrencies();
  const pickupPassed = usePickupPassed(request.pickup_at, serverNow, fetchedAt);
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

  return (
    <View style={[styles.root, { gap: space.md }]}>
      <View style={{ gap: space.sm }}>
        <Text
          variant="title"
          accessibilityRole="header"
          maxFontSizeMultiplier={TITLE_MAX_FONT_MULTIPLIER}
        >
          {customerLabel(request.customer_name)}
        </Text>
        <RequestStatusChip status={status} />
        <Text variant="bodyLg">{sellerStatusSentence(status)}</Text>
      </View>

      <RequestActions
        request={request}
        pickupPassed={pickupPassed}
        timeZone={timeZone}
        locale={locale}
      />

      <ScrollView contentContainerStyle={{ gap: space.lg, paddingBottom: space.xxl }}>
        {status === 'pending' ? (
          <Text color="textMuted">
            {`If you don't answer by ${formatDateTime(request.expires_at, options)}, this request expires.`}
          </Text>
        ) : null}

        <Card style={{ gap: space.sm }}>
          <Text accessibilityRole="header">Pickup</Text>
          <Text>{formatDateTime(request.pickup_at, options)}</Text>
          <Text color="textMuted">{`Sent ${formatDateTime(request.created_at, options)}`}</Text>
          {request.responded_at ? (
            <Text color="textMuted">{`Answered ${formatDateTime(request.responded_at, options)}`}</Text>
          ) : null}
        </Card>

        <Card style={{ gap: space.sm }}>
          <Text accessibilityRole="header">Order</Text>
          {summary.lines.map((line) => (
            <View key={line.itemId} style={[styles.line, { gap: space.md }]}>
              <Text style={styles.grow}>{`${line.quantity} × ${line.name}`}</Text>
              {line.price ? <Text>{line.price}</Text> : null}
            </View>
          ))}
          {request.order_text ? <Text>{request.order_text}</Text> : null}
          {summary.total ? (
            <View style={{ gap: space.xs }}>
              <Text>{`Estimated total: ${summary.total}`}</Text>
              {summary.excludesUnpriced ? <Text color="textMuted">{NO_PRICE_NOTE}</Text> : null}
              <Text color="textMuted">{CUSTOMER_PAYS_NOTE}</Text>
            </View>
          ) : null}
        </Card>

        {request.note ? (
          <Card style={{ gap: space.xs }}>
            <Text accessibilityRole="header">Customer note</Text>
            <Text>{request.note}</Text>
          </Card>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  line: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  grow: { flex: 1 },
});
