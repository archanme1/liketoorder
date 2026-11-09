import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui';
import { useTheme } from '@/theme/useTheme';

import { answerLines } from '../answerLines';
import { kindLabel, type RequestKind } from '../kind';
import type { PickupRequest } from '../schema';
import { STATUS_INFO, statusSentence } from '../status';
import { formatDateTime, type TimeOptions } from '../time';

import { AnswerLines } from './AnswerLines';
import { RequestKindLabel } from './RequestKindLabel';
import { RequestStatusChip } from './RequestStatusChip';

type RequestRowProps = TimeOptions & {
  request: PickupRequest;
  onPress: (request: PickupRequest) => void;
  /** What kind of request this is; spec 11 adds table requests. */
  kind?: RequestKind;
};

/** A short line about what was ordered: "2 items", or the start of the written order. */
export function orderPreview(request: Pick<PickupRequest, 'items' | 'order_text'>): string {
  const count = request.items?.reduce((sum, line) => sum + line.quantity, 0) ?? 0;
  const items = count > 0 ? `${count} ${count === 1 ? 'item' : 'items'}` : null;
  const text = request.order_text?.replace(/\s+/g, ' ').trim() ?? null;
  return [items, text].filter(Boolean).join(' · ');
}

// One row of My requests (memoized: a poll or a new page re-renders only the rows that changed). The status is the server's display_status, shown as it comes: the phone
// never works out "expired" for itself (a wrong phone clock must not change what is shown).
export const RequestRow = memo(function RequestRow({
  request,
  onPress,
  kind = 'pickup',
  timeZone,
  locale,
}: RequestRowProps) {
  const { colors, space, radius, size } = useTheme();
  const status = request.display_status;
  const pickup = formatDateTime(request.pickup_at, { timeZone, locale });
  const preview = orderPreview(request);
  const sentence = statusSentence(status, request.business_name);
  // One spoken line: who, the status as a word, what, and when.
  const spoken = [
    request.business_name,
    `Status: ${STATUS_INFO[status].label}`,
    sentence,
    ...answerLines(request),
    preview || null,
    `Pickup ${pickup}`,
  ]
    .filter(Boolean)
    .join('. ');

  return (
    <Pressable
      onPress={() => onPress(request)}
      accessibilityRole="button"
      accessibilityLabel={spoken}
      accessibilityValue={{ text: kindLabel(kind) }}
      accessibilityHint="Opens the request"
      style={({ pressed }) => [
        styles.row,
        {
          minHeight: size.touch,
          gap: space.sm,
          padding: space.md,
          borderRadius: radius.md,
          borderColor: colors.border,
          backgroundColor: colors.surface,
          opacity: pressed ? 0.8 : 1,
        },
      ]}
    >
      <View style={[styles.head, { gap: space.sm }]}>
        <Text variant="bodyLg" style={styles.name}>
          {request.business_name}
        </Text>
        <RequestStatusChip status={status} />
      </View>
      <RequestKindLabel kind={kind} />
      <Text color="textMuted">{sentence}</Text>
      <AnswerLines request={request} />
      {preview ? <Text numberOfLines={2}>{preview}</Text> : null}
      <Text color="textMuted">{`Pickup ${pickup}`}</Text>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  row: { borderWidth: StyleSheet.hairlineWidth },
  head: { flexDirection: 'row', alignItems: 'flex-start', flexWrap: 'wrap' },
  name: { flexShrink: 1 },
});
