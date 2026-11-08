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
  earliestPickup,
  formatDateTime,
  latestPickup,
  type TimeOptions,
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

type PickupTimePickerProps = TimeOptions & {
  /** "Now" on the phone; the earliest time offered is 15 minutes after it. */
  now: Date;
  value: Date | null;
  /** The chosen time (a quarter hour, inside the allowed window), and which side it was outside of. */
  onChange: (value: Date, problem: PickupTimeProblem | null) => void;
};

// The platform's own calendar and time picker, in the platform's own way. iOS: a button opens a
// dialog with one calendar-and-time control (15-minute steps, limited to the allowed window); the
// choice is applied only on Done, and Cancel, the backdrop and back discard it. Android: the date
// dialog, then the time dialog; that dialog ignores minimum and maximum dates, so the result is
// snapped and clamped here. Either way the result is an instant that goes to the server as UTC,
// and what is shown is in `timeZone` (the phone's unless a test says otherwise: it is only handed
// to the native picker when it was given explicitly).
export function PickupTimePicker({
  now,
  value,
  onChange,
  timeZone,
  locale,
}: PickupTimePickerProps) {
  const { colors, space, radius, size, scrim } = useTheme();
  const { height: windowHeight, fontScale } = useWindowDimensions();
  const reduceMotion = useReduceMotion();
  const zone = timeZone ?? deviceTimeZone();
  const earliest = earliestPickup(now);
  const latest = latestPickup(now);
  const base = value ?? earliest;

  const [open, setOpen] = useState(false);
  // What the control shows while the dialog is open. Nothing is applied until Done.
  const [draft, setDraft] = useState<Date>(base);
  const titleRef = useRef<ComponentRef<typeof View>>(null);

  const finish = (picked: Date) => {
    const { value: next, problem } = clampToWindow(picked, now);
    onChange(next, problem);
  };

  const choose = () => {
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        mode: 'date',
        value: base,
        minimumDate: earliest,
        maximumDate: latest,
        timeZoneName: timeZone,
        onValueChange: (_event, pickedDay) => {
          // Keep the wall-clock time already chosen, on the new day, whatever the dialog returned.
          const withDay = combineDateAndTime(pickedDay, base, zone);
          DateTimePickerAndroid.open({
            mode: 'time',
            value: withDay,
            minuteInterval: 15,
            timeZoneName: timeZone,
            onValueChange: (_timeEvent, pickedTime) => {
              finish(combineDateAndTime(withDay, pickedTime, zone));
            },
          });
        },
      });
      return;
    }
    setDraft(base);
    setOpen(true);
  };

  const cancel = () => setOpen(false);
  const done = () => {
    setOpen(false);
    finish(draft);
  };

  const label = value ? 'Change pickup time' : 'Choose pickup time';
  const cardMaxHeight = windowHeight * 0.85;
  return (
    <View style={{ gap: space.md }}>
      {value ? (
        <Text accessibilityRole="header">{`Pickup: ${formatDateTime(value, { timeZone: zone, locale })}`}</Text>
      ) : (
        <Text color="textMuted">No pickup time chosen yet.</Text>
      )}
      <Button title={label} variant="secondary" accessibilityLabel={label} onPress={choose} />

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
                    Pickup time
                  </Text>
                </View>
                <Text color="textMuted">{`Selected: ${formatDateTime(draft, { timeZone: zone, locale })}`}</Text>
                <DateTimePicker
                  mode="datetime"
                  display={pickerDisplay(fontScale)}
                  value={draft}
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
                    accessibilityLabel="Cancel, keep the current pickup time"
                    onPress={cancel}
                  />
                </View>
                <View style={[styles.cell, { minWidth: size.photoThumb }]}>
                  <Button
                    title="Done"
                    accessibilityLabel="Done, use this pickup time"
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
