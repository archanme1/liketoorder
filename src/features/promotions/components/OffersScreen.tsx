import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  FlatList,
  Linking,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Card, EmptyState, ErrorState, Text } from '@/components/ui';
import { useCuisines } from '@/features/cuisines/hooks/useCuisines';
import type { Cuisine } from '@/features/cuisines/schema';
import { LocationPrompt } from '@/features/map/components/LocationPrompt';
import { useSignedUrls } from '@/features/media/hooks/useSignedUrls';
import { MEDIA_BUCKET } from '@/features/menu/photos';
import { useTheme } from '@/theme/useTheme';
import Ionicons from '@expo/vector-icons/Ionicons';

import { distanceKm, distanceText } from '../distance';
import { useOffers } from '../hooks/useOffers';
import { useOffersOrigin } from '../hooks/useOffersOrigin';
import {
  BROWSE_MAP_LABEL,
  CHANGE_AREA_LABEL,
  CLEAR_FILTERS_LABEL,
  FINDING_OFFERS_TEXT,
  OFFERS_EMPTY_TEXT,
  OFFERS_END_TEXT,
  OFFERS_LOADING_MORE,
  OFFERS_MORE_FAILED,
  OFFERS_PROMPT_MESSAGE,
  OFFERS_REFRESH_FAILED,
  OFFERS_TITLE,
  OPEN_SETTINGS_LABEL,
  offerErrorMessage,
  offersCountAnnouncement,
} from '../messages';
import { areaHeading, areaNotice } from '../offersArea';
import {
  DEFAULT_OFFER_FILTERS,
  OFFERS_PAGE_SIZE,
  type Offer,
  type OfferFilters as Filters,
} from '../schema';

import { ChangeArea, type AreaOption } from './ChangeArea';
import { OfferCard } from './OfferCard';
import { FiltersPanel } from './FiltersPanel';
import { activeFilterCount, filterSummary, filtersButtonText, sameFilters } from './OfferFilters';
import { OfferSkeleton } from './OfferSkeleton';

type OffersScreenProps = {
  /** The tab is on screen (the route's focus effect). A stale list is reloaded on focus. */
  focused: boolean;
  /** Opens the place on its map tab (the route navigates). */
  onOpenOffer: (offer: Offer) => void;
  /** The empty state's "Browse the map". */
  onBrowseMap: () => void;
};

