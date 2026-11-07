import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useCallback, useEffect, useRef, useState, type ComponentRef } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui';
import { useReduceMotion } from '@/lib/useReduceMotion';
import { useTheme } from '@/theme/useTheme';

export type ViewerPhoto = {
  /** The stored path: also the image cache key, so a renewed URL never reloads the photo. */
  path: string;
  /** Spoken name, e.g. "Nonna Rosa's Table, photo 2 of 4". */
  label: string;
};

type PhotoViewerProps = {
  visible: boolean;
  photos: readonly ViewerPhoto[];
  /** The photo shown first when it opens, and the one it moves to as the person swipes. */
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  /** Signed URL; undefined while loading, null when the server gave none. */
  urlFor: (path: string) => string | null | undefined;
  /** Called once per path when an image fails (usually an expired URL). */
  onExpired: (path: string) => void;
};

export const CLOSE_PHOTO_LABEL = 'Close photo';
export const PHOTO_UNAVAILABLE = 'Photo unavailable';

export function photoCounter(index: number, count: number): string {
  return `Photo ${index + 1} of ${count}`;
}

// Full-screen photo viewer, one photo at a time, shown whole. Swiping is the native scroll of a
// horizontal paged list (no gesture-handler gestures, so nothing extra is needed inside a Modal on
// Android). Closes with the X, a tap beside the photo, or Android back. Reduce Motion: no fade, and
// the screen-reader next/previous actions jump instead of gliding.
export function PhotoViewer(props: PhotoViewerProps) {
  // Mounted only while open: the "already asked for a new link" memory starts fresh each time.
  return props.visible && props.photos.length > 0 ? <ViewerModal {...props} /> : null;
}

function ViewerModal({
  visible,
  photos,
  index,
  onIndexChange,
  onClose,
  urlFor,
  onExpired,
}: PhotoViewerProps) {
  const { space, radius, size, viewer } = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const reduceMotion = useReduceMotion();
  const listRef = useRef<FlatList<ViewerPhoto>>(null);
  const closeRef = useRef<ComponentRef<typeof Pressable>>(null);
  // Which paths were already asked to renew: a second failure on the same path is final.
  const renewed = useRef(new Set<string>());

  // A screen reader lands on the close button when the viewer opens.
  useEffect(() => {
    if (!visible) return;
    if (closeRef.current) AccessibilityInfo.sendAccessibilityEvent(closeRef.current, 'focus');
  }, [visible]);

  const onMomentumScrollEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const page = Math.round(event.nativeEvent.contentOffset.x / (width || 1));
      const next = Math.min(Math.max(page, 0), photos.length - 1);
      if (next !== index) onIndexChange(next);
    },
    [width, photos.length, index, onIndexChange],
  );

  const goTo = useCallback(
    (next: number) => {
      if (next < 0 || next >= photos.length) return;
      listRef.current?.scrollToIndex({ index: next, animated: !reduceMotion });
      onIndexChange(next);
    },
    [photos.length, reduceMotion, onIndexChange],
  );

  const handleExpired = useCallback(
    (path: string): boolean => {
      if (renewed.current.has(path)) return false;
      renewed.current.add(path);
      onExpired(path);
      return true;
    },
    [onExpired],
  );

  const current = Math.min(Math.max(index, 0), photos.length - 1);

  return (
    <Modal
      testID="photo-viewer-modal"
      visible={visible}
      transparent
      animationType={reduceMotion ? 'none' : 'fade'}
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View
        style={[styles.flex, { backgroundColor: viewer.backdrop }]}
        accessibilityViewIsModal
        testID="photo-viewer"
      >
        <View
          style={[
            styles.bar,
            { padding: space.md, paddingTop: insets.top + space.md, gap: space.md },
          ]}
        >
          <Text
            style={[styles.counter, { color: viewer.text }]}
            accessibilityRole="header"
            accessibilityLiveRegion="polite"
          >
            {photoCounter(current, photos.length)}
          </Text>
          <Pressable
            ref={closeRef}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={CLOSE_PHOTO_LABEL}
            style={[
              styles.close,
              {
                width: size.touch,
                height: size.touch,
                borderRadius: radius.pill,
                backgroundColor: viewer.control,
              },
            ]}
          >
            <Ionicons name="close" size={size.tabIcon} color={viewer.text} />
          </Pressable>
        </View>
        <FlatList
          ref={listRef}
          testID="photo-viewer-list"
          data={photos}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          keyExtractor={keyOf}
          initialScrollIndex={current}
          getItemLayout={(_data, i) => ({ length: width, offset: width * i, index: i })}
          windowSize={3}
          onMomentumScrollEnd={onMomentumScrollEnd}
          renderItem={({ item, index: i }) => (
            <ViewerPage
              photo={item}
              position={i}
              count={photos.length}
              width={width}
              uri={urlFor(item.path)}
              onClose={onClose}
              onExpired={handleExpired}
              onPrevious={() => goTo(i - 1)}
              onNext={() => goTo(i + 1)}
            />
          )}
        />
      </View>
    </Modal>
  );
}

