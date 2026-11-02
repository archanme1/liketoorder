import { View } from 'react-native';

import { Banner, Button, Card, Screen, Text } from '@/components/ui';
import { useSession } from '@/features/auth/hooks/useSession';
import { useSignOut } from '@/features/auth/hooks/useSignOut';
import { PASSWORD_UPDATED } from '@/features/auth/messages';
import { useTheme } from '@/theme/useTheme';

// Placeholder signed-in home. Spec 02 stage 3 replaces it with the profile home; spec 03 with tabs.
export default function HomeScreen() {
  const { space } = useTheme();
  const { session, notice, dismissNotice } = useSession();
  const signOut = useSignOut();

  return (
    <Screen>
      <View style={{ gap: space.lg }}>
        <Text variant="h1" accessibilityRole="header">
          LikeToOrder
        </Text>
        {notice === 'password-updated' ? (
          <Banner tone="success" message={PASSWORD_UPDATED} />
        ) : null}
        <Card>
          <Text>{`Signed in as ${session?.user.email ?? ''}`}</Text>
        </Card>
        <Button
          title="Sign out"
          variant="secondary"
          loading={signOut.isPending}
          onPress={() => {
            dismissNotice();
            signOut.mutate();
          }}
        />
      </View>
    </Screen>
  );
}
