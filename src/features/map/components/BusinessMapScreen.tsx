import Ionicons from '@expo/vector-icons/Ionicons';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { useReduceMotion } from '@/lib/useReduceMotion';
import { mapKeyName, useMapConfigured } from '../mapConfig';
import { isMarkerPressEvent } from '../mapEvents';
import { MAP_STYLE } from '../mapStyle';
import { pickLargePromoted, promotionLook, utcDateOf } from '../promotedLayout';
import {
  CIRCLE_MAX_DELTA,
  isOverServerLimit,
  regionAround,
  regionForPick,
  type MapRegion,
} from '../region';
import type { Pin } from '../schema';

import { mapErrorMessage } from '../messages';

import { ClusterMarker } from './ClusterMarker';
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
import type { BusinessMapConfig } from '../businessMapConfig';

import { RestaurantSheet } from './RestaurantSheet';

type LocationNoticeReason = 'denied' | 'denied_forever' | 'services_off' | 'no_fix';

const CAMERA_MS = 600;
const NO_PINS: Pin[] = [];
const NO_IDS: ReadonlySet<string> = new Set();

/** What the large promoted set is worked out from; a new object only when one of them changes. */
type LargeInputs = {
  pins: readonly Pin[];
  region: MapRegion | null;
  width: number;
  height: number;
};

/** The large set for these inputs, starting from the last one (promotedLayout). */
function nextLargeIds(inputs: LargeInputs, previous: ReadonlySet<string>): ReadonlySet<string> {
  if (!inputs.region) return NO_IDS;
  return pickLargePromoted({
    pins: inputs.pins,
    region: inputs.region,
    screen: { width: inputs.width, height: inputs.height },
    previous,
    utcDate: utcDateOf(new Date()),
  });
}

// The map screen both tabs share. Public: guests see the map too. The Google map, the opening
// view, the location flow, and the places in the visible area as markers and clusters, with the
// details sheet. What differs between the tabs (data, texts, marker, sheet body) is the config.
export function BusinessMapScreen({ config }: { config: BusinessMapConfig }) {
  const configured = useMapConfigured();
  if (!configured) {
    // __DEV__ only: the variable name is a hint for the developer, not for users.
    return (
      <View style={styles.flex}>
        <MapNotConfigured keyName={__DEV__ ? mapKeyName(Platform.OS) : undefined} />
      </View>
    );
  }
  return <ConfiguredMap config={config} />;
}

