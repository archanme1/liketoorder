import { useCallback } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, View } from 'react-native';

import { Banner, Button, EmptyState, ErrorState, Screen, Skeleton, Text } from '@/components/ui';
import { useTheme } from '@/theme/useTheme';

import { useMyRequests } from '../hooks/useMyRequests';
import { EMPTY_LIST, loadErrorMessage } from '../messages';
import type { PickupRequest } from '../schema';
import type { TimeOptions } from '../time';

import { RequestRow } from './RequestRow';

type MyRequestsScreenProps = TimeOptions & {
  onBack: () => void;
  onOpen: (request: PickupRequest) => void;
  onFindPlace: () => void;
};

const requestKey = (request: PickupRequest) => request.id;

export const LOAD_MORE_ERROR = "Couldn't load more requests.";
export const REFRESH_ERROR = "Couldn't refresh your requests.";

// My requests, newest first: loading, empty, error with Retry, or the list. More rows load as you
// scroll near the end (a footer spinner, or an inline Try again if that page fails, with the rows
// already loaded kept). Pull down to start again from the newest 50. Refetches when the app comes
// back to the front, every 30 s while a pending row is loaded, and just after one expires.
export function MyRequestsScreen({
  onBack,
  onOpen,
  onFindPlace,
  timeZone,
  locale,
}: MyRequestsScreenProps) {
  const { colors, space, type } = useTheme();
  const query = useMyRequests();
  const {
    refresh,
    refreshing,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    fetchNextPage,
  } = query;

  // The full-screen error is only for a first load that failed. With rows on screen, a failed
  // refresh or a failed next page is shown inline and the rows stay.
  const firstLoadFailed = query.isError && query.data === undefined;
  const refreshFailed =
    query.refreshFailed ||
    (query.isError && query.data !== undefined && !query.isFetchNextPageError);

  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage && !isFetchNextPageError) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage]);
  const onRefresh = useCallback(() => void refresh(), [refresh]);
  const renderItem = useCallback(
    ({ item }: { item: PickupRequest }) => (
      <RequestRow request={item} onPress={onOpen} timeZone={timeZone} locale={locale} />
    ),
    [onOpen, timeZone, locale],
  );

  return (
    <Screen>
      <View style={styles.back}>
        <Button title="Back" variant="ghost" accessibilityLabel="Back" onPress={onBack} />
      </View>
      <Text variant="title" accessibilityRole="header" maxFontSizeMultiplier={1.6}>
        My requests
      </Text>
      {query.isPending ? (
        <View
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel="Loading requests"
          style={{ gap: space.md, paddingTop: space.lg }}
        >
          <Skeleton height={type.title * 3} rounded="md" />
          <Skeleton height={type.title * 3} rounded="md" />
          <Skeleton height={type.title * 3} rounded="md" />
        </View>
      ) : firstLoadFailed ? (
        <ErrorState
          message={loadErrorMessage(query.error?.code ?? 'unknown')}
          onRetry={() => void query.refetch()}
          retrying={query.isFetching}
        />
      ) : query.requests.length === 0 ? (
        <EmptyState message={EMPTY_LIST} actionLabel="Find a place" onAction={onFindPlace} />
      ) : (
        <FlatList
          testID="requests-list"
          data={query.requests}
          keyExtractor={requestKey}
          renderItem={renderItem}
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          contentContainerStyle={{ gap: space.md, paddingVertical: space.lg }}
          ListHeaderComponent={
            refreshFailed ? (
              <View style={{ gap: space.sm }}>
                <Banner message={REFRESH_ERROR} />
                <Button
                  title="Try again"
                  variant="secondary"
                  accessibilityLabel="Try refreshing again"
                  onPress={() => void (query.isError ? query.refetch() : refresh())}
                  loading={query.isFetching || refreshing}
                />
              </View>
            ) : undefined
          }
          ListFooterComponent={
            query.isFetchingNextPage ? (
              <View style={[styles.footer, { padding: space.lg }]}>
                <ActivityIndicator
                  color={colors.primary}
                  accessibilityLabel="Loading more requests"
                />
              </View>
            ) : query.isFetchNextPageError ? (
              <View style={{ gap: space.sm }}>
                <Banner message={LOAD_MORE_ERROR} />
                <Button
                  title="Try again"
                  variant="secondary"
                  accessibilityLabel="Try loading more requests again"
                  onPress={() => void query.fetchNextPage()}
                />
              </View>
            ) : undefined
          }
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  back: { alignItems: 'flex-start' },
  footer: { alignItems: 'center' },
});
