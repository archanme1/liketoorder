import { View } from 'react-native';

import { Skeleton } from '@/components/ui';
import { useTheme } from '@/theme/useTheme';

const ROWS = 4;

/** The seller screens' loading state: one "Loading" label over static skeleton rows. */
export function SellerLoading({ label = 'Loading your business' }: { label?: string }) {
  const { space, size } = useTheme();
  return (
    <View accessible accessibilityLabel={label} testID="seller-skeleton" style={{ gap: space.lg }}>
      {Array.from({ length: ROWS }, (_, index) => (
        <Skeleton key={index} height={size.touch} />
      ))}
    </View>
  );
}
