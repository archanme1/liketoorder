import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, View } from 'react-native';

import { Button, Card, Text } from '@/components/ui';
import { scrim, maxFontMultiplier } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';

import {
  respondInputSchema,
  respondOptions,
  type DeclineReason,
  type RespondOptions,
} from '../schema';
import { DECLINE_REASON_REQUIRED, OTHER_REASON_REQUIRED, confirmCopy } from '../sellerMessages';

import { AcceptNoteField } from './AcceptNoteField';
import { DeclineReasonPicker } from './DeclineReasonPicker';

type RespondDialogProps = {
  action: 'accepted' | 'declined';
  homemade: boolean;
  /** The customer's name, for the confirm button's spoken label. */
  customer: string;
  /** Accept / Decline is running: every button is off, the confirm shows progress. */
  running: boolean;
  /** An error from the server to show inside the dialog, which stays open with the typed text. */
  errorMessage?: string | null;
  onConfirm: (options: RespondOptions | undefined) => void;
  onCancel: () => void;
};

const CONFIRM_TITLE = {
  accepted: 'Yes, accept request',
  declined: 'Yes, decline request',
} as const;

// The Accept / Decline confirm step. The answer is final, so it asks first; it also asks for what
// the answer needs: a note (optional) on Accept, one reason (required) on Decline. A Modal, so it
// can scroll above the keyboard and at the largest text size. What was typed lives here, in state
// that a refetch of the request does not touch.
export function RespondDialog({
  action,
  homemade,
  customer,
  running,
  errorMessage,
  onConfirm,
  onCancel,
}: RespondDialogProps) {
  const { space } = useTheme();
  const copy = confirmCopy(action, homemade);
  const [note, setNote] = useState('');
  const [reason, setReason] = useState<DeclineReason | null>(null);
  const [text, setText] = useState('');

  const input =
    action === 'accepted'
      ? { decision: 'accepted' as const, note }
      : { decision: 'declined' as const, reason: reason ?? undefined, text };
  const parsed = respondInputSchema.safeParse(input);

  // The spoken reason a disabled confirm gives.
  const missing =
    action === 'declined' && reason === null
      ? DECLINE_REASON_REQUIRED
      : action === 'declined' && reason === 'other' && text.trim() === ''
        ? OTHER_REASON_REQUIRED
        : null;
  const valid = parsed.success;

  const confirm = () => {
    if (running) return;
    if (!parsed.success) return;
    onConfirm(respondOptions(parsed.data));
  };

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={() => {
        if (!running) onCancel();
      }}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={[styles.flex, { backgroundColor: scrim }]}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
          contentContainerStyle={[styles.content, { padding: space.lg }]}
        >
          <View accessibilityViewIsModal testID="respond-dialog">
            <Card style={{ gap: space.md }}>
              <Text accessibilityRole="header" maxFontSizeMultiplier={maxFontMultiplier}>
                {copy.title}
              </Text>
              <Text color="textMuted">{copy.body}</Text>
              {action === 'accepted' ? (
                <AcceptNoteField value={note} onChange={setNote} homemade={homemade} />
              ) : (
                <DeclineReasonPicker
                  reason={reason}
                  onReasonChange={setReason}
                  text={text}
                  onTextChange={setText}
                />
              )}
              {errorMessage ? (
                <Text color="danger" accessibilityLiveRegion="polite">
                  {`⚠ ${errorMessage}`}
                </Text>
              ) : null}
              <View style={{ gap: space.sm }}>
                <Button
                  title={CONFIRM_TITLE[action]}
                  accessibilityLabel={`${CONFIRM_TITLE[action]} from ${customer}`}
                  accessibilityHint={missing ?? undefined}
                  variant={action === 'accepted' ? 'primary' : 'secondary'}
                  onPress={confirm}
                  loading={running}
                  disabled={running || !valid}
                />
                {missing && !running ? (
                  <Text variant="caption" color="textMuted" accessibilityLiveRegion="polite">
                    {missing}
                  </Text>
                ) : null}
                <Button title="Go back" variant="ghost" onPress={onCancel} disabled={running} />
              </View>
            </Card>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { flexGrow: 1, justifyContent: 'center' },
});
