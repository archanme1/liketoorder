import { zodResolver } from '@hookform/resolvers/zod';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useMemo, useRef } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { AccessibilityInfo, Pressable, StyleSheet, View } from 'react-native';

import { Button, Text, TextField } from '@/components/ui';
import { maxFontMultiplier } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';

import type { PromotionErrorCode } from '../api';
import {
  counterAnnouncement,
  counterLabel,
  formatChipDay,
  formatChipDayLong,
  localToday,
  startDayOptions,
} from '../format';
import { useRequestPromotion } from '../hooks/useRequestPromotion';
import { ASAP_LABEL, CATEGORY_LABELS, promotionErrorMessage, START_NOTE } from '../messages';
import {
  PROMOTION_CATEGORIES,
  promoteFormSchema,
  type MyPromotion,
  type PromoteFormInput,
  type PromotionCategory,
} from '../schema';
import { checkHeadline, headlineLength, MAX_HEADLINE_CHARS, normalizeHeadline } from '../text';

// Written as an escape so this file stays ASCII; the prefix means the error never relies on colour.
const WARNING = '\u26A0';
const HEADLINE_HINT = 'One line, up to 60 characters. No phone numbers or emails.';

type PromoteFormProps = {
  /** The request was saved; the screen now shows the answer. */
  onSent: (answer: MyPromotion) => void;
  /**
   * The server refused or could not be reached, for a reason that is not about one field; the
   * screen shows the message. A refused headline or category shows on its own field only.
   */
  onError: (code: PromotionErrorCode) => void;
  /** For the start-day chips. The phone's clock, zone and language by default; set in tests. */
  now?: Date;
  timeZone?: string;
  locale?: string;
};

// The request form: category, headline, preferred start. Fast feedback only: request_promotion
// judges every field again, and its refusals land on the same fields.
export function PromoteForm({ onSent, onError, now, timeZone, locale }: PromoteFormProps) {
  const { space } = useTheme();
  const send = useRequestPromotion();
  const { control, handleSubmit, setError, setValue } = useForm<PromoteFormInput>({
    resolver: zodResolver(promoteFormSchema),
    defaultValues: { category: null, headline: '', preferredStart: null },
  });

  const days = useMemo(
    () => startDayOptions(localToday(now ?? new Date(), timeZone)),
    [now, timeZone],
  );
  const startOptions = useMemo(
    () => [
      { value: null, label: ASAP_LABEL },
      ...days.map((day) => ({
        value: day,
        label: formatChipDay(day, locale),
        spoken: formatChipDayLong(day, locale),
      })),
    ],
    [days, locale],
  );

  const length = headlineLength(useWatch({ control, name: 'headline' }));
  const over = length > MAX_HEADLINE_CHARS;
  const lastLength = useRef(length);
  useEffect(() => {
    const message = counterAnnouncement(lastLength.current, length);
    lastLength.current = length;
    if (message) AccessibilityInfo.announceForAccessibility(message);
  }, [length]);

  const submit = handleSubmit((values) => {
    const check = checkHeadline(values.headline);
    if (!check.ok || values.category === null) return; // the resolver already showed why
    send.mutate(
      { category: values.category, headline: check.value, preferredStart: values.preferredStart },
      {
        onSuccess: onSent,
        onError: (error) => {
          const message = promotionErrorMessage(error.code);
          if (error.code === 'invalid_headline') return setError('headline', { message });
          if (error.code === 'invalid_category') return setError('category', { message });
          if (error.code === 'invalid_start') setValue('preferredStart', null);
          onError(error.code);
        },
      },
    );
  });

  return (
    <View style={{ gap: space.lg }}>
      <Controller
        control={control}
        name="category"
        render={({ field, fieldState }) => (
          <ChoiceChips<PromotionCategory | null>
            groupLabel="Category"
            options={PROMOTION_CATEGORIES.map((value) => ({
              value,
              label: CATEGORY_LABELS[value],
            }))}
            value={field.value}
            onChange={field.onChange}
            error={fieldState.error?.message}
          />
        )}
      />
      <Controller
        control={control}
        name="headline"
        render={({ field, fieldState }) => (
          <View style={{ gap: space.xs }}>
            <TextField
              label="Headline"
              hint={HEADLINE_HINT}
              value={field.value}
              onChangeText={(text) => field.onChange(normalizeHeadline(text))}
              onBlur={field.onBlur}
              error={fieldState.error?.message}
              returnKeyType="done"
              autoCapitalize="sentences"
            />
            <Text color={over ? 'danger' : 'textMuted'} accessibilityLabel={counterLabel(length)}>
              {`${length}/${MAX_HEADLINE_CHARS}${over ? ' Too long' : ''}`}
            </Text>
          </View>
        )}
      />
      <Controller
        control={control}
        name="preferredStart"
        render={({ field }) => (
          <ChoiceChips<string | null>
            groupLabel="Preferred start"
            options={startOptions}
            value={field.value}
            onChange={field.onChange}
            note={START_NOTE}
          />
        )}
      />
      <Button title="Send request" onPress={() => void submit()} loading={send.isPending} />
    </View>
  );
}

type ChoiceOption<T> = { value: T; label: string; spoken?: string };

type ChoiceChipsProps<T> = {
  groupLabel: string;
  options: ChoiceOption<T>[];
  value: T;
  onChange: (value: T) => void;
  error?: string;
  note?: string;
};

// One choice from a few, as radio chips (the RequestFilterChips pattern): the selected one is a
// word ("Featured, selected"), a check mark and bold text, never colour alone. 44 pt targets, and
// the chips wrap at large text.
function ChoiceChips<T extends string | null>({
  groupLabel,
  options,
  value,
  onChange,
  error,
  note,
}: ChoiceChipsProps<T>) {
  const { colors, space, radius, size, stroke, type, weight } = useTheme();
  return (
    <View style={{ gap: space.sm }}>
      <Text style={{ fontWeight: weight.semibold }}>{groupLabel}</Text>
      {note ? (
        <Text variant="caption" color="textMuted">
          {note}
        </Text>
      ) : null}
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={groupLabel}
        style={[styles.group, { gap: space.sm }]}
      >
        {options.map((option) => {
          const selected = option.value === value;
          const spoken = option.spoken ?? option.label;
          return (
            <Pressable
              key={option.value ?? 'none'}
              onPress={() => onChange(option.value)}
              accessibilityRole="radio"
              accessibilityLabel={selected ? `${spoken}, selected` : spoken}
              accessibilityState={{ selected }}
              style={[
                styles.option,
                {
                  minHeight: size.touch,
                  minWidth: size.touch,
                  gap: space.xs,
                  paddingHorizontal: space.lg,
                  paddingVertical: space.sm,
                  borderRadius: radius.pill,
                  borderWidth: selected ? stroke.selected : StyleSheet.hairlineWidth,
                  borderColor: selected ? colors.primary : colors.border,
                  backgroundColor: selected ? colors.surface : undefined,
                },
              ]}
            >
              {selected ? (
                <Ionicons
                  name="checkmark"
                  size={type.bodyLg}
                  color={colors.primary}
                  accessibilityElementsHidden
                  importantForAccessibility="no"
                />
              ) : null}
              <Text
                maxFontSizeMultiplier={maxFontMultiplier}
                style={selected ? { fontWeight: weight.semibold } : undefined}
              >
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {error ? (
        <Text variant="caption" color="danger" accessibilityLiveRegion="polite">
          {`${WARNING} ${error}`}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { flexDirection: 'row', flexWrap: 'wrap' },
  option: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
});
