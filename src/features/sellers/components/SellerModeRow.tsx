import { useRouter } from 'expo-router';
import { View } from 'react-native';

import { Banner, Button, Card, Skeleton, Text } from '@/components/ui';
import { useTheme } from '@/theme/useTheme';

import { useMyBusiness } from '../hooks/useMyBusiness';
import { useSetSellerMode } from '../hooks/useSetSellerMode';
import { sellerErrorMessage } from '../messages';

import { LabelledSwitch } from './LabelledSwitch';

// The Profile tab's seller row: "Start selling" without a business, a seller-mode switch with one.
export function SellerModeRow() {
  const { space, size } = useTheme();
  const router = useRouter();
  const business = useMyBusiness();
  const setMode = useSetSellerMode();

  if (business.isPending) {
    return (
      <View accessible accessibilityLabel="Loading seller mode">
        <Skeleton height={size.touch} />
      </View>
    );
  }
  if (business.isError && business.data === undefined) {
    return (
      <Card style={{ gap: space.sm }}>
        <Banner message={sellerErrorMessage(business.error.code)} />
        <Button
          title="Try again"
          variant="secondary"
          accessibilityLabel="Try loading seller mode again"
          loading={business.isRefetching}
          onPress={() => void business.refetch()}
        />
      </Card>
    );
  }
  if (!business.data) {
    return (
      <Card style={{ gap: space.md }}>
        <Text>Sell your food on LikeToOrder with this same account.</Text>
        <Button title="Start selling" onPress={() => router.push('/seller/onboarding')} />
      </Card>
    );
  }

  // Show the requested value while the switch is saving, so it doesn't flick back.
  const on = setMode.isPending ? setMode.variables : business.data.is_listed;
  return (
    <Card style={{ gap: space.sm }}>
      <LabelledSwitch
        label="Seller mode"
        description={
          on ? 'Your listing is visible and the Manage tab is shown.' : 'Your listing is hidden.'
        }
        value={on}
        onValueChange={(value) => setMode.mutate(value)}
        disabled={setMode.isPending}
      />
      {setMode.error ? <Banner message={sellerErrorMessage(setMode.error.code)} /> : null}
    </Card>
  );
}
