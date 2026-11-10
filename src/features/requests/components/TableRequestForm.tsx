import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  type ScrollViewInstance,
} from 'react-native';

import { Button, Text, TextField } from '@/components/ui';
import { clearReturnTo } from '@/features/auth/returnTo';
import { deviceLocale } from '@/features/menu/hooks/useCurrencies';
import { useKeyboardVisible } from '@/lib/useKeyboardVisible';
import { maxFontMultiplier } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';

import { useSubmitTableRequest } from '../hooks/useSubmitTableRequest';
import { TABLE_SENT_NOTE, requestErrorMessage, tableSentMessage } from '../messages';
import {
  MAX_NOTE,
  MIN_PARTY_SIZE,
  stripHidden,
  tableFormSchema,
  tableTimeProblem,
  type TableFormInput,
  type TableFormValues,
} from '../schema';
import { formatDateTimeWithZone, type TimeOptions } from '../time';

import { PartySizeStepper } from './PartySizeStepper';
import { RequestStatusChip } from './RequestStatusChip';
import { SendBar } from './SendBar';
import { TableTimePicker } from './TableTimePicker';

export const CHOOSE_TABLE_TIME_MESSAGE = 'Choose a table time';
export const LATER_TABLE_TIME_MESSAGE = 'Pick a later time';
export const FAR_TABLE_TIME_MESSAGE = 'Pick a time within the next 30 days';

const DEFAULT_PARTY = 2;

type TableRequestFormProps = TimeOptions & {
  business: { id: string; name: string };
  /** Leaves the form (back to the map). */
  onClose: () => void;
};