// Spec 16 Offers: active promotions near the person or a chosen area, for guests and customers.
// Loading (skeletons), error (Try again), empty (Browse the map), the list with paging, pull to
// refresh, the filters, Change area and the location notes. Only the snapped grid point is ever
// sent (useOffersOrigin); distances are worked out here, on the phone.
export function OffersScreen({ focused, onOpenOffer, onBrowseMap }: OffersScreenProps) {
  const { colors, space, radius, size, stroke, type, weight, opacity } = useTheme();
  const insets = useSafeAreaInsets();
  const where = useOffersOrigin();
  const { origin } = where;
  const point = origin.status === 'ready' ? origin.point : null;
  const [filters, setFilters] = useState<Filters>(DEFAULT_OFFER_FILTERS);
  const offers = useOffers(point, filters);
  const [changing, setChanging] = useState(false);

  const cuisines = useCuisines();
  const cuisineByCode = useMemo(() => {
    const map = new Map<string, Cuisine>();
    for (const cuisine of cuisines.data ?? []) map.set(cuisine.code, cuisine);
    return map;
  }, [cuisines.data]);

  const coverPaths = useMemo(
    () => offers.offers.flatMap((offer) => (offer.cover ? [offer.cover.path] : [])),
    [offers.offers],
  );
  const { urlFor, renew } = useSignedUrls(MEDIA_BUCKET, coverPaths);
  const onCoverExpired = useCallback((path: string) => void renew(path), [renew]);

  // A stale list is reloaded when the tab comes back into view (stale: older than a minute).
  const { isStale, isFetching, refetch, data } = offers;
  const wasFocused = useRef(focused);
  useEffect(() => {
    if (focused && !wasFocused.current && data && isStale && !isFetching) void refetch();
    wasFocused.current = focused;
  }, [focused, data, isStale, isFetching, refetch]);

  // After a filter or area change, say how many offers the new list has. Each change is a new
  // request number, so the effect runs even when the new list is already cached and settled with
  // the same count, and a request is announced once: never later, on an unrelated update.
  const [announceRequest, setAnnounceRequest] = useState(0);
  const announced = useRef(0);
  const requestAnnouncement = useCallback(() => setAnnounceRequest((n) => n + 1), []);
  const count = offers.offers.length;
  const settled = offers.isSuccess && !offers.isFetching;
  useEffect(() => {
    if (announceRequest === announced.current || !settled) return;
    announced.current = announceRequest;
    AccessibilityInfo.announceForAccessibility(offersCountAnnouncement(count, offers.hasNextPage));
  }, [announceRequest, settled, count, offers.hasNextPage]);

  // The Filters panel works on a draft; only "Show offers" (or Clear filters) changes these.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersButton = useRef<ComponentRef<typeof View>>(null);
  const filtersWasOpen = useRef(false);
  // Back on the Filters button once the panel has closed, however it closed.
  useEffect(() => {
    if (filtersWasOpen.current && !filtersOpen) {
      if (filtersButton.current) {
        AccessibilityInfo.sendAccessibilityEvent(filtersButton.current, 'focus');
      }
    }
    filtersWasOpen.current = filtersOpen;
  }, [filtersOpen]);

  const onApplyFilters = useCallback(
    (next: Filters) => {
      setFiltersOpen(false);
      // Nothing changed: just close, and ask the server nothing.
      if (sameFilters(next, filters)) return;
      requestAnnouncement();
      setFilters(next);
    },
    [filters, requestAnnouncement],
  );
  const onClearFilters = useCallback(() => {
    requestAnnouncement();
    setFilters(DEFAULT_OFFER_FILTERS);
  }, [requestAnnouncement]);
  const filterCount = activeFilterCount(filters);
  const filtersText = filtersButtonText(filterCount);

  const onChooseArea = useCallback(
    (option: AreaOption) => {
      setChanging(false);
      requestAnnouncement();
      if (option === 'me') void where.chooseMyLocation();
      else where.chooseArea(option);
    },
    [where, requestAnnouncement],
  );

  const { refresh } = offers;
  const { refreshPosition } = where;
  const onRefresh = useCallback(async () => {
    const moved = await refreshPosition();
    if (!moved) await refresh();
  }, [refresh, refreshPosition]);

  const distanceFor = useCallback(
    (offer: Offer) =>
      origin.status === 'ready'
        ? distanceText(distanceKm(origin.position, offer), offer.type)
        : null,
    [origin],
  );

  const renderItem = useCallback(
    ({ item }: { item: Offer }) => (
      <OfferCard
        offer={item}
        cuisine={cuisineByCode.get(item.cuisine_code)}
        distance={distanceFor(item)}
        coverUri={item.cover ? urlFor(item.cover.path) : null}
        onCoverExpired={onCoverExpired}
        onOpen={onOpenOffer}
      />
    ),
    [cuisineByCode, distanceFor, urlFor, onCoverExpired, onOpenOffer],
  );

  const loading = origin.status === 'loading' || (offers.isPending && !offers.isError);
  const firstPageFailed = offers.isError && !offers.data;
  const current: AreaOption =
    origin.status === 'ready' ? origin.kind : where.choice === 'auto' ? 'me' : where.choice;

  const header = (
    <View style={{ gap: space.md, paddingBottom: space.md }}>
      <Text variant="h1" accessibilityRole="header">
        {OFFERS_TITLE}
      </Text>
      <View style={[styles.areaRow, { gap: space.sm }]}>
        <View style={[styles.areaRow, styles.flex, { gap: space.sm }]}>
          {origin.status === 'ready' ? (
            <Text variant="bodyLg">{areaHeading(origin.kind)}</Text>
          ) : (
            <Text variant="bodyLg" color="textMuted" accessibilityLabel={FINDING_OFFERS_TEXT}>
              {FINDING_OFFERS_TEXT}
            </Text>
          )}
          <Button title={CHANGE_AREA_LABEL} variant="secondary" onPress={() => setChanging(true)} />
        </View>
        <Pressable
          ref={filtersButton}
          onPress={() => setFiltersOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={filtersText.label}
          accessibilityHint="Opens the filters"
          testID="filters-button"
          style={({ pressed }) => [
            styles.filtersButton,
            {
              minHeight: size.touch,
              minWidth: size.touch,
              gap: space.xs,
              paddingHorizontal: space.lg,
              borderRadius: radius.md,
              borderColor: filterCount > 0 ? colors.primary : colors.border,
              borderWidth: filterCount > 0 ? stroke.selected : StyleSheet.hairlineWidth,
              backgroundColor: colors.surface,
              opacity: pressed ? opacity.pressed : 1,
            },
          ]}
        >
          <Ionicons
            name="options-outline"
            size={type.bodyLg}
            color={colors.primary}
            accessibilityElementsHidden
            importantForAccessibility="no"
          />
          <Text color="primary" style={{ fontWeight: weight.semibold }}>
            {filtersText.title}
          </Text>
        </Pressable>
      </View>
      {filterCount > 0 ? (
        <View style={[styles.areaRow, { gap: space.sm }]}>
          <Text color="textMuted" style={styles.flex}>
            {filterSummary(filters)}
          </Text>
          <Button title={CLEAR_FILTERS_LABEL} variant="ghost" onPress={onClearFilters} />
        </View>
      ) : null}
      {where.showPrompt ? (
        <LocationPrompt
          things="offers"
          message={OFFERS_PROMPT_MESSAGE}
          onAllow={() => void where.chooseMyLocation()}
          onNotNow={where.dismissPrompt}
        />
      ) : null}
      {!where.showPrompt && origin.status === 'ready' && origin.reason && origin.kind !== 'me' ? (
        <Card style={{ gap: space.sm }}>
          <Text accessibilityLiveRegion="polite">{areaNotice(origin.reason, origin.kind)}</Text>
          {origin.reason === 'location_off' && where.settingsOnly ? (
            <Button
              title={OPEN_SETTINGS_LABEL}
              variant="secondary"
              onPress={() => void Linking.openSettings()}
              accessibilityHint="Opens the Settings app"
            />
          ) : null}
        </Card>
      ) : null}
      {offers.refreshFailed ? <Text color="textMuted">{OFFERS_REFRESH_FAILED}</Text> : null}
    </View>
  );

  let empty;
  if (loading) empty = <OfferSkeleton />;
  else if (firstPageFailed && offers.error)
    empty = (
      <ErrorState
        message={offerErrorMessage(offers.error.code)}
        onRetry={() => void offers.refetch()}
        retrying={offers.isFetching}
      />
    );
  else
    empty = (
      <View style={styles.flex}>
        <EmptyState
          message={OFFERS_EMPTY_TEXT}
          actionLabel={BROWSE_MAP_LABEL}
          onAction={onBrowseMap}
        />
        {filterCount > 0 ? (
          <Button title={CLEAR_FILTERS_LABEL} variant="ghost" onPress={onClearFilters} />
        ) : null}
      </View>
    );

  let footer = null;
  if (!loading && count > 0) {
    if (offers.isFetchingNextPage) {
      footer = (
        <View
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel={OFFERS_LOADING_MORE}
          style={[styles.footerRow, { gap: space.sm, padding: space.md }]}
        >
          <ActivityIndicator />
          <Text>{OFFERS_LOADING_MORE}</Text>
        </View>
      );
    } else if (offers.isFetchNextPageError) {
      footer = (
        <View style={{ gap: space.sm, padding: space.md }}>
          <Text accessibilityRole="alert">{OFFERS_MORE_FAILED}</Text>
          <Button title="Try again" onPress={() => void offers.loadMore()} variant="secondary" />
        </View>
      );
    } else if (!offers.hasNextPage) {
      footer = (
        <Text color="textMuted" style={[styles.end, { padding: space.md }]}>
          {OFFERS_END_TEXT}
        </Text>
      );
    }
  }

  return (
    <View testID="offers-screen" style={styles.flex}>
      <FlatList
        testID="offers-list"
        data={loading || firstPageFailed ? [] : offers.offers}
        keyExtractor={(offer) => offer.business_id}
        renderItem={renderItem}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        ListFooterComponent={footer ?? undefined}
        ItemSeparatorComponent={OfferSeparator}
        onEndReached={() => void offers.loadMore()}
        onEndReachedThreshold={0.5}
        initialNumToRender={OFFERS_PAGE_SIZE}
        contentContainerStyle={{
          paddingTop: insets.top + space.lg,
          paddingHorizontal: space.lg,
          paddingBottom: space.xl,
        }}
        refreshControl={
          <RefreshControl
            refreshing={offers.refreshing}
            onRefresh={() => void onRefresh()}
            accessibilityLabel="Refresh offers"
          />
        }
      />
      {filtersOpen ? (
        <FiltersPanel
          applied={filters}
          onApply={onApplyFilters}
          onClose={() => setFiltersOpen(false)}
        />
      ) : null}
      <ChangeArea
        visible={changing}
        current={current}
        hasLastMap={where.hasLastMap}
        onChoose={onChooseArea}
        onClose={() => setChanging(false)}
      />
    </View>
  );
}

// Between two cards. Its own component, so the list keeps the same one across renders.
function OfferSeparator() {
  const { space } = useTheme();
  return <View style={{ height: space.md }} />;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  areaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  filtersButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  footerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  end: { textAlign: 'center' },
});
