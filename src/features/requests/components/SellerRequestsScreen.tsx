import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Banner, Button, EmptyState, ErrorState, Skeleton } from '@/components/ui';
import { useTheme } from '@/theme/useTheme';

import { useBusinessRequests } from '../hooks/useBusinessRequests';
import type { BusinessRequest, RequestFilter } from '../schema';
import {
  emptyMessage,
  inboxErrorMessage,
  INBOX_LOAD_MORE_ERROR,
  INBOX_REFRESH_ERROR,
  RECEIVED_FILTER_GROUP,
} from '../sellerMessages';
import type { TimeOptions } from '../time';

import { RequestFilterChips } from './RequestFilterChips';
import { SellerRequestRow } from './SellerRequestRow';

type SellerRequestsScreenProps = TimeOptions & {
  onOpen: (request: BusinessRequest) => void;
};

const requestKey = (request: BusinessRequest) => request.id;

// The seller's inbox (Received in the Requests tab, and Manage Business > Requests), newest first,
// with server-side filter chips that open on Pending (screen state only, so not kept across visits).
// Loading, empty, error with Retry, or the list. More rows load as you scroll near the end (a footer
// spinner, or an inline Try again if that page fails, with the rows already loaded kept). Pull down
// to start again from the newest 50. Refetches when the app comes back to the front, every 30 s
// while a pending row is loaded, and just after one expires. The seller Stack's header draws the
// title and Back.
export function SellerRequestsScreen({ onOpen, timeZone, locale }: SellerRequestsScreenProps) {
  const { colors, space, type } = useTheme();
  const [filter, setFilter] = useState<RequestFilter>('pending');
  const query = useBusinessRequests(filter);
  const {
    refresh,
    refreshing,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    fetchNextPage,
  } = query;

  // The full-screen error is for a first load that failed, and for a refetch that failed while the
  // list is empty (there is nothing on screen to keep, and the plain empty state would hide the
  // failure). With rows on screen, a failed refresh or a failed next page is shown inline and the
  // rows stay.
  const firstLoadFailed =
    query.isError && (query.data === undefined || query.requests.length === 0);
  const refreshFailed =
    query.refreshFailed ||
    (query.isError && query.data !== undefined && !query.isFetchNextPageError);

  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage && !isFetchNextPageError) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage]);
  const onRefresh = useCallback(() => void refresh(), [refresh]);
  const renderItem = useCallback(
    ({ item }: { item: BusinessRequest }) => (
      <SellerRequestRow request={item} onPress={onOpen} timeZone={timeZone} locale={locale} />
    ),
    [onOpen, timeZone, locale],
  );

  return (
    <SafeAreaView
      edges={['bottom']}
      style={[styles.root, { backgroundColor: colors.bg, padding: space.lg, gap: space.md }]}
    >
      <RequestFilterChips value={filter} onChange={setFilter} groupLabel={RECEIVED_FILTER_GROUP} />
      {query.isPending ? (
        <View
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel="Loading requests"
          style={{ gap: space.md, paddingTop: space.sm }}
        >
          <Skeleton height={type.title * 3} rounded="md" />
          <Skeleton height={type.title * 3} rounded="md" />
          <Skeleton height={type.title * 3} rounded="md" />
        </View>
      ) : firstLoadFailed ? (
        <ErrorState
          message={inboxErrorMessage(query.error?.code ?? 'unknown')}
          onRetry={() => void query.refetch()}
          retrying={query.isFetching}
        />
      ) : query.requests.length === 0 ? (
        <EmptyState message={emptyMessage(filter)} />
      ) : (
        <FlatList
          // A fresh list (and scroll position) for each filter.
          key={filter}
          testID="inbox-list"
          data={query.requests}
          keyExtractor={requestKey}
          renderItem={renderItem}
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          contentContainerStyle={{ gap: space.md, paddingBottom: space.lg }}
          ListHeaderComponent={
            refreshFailed ? (
              <View style={{ gap: space.sm, paddingBottom: space.md }}>
                <Banner message={INBOX_REFRESH_ERROR} />
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
                <Banner message={INBOX_LOAD_MORE_ERROR} />
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  footer: { alignItems: 'center' },
});
