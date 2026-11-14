import { useRouter } from 'expo-router';
import { Linking, ScrollView, StyleSheet, View } from 'react-native';

import { Banner, Button, Card, ErrorState, Screen, Skeleton, Text } from '@/components/ui';
import { useMyBusiness } from '@/features/sellers/hooks/useMyBusiness';
import { LabelledSwitch } from '@/features/sellers/components/LabelledSwitch';
import { maxFontMultiplier } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';

import { useNotificationPermission } from '../hooks/useNotificationPermission';
import { useNotificationSettings } from '../hooks/useNotificationSettings';
import { useSetNotificationSetting } from '../hooks/useSetNotificationSetting';
import {
  PERMISSION_DENIED,
  PERMISSION_DENIED_HELP,
  PERMISSION_UNDETERMINED,
  SETTING_DESCRIPTIONS,
  SETTING_LABELS,
  SETTINGS_SAVE_FAILED,
  notificationErrorMessage,
} from '../messages';
import type { NotificationSettings } from '../schema';

const OWNER_SWITCHES = ['newRequests', 'cancellations', 'arrivals'] as const;

// Profile > Notifications: the phone's permission on top, then the switches. "Answers to my
// requests" is for everyone; the three owner switches show once a business is known to exist.
// There is no master switch: the phone's own setting is the master (Decision 4).
export function NotificationSettingsScreen() {
  const { space, size } = useTheme();
  const router = useRouter();
  const business = useMyBusiness();
  const settings = useNotificationSettings();
  const save = useSetNotificationSetting();
  const isOwner = business.data !== null && business.data !== undefined;

  const toggle = (key: keyof NotificationSettings, value: boolean) => save.mutate({ [key]: value });

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ gap: space.lg, paddingVertical: space.md }}>
        <View style={styles.start}>
          <Button
            title="Back"
            variant="ghost"
            accessibilityLabel="Back to Profile"
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/profile'))}
          />
        </View>
        <Text variant="h1" accessibilityRole="header" maxFontSizeMultiplier={maxFontMultiplier}>
          Notifications
        </Text>
        <PermissionPanel role={isOwner ? 'owner' : 'customer'} />
        {settings.isPending ? (
          <View
            accessible
            accessibilityLabel="Loading notification settings"
            style={{ gap: space.sm }}
          >
            <Skeleton height={size.touch} />
            <Skeleton height={size.touch} />
          </View>
        ) : settings.isError && settings.data === undefined ? (
          <ErrorState
            message={notificationErrorMessage(settings.error.code)}
            onRetry={() => void settings.refetch()}
            retrying={settings.isRefetching}
          />
        ) : settings.data ? (
          <Card style={{ gap: space.md }}>
            <LabelledSwitch
              label={SETTING_LABELS.answers}
              description={SETTING_DESCRIPTIONS.answers}
              value={settings.data.answers}
              onValueChange={(value) => toggle('answers', value)}
            />
            {isOwner
              ? OWNER_SWITCHES.map((key) => (
                  <LabelledSwitch
                    key={key}
                    label={SETTING_LABELS[key]}
                    description={SETTING_DESCRIPTIONS[key]}
                    value={settings.data[key]}
                    onValueChange={(value) => toggle(key, value)}
                  />
                ))
              : null}
          </Card>
        ) : null}
        {save.isError ? <Banner message={SETTINGS_SAVE_FAILED} /> : null}
      </ScrollView>
    </Screen>
  );
}

function PermissionPanel({ role }: { role: 'customer' | 'owner' }) {
  const { space, size } = useTheme();
  const router = useRouter();
  const { state } = useNotificationPermission();

  if (state === undefined) {
    return (
      <View accessible accessibilityLabel="Checking notification permission">
        <Skeleton height={size.touch} />
      </View>
    );
  }
  if (state === 'undetermined') {
    return (
      <Card style={{ gap: space.md }}>
        <Text>{PERMISSION_UNDETERMINED}</Text>
        <Button
          title="Turn on notifications"
          onPress={() => router.push({ pathname: '/notifications/allow', params: { role } })}
        />
      </Card>
    );
  }
  if (state === 'denied') {
    return (
      <Card style={{ gap: space.md }}>
        <Banner tone="info" message={PERMISSION_DENIED} />
        <Text color="textMuted">{PERMISSION_DENIED_HELP}</Text>
        <Button
          title="Open Settings"
          accessibilityHint="Opens this app's page in your phone's Settings."
          onPress={() => void Linking.openSettings()}
        />
      </Card>
    );
  }
  return null;
}

const styles = StyleSheet.create({
  start: { alignItems: 'flex-start' },
});
