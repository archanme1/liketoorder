import { View } from 'react-native';

import { Text } from '@/components/ui';
import { useTheme } from '@/theme/useTheme';

type SellerRequestDetailScreenProps = {
  /** The request id, or null when the link had no valid id. */
  requestId: string | null;
};

// PLACEHOLDER for gate C1 so the route has something to render. Gate C2 replaces this file with the
// real detail screen (states, order, actions with confirm steps).
export function SellerRequestDetailScreen({ requestId }: SellerRequestDetailScreenProps) {
  const { space } = useTheme();
  return (
    <View style={{ padding: space.lg }}>
      <Text>
        {requestId ? 'Request details are coming next.' : "We couldn't find that request."}
      </Text>
    </View>
  );
}
