import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui';
import { useTheme } from '@/theme/useTheme';

import { answerLines } from '../answerLines';
import { kindLabel, type RequestKind } from '../kind';
import type { SellerRequest } from '../schema';
import { customerLabel, sellerStatusSentence } from '../sellerMessages';
import { STATUS_INFO } from '../status';
import { formatDateTime, type TimeOptions } from '../time';

import { orderPreview } from './RequestRow';
import { AnswerLines } from './AnswerLines';
import { RequestKindLabel } from './RequestKindLabel';
import { RequestStatusChip } from './RequestStatusChip';

type SellerRequestRowProps = TimeOptions & {
  request: SellerRequest;
  onPress: (request: SellerRequest) => void;
  /** What kind of request this is; spec 11 adds table requests. */
  kind?: RequestKind;
};

export const ROW_TITLE_MAX_FONT_MULTIPLIER = 1.6;

// One row of the seller's inbox (memoized: a poll or a new page re-renders only the rows that
// changed). The status is the server's display_status as it comes; the phone never works out
// "expired" for itself.
export const SellerRequestRow = memo(function SellerRequestRow({
  request,
  onPress,
  kind = 'pickup',
  timeZone,
  locale,
}: SellerRequestRowProps) {
  const { colors, space, radius, size } = useTheme();
  const status = request.display_status;
  const name = customerLabel(request.customer_name);
  const pickup = formatDateTime(request.pickup_at, { timeZone, locale });
  const preview = orderPreview(request);
  const sentence = sellerStatusSentence(status);
  // One spoken line: who, the status as a word, what, and when.
  const spoken = [
    `Request from ${name}`,
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
      <Text color="textMuted">{`Pickup ${pickup}`}</Text>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  row: { borderWidth: StyleSheet.hairlineWidth },
  head: { flexDirection: 'row', alignItems: 'flex-start', flexWrap: 'wrap' },
  name: { flexShrink: 1 },
});
