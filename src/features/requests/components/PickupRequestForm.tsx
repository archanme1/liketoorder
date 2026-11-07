import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  type ScrollViewInstance,
} from 'react-native';

import { Banner, Button, Card, Text, TextField } from '@/components/ui';
import { clearReturnTo } from '@/features/auth/returnTo';
import { deviceLocale, useCurrencies } from '@/features/menu/hooks/useCurrencies';
import { useTheme } from '@/theme/useTheme';

import { useSubmitPickupRequest } from '../hooks/useSubmitPickupRequest';
import type { RequestMenu } from '../hooks/useRequestMenu';
import {
  NO_MENU_NOTE,
  NO_PRICE_NOTE,
  PAY_NOTE,
  requestErrorMessage,
  sentMessage,
} from '../messages';
import {
  MAX_NOTE,
  MAX_ORDER_TEXT,
  pickupTimeProblem,
  prepareOrder,
  stripHidden,
  type OrderDraftProblem,
  type PickupRequest,
} from '../schema';
import { summarizeOrder } from '../summary';
import { formatDateTime } from '../time';

import { PickupTimePicker } from './PickupTimePicker';
import { QuantityStepper } from './QuantityStepper';
import { RequestStatusChip } from './RequestStatusChip';

export const TITLE_MAX_FONT_MULTIPLIER = 1.6;
export const LATER_TIME_MESSAGE = 'Pick a later time';
export const CHOOSE_TIME_MESSAGE = 'Choose a pickup time';
export const FAR_TIME_MESSAGE = 'Pick a time within the next 7 days';

const DRAFT_MESSAGES: Record<OrderDraftProblem, string> = {
  empty_order: requestErrorMessage('empty_order'),
  too_many_lines: 'Choose at most 30 different items.',
  text_too_long: `Keep your order to ${MAX_ORDER_TEXT} characters.`,
  note_too_long: `Keep your note to ${MAX_NOTE} characters.`,
};

type PickupRequestFormProps = {
  menu: RequestMenu;
  /** Leaves the form (back to the map). */
  onClose: () => void;
};

