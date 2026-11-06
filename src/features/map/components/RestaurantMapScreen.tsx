import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, StyleSheet, View } from 'react-native';
import MapView, { PROVIDER_GOOGLE } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/theme/useTheme';

import { useInitialRegion } from '../hooks/useInitialRegion';
import { useLocationPermission } from '../hooks/useLocationPermission';
import { useMapRegion } from '../hooks/useMapRegion';
import { useReduceMotion } from '../hooks/useReduceMotion';
import { mapKeyName, useMapConfigured } from '../mapConfig';
import { isOverServerLimit, regionAround, type MapRegion } from '../region';

import { LocationPrompt } from './LocationPrompt';
import { LocationNotice, MapNotConfigured, ZoomInNotice } from './MapNotices';

type LocationNoticeReason = 'denied' | 'denied_forever' | 'services_off' | 'no_fix';

const CAMERA_MS = 600;

// The Restaurants tab. Public: guests see the map too. Pins, clusters and the sheet arrive in
// the next gates; this is the shell: the Google map, the opening view and the location flow.
export function RestaurantMapScreen() {
  const configured = useMapConfigured();
  const { space } = useTheme();
  if (!configured) {
    // __DEV__ only: the variable name is a hint for the developer, not for users.
    return (
      <View style={styles.flex}>
        <MapNotConfigured keyName={__DEV__ ? mapKeyName(Platform.OS) : undefined} />
        <View style={{ height: space.xl }} />
      </View>
    );
  }
  return <ConfiguredMap />;
}

function ConfiguredMap() {
  const { colors, space, radius, size, opacity } = useTheme();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const mapRef = useRef<MapView>(null);
  const [notice, setNotice] = useState<LocationNoticeReason | null>(null);

  const permission = useLocationPermission();
  const { opening, myRegion } = useInitialRegion({
    permission: permission.state,
    getPosition: permission.getPosition,
  });
  const { region, onRegionChangeComplete } = useMapRegion(opening?.region ?? null);

  const moveTo = useCallback(
    (target: MapRegion) => {
      mapRef.current?.animateToRegion(target, reduceMotion ? 0 : CAMERA_MS);
    },
    [reduceMotion],
  );

  // The position arrived in time: move there. A slow or failed fix leaves the map where it is.
  useEffect(() => {
    if (myRegion) moveTo(myRegion);
  }, [myRegion, moveTo]);

  const onAllow = useCallback(() => {
    void permission.request();
  }, [permission]);

  const onLocateMe = useCallback(async () => {
    setNotice(null);
    let state = permission.state;
    if (state === 'unknown') state = await permission.refresh();
    if (state === 'undetermined') state = await permission.request();
    if (state === 'granted') {
      const position = await permission.getPosition();
      if (position) moveTo(regionAround(position.latitude, position.longitude));
      else setNotice('no_fix');
    } else if (state === 'denied' || state === 'denied_forever' || state === 'services_off') {
      setNotice(state);
    }
  }, [permission, moveTo]);

  const openSettings = useCallback(() => {
    void Linking.openSettings();
  }, []);

  if (!opening) {
    return (
      <View style={[styles.flex, styles.center]}>
        <ActivityIndicator color={colors.primary} accessibilityLabel="Loading map" />
      </View>
    );
  }

  const tooWide = region ? isOverServerLimit(region) : isOverServerLimit(opening.region);

  return (
    <View style={styles.flex}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        provider={PROVIDER_GOOGLE}
        initialRegion={opening.region}
        onRegionChangeComplete={onRegionChangeComplete}
        toolbarEnabled={false}
        accessibilityLabel="Restaurants map"
      />
      <View
        pointerEvents="box-none"
        style={[
          styles.overlay,
          { top: insets.top + space.md, left: space.lg, right: space.lg, gap: space.md },
        ]}
      >
        {permission.showPrompt ? (
          <LocationPrompt onAllow={onAllow} onNotNow={permission.dismissPrompt} />
        ) : null}
        {tooWide ? <ZoomInNotice /> : null}
        {notice ? (
          <LocationNotice
            reason={notice}
            onOpenSettings={openSettings}
            onClose={() => setNotice(null)}
          />
        ) : null}
      </View>
      <Pressable
        onPress={() => void onLocateMe()}
        accessibilityRole="button"
        accessibilityLabel="Locate me"
        accessibilityHint="Centres the map on your location"
        style={({ pressed }) => [
          styles.locate,
          {
            right: space.lg,
            bottom: space.lg,
            width: size.touch,
            height: size.touch,
            borderRadius: radius.pill,
            backgroundColor: colors.surface,
            borderColor: colors.border,
            opacity: pressed ? opacity.pressed : 1,
          },
        ]}
      >
        <Ionicons name="locate" size={size.tabIcon} color={colors.primary} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  overlay: { position: 'absolute' },
  locate: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
});
