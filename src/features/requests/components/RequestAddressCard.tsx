import { View } from 'react-native';

import { Button, Card, Skeleton, Text } from '@/components/ui';
import { HOMEMADE_DISCLAIMER_BODY, HOMEMADE_DISCLAIMER_TITLE } from '@/features/map/homemadeText';
import { useTheme } from '@/theme/useTheme';

import { usePickupAddress } from '../hooks/usePickupAddress';
import type { PickupRequest } from '../schema';

export const ADDRESS_UNAVAILABLE = "The cook's address isn't available any more.";

// The cook's exact address, for an accepted or completed homemade request only. The address comes
// from get_my_pickup_address and from nowhere else; it is never in a list, never cached after the
// request leaves those statuses, and never logged.
export function RequestAddressCard({ request }: { request: PickupRequest }) {
  const { space, type } = useTheme();
  const address = usePickupAddress(request.id, request);

  return (
    <Card style={{ gap: space.md }}>
      <Text variant="bodyLg" accessibilityRole="header">
        Pickup address
      </Text>
      {address.isPending ? (
        <View
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel="Loading address"
          style={{ gap: space.sm }}
        >
          <Skeleton height={type.bodyLg} />
          <Skeleton height={type.bodyLg} width="60%" />
        </View>
      ) : address.isError ? (
        <View style={{ gap: space.sm }}>
          <Text accessibilityRole="alert">{"We couldn't load the address. Try again."}</Text>
          <Button
            title="Retry"
            accessibilityLabel="Retry loading the address"
            onPress={() => void address.refetch()}
            loading={address.isFetching}
          />
        </View>
      ) : address.data ? (
        <Text selectable>{address.data.formatted_address}</Text>
      ) : (
        <Text accessibilityRole="alert">{ADDRESS_UNAVAILABLE}</Text>
      )}
      <View style={{ gap: space.xs }}>
        <Text accessibilityRole="header">{HOMEMADE_DISCLAIMER_TITLE}</Text>
        <Text color="textMuted">{HOMEMADE_DISCLAIMER_BODY}</Text>
      </View>
    </Card>
  );
}