// Pick a day and time, how many people, an optional note, send. The server judges everything
// (the time window, the party size, who may be asked, the limits, the status); the app mirrors the
// limits for quick feedback. Nothing here says a table is booked: a sent request is waiting.
export function TableRequestForm({
  business,
  onClose,
  timeZone,
  locale = deviceLocale(),
}: TableRequestFormProps) {
  const { space } = useTheme();
  const router = useRouter();
  const submit = useSubmitTableRequest();
  // While a send runs the form is read-only, and the result is taken from the mutation itself.
  const sending = submit.isPending;
  const sent = submit.isSuccess ? submit.data : null;
  const keyboardVisible = useKeyboardVisible();

  const { control, handleSubmit, setValue } = useForm<TableFormInput, unknown, TableFormValues>({
    resolver: zodResolver(tableFormSchema),
    defaultValues: { partySize: DEFAULT_PARTY, note: '' },
  });
  const tableAt = useWatch({ control, name: 'tableAt' });
  const partySize = useWatch({ control, name: 'partySize' });

  const [now, setNow] = useState(() => new Date());
  const [problem, setProblem] = useState<string | null>(null);
  const [viewportHeight, setViewportHeight] = useState(0);
  const scrollRef = useRef<ScrollViewInstance>(null);
  const fieldY = useRef<Record<string, number>>({});

  // Opening the form uses up the sign-in return, so it can't fire again later.
  useEffect(() => {
    clearReturnTo();
  }, []);

  const edited = () => {
    // A reset while a send runs would detach it from this form. Edits are blocked then anyway.
    if (submit.isPending) return;
    setProblem(null);
    submit.reset();
  };

  const showTimeSection = () =>
    scrollRef.current?.scrollTo({
      y: Math.max(0, (fieldY.current.time ?? 0) - space.lg),
      animated: true,
    });

  const onValid = (values: TableFormValues) => {
    const fresh = new Date();
    setNow(fresh);
    const issue = tableTimeProblem(values.tableAt, fresh);
    if (issue) {
      setProblem(issue === 'too_soon' ? LATER_TABLE_TIME_MESSAGE : FAR_TABLE_TIME_MESSAGE);
      showTimeSection();
      return;
    }
    setProblem(null);
    submit.submit({
      businessId: business.id,
      tableAt: values.tableAt,
      partySize: values.partySize,
      note: values.note === '' ? undefined : values.note,
    });
  };
  const onInvalid = () => {
    // The picker has no value yet: the only field that can be missing.
    if (!tableAt) {
      setProblem(CHOOSE_TABLE_TIME_MESSAGE);
      showTimeSection();
      return;
    }
    setProblem('Check the party size and your note, then try again.');
  };
  const onSend = () => {
    setNow(new Date());
    void handleSubmit(onValid, onInvalid)();
  };

  if (sent) {
    return (
      <View style={{ gap: space.lg }}>
        <Text
          variant="title"
          accessibilityRole="header"
          accessibilityLiveRegion="polite"
          maxFontSizeMultiplier={maxFontMultiplier}
        >
          Request sent
        </Text>
        <RequestStatusChip status={sent.display_status} />
        <Text variant="bodyLg">{tableSentMessage(business.name)}</Text>
        <Text color="textMuted">
          {`${formatDateTimeWithZone(sent.table_at, { timeZone, locale })}, party of ${sent.party_size}. ${TABLE_SENT_NOTE}`}
        </Text>
        <Button title="View my requests" onPress={() => router.replace('/requests')} />
        <Button title="Done" variant="secondary" onPress={onClose} />
      </View>
    );
  }

  const serverError = submit.error ? requestErrorMessage(submit.error.code) : null;
  // One message at a time, in the bar, right under Send.
  const barError = problem ?? serverError;

  return (
    <KeyboardAvoidingView
      testID="keyboard-avoiding"
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Fixed: title, then the Send bar. While the keyboard is up the title steps aside. */}
      {keyboardVisible ? null : (
        <View style={{ gap: space.xs }}>
          <Text
            variant="title"
            accessibilityRole="header"
            maxFontSizeMultiplier={maxFontMultiplier}
          >
            Request table
          </Text>
          <Text color="textMuted">{`At ${business.name}`}</Text>
        </View>
      )}
      <SendBar
        businessName={business.name}
        noun="table"
        error={barError}
        sending={sending}
        onSend={onSend}
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
        <View
          style={{ gap: space.sm }}
          onLayout={(event) => {
            fieldY.current.time = event.nativeEvent.layout.y;
          }}
        >
          <Text variant="bodyLg" accessibilityRole="header">
            Table time
          </Text>
          <TableTimePicker
            now={now}
            disabled={sending}
            onOpen={() => {
              // A form left open for a while must offer times that are still allowed.
              const fresh = new Date();
              setNow(fresh);
              return fresh;
            }}
            value={tableAt ?? null}
            timeZone={timeZone}
            locale={locale}
            onChange={(value, issue) => {
              edited();
              setValue('tableAt', value, { shouldValidate: false });
              // The native picker may offer a time the server would refuse (Android's time dialog
              // ignores its limits): the nearest allowed time is kept and the person told.
              setProblem(
                issue === 'too_soon'
                  ? LATER_TABLE_TIME_MESSAGE
                  : issue === 'too_far'
                    ? FAR_TABLE_TIME_MESSAGE
                    : null,
              );
            }}
          />
        </View>

        <View style={{ gap: space.sm }}>
          <Text variant="bodyLg" accessibilityRole="header">
            Party size
          </Text>
          <View style={[styles.partyRow, { gap: space.md }]}>
            <PartySizeStepper
              size={partySize ?? MIN_PARTY_SIZE}
              disabled={sending}
              onChange={(next) => {
                edited();
                setValue('partySize', next);
              }}
            />
            <Text color="textMuted">{partySize === 1 ? 'person' : 'people'}</Text>
          </View>
        </View>

        <View
          onLayout={(event) => {
            fieldY.current.note = event.nativeEvent.layout.y;
          }}
        >
          <Controller
            control={control}
            name="note"
            render={({ field }) => (
              <TextField
                label="Note for the restaurant (optional)"
                value={field.value ?? ''}
                onChangeText={(text) => {
                  edited();
                  field.onChange(stripHidden(text));
                }}
                onBlur={field.onBlur}
                onFocus={() =>
                  scrollRef.current?.scrollTo({
                    y: Math.max(0, (fieldY.current.note ?? 0) - space.lg),
                    animated: true,
                  })
                }
                multiline
                maxLength={MAX_NOTE}
                editable={!sending}
                textAlignVertical="top"
              />
            )}
          />
        </View>

        <Text variant="caption" color="textMuted">
          {TABLE_SENT_NOTE}
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  partyRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
});
