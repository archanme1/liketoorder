import { View } from 'react-native';

import { Card, Text } from '@/components/ui';
import { useTheme } from '@/theme/useTheme';

import { formatChipDay, statusText, type FormatOptions } from '../format';
import { ASAP_LABEL, CATEGORY_LABELS } from '../messages';
import type { Promotion } from '../schema';

type PromotionStatusCardProps = {
  promotion: Promotion;
  /** The phone's by default; set in tests. */
  options?: FormatOptions;
};

// The seller's own latest campaign. One screen-reader element with the whole status in words: the
// state is never shown by colour alone. No price (spec 16b D15).
export function PromotionStatusCard({ promotion, options = {} }: PromotionStatusCardProps) {
  const { space, weight } = useTheme();
  const status = statusText(promotion, options);
  const category = CATEGORY_LABELS[promotion.category];
  const requested = promotion.state === 'requested';
  const start = requested
    ? `Preferred start: ${
        promotion.preferred_start === null
          ? ASAP_LABEL
          : formatChipDay(promotion.preferred_start, options.locale)
      }`
    : null;

  // Each part is its own sentence; the status already ends with a full stop.
  const label = [status, `${category}.`, `Headline: ${promotion.headline}.`, start && `${start}.`]
    .filter((part): part is string => Boolean(part))
    .join(' ');

  return (
    <Card>
      <View accessible accessibilityLabel={label} style={{ gap: space.sm }}>
        <Text variant="bodyLg" style={{ fontWeight: weight.semibold }}>
          {status}
        </Text>
        <Text color="textMuted">{category}</Text>
        <Text>{promotion.headline}</Text>
        {start ? <Text color="textMuted">{start}</Text> : null}
      </View>
    </Card>
  );
}
