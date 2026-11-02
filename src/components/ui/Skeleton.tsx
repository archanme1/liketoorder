import { View, type DimensionValue } from 'react-native';

import type { Theme } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';

type SkeletonProps = {
  width?: DimensionValue;
  height: number;
  rounded?: keyof Theme['radius'];
};

// Static placeholder block. No looping shimmer, so nothing to disable for reduce-motion.
// Hidden from screen readers: the loading container carries one "Loading" label, so
// several skeletons don't each announce it.
export function Skeleton({ width = '100%', height, rounded = 'sm' }: SkeletonProps) {
  const { colors, radius } = useTheme();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width, height, borderRadius: radius[rounded], backgroundColor: colors.surfaceAlt }}
    />
  );
}
