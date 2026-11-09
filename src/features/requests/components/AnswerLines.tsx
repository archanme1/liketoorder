import { View } from 'react-native';

import { Text } from '@/components/ui';
import { useTheme } from '@/theme/useTheme';

import { answerLines } from '../answerLines';
import type { PickupRequest } from '../schema';

/** "Declined: Sold out" and "Seller's note: ..." as plain text (no links, no markup). */
export function AnswerLines({
  request,
  variant = 'body',
}: {
  request: Pick<PickupRequest, 'status' | 'decline_reason' | 'response_note'>;
  variant?: 'body' | 'bodyLg';
}) {
  const { space } = useTheme();
  const lines = answerLines(request);
  if (lines.length === 0) return null;
  return (
    <View style={{ gap: space.xs }}>
      {lines.map((line) => (
        <Text key={line} variant={variant}>
          {line}
        </Text>
      ))}
    </View>
  );
}
