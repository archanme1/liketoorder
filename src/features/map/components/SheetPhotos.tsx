import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo, type ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui';
import { PhotoOpenTarget } from '@/features/media/components/PhotoOpenTarget';
import { PhotoTile } from '@/features/media/components/PhotoTile';
import { PhotoViewer } from '@/features/media/components/PhotoViewer';
import { usePhotoViewer } from '@/features/media/hooks/usePhotoViewer';
import { useTheme } from '@/theme/useTheme';

import type { DetailsPhoto } from '../schema';

type SheetPhotosInput = {
  name: string;
  /** The cover photo, if the place has one. */
  cover: DetailsPhoto | undefined;
  gallery: readonly DetailsPhoto[];
  urlFor: (path: string) => string | null | undefined;
  onExpired: (path: string) => void;
};

export function photoLabel(name: string, index: number, count: number): string {
  return `${name}, photo ${index} of ${count}`;
}

export function openViewerLabel(name: string, index: number, count: number): string {
  return `${photoLabel(name, index, count)}. Opens photo viewer.`;
}

/**
 * The cover and the gallery are shown in two places (the cover is a short banner at the top of the
 * sheet, the gallery a row lower down, after the menu) but they page together in ONE viewer: a tap
 * on the banner opens at photo 1 and a swipe reaches the gallery. This hook owns that viewer and
 * returns the pieces to place, so the sheet bodies decide the order.
 *
 * Nothing is shown for a missing cover (no placeholder). "No photos yet" appears, in the gallery's
 * place, only when there is neither a cover nor a gallery.
 */
export function useCoverAndGallery({ name, cover, gallery, urlFor, onExpired }: SheetPhotosInput): {
  banner: ReactNode;
  gallerySection: ReactNode;
  viewer: ReactNode;
} {
  const viewer = usePhotoViewer();
  const all = useMemo(() => (cover ? [cover, ...gallery] : [...gallery]), [cover, gallery]);
  const viewerPhotos = useMemo(
    () =>
      all.map((photo, index) => ({
        path: photo.path,
        label: photoLabel(name, index + 1, all.length),
      })),
    [all, name],
  );
  const { open } = viewer;

  return {
    banner: cover ? (
      <CoverBanner
        name={name}
        photo={cover}
        count={all.length}
        urlFor={urlFor}
        onExpired={onExpired}
        onOpen={() => open(0)}
      />
    ) : null,
    gallerySection:
      gallery.length > 0 ? (
        <GalleryStrip
          name={name}
          photos={gallery}
          offset={cover ? 1 : 0}
          count={all.length}
          urlFor={urlFor}
          onExpired={onExpired}
          onOpen={open}
        />
      ) : cover ? null : (
        <NoPhotos />
      ),
    viewer: (
      <PhotoViewer
        visible={viewer.visible}
        photos={viewerPhotos}
        index={viewer.index}
        onIndexChange={viewer.setIndex}
        onClose={viewer.close}
        urlFor={urlFor}
        onExpired={onExpired}
      />
    ),
  };
}

type BannerProps = {
  name: string;
  photo: DetailsPhoto;
  count: number;
  urlFor: (path: string) => string | null | undefined;
  onExpired: (path: string) => void;
  onOpen: () => void;
};

// A short, full-width banner, cropped to fill. Tapping it opens the photo viewer.
function CoverBanner({ name, photo, count, urlFor, onExpired, onOpen }: BannerProps) {
  const { size } = useTheme();
  return (
    <View testID="cover-banner">
      <PhotoOpenTarget accessibilityLabel={openViewerLabel(name, 1, count)} onPress={onOpen}>
        <PhotoTile
          path={photo.path}
          uri={urlFor(photo.path)}
          size={size.coverBanner}
          width="100%"
          accessibilityLabel={photoLabel(name, 1, count)}
          onExpired={onExpired}
        />
      </PhotoOpenTarget>
    </View>
  );
}

type GalleryProps = {
  name: string;
  photos: readonly DetailsPhoto[];
  /** 1 when a cover comes first in the viewer, otherwise 0. */
  offset: number;
  count: number;
  urlFor: (path: string) => string | null | undefined;
  onExpired: (path: string) => void;
  onOpen: (index: number) => void;
};

function GalleryStrip({ name, photos, offset, count, urlFor, onExpired, onOpen }: GalleryProps) {
  const { space, size } = useTheme();
  return (
    <ScrollView
      testID="gallery-strip"
      horizontal
      nestedScrollEnabled
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: space.sm }}
    >
      {photos.map((photo, index) => {
        const position = index + offset;
        return (
          <PhotoOpenTarget
            key={photo.id}
            accessibilityLabel={openViewerLabel(name, position + 1, count)}
            onPress={() => onOpen(position)}
          >
            <PhotoTile
              path={photo.path}
              uri={urlFor(photo.path)}
              size={size.photoLarge}
              accessibilityLabel={photoLabel(name, position + 1, count)}
              onExpired={onExpired}
            />
          </PhotoOpenTarget>
        );
      })}
    </ScrollView>
  );
}

function NoPhotos() {
  const { colors, space, radius, size, type } = useTheme();
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

const styles = StyleSheet.create({
  empty: { alignItems: 'center', justifyContent: 'center' },
});
