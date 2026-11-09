import { View } from 'react-native';

import { Text, TextField } from '@/components/ui';
import { useTheme } from '@/theme/useTheme';

import { MAX_ANSWER_NOTE } from '../schema';
import { ACCEPT_ADDRESS_HINT, ACCEPT_NOTE_LABEL, counterText } from '../sellerMessages';

type AcceptNoteFieldProps = {
  value: string;
  onChange: (value: string) => void;
  /** A homemade cook's address is shared by the app after Accept, so the box says not to type it. */
  homemade: boolean;
  onFocus?: () => void;
};

// The optional note on an accept (0 to 200 characters, empty is fine), with a live counter in
// words ("12 of 200"). Plain text only.
export function AcceptNoteField({ value, onChange, homemade, onFocus }: AcceptNoteFieldProps) {
  const { space } = useTheme();
  const tooLong = value.length > MAX_ANSWER_NOTE;
  return (
    <View style={{ gap: space.xs }}>
      <TextField
        label={ACCEPT_NOTE_LABEL}
        value={value}
        onChangeText={onChange}
        onFocus={onFocus}
        multiline
        textAlignVertical="top"
        error={tooLong ? `Shorten your note to ${MAX_ANSWER_NOTE} characters` : undefined}
        hint={homemade ? ACCEPT_ADDRESS_HINT : undefined}
      />
      <Text variant="caption" color="textMuted" accessibilityLiveRegion="polite">
        {counterText(value.length, MAX_ANSWER_NOTE)}
      </Text>
    </View>
  );
}
