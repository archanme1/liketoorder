import { useRouter } from 'expo-router';
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
import { useDeleteFoodLog } from '../hooks/useFoodLogMutations';
import { DELETE_MESSAGE, DELETE_TITLE, foodLogErrorMessage, foodLogFlowMessage } from '../messages';
import type { FoodLog } from '../schema';
import { FOOD_LOG_BUCKET } from '../uploadFoodLog';

import { FoodLogFrame } from './FoodLogFrame';
import { cuisineName } from './FoodLogRow';
import { FoodLogNotFound } from './FoodLogNotFound';

// One of my uploads: the full image (tap for the viewer), the full description, the cuisine, the
// date and the visibility as a word, with Edit and Delete in the fixed top part.
export function FoodLogDetailScreen({ id }: { id: string }) {
  const router = useRouter();
  const { space, size } = useTheme();
  const query = useFoodLog(id);
  const back = () => (router.canGoBack() ? router.back() : router.replace('/food-log'));

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
  if (query.isError) {
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
  return <FoodLogDetails log={query.data} onClose={back} />;
}

function FoodLogDetails({
  log,
  onClose,
}: {
  log: FoodLog & { path: string };
  onClose: () => void;
}) {
  const router = useRouter();
  const { space, weight } = useTheme();
  const { width } = useWindowDimensions();
  const cuisine = useCuisine(log.cuisine_code);
  const remove = useDeleteFoodLog(log.id);
  const viewer = usePhotoViewer();
  const { urlFor, renew } = useSignedUrls(FOOD_LOG_BUCKET, [log.path]);

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
        onPress: () => remove.mutate(undefined, { onSuccess: onClose }),
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
