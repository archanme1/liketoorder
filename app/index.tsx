import { useRouter } from 'expo-router';
import { ScrollView } from 'react-native';

import { Banner, Button, Screen } from '@/components/ui';
import { useSession } from '@/features/auth/hooks/useSession';
import { useSignOut } from '@/features/auth/hooks/useSignOut';
import { authErrorMessage, PASSWORD_UPDATED } from '@/features/auth/messages';
import { ProfileHeader } from '@/features/profile/components/ProfileHeader';
import { useTheme } from '@/theme/useTheme';

// TEMPORARY signed-in home (spec 02). Replaced by tabs in spec 03.
export default function HomeScreen() {
  const { space } = useTheme();
  const router = useRouter();
  const { notice, dismissNotice } = useSession();
  const signOut = useSignOut();

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ gap: space.lg, paddingVertical: space.xl }}>
        {notice === 'password-updated' ? (
          <Banner tone="success" message={PASSWORD_UPDATED} />
        ) : null}
        <ProfileHeader />
        {signOut.error ? <Banner message={authErrorMessage(signOut.error.code)} /> : null}
        <Button
          title="Edit profile"
          onPress={() => {
            dismissNotice();
            router.push('/profile/edit');
          }}
        />
        <Button
          title="Sign out"
          variant="secondary"
          loading={signOut.isPending}
          onPress={() => {
            dismissNotice();
            signOut.mutate();
          }}
        />
      </ScrollView>
    </Screen>
  );
}
