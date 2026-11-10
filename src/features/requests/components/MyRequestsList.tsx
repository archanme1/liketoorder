import { useCallback } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, View } from 'react-native';

import { Banner, Button, EmptyState, ErrorState, Skeleton } from '@/components/ui';
import { useTheme } from '@/theme/useTheme';

import { useMyRequests } from '../hooks/useMyRequests';
import { EMPTY_LIST, loadErrorMessage } from '../messages';
import type { CustomerRequest } from '../schema';
import type { TimeOptions } from '../time';

import { RequestRow } from './RequestRow';

export type MyRequestsListProps = TimeOptions & {
  onOpen: (request: CustomerRequest) => void;
  /** Shows a "Find a place" button on the empty list. Left out where the maps are out of reach. */
  onFindPlace?: () => void;
  /** The empty list's words. */
  emptyMessage?: string;
};

const requestKey = (request: CustomerRequest) => request.id;

export const LOAD_MORE_ERROR = "Couldn't load more requests.";
export const REFRESH_ERROR = "Couldn't refresh your requests.";

// The customer's requests, newest first (the body of My requests and of the Sent list on the
// Requests tab): loading, empty, error with Retry, or the list. More rows load as you scroll near
// the end (a footer spinner, or an inline Try again if that page fails, with the rows already
// loaded kept). Pull down to start again from the newest 50. Refetches when the app comes back to
// the front, every 30 s while a pending row is loaded, and just after one expires.
export function MyRequestsList({
  onOpen,
  onFindPlace,
  emptyMessage = EMPTY_LIST,
  timeZone,
  locale,
}: MyRequestsListProps) {
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
    ({ item }: { item: CustomerRequest }) => (
      <RequestRow request={item} onPress={onOpen} timeZone={timeZone} locale={locale} />
    ),
    [onOpen, timeZone, locale],
  );

  return (
    <>
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
        <EmptyState
          message={emptyMessage}
          actionLabel={onFindPlace ? 'Find a place' : undefined}
          onAction={onFindPlace}
        />
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
    </>
  );
}

const styles = StyleSheet.create({
  footer: { alignItems: 'center' },
});
