import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, View } from 'react-native';

import { Banner, Button, EmptyState, ErrorState, Skeleton } from '@/components/ui';
import { useSignedUrls } from '@/features/media/hooks/useSignedUrls';
import { useTheme } from '@/theme/useTheme';

import { useFoodLogCleanup } from '../hooks/useFoodLogCleanup';
import { useMyFoodLogs } from '../hooks/useMyFoodLogs';
import { FOOD_LOG_EMPTY, foodLogErrorMessage, LOAD_MORE_ERROR } from '../messages';
import type { FoodLog } from '../schema';
import { FOOD_LOG_BUCKET } from '../uploadFoodLog';

import { FoodLogFrame } from './FoodLogFrame';
import { FoodLogRow } from './FoodLogRow';

const logKey = (log: FoodLog) => log.id;

// My uploads, newest first, 50 at a time: Add photo at the top, then loading, empty, error with
// Retry, or the list. More rows load near the end (a footer spinner, or an inline Try again that
// keeps the rows already loaded). Pull down to start again from the newest 50.
export function FoodLogListScreen() {
  const router = useRouter();
  const { colors, space, size } = useTheme();
  const query = useMyFoodLogs();
  const { logs, hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage, refresh } =
    query;
  const [refreshing, setRefreshing] = useState(false);
  useFoodLogCleanup();

  const paths = useMemo(
    () => logs.flatMap((log) => (log.is_mine && log.path ? [log.path] : [])),
    [logs],
  );
  const { urlFor, renew } = useSignedUrls(FOOD_LOG_BUCKET, paths);

  const firstLoadFailed = query.isError && query.data === undefined;
  const refreshFailed = query.isRefetchError && !isFetchNextPageError;

  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage && !isFetchNextPageError) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage]);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  }, [refresh]);
  const open = useCallback(
    (log: FoodLog) => router.push({ pathname: '/food-log/[id]', params: { id: log.id } }),
    [router],
  );
  const onExpired = useCallback((path: string) => void renew(path), [renew]);
  const renderItem = useCallback(
    ({ item }: { item: FoodLog }) => (
      <FoodLogRow
        log={item}
        uri={item.path ? urlFor(item.path) : null}
        onExpired={onExpired}
        onPress={open}
      />
    ),
    [urlFor, onExpired, open],
  );

  return (
    <FoodLogFrame
      scroll={false}
      top={<Button title="Add photo" onPress={() => router.push('/food-log/new')} />}
    >
      {query.isPending ? (
        <View
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel="Loading food photos"
          style={{ gap: space.md, paddingTop: space.lg }}
        >
          <Skeleton height={size.photoThumb} rounded="md" />
          <Skeleton height={size.photoThumb} rounded="md" />
          <Skeleton height={size.photoThumb} rounded="md" />
        </View>
      ) : firstLoadFailed ? (
        <ErrorState
          message={foodLogErrorMessage(query.error?.code ?? 'unknown')}
          onRetry={() => void query.refetch()}
          retrying={query.isFetching}
        />
      ) : logs.length === 0 ? (
        <EmptyState message={FOOD_LOG_EMPTY} />
      ) : (
        <FlatList
          testID="food-log-list"
          data={logs}
          keyExtractor={logKey}
          renderItem={renderItem}
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          contentContainerStyle={{ gap: space.md, paddingVertical: space.lg }}
          ListHeaderComponent={
            refreshFailed ? (
              <View style={{ gap: space.sm }}>
                <Banner message={foodLogErrorMessage(query.error?.code ?? 'unknown')} />
                <Button
                  title="Try again"
                  variant="secondary"
                  accessibilityLabel="Try refreshing again"
                  onPress={() => void query.refetch()}
                  loading={query.isFetching}
                />
              </View>
            ) : undefined
          }
          ListFooterComponent={
            isFetchingNextPage ? (
              <View style={[styles.footer, { padding: space.lg }]}>
                <ActivityIndicator
                  color={colors.primary}
                  accessibilityLabel="Loading more food photos"
                />
              </View>
            ) : isFetchNextPageError ? (
              <View style={{ gap: space.sm }}>
                <Banner message={LOAD_MORE_ERROR} />
                <Button
                  title="Try again"
                  variant="secondary"
                  accessibilityLabel="Try loading more food photos again"
                  onPress={() => void fetchNextPage()}
                />
              </View>
            ) : undefined
          }
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />
          }
        />
      )}
    </FoodLogFrame>
  );
}

const styles = StyleSheet.create({
  footer: { alignItems: 'center' },
});
