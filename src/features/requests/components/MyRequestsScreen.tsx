import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';

import { Button, EmptyState, ErrorState, Screen, Skeleton, Text } from '@/components/ui';
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

// My requests, newest first: loading, empty, error with Retry, or the list. Refetches when the
// app comes back to the front, every 30 s while a pending row is visible, and just after one
// expires (all in useMyRequests); pull down to refresh by hand.
export function MyRequestsScreen({
  onBack,
  onOpen,
  onFindPlace,
  timeZone,
  locale,
}: MyRequestsScreenProps) {
  const { space, type } = useTheme();
  const query = useMyRequests();

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
      ) : query.isError ? (
        <ErrorState
          message={loadErrorMessage(query.error.code)}
          onRetry={() => void query.refetch()}
          retrying={query.isFetching}
        />
      ) : query.data.requests.length === 0 ? (
        <EmptyState message={EMPTY_LIST} actionLabel="Find a place" onAction={onFindPlace} />
      ) : (
        <FlatList
          data={query.data.requests}
          keyExtractor={(request) => request.id}
          renderItem={({ item }) => (
            <RequestRow request={item} onPress={onOpen} timeZone={timeZone} locale={locale} />
          )}
          contentContainerStyle={{ gap: space.md, paddingVertical: space.lg }}
          refreshControl={
            <RefreshControl
              refreshing={query.isRefetching}
              onRefresh={() => void query.refetch()}
            />
          }
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  back: { alignItems: 'flex-start' },
});
