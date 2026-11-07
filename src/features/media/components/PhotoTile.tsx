import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Skeleton, Text } from '@/components/ui';
import { useTheme } from '@/theme/useTheme';

type PhotoTileProps = {
  /** The stored path. Also the image cache key, so a renewed URL never reloads the photo. */
  path: string;
  /** Signed URL; undefined while loading, null when the server gave none. */
  uri: string | null | undefined;
  /** Spoken name, e.g. "Cover photo, Maria's Kitchen". */
  accessibilityLabel: string;
  /** Called once per path per mount when the image fails (usually an expired URL). */
  onExpired: (path: string) => void;
  /** Edit mode: the tile becomes a button. */
  onPress?: () => void;
  /** Edit-mode action label, e.g. "Gallery photo 2 of 6. Opens photo options." */
  editLabel?: string;
  size?: number;
  /**
   * Width of the tile. Default: square (the same as the height). Pass '100%' or a number for a
   * banner: the photo is cropped to fill it (contentFit "cover").
   */
  width?: number | '100%';
};

type Status = 'loading' | 'loaded' | 'retrying' | 'failed';

export function PhotoTile({
  path,
  uri,
  accessibilityLabel,
  onExpired,
  onPress,
  editLabel,
  size: tileSize,
  width: tileWidth,
}: PhotoTileProps) {
  const { colors, radius, size, space, type, opacity } = useTheme();
  const dimension = Math.max(tileSize ?? size.photoThumb, size.touch);

  // Status is kept per path, not per URL: a new URL for the same path keeps a loaded tile loaded.
  const [state, setState] = useState<{ path: string; status: Status }>({ path, status: 'loading' });
  if (state.path !== path) setState({ path, status: 'loading' });
  const status = state.path === path ? state.status : 'loading';
  const expired = useRef(new Set<string>());

  const failed = status === 'failed' || uri === null;

  function handleError() {
    if (!expired.current.has(path)) {
      expired.current.add(path);
      setState({ path, status: 'retrying' });
      onExpired(path);
    } else {
      setState({ path, status: 'failed' });
    }
  }

  const box = { width: tileWidth ?? dimension, height: dimension, borderRadius: radius.md };

  const body = (
    <View style={[styles.box, box, { backgroundColor: colors.surfaceAlt }]}>
      {failed ? (
        <View style={[styles.center, { gap: space.xs, padding: space.xs }]}>
          <Ionicons name="image-outline" size={type.title} color={colors.textMuted} />
          <Text variant="caption" color="textMuted" style={styles.centerText}>
            Photo unavailable
          </Text>
        </View>
      ) : (
        <>
          {uri ? (
            <Image
              source={{ uri, cacheKey: path }}
              cachePolicy="memory-disk"
              contentFit="cover"
              style={StyleSheet.absoluteFill}
              onLoad={() => setState({ path, status: 'loaded' })}
              onError={handleError}
              accessible={false}
            />
          ) : null}
          {status !== 'loaded' ? (
            <View style={StyleSheet.absoluteFill}>
              <Skeleton height={dimension} rounded="md" />
            </View>
          ) : null}
        </>
      )}
    </View>
  );

  const unavailable = failed ? '. Photo unavailable' : '';
  const spokenName = `${accessibilityLabel}${unavailable}`;

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={editLabel ? `${editLabel}${unavailable}` : spokenName}
        style={({ pressed }) => ({ opacity: pressed ? opacity.pressed : 1 })}
      >
        {body}
      </Pressable>
    );
  }
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={spokenName}>
      {body}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { overflow: 'hidden' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  centerText: { textAlign: 'center' },
});
