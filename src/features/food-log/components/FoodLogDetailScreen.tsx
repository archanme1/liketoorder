import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useRef, type ReactNode } from 'react';
import { Alert, StyleSheet, useWindowDimensions, View } from 'react-native';

import { Banner, Button, ErrorState, Skeleton, Text } from '@/components/ui';
import { CuisineLabel } from '@/features/cuisines/components/CuisineLabel';
import { useCuisine } from '@/features/cuisines/hooks/useCuisines';
import { PhotoTile } from '@/features/media/components/PhotoTile';
import { PhotoViewer } from '@/features/media/components/PhotoViewer';
import { usePhotoViewer } from '@/features/media/hooks/usePhotoViewer';
import { useSignedUrls } from '@/features/media/hooks/useSignedUrls';
import { useTheme } from '@/theme/useTheme';

import { formatLocalDate } from '../date';
import { useFoodLog } from '../hooks/useFoodLog';
import { useFoodLogBack } from '../hooks/useFoodLogBack';
import { forgetFoodLog, useDeleteFoodLog } from '../hooks/useFoodLogMutations';
import { DELETE_MESSAGE, DELETE_TITLE, foodLogErrorMessage, foodLogFlowMessage } from '../messages';
import type { FoodLog } from '../schema';
import { cuisineName, FOOD_LOG_BUCKET } from '../shared';

import { FoodLogFrame } from './FoodLogFrame';
import { FoodLogNotFound } from './FoodLogNotFound';
import { FoodLogRefreshError } from './FoodLogRefreshError';

// One of my uploads: the full image (tap for the viewer), the full description, the cuisine, the
// date and the visibility as a word, with Edit and Delete in the fixed top part.
export function FoodLogDetailScreen({ id }: { id: string }) {
  const { space, size } = useTheme();
  const query = useFoodLog(id);
  const back = useFoodLogBack();
  const log = query.data;

  if (query.isPending) {
    return (
      <FoodLogFrame>
        <View
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel="Loading photo"
          style={{ gap: space.md }}
        >
          <Skeleton height={size.photoLarge} rounded="md" />
          <Skeleton height={size.touch} rounded="md" />
        </View>
      </FoodLogFrame>
    );
  }
  // A failed background refresh keeps the photo on screen; not-found always replaces it.
  if (query.isError && (log === undefined || query.error.code === 'not_found')) {
    return (
      <FoodLogFrame>
        {query.error.code === 'not_found' ? (
          <FoodLogNotFound onBack={back} />
        ) : (
          <ErrorState
            message={foodLogErrorMessage(query.error.code)}
            onRetry={() => void query.refetch()}
            retrying={query.isFetching}
          />
        )}
      </FoodLogFrame>
    );
  }
  if (log === undefined) return null;
  return (
    <FoodLogDetails
      log={log}
      onClose={back}
      refreshError={
        query.isError ? (
          <FoodLogRefreshError
            message={foodLogErrorMessage(query.error.code)}
            onRetry={() => void query.refetch()}
            retrying={query.isFetching}
            retryLabel="Try loading this photo again"
          />
        ) : null
      }
    />
  );
}

function FoodLogDetails({
  log,
  onClose,
  refreshError,
}: {
  log: FoodLog & { path: string };
  onClose: () => void;
  refreshError: ReactNode;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { space, weight } = useTheme();
  const { width } = useWindowDimensions();
  const cuisine = useCuisine(log.cuisine_code);
  const remove = useDeleteFoodLog(log.id);
  const viewer = usePhotoViewer();
  const { urlFor, renew } = useSignedUrls(FOOD_LOG_BUCKET, [log.path]);

  // Once a deleted log's screen has gone, its cached detail and signed URL go too.
  const deleted = useRef(false);
  useEffect(
    () => () => {
      if (deleted.current) forgetFoodLog(queryClient, log.id, log.path);
    },
    [queryClient, log.id, log.path],
  );

  const date = formatLocalDate(log.local_date);
  const photoName = `Food photo, ${cuisineName(cuisine)}, ${date}`;
  const onExpired = (path: string) => void renew(path);

  function confirmDelete() {
    Alert.alert(DELETE_TITLE, DELETE_MESSAGE, [
      { text: 'Cancel', style: 'cancel' },
      // Close on success: the screen leaves before the list refetch, so "This photo isn't
      // available." never flashes.
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          remove.mutate(undefined, {
            onSuccess: () => {
              deleted.current = true;
              onClose();
            },
          }),
      },
    ]);
  }

  return (
    <FoodLogFrame
      top={
        <View style={[styles.actions, { gap: space.sm }]}>
          <View style={styles.action}>
            <Button
              title="Edit"
              variant="secondary"
              accessibilityLabel="Edit this photo"
              onPress={() =>
                router.push({ pathname: '/food-log/[id]/edit', params: { id: log.id } })
              }
              disabled={remove.isPending}
            />
          </View>
          <View style={styles.action}>
            <Button
              title="Delete"
              variant="secondary"
              accessibilityLabel="Delete this photo"
              onPress={confirmDelete}
              loading={remove.isPending}
            />
          </View>
        </View>
      }
    >
      {refreshError}
      {remove.isError ? <Banner message={foodLogFlowMessage(remove.error)} /> : null}
      <PhotoTile
        path={log.path}
        uri={urlFor(log.path)}
        accessibilityLabel={`${photoName}. Opens full image.`}
        onExpired={onExpired}
        onPress={() => viewer.open(0)}
        size={Math.max(width - space.lg * 2, 0)}
        width="100%"
      />
      <View style={{ gap: space.sm }}>
        <CuisineLabel code={log.cuisine_code} variant="bodyLg" />
        <Text color="textMuted">{date}</Text>
        <Text style={{ fontWeight: weight.semibold }}>{log.is_public ? 'Public' : 'Private'}</Text>
        {log.description ? <Text>{log.description}</Text> : null}
      </View>
      <PhotoViewer
        visible={viewer.visible}
        photos={[{ path: log.path, label: photoName }]}
        index={viewer.index}
        onIndexChange={viewer.setIndex}
        onClose={viewer.close}
        urlFor={urlFor}
        onExpired={onExpired}
      />
    </FoodLogFrame>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', flexWrap: 'wrap' },
  action: { flexGrow: 1 },
});
