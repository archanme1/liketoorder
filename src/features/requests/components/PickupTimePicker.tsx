import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { useRef, useState, type ComponentRef } from 'react';
import {
  AccessibilityInfo,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';

import { Button, Text } from '@/components/ui';
import { useReduceMotion } from '@/lib/useReduceMotion';
import { useTheme } from '@/theme/useTheme';

import type { PickupTimeProblem } from '../schema';
import {
  clampToWindow,
  combineDateAndTime,
  deviceTimeZone,
  formatDateTime,
  formatDateTimeWithZone,
  PICKUP_WINDOW,
  type TimeOptions,
  type TimeWindow,
} from '../time';

/**
 * From this system text scale up, the iOS control is the compact wheels instead of the inline
 * calendar, which grows with the text size and may not fit a dialog. To tune after the
 * Simulator run at the largest sizes.
 */
export const SPINNER_FONT_SCALE = 2;

/** The iOS control's style for a text scale. */
export function pickerDisplay(fontScale: number): 'inline' | 'spinner' {
  return fontScale >= SPINNER_FONT_SCALE ? 'spinner' : 'inline';
}

// The words around the picker: a pickup, or a table (spec 11). A table time is always shown with
// the zone's name.
const COPY = {
  pickup: { noun: 'pickup', line: 'Pickup', title: 'Pickup time' },
  table: { noun: 'table', line: 'Table time', title: 'Table time' },
} as const;

type PickupTimePickerProps = TimeOptions & {
  /** What is being picked. The default is a pickup time. */
  kind?: keyof typeof COPY;
  /** The times offered. The default is the pickup window (15 minutes to 7 days). */
  offeredTimes?: TimeWindow;
  /** "Now" on the phone; the earliest time offered comes after it (see `offeredTimes`). */
  now: Date;
  value: Date | null;
  /** Read-only, e.g. while the request is being sent. */
  disabled?: boolean;
  /** The chosen time (a quarter hour, inside the allowed window), and which side it was outside of. */
  onChange: (value: Date, problem: PickupTimeProblem | null) => void;
  /**
   * Called when the person opens the picker. Returns the current time, which the picker uses for
   * the earliest and latest times, so a form left open for a while offers times that are still
   * allowed. The parent should also store it as the `now` it passes in.
   */
  onOpen?: () => Date;
};

// The platform's own calendar and time picker, in the platform's own way. iOS: a button opens a
// dialog with one calendar-and-time control (15-minute steps, limited to the allowed window); the
// choice is applied only on Done, and Cancel, the backdrop and back discard it. Android: the date
// dialog, then the time dialog; that dialog ignores minimum and maximum dates, so the result is
// snapped and clamped here. Either way the result is an instant that goes to the server as UTC,
// and what is shown is in `timeZone` (the phone's unless a test says otherwise: it is only handed
// to the native picker when it was given explicitly).
export function PickupTimePicker({
  kind = 'pickup',
  offeredTimes = PICKUP_WINDOW,
  now,
  value,
  onChange,
  disabled = false,
  onOpen,
  timeZone,
  locale,
}: PickupTimePickerProps) {
  const { colors, space, radius, size, scrim } = useTheme();
  const { height: windowHeight, fontScale } = useWindowDimensions();
  const reduceMotion = useReduceMotion();
  const zone = timeZone ?? deviceTimeZone();
  const copy = COPY[kind];
  const show = (date: Date) =>
    kind === 'table'
      ? formatDateTimeWithZone(date, { timeZone: zone, locale })
      : formatDateTime(date, { timeZone: zone, locale });
  const earliest = offeredTimes.earliest(now);
  const latest = offeredTimes.latest(now);
  const base = value ?? earliest;

  const [open, setOpen] = useState(false);
  // What the control shows while the dialog is open, once the person has moved it; until then it
  // shows the chosen time (or the earliest). Nothing is applied until Done.
  const [draft, setDraft] = useState<Date | null>(null);
  const shownDraft = draft ?? base;
  const titleRef = useRef<ComponentRef<typeof View>>(null);

  const finish = (picked: Date, at: Date = now) => {
    const { value: next, problem } = clampToWindow(picked, at, offeredTimes);
    onChange(next, problem);
  };

  const choose = () => {
    const at = onOpen ? onOpen() : now;
    if (Platform.OS === 'android') {
      // The dialogs open straight away, so they use the fresh time directly.
      const openBase = value ?? offeredTimes.earliest(at);
      DateTimePickerAndroid.open({
        mode: 'date',
        value: openBase,
        minimumDate: offeredTimes.earliest(at),
        maximumDate: offeredTimes.latest(at),
        timeZoneName: timeZone,
        onValueChange: (_event, pickedDay) => {
          // Keep the wall-clock time already chosen, on the new day, whatever the dialog returned.
          const withDay = combineDateAndTime(pickedDay, openBase, zone);
          DateTimePickerAndroid.open({
            mode: 'time',
            value: withDay,
            minuteInterval: 15,
            timeZoneName: timeZone,
            onValueChange: (_timeEvent, pickedTime) => {
              finish(combineDateAndTime(withDay, pickedTime, zone), at);
            },
          });
        },
      });
      return;
    }
    setDraft(null);
    setOpen(true);
  };

  const cancel = () => setOpen(false);
  const done = () => {
    setOpen(false);
    finish(shownDraft);
  };

  const label = value ? `Change ${copy.noun} time` : `Choose ${copy.noun} time`;
  const cardMaxHeight = windowHeight * 0.85;
  return (
    <View style={{ gap: space.md }}>
      {value ? (
        <Text>{`${copy.line}: ${show(value)}`}</Text>
      ) : (
        <Text color="textMuted">{`No ${copy.noun} time chosen yet.`}</Text>
      )}
      <Button
        title={label}
        variant="secondary"
        accessibilityLabel={label}
        onPress={choose}
        disabled={disabled}
      />

      {Platform.OS === 'ios' ? (
        <Modal
          testID="pickup-time-modal"
          visible={open}
          transparent
          animationType={reduceMotion ? 'none' : 'fade'}
          onRequestClose={cancel}
          // A screen reader starts inside the dialog, on its title.
          onShow={() => {
            if (titleRef.current) {
              AccessibilityInfo.sendAccessibilityEvent(titleRef.current, 'focus');
            }
          }}
        >
          <View style={[styles.fill, { backgroundColor: scrim, padding: space.lg }]}>
            {/* The backdrop: a tap outside the card discards. Screen readers use Cancel instead. */}
            <Pressable
              testID="pickup-time-backdrop"
              onPress={cancel}
              accessible={false}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={StyleSheet.absoluteFill}
            />
            <View
              testID="pickup-time-dialog"
              accessibilityViewIsModal
              style={[
                styles.card,
                {
                  maxHeight: cardMaxHeight,
                  borderRadius: radius.lg,
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                },
              ]}
            >
              {/* The control scrolls: at the largest text size it can be taller than the dialog.
                  Cancel and Done below stay in view. */}
              <ScrollView
                testID="pickup-time-scroll"
                style={styles.shrink}
                contentContainerStyle={{ padding: space.lg, gap: space.md }}
              >
                <View ref={titleRef} accessible accessibilityRole="header">
                  <Text variant="title" maxFontSizeMultiplier={1.6}>
                    {copy.title}
                  </Text>
                </View>
                <Text color="textMuted">{`Selected: ${show(shownDraft)}`}</Text>
                <DateTimePicker
                  mode="datetime"
                  display={pickerDisplay(fontScale)}
                  value={shownDraft}
                  minimumDate={earliest}
                  maximumDate={latest}
                  minuteInterval={15}
                  timeZoneName={timeZone}
                  locale={locale}
                  onValueChange={(_event, picked) => setDraft(picked)}
                />
              </ScrollView>
              <View
                testID="pickup-time-footer"
                style={[
                  styles.footer,
                  {
                    gap: space.sm,
                    padding: space.lg,
                    borderTopColor: colors.border,
                  },
                ]}
              >
                <View style={[styles.cell, { minWidth: size.photoThumb }]}>
                  <Button
                    title="Cancel"
                    variant="secondary"
                    accessibilityLabel={`Cancel, keep the current ${copy.noun} time`}
                    onPress={cancel}
                  />
                </View>
                <View style={[styles.cell, { minWidth: size.photoThumb }]}>
                  <Button
                    title="Done"
                    accessibilityLabel={`Done, use this ${copy.noun} time`}
                    onPress={done}
                  />
                </View>
              </View>
            </View>
          </View>
        </Modal>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, justifyContent: 'center' },
  card: { overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth },
  shrink: { flexShrink: 1 },
  footer: { flexDirection: 'row', flexWrap: 'wrap', borderTopWidth: StyleSheet.hairlineWidth },
  cell: { flexGrow: 1 },
});
