import { View } from 'react-native';

import { Banner, Button, Card, Text } from '@/components/ui';
import { useTheme } from '@/theme/useTheme';

import type { LocationState } from '../hooks/useLocationPermission';

// Messages the map shows over the tiles. All are text-first; none relies on colour alone.

export const ZOOM_IN_MESSAGE = 'Zoom in to see restaurants';

export function ZoomInNotice() {
  return <Banner tone="info" message={ZOOM_IN_MESSAGE} />;
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
