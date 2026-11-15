import { View } from 'react-native';

import { Banner, Button } from '@/components/ui';
import { useTheme } from '@/theme/useTheme';

type FoodLogRefreshErrorProps = {
  message: string;
  onRetry: () => void;
  retrying: boolean;
  retryLabel: string;
};

// A failed background refresh: what is already on screen stays, with this above it.
export function FoodLogRefreshError({
  message,
  onRetry,
  retrying,
  retryLabel,
}: FoodLogRefreshErrorProps) {
  const { space } = useTheme();
  return (
    <View style={{ gap: space.sm }}>
      <Banner message={message} />
      <Button
        title="Try again"
        variant="secondary"
        accessibilityLabel={retryLabel}
        onPress={onRetry}
        loading={retrying}
      />
    </View>
  );
}
