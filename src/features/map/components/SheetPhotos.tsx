import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui';
import { PhotoOpenTarget } from '@/features/media/components/PhotoOpenTarget';
import { PhotoTile } from '@/features/media/components/PhotoTile';
import { PhotoViewer } from '@/features/media/components/PhotoViewer';
import { usePhotoViewer } from '@/features/media/hooks/usePhotoViewer';
import { useTheme } from '@/theme/useTheme';

import type { DetailsPhoto } from '../schema';

type SheetPhotosProps = {
  name: string;
  /** The cover (if any) followed by the gallery, in order. */
  photos: readonly DetailsPhoto[];
  urlFor: (path: string) => string | null | undefined;
  onExpired: (path: string) => void;
};

export function photoLabel(name: string, index: number, count: number): string {
  return `${name}, photo ${index} of ${count}`;
}

export function openViewerLabel(name: string, index: number, count: number): string {
  return `${photoLabel(name, index, count)}. Opens photo viewer.`;
}

// Cover and gallery in one row you can swipe. Tapping a photo opens the photo viewer on it. A
// place with no photos gets a calm placeholder, never a blank gap.
export function SheetPhotos({ name, photos, urlFor, onExpired }: SheetPhotosProps) {
  const { colors, space, radius, size, type } = useTheme();
  const viewer = usePhotoViewer();
  const viewerPhotos = useMemo(
    () =>
      photos.map((photo, index) => ({
        path: photo.path,
        label: photoLabel(name, index + 1, photos.length),
      })),
    [photos, name],
  );

  if (photos.length === 0) {
    return (
      <View
        accessible
        accessibilityLabel="No photos yet"
        style={[
          styles.empty,
          {
            height: size.photoThumb,
            gap: space.xs,
            borderRadius: radius.md,
            backgroundColor: colors.surfaceAlt,
          },
        ]}
      >
        <Ionicons name="image-outline" size={type.title} color={colors.textMuted} />
        <Text color="textMuted">No photos yet</Text>
      </View>
    );
  }

  return (
    <>
      <ScrollView
        horizontal
        nestedScrollEnabled
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: space.sm }}
      >
        {photos.map((photo, index) => (
          <PhotoOpenTarget
            key={photo.id}
            accessibilityLabel={openViewerLabel(name, index + 1, photos.length)}
            onPress={() => viewer.open(index)}
          >
            <PhotoTile
              path={photo.path}
              uri={urlFor(photo.path)}
              size={size.photoLarge}
              accessibilityLabel={photoLabel(name, index + 1, photos.length)}
              onExpired={onExpired}
            />
          </PhotoOpenTarget>
        ))}
      </ScrollView>
      <PhotoViewer
        visible={viewer.visible}
        photos={viewerPhotos}
        index={viewer.index}
        onIndexChange={viewer.setIndex}
        onClose={viewer.close}
        urlFor={urlFor}
        onExpired={onExpired}
      />
    </>
  );
}

const styles = StyleSheet.create({
  empty: { alignItems: 'center', justifyContent: 'center' },
});
