import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui';
import { useTheme } from '@/theme/useTheme';

import { answerLines } from '../answerLines';
import { kindLabel } from '../kind';
import type { CustomerRequest, PickupRequest } from '../schema';
import { STATUS_INFO, statusSentence } from '../status';
import { formatDateTime, type TimeOptions } from '../time';

import { AnswerLines } from './AnswerLines';
import { RequestKindLabel } from './RequestKindLabel';
import { RequestStatusChip } from './RequestStatusChip';

type RequestRowProps = TimeOptions & {
  request: CustomerRequest;
  onPress: (request: CustomerRequest) => void;
};

/** "Party of 4" (a table request has no items). */
export function partyText(size: number): string {
  return `Party of ${size}`;
}

/** A short line about what was ordered: "2 items", or the start of the written order. */
export function orderPreview(request: Pick<PickupRequest, 'items' | 'order_text'>): string {
  const count = request.items?.reduce((sum, line) => sum + line.quantity, 0) ?? 0;
  const items = count > 0 ? `${count} ${count === 1 ? 'item' : 'items'}` : null;
  const text = request.order_text?.replace(/\s+/g, ' ').trim() ?? null;
  return [items, text].filter(Boolean).join(' · ');
}

// One row of My requests (memoized: a poll or a new page re-renders only the rows that changed).
// The status is the server's display_status, shown as it comes: the phone never works out
// "expired" for itself (a wrong phone clock must not change what is shown).
export const RequestRow = memo(function RequestRow({
  request,
  onPress,
  timeZone,
  locale,
}: RequestRowProps) {
  const { colors, space, radius, size } = useTheme();
  const status = request.display_status;
  const kind = request.kind;
  // Pickup: what was ordered and the pickup time. Table: the party and the table time.
  const when =
    request.kind === 'table'
      ? `Table ${formatDateTime(request.table_at, { timeZone, locale })}`
      : `Pickup ${formatDateTime(request.pickup_at, { timeZone, locale })}`;
  const preview = request.kind === 'table' ? partyText(request.party_size) : orderPreview(request);
  const sentence = statusSentence(status, request.business_name, kind);
  // One spoken line, the kind FIRST: the kind, who, the status as a word, what, and when.
  const spoken = [
    kindLabel(kind),
    request.business_name,
    `Status: ${STATUS_INFO[status].label}`,
    sentence,
    ...answerLines(request),
    preview || null,
    when,
  ]
    .filter(Boolean)
    .join('. ');

  return (
    <Pressable
      onPress={() => onPress(request)}
      accessibilityRole="button"
      accessibilityLabel={spoken}
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
      <Text color="textMuted">{when}</Text>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  row: { borderWidth: StyleSheet.hairlineWidth },
  head: { flexDirection: 'row', alignItems: 'flex-start', flexWrap: 'wrap' },
  name: { flexShrink: 1 },
});