function noop() {}

function keyOf(photo: ViewerPhoto): string {
  return photo.path;
}

type PageProps = {
  photo: ViewerPhoto;
  position: number;
  count: number;
  width: number;
  uri: string | null | undefined;
  onClose: () => void;
  onExpired: (path: string) => boolean;
  onPrevious: () => void;
  onNext: () => void;
};

function ViewerPage({
  photo,
  position,
  count,
  width,
  uri,
  onClose,
  onExpired,
  onPrevious,
  onNext,
}: PageProps) {
  const { space, viewer } = useTheme();
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const handleError = () => {
    // The first failure is usually an expired link: ask for a new one and wait. A second is final.
    if (!onExpired(photo.path)) setFailed(true);
  };

  const unavailable = failed || uri === null;
  const actions = [
    ...(position > 0 ? [{ name: 'previous', label: 'Previous photo' }] : []),
    ...(position < count - 1 ? [{ name: 'next', label: 'Next photo' }] : []),
  ];

  return (
    // A tap on the dark area beside the photo closes the viewer; the photo itself swallows taps.
    <Pressable
      onPress={onClose}
      accessible={false}
      style={[styles.page, { width }]}
      testID={`photo-page-${position}`}
    >
      <Pressable
        accessible
        accessibilityRole="image"
        accessibilityLabel={unavailable ? `${photo.label}. ${PHOTO_UNAVAILABLE}` : photo.label}
        // Swallows taps on the photo itself, so only the dark area beside it closes the viewer.
        onPress={noop}
        accessibilityActions={actions}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === 'previous') onPrevious();
          if (event.nativeEvent.actionName === 'next') onNext();
        }}
        style={styles.photoBox}
      >
        {unavailable ? (
          <View style={[styles.center, { gap: space.sm }]}>
            <Ionicons name="image-outline" size={space.xxl} color={viewer.text} />
            <Text style={{ color: viewer.text }}>{PHOTO_UNAVAILABLE}</Text>
          </View>
        ) : (
          <>
            {uri ? (
              <Image
                source={{ uri, cacheKey: photo.path }}
                cachePolicy="memory-disk"
                contentFit="contain"
                style={StyleSheet.absoluteFill}
                onLoad={() => setLoaded(true)}
                onError={handleError}
                accessible={false}
              />
            ) : null}
            {!loaded ? (
              <View style={[StyleSheet.absoluteFill, styles.center]} pointerEvents="none">
                <ActivityIndicator color={viewer.text} accessibilityLabel="Loading photo" />
              </View>
            ) : null}
          </>
        )}
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  bar: { flexDirection: 'row', alignItems: 'center' },
  counter: { flex: 1 },
  close: { alignItems: 'center', justifyContent: 'center' },
  page: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  photoBox: { width: '100%', height: '85%' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