function ConfiguredMap({ config }: { config: BusinessMapConfig }) {
  const { colors, space, radius, size, opacity } = useTheme();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const mapRef = useRef<MapView>(null);
  const [notice, setNotice] = useState<LocationNoticeReason | null>(null);

  const permission = useLocationPermission();
  // The callbacks are stable; the `permission` object itself is new on every render.
  const { request, refresh, getPosition } = permission;
  const { opening, myRegion } = useInitialRegion({
    permission: permission.state,
    getPosition,
    regionKey: config.regionKey,
  });
  const { region, settledRegion, box, onRegionChangeComplete } = useMapRegion(
    opening?.region ?? null,
    config.regionKey,
  );

  // Pins are requested for the settled box only, and never for a view the server would refuse.
  const wideView = region ? isOverServerLimit(region) : false;
  const queryBox = settledRegion && !isOverServerLimit(settledRegion) ? box : null;
  const pins = config.usePins(queryBox);

  const cuisines = useCuisines();
  const cuisineByCode = useMemo(() => {
    const map = new Map<string, Cuisine>();
    for (const cuisine of cuisines.data ?? []) map.set(cuisine.code, cuisine);
    return map;
  }, [cuisines.data]);

  // One boolean, not the region, goes to the markers: a pan re-renders them only when it flips.
  const zoomedIn = region !== null && region.latitudeDelta <= CIRCLE_MAX_DELTA;

  // The size of the area the sheet slides in (the map fills it), so snap heights, scroll space and
  // on-screen marker spacing are exact.
  const [containerHeight, setContainerHeight] = useState(0);
  const [containerWidth, setContainerWidth] = useState(0);

  // Spec 16: the promoted places drawn large (at most 8, spaced on screen, promotedLayout). Worked
  // out again only when the settled region, the pins or the map size change, starting from the
  // last set so a pan never reshuffles it. Kept in state and updated during render (like
  // usePinsQuery's last good answer), so the clusters below are built in the same render.
  const largeInputs = useMemo<LargeInputs>(
    () => ({
      pins: pins.pins,
      region: region && !wideView ? region : null,
      width: containerWidth,
      height: containerHeight,
    }),
    [pins.pins, region, wideView, containerWidth, containerHeight],
  );
  const [large, setLarge] = useState<{ inputs: LargeInputs | null; ids: ReadonlySet<string> }>({
    inputs: null,
    ids: NO_IDS,
  });
  const largeStale = large.inputs !== largeInputs;
  const largeIds = largeStale ? nextLargeIds(largeInputs, large.ids) : large.ids;
  if (largeStale) setLarge({ inputs: largeInputs, ids: largeIds });
  // A stable string, so the clusters are rebuilt only when the large set really changes.
  const largeKey = [...largeIds].sort().join(',');
  const largePins = useMemo(() => {
    const ids = new Set(largeKey ? largeKey.split(',') : []);
    return ids.size ? pins.pins.filter((pin) => ids.has(pin.id)) : NO_PINS;
  }, [pins.pins, largeKey]);

  // The large ones are drawn on their own, above everything, and never inside a cluster. Every
  // other pin (promoted ones with the ring included) clusters as before.
  const clusterIndex = useMemo(() => {
    const ids = new Set(largePins.map((pin) => pin.id));
    return createClusterIndex(ids.size ? pins.pins.filter((pin) => !ids.has(pin.id)) : pins.pins);
  }, [pins.pins, largePins]);
  const items = useMemo(
    () => (region && !wideView ? clusterIndex.itemsFor(region) : []),
    [clusterIndex, region, wideView],
  );
  // The open place (kept as the whole pin so the sheet can show its name at once), and
  // whether the "Places in this area" list is open. Neither moves the map.
  const [selected, setSelected] = useState<Pin | null>(null);
  const [listOpen, setListOpen] = useState(false);
  // True when the open place was picked from the list, so "Back to list" is offered.
  const [openedFromList, setOpenedFromList] = useState(false);

  const moveTo = useCallback(
    (target: MapRegion) => {
      mapRef.current?.animateToRegion(target, reduceMotion ? 0 : CAMERA_MS);
    },
    [reduceMotion],
  );

  // The position arrived in time: move there, once the map can take camera moves (the fix can
  // land before the map is on screen, or before it reports ready). A slow or failed fix leaves
  // the map where it is.
  const [mapReady, setMapReady] = useState(false);
  const onMapReady = useCallback(() => setMapReady(true), []);
  const movedTo = useRef<MapRegion | null>(null);
  useEffect(() => {
    if (!myRegion || !mapReady || movedTo.current === myRegion) return;
    movedTo.current = myRegion;
    moveTo(myRegion);
  }, [myRegion, mapReady, moveTo]);

  // Tapping a flag on the map does not move the map.
  const onSelectPin = useCallback((pin: Pin) => {
    setListOpen(false);
    setOpenedFromList(false);
    setSelected(pin);
  }, []);
  // Picking from the list does: a short move that centres the pin above the sheet.
  // The sheet gets this callback, so it must not change with every camera move: the current
  // region is read from a ref.
  const regionRef = useRef<MapRegion | null>(null);
  useEffect(() => {
    regionRef.current = region;
  }, [region]);
  const onSelectFromList = useCallback(
    (pin: Pin) => {
      setListOpen(false);
      setOpenedFromList(true);
      setSelected(pin);
      moveTo(regionForPick(pin, regionRef.current));
    },
    [moveTo],
  );
  const onClearSelection = useCallback(() => {
    setSelected(null);
    setListOpen(false);
    setOpenedFromList(false);
  }, []);
  // The bare map was tapped. A marker press that bubbled up to the map is not that.
  const onMapPress = useCallback(
    (event: unknown) => {
      if (isMarkerPressEvent(event)) return;
      onClearSelection();
    },
    [onClearSelection],
  );
  const onOpenList = useCallback(() => {
    setSelected(null);
    setOpenedFromList(false);
    setListOpen(true);
  }, []);
  // "Back to list" leaves the map where it is.
  const onBackToList = useCallback(() => {
    setSelected(null);
    setOpenedFromList(false);
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
    void request();
  }, [request]);

  const onLocateMe = useCallback(async () => {
    setNotice(null);
    // Always ask the system again: the person may have changed it in Settings since the last look.
    let state = await refresh();
    if (state === 'undetermined') state = await request();
    if (state === 'granted') {
      const position = await getPosition();
      if (position) moveTo(regionAround(position.latitude, position.longitude));
      else setNotice('no_fix');
    } else if (state === 'denied' || state === 'denied_forever' || state === 'services_off') {
      setNotice(state);
    }
  }, [refresh, request, getPosition, moveTo]);

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
    <View
      testID="map-screen"
      style={styles.flex}
      onLayout={(event) => {
        setContainerHeight(event.nativeEvent.layout.height);
        setContainerWidth(event.nativeEvent.layout.width);
      }}
    >
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        provider={PROVIDER_GOOGLE}
        initialRegion={opening.region}
        onMapReady={onMapReady}
        onRegionChangeComplete={onRegionChangeComplete}
        onPress={onMapPress}
        customMapStyle={MAP_STYLE}
        toolbarEnabled={false}
        moveOnMarkerPress={false}
        accessibilityLabel={config.mapLabel}
      >
        {items.map((item) =>
          item.kind === 'cluster' ? (
            <ClusterMarker
              key={item.key}
              clusterId={item.clusterId}
              count={item.count}
              latitude={item.latitude}
              longitude={item.longitude}
              onPress={onClusterPress}
            />
          ) : (
            <Fragment key={item.key}>
              {config.renderMarker({
                pin: item.pin,
                cuisine: cuisineByCode.get(item.pin.cuisine_code),
                selected: item.pin.id === selected?.id,
                onSelect: onSelectPin,
                zoomedIn,
                promotion: promotionLook(item.pin, largeIds),
              })}
            </Fragment>
          ),
        )}
        {/* Empty while the view is too wide (the large set is worked out for drawn views only). */}
        {largePins.map((pin) => (
          <Fragment key={`p-${pin.id}`}>
            {config.renderMarker({
              pin,
              cuisine: cuisineByCode.get(pin.cuisine_code),
              selected: pin.id === selected?.id,
              onSelect: onSelectPin,
              zoomedIn,
              promotion: 'large',
            })}
          </Fragment>
        ))}
      </MapView>
      <View
        pointerEvents="box-none"
        style={[
          styles.overlay,
          { top: insets.top + space.md, left: space.lg, right: space.lg, gap: space.md },
        ]}
      >
        {permission.showPrompt ? (
          <LocationPrompt
            onAllow={onAllow}
            onNotNow={permission.dismissPrompt}
            things={config.promptThings}
          />
        ) : null}
        {showZoomIn ? <ZoomInNotice message={config.texts.zoomIn} /> : null}
        {pins.capped && !showZoomIn && settledNow ? <ZoomInMoreNotice /> : null}
        {queryBox !== null && pins.isFetching && !pins.error ? (
          <LoadingPinsIndicator things={config.texts.things} />
        ) : null}
        {pins.error && rateLimited ? <RateLimitedNotice onTryAgain={pins.retry} /> : null}
        {pins.error && !rateLimited ? (
          <PinsErrorNotice
            message={mapErrorMessage(pins.error.code, config.texts.things)}
            onRetry={pins.retry}
          />
        ) : null}
        {empty ? <EmptyAreaNotice title={config.texts.emptyTitle} /> : null}
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
          accessibilityHint={config.texts.listHint}
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
        onSelect={onSelectFromList}
        fromList={selected !== null && openedFromList}
        onBackToList={onBackToList}
        onClose={onClearSelection}
        containerHeight={containerHeight}
        DetailsBody={config.DetailsBody}
        Actions={config.Actions}
        detailsLabel={config.texts.detailsLabel}
        placesTitle={config.texts.placesTitle}
        emptyText={config.texts.listEmpty}
        useSponsored={config.useSponsored}
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
