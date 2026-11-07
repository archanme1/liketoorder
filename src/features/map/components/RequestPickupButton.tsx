import { useRouter } from 'expo-router';
import { useContext } from 'react';
import { View } from 'react-native';

import { Button } from '@/components/ui';
import { AuthContext } from '@/features/auth/components/AuthProvider';
import { requestFormHref, setReturnTo } from '@/features/auth/returnTo';
import { useMyBusiness } from '@/features/sellers/hooks/useMyBusiness';
import { useTheme } from '@/theme/useTheme';

type RequestPickupButtonProps = {
  businessId: string;
  /** The business name, for the spoken label. */
  name: string;
};

// The sheet's entry point to the request form. Public sheet, signed-in action: a guest is sent to
// sign in and comes back to the form for this business. Outside the auth provider (no one knows
// who is looking) there is no button at all.
export function RequestPickupButton(props: RequestPickupButtonProps) {
  const auth = useContext(AuthContext);
  if (!auth) return null;
  return auth.session ? <SignedInButton {...props} /> : <GuestButton {...props} />;
}

function GuestButton({ businessId, name }: RequestPickupButtonProps) {
  const router = useRouter();
  const { space } = useTheme();
  return (
    <View style={{ gap: space.sm }}>
      <Button
        title="Request pickup"
        accessibilityLabel={`Request pickup from ${name}`}
        accessibilityHint="Opens sign in first"
        onPress={() => {
          setReturnTo(requestFormHref(businessId));
          router.push('/sign-in');
        }}
      />
    </View>
  );
}

function SignedInButton({ businessId, name }: RequestPickupButtonProps) {
  const router = useRouter();
  const { space } = useTheme();
  const mine = useMyBusiness();

  // A seller can't request from themselves. Nothing shows while that is still being checked, so
  // the owner never sees the button flash; if the check fails the server still answers
  // own_business.
  if (mine.isPending) return null;
  if (mine.data?.id === businessId) return null;

  return (
    <View style={{ gap: space.sm }}>
      <Button
        title="Request pickup"
        accessibilityLabel={`Request pickup from ${name}`}
        onPress={() => router.push({ pathname: '/requests/new', params: { businessId } })}
      />
    </View>
  );
}
