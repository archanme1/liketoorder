import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui';
import { maxFontMultiplier } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';

import { answerLines } from '../answerLines';
import { kindLabel } from '../kind';
import type { BusinessRequest } from '../schema';
import { CUSTOMER_ARRIVED, customerLabel, sellerStatusSentence } from '../sellerMessages';
import { STATUS_INFO } from '../status';
import { formatDateTime, type TimeOptions } from '../time';

import { orderPreview, partyText } from './RequestRow';
import { AnswerLines } from './AnswerLines';
import { RequestKindLabel } from './RequestKindLabel';
import { RequestStatusChip } from './RequestStatusChip';

type SellerRequestRowProps = TimeOptions & {
  request: BusinessRequest;
  onPress: (request: BusinessRequest) => void;
};

export const ROW_TITLE_MAX_FONT_MULTIPLIER = maxFontMultiplier;

// One row of the seller's inbox (memoized: a poll or a new page re-renders only the rows that
// changed). The status is the server's display_status as it comes; the phone never works out
// "expired" for itself.
export const SellerRequestRow = memo(function SellerRequestRow({
  request,
  onPress,
  timeZone,
  locale,
}: SellerRequestRowProps) {
  const { colors, space, radius, size } = useTheme();
  const status = request.display_status;
  const name = customerLabel(request.customer_name);
  const kind = request.kind;
  const when =
    request.kind === 'table'
      ? `Table ${formatDateTime(request.table_at, { timeZone, locale })}`
      : `Pickup ${formatDateTime(request.pickup_at, { timeZone, locale })}`;
  const preview = request.kind === 'table' ? partyText(request.party_size) : orderPreview(request);
  const sentence = sellerStatusSentence(status, kind);
  // One spoken line, the kind FIRST: the kind, who, the status as a word, what, and when.
  const spoken = [
    kindLabel(kind),
    `Request from ${name}`,
    `Status: ${STATUS_INFO[status].label}`,
    sentence,
    ...answerLines(request),
    preview || null,
    request.kind === 'table' && request.arrived_at ? CUSTOMER_ARRIVED : null,
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
        <Text
          variant="bodyLg"
          maxFontSizeMultiplier={ROW_TITLE_MAX_FONT_MULTIPLIER}
          style={styles.name}
        >
          {name}
        </Text>
        <RequestStatusChip status={status} />
      </View>
      <RequestKindLabel kind={kind} />
      <Text color="textMuted">{sentence}</Text>
      <AnswerLines request={request} />
      {preview ? <Text numberOfLines={2}>{preview}</Text> : null}
      {request.kind === 'table' && request.arrived_at ? <Text>{CUSTOMER_ARRIVED}</Text> : null}
      <Text color="textMuted">{when}</Text>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  row: { borderWidth: StyleSheet.hairlineWidth },
  head: { flexDirection: 'row', alignItems: 'flex-start', flexWrap: 'wrap' },
  name: { flexShrink: 1 },
});
