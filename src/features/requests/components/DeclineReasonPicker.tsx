import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text, TextField } from '@/components/ui';
import { maxFontMultiplier } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';

import {
  DECLINE_REASON_ORDER,
  TABLE_DECLINE_REASON_ORDER,
  declineReasonText,
  tableDeclineReasonText,
} from '../declineReasons';
import type { RequestKind } from '../kind';
import { MAX_ANSWER_NOTE, type AnyDeclineReason } from '../schema';
import { DECLINE_REASON_TITLE, OTHER_REASON_LABEL, counterText } from '../sellerMessages';

type DeclineReasonPickerProps = {
  /** Which list of reasons to offer; a pickup unless told otherwise. */
  kind?: RequestKind;
  /** Nothing is chosen at first: the seller must pick one. */
  reason: AnyDeclineReason | null;
  // Method syntax on purpose: a caller that holds only one kind's reasons can pass its setter.
  onReasonChange(reason: AnyDeclineReason): void;
  /** The seller's own words, used only with "Other". */
  text: string;
  onTextChange: (text: string) => void;
};

// Six radio rows (five for a table), then a text box for "Other". The chosen row is a word ("selected"), a check mark
// and bold text, never colour alone. Each row is at least 44 pt and wraps at large text.
export function DeclineReasonPicker({
  kind = 'pickup',
  reason,
  onReasonChange,
  text,
  onTextChange,
}: DeclineReasonPickerProps) {
  const { colors, space, radius, size, stroke, type, weight } = useTheme();
  const length = text.length;
  const tooLong = length > MAX_ANSWER_NOTE;
  const error = tooLong ? `Shorten your reason to ${MAX_ANSWER_NOTE} characters` : undefined;

  return (
    <View style={{ gap: space.sm }}>
      <Text
        accessibilityRole="header"
        style={{ fontWeight: weight.semibold }}
        maxFontSizeMultiplier={maxFontMultiplier}
      >
        {DECLINE_REASON_TITLE}
      </Text>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel="Reason for declining"
        style={{ gap: space.sm }}
      >
        {(kind === 'table' ? TABLE_DECLINE_REASON_ORDER : DECLINE_REASON_ORDER).map((code) => {
          const selected = code === reason;
          const label =
            kind === 'table'
              ? tableDeclineReasonText(code as (typeof TABLE_DECLINE_REASON_ORDER)[number])
              : declineReasonText(code as (typeof DECLINE_REASON_ORDER)[number]);
          return (
            <Pressable
              key={code}
              onPress={() => onReasonChange(code)}
              accessibilityRole="radio"
              accessibilityLabel={selected ? `${label}, selected` : label}
              accessibilityState={{ selected }}
              style={[
                styles.row,
                {
                  minHeight: size.touch,
                  gap: space.sm,
                  paddingHorizontal: space.md,
                  paddingVertical: space.sm,
                  borderRadius: radius.md,
                  borderWidth: selected ? stroke.selected : StyleSheet.hairlineWidth,
                  borderColor: selected ? colors.primary : colors.border,
                  backgroundColor: selected ? colors.surface : undefined,
                },
              ]}
            >
              <Ionicons
                name={selected ? 'radio-button-on' : 'radio-button-off'}
                size={type.bodyLg}
                color={selected ? colors.primary : colors.textMuted}
                accessibilityElementsHidden
                importantForAccessibility="no"
              />
              <Text
                style={[styles.label, selected ? { fontWeight: weight.semibold } : undefined]}
                maxFontSizeMultiplier={maxFontMultiplier}
              >
                {label}
              </Text>
              {selected ? (
                <Ionicons
                  name="checkmark"
                  size={type.bodyLg}
                  color={colors.primary}
                  accessibilityElementsHidden
                  importantForAccessibility="no"
                />
              ) : null}
            </Pressable>
          );
        })}
      </View>
      {reason === 'other' ? (
        <View style={{ gap: space.xs }}>
          <TextField
            label={OTHER_REASON_LABEL}
            value={text}
            onChangeText={onTextChange}
            multiline
            textAlignVertical="top"
            error={error}
          />
          <Text variant="caption" color="textMuted" accessibilityLiveRegion="polite">
            {counterText(length, MAX_ANSWER_NOTE)}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  label: { flex: 1 },
});
