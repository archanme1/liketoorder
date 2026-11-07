import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, StyleSheet, View } from 'react-native';
import MapView, { PROVIDER_GOOGLE } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useCuisines } from '@/features/cuisines/hooks/useCuisines';
import type { Cuisine } from '@/features/cuisines/schema';
import { Text } from '@/components/ui';
import { useTheme } from '@/theme/useTheme';

import { createClusterIndex } from '../clustering';
import { useInitialRegion } from '../hooks/useInitialRegion';
import { useLocationPermission } from '../hooks/useLocationPermission';
import { useMapRegion } from '../hooks/useMapRegion';
import { usePinsInBounds } from '../hooks/usePinsInBounds';
import { useReduceMotion } from '../hooks/useReduceMotion';
import { mapKeyName, useMapConfigured } from '../mapConfig';
import { isOverServerLimit, regionAround, type MapRegion } from '../region';
import type { Pin } from '../schema';

import { mapErrorMessage } from '../messages';

import { ClusterMarker } from './ClusterMarker';
import { FlagMarker } from './FlagMarker';
import { LocationPrompt } from './LocationPrompt';
import {
  EmptyAreaNotice,
  LoadingPinsIndicator,
  LocationNotice,
  MapNotConfigured,
  PinsErrorNotice,
  RateLimitedNotice,
  ZoomInMoreNotice,
  ZoomInNotice,
} from './MapNotices';
import { RestaurantSheet } from './RestaurantSheet';

type LocationNoticeReason = 'denied' | 'denied_forever' | 'services_off' | 'no_fix';

const CAMERA_MS = 600;
const NO_PINS: Pin[] = [];

// The Restaurants tab. Public: guests see the map too. The Google map, the opening view, the
// location flow, and the restaurants in the visible area as flags and clusters. The details
// sheet arrives in the next gate.
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
  const { region, settledRegion, box, onRegionChangeComplete } = useMapRegion(
    opening?.region ?? null,
  );

  // Pins are requested for the settled box only, and never for a view the server would refuse.
  const wideView = region ? isOverServerLimit(region) : false;
  const queryBox = settledRegion && !isOverServerLimit(settledRegion) ? box : null;
  const pins = usePinsInBounds(queryBox);

  const cuisines = useCuisines();
  const cuisineByCode = useMemo(() => {
    const map = new Map<string, Cuisine>();
    for (const cuisine of cuisines.data ?? []) map.set(cuisine.code, cuisine);
    return map;
  }, [cuisines.data]);

  const clusterIndex = useMemo(() => createClusterIndex(pins.pins), [pins.pins]);
  const items = useMemo(
    () => (region && !wideView ? clusterIndex.itemsFor(region) : []),
    [clusterIndex, region, wideView],
  );
  // The open restaurant (kept as the whole pin so the sheet can show its name at once), and
  // whether the "Places in this area" list is open. Neither moves the map.
  const [selected, setSelected] = useState<Pin | null>(null);
  const [listOpen, setListOpen] = useState(false);

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

  // Selecting a flag does not move the map.
  const onSelectPin = useCallback((pin: Pin) => {
    setListOpen(false);
    setSelected(pin);
  }, []);
  const onClearSelection = useCallback(() => {
    setSelected(null);
    setListOpen(false);
  }, []);
  const onOpenList = useCallback(() => {
    setSelected(null);
    setListOpen(true);
  }, []);
  const onClusterPress = useCallback(
    (clusterId: number) => {
      const target = clusterIndex.regionForCluster(clusterId);
      if (target) moveTo(target);
    },
    [clusterIndex, moveTo],
  );

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

  const tooWide = region ? wideView : isOverServerLimit(opening.region);
  const settledNow = !pins.isFetching;
  const showZoomIn = tooWide || (pins.tooLarge && settledNow);
  const rateLimited = pins.error?.code === 'rate_limited';
  const empty =
    queryBox !== null &&
    pins.hasData &&
    pins.pins.length === 0 &&
    !pins.tooLarge &&
    settledNow &&
    !pins.error;

  return (
    <View style={styles.flex}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        provider={PROVIDER_GOOGLE}
        initialRegion={opening.region}
        onRegionChangeComplete={onRegionChangeComplete}
        onPress={onClearSelection}
        toolbarEnabled={false}
        moveOnMarkerPress={false}
        accessibilityLabel="Restaurants map"
      >
        {items.map((item) =>
          item.kind === 'cluster' ? (
            <ClusterMarker key={item.key} cluster={item} onPress={onClusterPress} />
          ) : (
            <FlagMarker
              key={item.key}
              pin={item.pin}
              cuisine={cuisineByCode.get(item.pin.cuisine_code)}
              selected={item.pin.id === selected?.id}
              onSelect={onSelectPin}
            />
          ),
        )}
      </MapView>
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
        {showZoomIn ? <ZoomInNotice /> : null}
        {pins.capped && !showZoomIn && settledNow ? <ZoomInMoreNotice /> : null}
        {queryBox !== null && pins.isFetching && !pins.error ? <LoadingPinsIndicator /> : null}
        {pins.error && rateLimited ? <RateLimitedNotice onTryAgain={pins.retry} /> : null}
        {pins.error && !rateLimited ? (
          <PinsErrorNotice message={mapErrorMessage(pins.error.code)} onRetry={pins.retry} />
        ) : null}
        {empty ? <EmptyAreaNotice /> : null}
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
      {wideView ? null : (
        <Pressable
          onPress={onOpenList}
          accessibilityRole="button"
          accessibilityLabel="Places in this area"
          accessibilityHint="Opens a list of the restaurants on the map"
          style={({ pressed }) => [
            styles.places,
            {
              left: space.lg,
              bottom: space.lg,
              minHeight: size.touch,
              gap: space.sm,
              paddingHorizontal: space.lg,
              borderRadius: radius.pill,
              backgroundColor: colors.surface,
              borderColor: colors.border,
              opacity: pressed ? opacity.pressed : 1,
            },
          ]}
        >
          <Ionicons name="list" size={size.tabIcon} color={colors.primary} />
          <Text>Places in this area</Text>
        </Pressable>
      )}
      <RestaurantSheet
        selected={selected}
        listOpen={listOpen}
        pins={wideView ? NO_PINS : pins.pins}
        cuisineByCode={cuisineByCode}
        onSelect={onSelectPin}
        onClose={onClearSelection}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  overlay: { position: 'absolute' },
  places: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  locate: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
});
