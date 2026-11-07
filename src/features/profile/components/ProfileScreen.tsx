import { useLocalSearchParams, useRouter } from 'expo-router';
import { ScrollView } from 'react-native';

import { Banner, Button, NavRow, Screen } from '@/components/ui';
import { useSession } from '@/features/auth/hooks/useSession';
import { useSignOut } from '@/features/auth/hooks/useSignOut';
import { authErrorMessage, PASSWORD_UPDATED } from '@/features/auth/messages';
import { SellerModeRow } from '@/features/sellers/components/SellerModeRow';
import { useTheme } from '@/theme/useTheme';

import { ProfileHeader } from './ProfileHeader';

// The signed-in Profile tab. ProfileHeader handles the loading / empty / error / success states.
export function ProfileScreen() {
  const { space } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ notice?: string }>();
  const { notice, dismissNotice } = useSession();
  const signOut = useSignOut();

  // The reset form passes ?notice=password-updated; the session notice is the fallback for when
  // the route guard got here first.
  const passwordUpdated = params.notice === 'password-updated' || notice === 'password-updated';

  const clearNotice = () => {
    dismissNotice();
    if (params.notice) router.setParams({ notice: undefined });
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ gap: space.lg, paddingVertical: space.xl }}>
        {passwordUpdated ? <Banner tone="success" message={PASSWORD_UPDATED} /> : null}
        <ProfileHeader />
        {signOut.error ? <Banner message={authErrorMessage(signOut.error.code)} /> : null}
        <Button
          title="Edit profile"
          onPress={() => {
            clearNotice();
            router.push('/profile/edit');
          }}
        />
        <NavRow
          label="My requests"
          onPress={() => {
            clearNotice();
            router.push('/requests');
          }}
        />
        <SellerModeRow />
        <Button
          title="Sign out"
          variant="secondary"
          loading={signOut.isPending}
          onPress={() => {
            clearNotice();
            signOut.mutate();
          }}
        />
      </ScrollView>
    </Screen>
  );
}
