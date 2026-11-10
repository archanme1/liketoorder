import { View } from 'react-native';

import { Text, TextField } from '@/components/ui';
import { maxFontMultiplier } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';

import {
  DECLINE_REASON_ORDER,
  TABLE_DECLINE_REASON_ORDER,
  declineReasonText,
  tableDeclineReasonText,
} from '../declineReasons';
import { MAX_ANSWER_NOTE, type DeclineReason, type TableDeclineReason } from '../schema';
import { DECLINE_REASON_TITLE, OTHER_REASON_LABEL, counterText } from '../sellerMessages';

import { DeclineReasonList } from './DeclineReasonList';

type CommonProps = {
  /** The seller's own words, used only with "Other". */
  text: string;
  onTextChange: (text: string) => void;
};

// A pickup picker holds and returns pickup reasons; a table picker holds and returns table reasons.
// The kind decides the whole type, so a pickup dialog cannot be handed a table reason.
type DeclineReasonPickerProps = CommonProps &
  (
    | {
        kind?: 'pickup';
        /** Nothing is chosen at first: the seller must pick one. */
        reason: DeclineReason | null;
        onReasonChange: (reason: DeclineReason) => void;
      }
    | {
        kind: 'table';
        reason: TableDeclineReason | null;
        onReasonChange: (reason: TableDeclineReason) => void;
      }
  );

const PICKUP_OPTIONS = DECLINE_REASON_ORDER.map((code) => ({
  code,
  label: declineReasonText(code),
}));
const TABLE_OPTIONS = TABLE_DECLINE_REASON_ORDER.map((code) => ({
  code,
  label: tableDeclineReasonText(code),
}));

// Six radio rows (five for a table), then a text box for "Other".
export function DeclineReasonPicker(props: DeclineReasonPickerProps) {
  const { text, onTextChange } = props;
  const { space, weight } = useTheme();
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
      {props.kind === 'table' ? (
        <DeclineReasonList
          options={TABLE_OPTIONS}
          reason={props.reason}
          onChange={props.onReasonChange}
        />
      ) : (
        <DeclineReasonList
          options={PICKUP_OPTIONS}
          reason={props.reason}
          onChange={props.onReasonChange}
        />
      )}
      {props.reason === 'other' ? (
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
