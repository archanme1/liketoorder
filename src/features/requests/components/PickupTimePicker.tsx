import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Platform, View } from 'react-native';

import { Button, Text } from '@/components/ui';
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

type PickupTimePickerProps = TimeOptions & {
  /** "Now" on the phone; the earliest time offered is 15 minutes after it. */
  now: Date;
  value: Date | null;
  /** The chosen time (a quarter hour, inside the allowed window), and which side it was outside of. */
  onChange: (value: Date, problem: PickupTimeProblem | null) => void;
};

// The platform's own calendar and time picker. iOS: one inline control (calendar and time
// together) shown after "Choose pickup time", 15-minute steps, limited to the allowed window.
// Android: the date dialog, then the time dialog; its time dialog ignores minimum and maximum
// dates, so the result is snapped and clamped here. Either way the result is an instant that
// goes to the server as UTC, and what is shown is in `timeZone` (the phone's unless a test says
// otherwise: it is only handed to the native picker when it was given explicitly).
export function PickupTimePicker({
  now,
  value,
  onChange,
  timeZone,
  locale,
}: PickupTimePickerProps) {
  const { space } = useTheme();
  const [open, setOpen] = useState(false);
  const zone = timeZone ?? deviceTimeZone();
  const earliest = earliestPickup(now);
  const latest = latestPickup(now);
  const base = value ?? earliest;

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
    // iOS: showing the control also selects its first value, so what is shown is what is chosen.
    if (value === null) finish(earliest);
    setOpen((current) => !current);
  };

  const label = value ? 'Change pickup time' : 'Choose pickup time';
  return (
    <View style={{ gap: space.md }}>
      {value ? (
        <Text accessibilityRole="header">{`Pickup: ${formatDateTime(value, { timeZone: zone, locale })}`}</Text>
      ) : (
        <Text color="textMuted">No pickup time chosen yet.</Text>
      )}
      <Button
        title={Platform.OS === 'ios' && open ? 'Hide calendar' : label}
        variant="secondary"
        accessibilityLabel={Platform.OS === 'ios' && open ? 'Hide pickup calendar' : label}
        onPress={choose}
      />
      {Platform.OS === 'ios' && open ? (
        <DateTimePicker
          mode="datetime"
          display="inline"
          value={base}
          minimumDate={earliest}
          maximumDate={latest}
          minuteInterval={15}
          timeZoneName={timeZone}
          locale={locale}
          onValueChange={(_event, picked) => finish(picked)}
        />
      ) : null}
    </View>
  );
}
