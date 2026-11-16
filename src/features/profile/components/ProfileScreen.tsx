import { useLocalSearchParams, useRouter } from 'expo-router';
import { RefreshControl, ScrollView } from 'react-native';

import { Banner, Button, Screen } from '@/components/ui';
import { useSession } from '@/features/auth/hooks/useSession';
import { useSignOut } from '@/features/auth/hooks/useSignOut';
import { authErrorMessage, PASSWORD_UPDATED } from '@/features/auth/messages';
import { ActivitySection } from '@/features/food-log/components/ActivitySection';
import { useActivityRefresh } from '@/features/food-log/hooks/useActivityRefresh';
import { NotificationsRow } from '@/features/notifications/components/NotificationsRow';
import { SellerModeRow } from '@/features/sellers/components/SellerModeRow';
import { useTheme } from '@/theme/useTheme';

import { FoodLogProfileRow } from './FoodLogProfileRow';
import { ProfileHeader } from './ProfileHeader';

// The signed-in Profile tab. ProfileHeader handles the loading / empty / error / success states;
// the activity section (spec 14) has its own, so the rest of Profile always renders.
export function ProfileScreen() {
  const { space } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ notice?: string }>();
  const { notice, dismissNotice } = useSession();
  const signOut = useSignOut();
  // Pull to refresh reloads the activity grid and its open day (spec 14).
  const activityRefresh = useActivityRefresh();

  // The reset form passes ?notice=password-updated; the session notice is the fallback for when
  // the route guard got here first.
  const passwordUpdated = params.notice === 'password-updated' || notice === 'password-updated';

  const clearNotice = () => {
    dismissNotice();
    if (params.notice) router.setParams({ notice: undefined });
  };

  return (
    <Screen>
      <ScrollView
        testID="profile-scroll"
        contentContainerStyle={{ gap: space.lg, paddingVertical: space.xl }}
        refreshControl={
          <RefreshControl
            refreshing={activityRefresh.refreshing}
            onRefresh={() => void activityRefresh.onRefresh()}
          />
        }
      >
        {passwordUpdated ? <Banner tone="success" message={PASSWORD_UPDATED} /> : null}
        <ProfileHeader />
        <ActivitySection weeks={17} showFullYear />
        {signOut.error ? <Banner message={authErrorMessage(signOut.error.code)} /> : null}
        <Button
          title="Edit profile"
          onPress={() => {
            clearNotice();
            router.push('/profile/edit');
          }}
        />
        <FoodLogProfileRow />
        <SellerModeRow />
        <NotificationsRow />
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
