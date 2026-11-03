import { useRouter } from 'expo-router';
import { View } from 'react-native';

import { Text } from '@/components/ui';
import { useTheme } from '@/theme/useTheme';

import type { MyBusiness } from '../schema';

import { AddressAutocomplete } from './AddressAutocomplete';
import { SellerScreenFrame } from './SellerScreenFrame';
import { SellerScreenGate } from './SellerScreenGate';

export function ChangeAddressScreen() {
  return (
    <SellerScreenFrame>
      <SellerScreenGate screen="address">
        {(business) => <ChangeAddress business={business} />}
      </SellerScreenGate>
    </SellerScreenFrame>
  );
}

function ChangeAddress({ business }: { business: MyBusiness }) {
  const { space } = useTheme();
  const router = useRouter();
  const close = () => (router.canGoBack() ? router.back() : router.replace('/manage'));

  return (
    <View style={{ gap: space.lg }}>
      {/* The owner's own exact address; never shown to anyone else. */}
      <View accessible style={{ gap: space.xs }}>
        <Text color="textMuted">Current address</Text>
        <Text variant="bodyLg">{business.location?.formatted_address ?? 'No address yet'}</Text>
      </View>
      <AddressAutocomplete businessType={business.type} onResolved={close} />
    </View>
  );
}
