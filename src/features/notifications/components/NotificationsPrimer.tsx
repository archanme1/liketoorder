import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ScrollView } from 'react-native';

import { Button, Screen, Text } from '@/components/ui';
import { useSession } from '@/features/auth/hooks/useSession';
import { maxFontMultiplier } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';

import { useNotificationPermission } from '../hooks/useNotificationPermission';
import { PRIMER_LATER, PRIMER_PRIVACY, PRIMER_TITLE, primerMessage } from '../messages';
import { markOpenedThisRun, savePrimerSeen, type PrimerRole } from '../primerMoment';

type NotificationsPrimerProps = { role: PrimerRole };

// The plain explanation shown before the system asks (Decision 7). Opening it at all counts as
// "asked": the flag is written on mount, so Not now, a swipe-away and Turn on all leave it set and
// the primer is not offered again on its own (it stays reachable from Profile).
export function NotificationsPrimer({ role }: NotificationsPrimerProps) {
  const { space } = useTheme();
  const router = useRouter();
  const { session } = useSession();
  const userId = session?.user.id;
  const permission = useNotificationPermission();
  const [asking, setAsking] = useState(false);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  useEffect(() => {
    if (!userId) return;
    markOpenedThisRun(userId);
    void savePrimerSeen(userId);
  }, [userId]);

  const close = () => (router.canGoBack() ? router.back() : router.replace('/profile'));

  const turnOn = async () => {
    setAsking(true);
    try {
      await permission.request();
    } catch {
      // The system prompt failed: close anyway; Profile shows the real state.
    }
    // Already gone (a swipe-away while the system prompt was up): nothing left to close.
    if (!mounted.current) return;
    setAsking(false);
    close();
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ gap: space.lg, paddingVertical: space.xl }}>
        <Text variant="h1" accessibilityRole="header" maxFontSizeMultiplier={maxFontMultiplier}>
          {PRIMER_TITLE}
        </Text>
        <Text variant="bodyLg">{primerMessage(role)}</Text>
        <Text color="textMuted">{PRIMER_PRIVACY}</Text>
        <Button
          title="Turn on"
          accessibilityLabel="Turn on notifications"
          accessibilityHint="Your phone will ask you to allow notifications."
          loading={asking}
          onPress={() => void turnOn()}
        />
        <Button
          title="Not now"
          variant="secondary"
          accessibilityLabel="Not now"
          disabled={asking}
          onPress={close}
        />
        <Text variant="caption" color="textMuted">
          {PRIMER_LATER}
        </Text>
      </ScrollView>
    </Screen>
  );
}
