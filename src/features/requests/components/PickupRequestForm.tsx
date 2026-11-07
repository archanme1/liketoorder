import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  type ScrollViewInstance,
} from 'react-native';

import { Button, Card, Text, TextField } from '@/components/ui';
import { clearReturnTo } from '@/features/auth/returnTo';
import { deviceLocale, useCurrencies } from '@/features/menu/hooks/useCurrencies';
import { useKeyboardVisible } from '@/lib/useKeyboardVisible';
import { useTheme } from '@/theme/useTheme';

import { useSubmitPickupRequest } from '../hooks/useSubmitPickupRequest';
import type { RequestMenu } from '../hooks/useRequestMenu';
import { NO_MENU_NOTE, PAY_NOTE, requestErrorMessage, sentMessage } from '../messages';
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
import { SendBar } from './SendBar';

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
  const router = useRouter();
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
  const keyboardVisible = useKeyboardVisible();
  // Height of the scrolling area, so any field can be scrolled up to its top edge.
  const [viewportHeight, setViewportHeight] = useState(0);

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
    const showTimeSection = () =>
      scrollRef.current?.scrollTo({
        y: Math.max(0, (fieldY.current.time ?? 0) - space.lg),
        animated: true,
      });
    if (!pickupAt) {
      setTimeProblem(CHOOSE_TIME_MESSAGE);
      showTimeSection();
      return;
    }
    const timeIssue = pickupTimeProblem(pickupAt, fresh);
    if (timeIssue) {
      setTimeProblem(timeIssue === 'too_soon' ? LATER_TIME_MESSAGE : FAR_TIME_MESSAGE);
      showTimeSection();
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
        <Button title="View my requests" onPress={() => router.replace('/requests')} />
        <Button title="Done" variant="secondary" onPress={onClose} />
      </View>
    );
  }

  const serverError = submit.error ? requestErrorMessage(submit.error.code) : null;
  const sending = submit.isPending;
  // One message at a time, in the bar, right under Send.
  const barError = timeProblem ?? problem ?? serverError;

  return (
    <KeyboardAvoidingView
      testID="keyboard-avoiding"
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Fixed: title, then the Send bar. While the keyboard is up the title steps aside so the
          bar and the focused field have the room. */}
      {keyboardVisible ? null : (
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
      )}
      <SendBar
        businessName={menu.name}
        total={summary.total}
        excludesUnpriced={summary.excludesUnpriced}
        error={barError}
        sending={sending}
        onSend={onSubmit}
      />

      <ScrollView
        ref={scrollRef}
        testID="request-form-scroll"
        style={styles.flex}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        onLayout={(event) => setViewportHeight(event.nativeEvent.layout.height)}
        contentContainerStyle={{
          gap: space.lg,
          // With the keyboard up, slack as tall as the area lets the last field reach the top.
          paddingBottom: keyboardVisible ? Math.max(space.xxl, viewportHeight) : space.xxl,
        }}
      >
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

        {/* A focused text box scrolls to the top of this area: just under the fixed Send bar. */}
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

        <View
          style={{ gap: space.sm }}
          onLayout={(event) => {
            fieldY.current.time = event.nativeEvent.layout.y;
          }}
        >
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
            {summary.total ? <Text color="textMuted">{PAY_NOTE}</Text> : null}
          </Card>
        ) : null}

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
});