// Choose items (or write the order), pick a time, send. Everything the server decides — names,
// prices, availability, limits, status — is the server's: the app sends item ids and quantities.
export function PickupRequestForm({ menu, onClose }: PickupRequestFormProps) {
  const { space } = useTheme();
  const submit = useSubmitPickupRequest();
  const currencies = useCurrencies();
  const locale = deviceLocale();

  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [orderText, setOrderText] = useState('');
  const [note, setNote] = useState('');
  const [pickupAt, setPickupAt] = useState<Date | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [problem, setProblem] = useState<string | null>(null);
  const [timeProblem, setTimeProblem] = useState<string | null>(null);
  const [sent, setSent] = useState<PickupRequest | null>(null);

  // Opening the form uses up the sign-in return, so it can't fire again later.
  useEffect(() => {
    clearReturnTo();
  }, []);

  const scrollRef = useRef<ScrollViewInstance>(null);
  const fieldY = useRef<Record<string, number>>({});
  const available = useMemo(
    () => menu.items.filter((item) => item.is_available).sort((a, b) => a.position - b.position),
    [menu.items],
  );
  const currency = useMemo(() => {
    const found = currencies.data?.find((entry) => entry.code === menu.currencyCode);
    return found ? { code: found.code, minorUnits: found.minor_units } : null;
  }, [currencies.data, menu.currencyCode]);
  const summary = useMemo(
    () => summarizeOrder(available, quantities, currency, locale),
    [available, quantities, currency, locale],
  );

  const edited = () => {
    setProblem(null);
    submit.reset();
  };

  const onSubmit = () => {
    const fresh = new Date();
    setNow(fresh);
    setProblem(null);
    if (!pickupAt) {
      setTimeProblem(CHOOSE_TIME_MESSAGE);
      return;
    }
    const timeIssue = pickupTimeProblem(pickupAt, fresh);
    if (timeIssue) {
      setTimeProblem(timeIssue === 'too_soon' ? LATER_TIME_MESSAGE : FAR_TIME_MESSAGE);
      return;
    }
    setTimeProblem(null);

    const prepared = prepareOrder({
      lines: available
        .filter((item) => (quantities[item.id] ?? 0) > 0)
        .map((item) => ({ itemId: item.id, quantity: quantities[item.id] })),
      orderText,
      note,
    });
    if (!prepared.ok) {
      setProblem(DRAFT_MESSAGES[prepared.problem]);
      return;
    }
    submit.submit(
      {
        businessId: menu.id,
        pickupAt,
        items: prepared.args.items,
        orderText: prepared.args.orderText,
        note: prepared.args.note,
      },
      { onSuccess: setSent },
    );
  };

  if (sent) {
    return (
      <View style={{ gap: space.lg }}>
        <Text
          variant="title"
          accessibilityRole="header"
          accessibilityLiveRegion="polite"
          maxFontSizeMultiplier={TITLE_MAX_FONT_MULTIPLIER}
        >
          Request sent
        </Text>
        <RequestStatusChip status={sent.display_status} />
        <Text variant="bodyLg">{sentMessage(menu.name)}</Text>
        <Text color="textMuted">
          {`Pickup ${formatDateTime(sent.pickup_at, { locale })}. If ${menu.name} doesn't answer in time, it will show as expired.`}
        </Text>
        <Button title="Done" variant="secondary" onPress={onClose} />
      </View>
    );
  }

  const serverError = submit.error ? requestErrorMessage(submit.error.code) : null;
  const sending = submit.isPending;

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        ref={scrollRef}
        testID="request-form-scroll"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ gap: space.lg, paddingBottom: space.xxl }}
      >
        <View style={{ gap: space.xs }}>
          <Text
            variant="title"
            accessibilityRole="header"
            maxFontSizeMultiplier={TITLE_MAX_FONT_MULTIPLIER}
          >
            Request pickup
          </Text>
          <Text color="textMuted">{`From ${menu.name}`}</Text>
        </View>

        {available.length > 0 ? (
          <View style={{ gap: space.md }}>
            <Text variant="bodyLg" accessibilityRole="header">
              Menu
            </Text>
            {available.map((item) => {
              const quantity = quantities[item.id] ?? 0;
              const price =
                currency && item.price_minor !== null
                  ? summarizeOrder([item], { [item.id]: 1 }, currency, locale).lines[0]?.price
                  : null;
              return (
                <View key={item.id} style={[styles.itemRow, { gap: space.md }]}>
                  <View style={[styles.flex, { gap: space.xs }]}>
                    <Text>{item.name}</Text>
                    {price ? <Text color="textMuted">{price}</Text> : null}
                  </View>
                  <QuantityStepper
                    itemName={item.name}
                    quantity={quantity}
                    onChange={(next) => {
                      edited();
                      setQuantities((current) => ({ ...current, [item.id]: next }));
                    }}
                  />
                </View>
              );
            })}
          </View>
        ) : (
          <Text color="textMuted">{NO_MENU_NOTE}</Text>
        )}

        {/* A focused text box scrolls above the keyboard, and so above Send, below it. */}
        <View
          onLayout={(event) => {
            fieldY.current.order = event.nativeEvent.layout.y;
          }}
        >
          <TextField
            label={available.length > 0 ? 'Anything else' : 'Your order'}
            hint="Write your order in your own words."
            value={orderText}
            onChangeText={(text) => {
              edited();
              setOrderText(stripHidden(text));
            }}
            onFocus={() =>
              scrollRef.current?.scrollTo({
                y: Math.max(0, (fieldY.current.order ?? 0) - space.lg),
                animated: true,
              })
            }
            multiline
            maxLength={MAX_ORDER_TEXT}
            textAlignVertical="top"
          />
        </View>

        <View style={{ gap: space.sm }}>
          <Text variant="bodyLg" accessibilityRole="header">
            Pickup time
          </Text>
          {pickupAt ? (
            <Text color="textMuted">{`Selected: ${formatDateTime(pickupAt, { locale })}`}</Text>
          ) : null}
          <PickupTimePicker
            now={now}
            value={pickupAt}
            locale={locale}
            onChange={(value) => {
              edited();
              setTimeProblem(null);
              setPickupAt(value);
            }}
          />
          {timeProblem ? (
            <View style={[styles.row, { gap: space.xs }]}>
              <Ionicons name="alert-circle-outline" size={space.lg} />
              <Text color="danger" accessibilityRole="alert">
                {timeProblem}
              </Text>
            </View>
          ) : null}
        </View>

        <View
          onLayout={(event) => {
            fieldY.current.note = event.nativeEvent.layout.y;
          }}
        >
          <TextField
            label="Note for the seller (optional)"
            value={note}
            onChangeText={(text) => {
              edited();
              setNote(stripHidden(text));
            }}
            onFocus={() =>
              scrollRef.current?.scrollTo({
                y: Math.max(0, (fieldY.current.note ?? 0) - space.lg),
                animated: true,
              })
            }
            multiline
            maxLength={MAX_NOTE}
            textAlignVertical="top"
          />
        </View>

        {summary.lines.length > 0 ? (
          <Card style={{ gap: space.sm }}>
            <Text variant="bodyLg" accessibilityRole="header">
              Your order
            </Text>
            {summary.lines.map((line) => (
              <View key={line.itemId} style={[styles.itemRow, { gap: space.md }]}>
                <Text style={styles.flex}>{`${line.quantity} × ${line.name}`}</Text>
                {line.price ? <Text>{line.price}</Text> : null}
              </View>
            ))}
            {summary.total ? (
              <View style={{ gap: space.xs }}>
                <Text accessibilityRole="header">{`Estimated total: ${summary.total}`}</Text>
                {summary.excludesUnpriced ? <Text color="textMuted">{NO_PRICE_NOTE}</Text> : null}
                <Text color="textMuted">{PAY_NOTE}</Text>
              </View>
            ) : null}
          </Card>
        ) : null}

        {problem ? <Banner message={problem} /> : null}
        {serverError ? <Banner message={serverError} /> : null}

        <Button
          title="Send request"
          accessibilityLabel={`Send pickup request to ${menu.name}`}
          onPress={onSubmit}
          loading={sending}
          disabled={sending}
        />
        <Text variant="caption" color="textMuted">
          The seller will answer this request.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  itemRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  row: { flexDirection: 'row', alignItems: 'center' },
});
