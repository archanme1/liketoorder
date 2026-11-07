import Ionicons from '@expo/vector-icons/Ionicons';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui';
import { PhotoTile } from '@/features/media/components/PhotoTile';
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

// Cover and gallery in one row you can swipe. Photos show at normal size only (the photo
// viewer is spec 08). A restaurant with no photos gets a calm placeholder, never a blank gap.
export function SheetPhotos({ name, photos, urlFor, onExpired }: SheetPhotosProps) {
  const { colors, space, radius, size, type } = useTheme();

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
    <ScrollView
      horizontal
      nestedScrollEnabled
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: space.sm }}
    >
      {photos.map((photo, index) => (
        <PhotoTile
          key={photo.id}
          path={photo.path}
          uri={urlFor(photo.path)}
          size={size.photoLarge}
          accessibilityLabel={photoLabel(name, index + 1, photos.length)}
          onExpired={onExpired}
        />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  empty: { alignItems: 'center', justifyContent: 'center' },
});
