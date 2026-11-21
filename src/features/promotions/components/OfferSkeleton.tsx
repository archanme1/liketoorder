import { StyleSheet, View } from 'react-native';

import { Skeleton } from '@/components/ui';
import { useTheme } from '@/theme/useTheme';

import { OFFERS_LOADING_LABEL } from '../messages';

const ROWS = [0, 1, 2];

// Three still placeholder cards (Skeleton has no shimmer, so Reduce Motion has nothing to stop).
// One "Loading offers" for screen readers; the blocks themselves are hidden.
export function OfferSkeleton() {
  const { colors, space, radius, size, type } = useTheme();
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={OFFERS_LOADING_LABEL}
      testID="offers-loading"
      style={{ gap: space.md }}
    >
      {ROWS.map((row) => (
        <View
          key={row}
          style={[
            styles.card,
            {
              gap: space.md,
              padding: space.md,
              borderRadius: radius.md,
              borderColor: colors.border,
              backgroundColor: colors.surface,
            },
          ]}
        >
          <Skeleton width={size.photoThumb} height={size.photoThumb} />
          <View style={[styles.text, { gap: space.sm }]}>
            <Skeleton height={type.bodyLg} width="70%" />
            <Skeleton height={type.body} width="40%" />
            <Skeleton height={type.body} />
            <Skeleton height={type.body} width="50%" />
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', borderWidth: StyleSheet.hairlineWidth },
  text: { flex: 1 },
});
