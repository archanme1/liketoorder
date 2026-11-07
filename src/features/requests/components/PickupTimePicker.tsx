import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui';
import { useTheme } from '@/theme/useTheme';

import {
  buildPickupDays,
  formatFullDay,
  formatTime,
  localDateKey,
  deviceTimeZone,
  type TimeOptions,
} from '../time';

type PickupTimePickerProps = TimeOptions & {
  /** "Now" on the phone; the earliest time offered is 15 minutes after it. */
  now: Date;
  value: Date | null;
  onChange: (value: Date) => void;
};

// Built from React Native primitives (no date-picker library): day buttons for the next 7 days,
// then a grid of quarter-hour times for the chosen day. Days and times are in `timeZone` (the
// phone's by default); the chosen value is an instant, sent to the server as UTC.
export function PickupTimePicker({
  now,
  value,
  onChange,
  timeZone = deviceTimeZone(),
  locale,
}: PickupTimePickerProps) {
  const { colors, space, radius, size, stroke } = useTheme();
  const options = useMemo(() => ({ timeZone, locale }), [timeZone, locale]);
  const days = useMemo(() => buildPickupDays(now, options), [now, options]);
  const [dayKey, setDayKey] = useState<string | null>(null);

  const valueKey = value ? localDateKey(value, timeZone) : null;
  const shownKey = dayKey ?? valueKey ?? days[0]?.key ?? null;
  const day = days.find((entry) => entry.key === shownKey) ?? days[0];

  if (!day) return null;

  return (
    <View style={{ gap: space.md }}>
      <View style={[styles.wrap, { gap: space.sm }]} accessibilityLabel="Pickup day">
        {days.map((entry) => {
          const selected = entry.key === day.key;
          return (
            <Pressable
              key={entry.key}
              onPress={() => setDayKey(entry.key)}
              accessibilityRole="button"
              accessibilityLabel={entry.spokenLabel}
              accessibilityState={{ selected }}
              style={[
                styles.option,
                {
                  minHeight: size.touch,
                  minWidth: size.touch,
                  paddingHorizontal: space.md,
                  gap: space.xs,
                  borderRadius: radius.md,
                  borderColor: selected ? colors.primary : colors.border,
                  borderWidth: selected ? stroke.selected : StyleSheet.hairlineWidth,
                  backgroundColor: colors.surface,
                },
              ]}
            >
              {selected ? (
                <Ionicons name="checkmark" size={size.tabIcon * 0.7} color={colors.primary} />
              ) : null}
              <Text>{entry.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <ScrollView
        nestedScrollEnabled
        style={{ maxHeight: size.photoLarge * 2 }}
        accessibilityLabel={`Pickup times on ${day.spokenLabel}`}
      >
        <View style={[styles.wrap, { gap: space.sm }]}>
          {day.slots.map((slot) => {
            const selected = value !== null && slot.getTime() === value.getTime();
            const time = formatTime(slot, options);
            return (
              <Pressable
                key={slot.getTime()}
                onPress={() => onChange(slot)}
                accessibilityRole="button"
                accessibilityLabel={`${formatFullDay(slot, options)}, ${time}`}
                accessibilityState={{ selected }}
                style={[
                  styles.option,
                  {
                    minHeight: size.touch,
                    minWidth: size.touch,
                    paddingHorizontal: space.md,
                    gap: space.xs,
                    borderRadius: radius.md,
                    borderColor: selected ? colors.primary : colors.border,
                    borderWidth: selected ? stroke.selected : StyleSheet.hairlineWidth,
                    backgroundColor: colors.surface,
                  },
                ]}
              >
                {selected ? (
                  <Ionicons name="checkmark" size={size.tabIcon * 0.7} color={colors.primary} />
                ) : null}
                <Text>{time}</Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  option: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
});
