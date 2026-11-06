import { ActivityIndicator, View } from 'react-native';

import { Banner, Button, Card, Text } from '@/components/ui';
import { useTheme } from '@/theme/useTheme';

import type { LocationState } from '../hooks/useLocationPermission';
import { RATE_LIMITED_MESSAGE } from '../messages';

// Messages the map shows over the tiles. All are text-first; none relies on colour alone.

export const ZOOM_IN_MESSAGE = 'Zoom in to see restaurants';

export function ZoomInNotice() {
  return <Banner tone="info" message={ZOOM_IN_MESSAGE} />;
}

export const ZOOM_IN_MORE_MESSAGE = 'Zoom in to see more';

export function ZoomInMoreNotice() {
  return <Banner tone="info" message={ZOOM_IN_MORE_MESSAGE} />;
}

// Small and non-blocking: the old pins stay on screen while the next area loads.
export function LoadingPinsIndicator() {
  const { colors, space, radius } = useTheme();
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel="Loading restaurants"
      style={{
        alignSelf: 'flex-start',
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.sm,
        paddingHorizontal: space.md,
        paddingVertical: space.sm,
        borderRadius: radius.pill,
        backgroundColor: colors.surface,
        borderColor: colors.border,
        borderWidth: 1,
      }}
    >
      <ActivityIndicator color={colors.primary} />
      <Text>Loading restaurants</Text>
    </View>
  );
}

export function EmptyAreaNotice() {
  const { space } = useTheme();
  return (
    <Card style={{ gap: space.xs }}>
      <Text variant="bodyLg" accessibilityRole="header">
        No restaurants here yet
      </Text>
      <Text color="textMuted">Zoom out or move the map to look further.</Text>
    </Card>
  );
}

type PinsErrorNoticeProps = { message: string; onRetry: () => void };

// The pin query failed: a banner with Retry. The old pins stay on the map.
export function PinsErrorNotice({ message, onRetry }: PinsErrorNoticeProps) {
  const { space } = useTheme();
  return (
    <View style={{ gap: space.sm }}>
      <Banner message={message} />
      <Button title="Retry" onPress={onRetry} />
    </View>
  );
}

// Too many requests: a calm note, not an error. Nothing is re-sent until the person moves the
// map or taps "Try again".
export function RateLimitedNotice({ onTryAgain }: { onTryAgain: () => void }) {
  const { space } = useTheme();
  return (
    <Card style={{ gap: space.sm }}>
      <Text accessibilityLiveRegion="polite">{RATE_LIMITED_MESSAGE}</Text>
      <Button title="Try again" onPress={onTryAgain} variant="secondary" />
    </Card>
  );
}

type LocationNoticeProps = {
  /** Why the locate-me button can't centre the map right now. */
  reason: Extract<LocationState, 'denied' | 'denied_forever' | 'services_off'> | 'no_fix';
  onOpenSettings: () => void;
  onClose: () => void;
};

const LOCATION_MESSAGES: Record<LocationNoticeProps['reason'], string> = {
  denied: 'Location is off for LikeToOrder. You can turn it on in Settings.',
  denied_forever: 'Location is off for LikeToOrder. You can turn it on in Settings.',
  services_off: 'Turn on Location Services in Settings to centre the map on you.',
  no_fix: "We couldn't find your location. Try again in a moment.",
};

export function LocationNotice({ reason, onOpenSettings, onClose }: LocationNoticeProps) {
  const { space } = useTheme();
  return (
    <Card style={{ gap: space.md }}>
      <Text accessibilityRole="alert">{LOCATION_MESSAGES[reason]}</Text>
      <View style={{ gap: space.sm }}>
        {reason === 'no_fix' ? null : (
          <Button
            title="Open Settings"
            onPress={onOpenSettings}
            accessibilityHint="Opens the Settings app"
          />
        )}
        <Button title="Close" onPress={onClose} variant="secondary" />
      </View>
    </Card>
  );
}

type MapNotConfiguredProps = {
  /** Shown only in development: the variable to set. */
  keyName?: string;
};

// Shown instead of the map when the Maps SDK key is missing.
export function MapNotConfigured({ keyName }: MapNotConfiguredProps) {
  const { space } = useTheme();
  return (
    <View style={{ flex: 1, justifyContent: 'center', padding: space.xl, gap: space.md }}>
      <Text variant="title" accessibilityRole="header">
        Map isn&apos;t configured
      </Text>
      <Text color="textMuted" accessibilityRole="alert">
        {keyName
          ? `Set ${keyName} in your .env file, then rebuild the development build.`
          : 'The map is not available right now.'}
      </Text>
    </View>
  );
}
