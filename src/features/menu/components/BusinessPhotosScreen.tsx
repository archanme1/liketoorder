import { useLocalSearchParams } from 'expo-router';
import {
  memo,
  useCallback,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { Alert, StyleSheet, View, type ScrollViewInstance } from 'react-native';

import { Banner, ErrorState, Text } from '@/components/ui';
import { AddPhotoButton } from '@/features/media/components/AddPhotoButton';
import { PhotoTile } from '@/features/media/components/PhotoTile';
import { PhotoViewer, type ViewerPhoto } from '@/features/media/components/PhotoViewer';
import { usePhotoViewer } from '@/features/media/hooks/usePhotoViewer';
import { useSignedUrls } from '@/features/media/hooks/useSignedUrls';
import { SellerLoading } from '@/features/sellers/components/SellerLoading';
import { SellerScreenFrame } from '@/features/sellers/components/SellerScreenFrame';
import { SellerScreenGate } from '@/features/sellers/components/SellerScreenGate';
import type { MyBusiness } from '@/features/sellers/schema';
import { useTheme } from '@/theme/useTheme';

import { useMyMenu } from '../hooks/useMyMenu';
import { usePhotoCleanup } from '../hooks/usePhotoCleanup';
import { useDeleteBusinessPhoto, useUploadBusinessPhoto } from '../hooks/usePhotoMutations';
import {
  HOMEMADE_PHOTO_NOTE,
  MENU_PHOTOS_HINT,
  menuErrorMessage,
  photoErrorMessage,
} from '../messages';
import {
  groupPhotos,
  MEDIA_BUCKET,
  PHOTO_LIMITS,
  photoEditLabels,
  photoNames,
  slotPhoto,
} from '../photos';
import type { BusinessPhoto, Menu, PhotoKind } from '../schema';

export function BusinessPhotosScreen() {
  const scrollRef = useRef<ScrollViewInstance>(null);
  return (
    <SellerScreenFrame scrollRef={scrollRef}>
      <SellerScreenGate screen="photos">
        {(business) => <PhotosBody business={business} scrollRef={scrollRef} />}
      </SellerScreenGate>
    </SellerScreenFrame>
  );
}

type PhotosBodyProps = {
  business: MyBusiness;
  scrollRef: RefObject<ScrollViewInstance | null>;
};

// Loads only after the business (Decision 14), with its own loading and error states.
function PhotosBody({ business, scrollRef }: PhotosBodyProps) {
  usePhotoCleanup();
  const menu = useMyMenu(business.id);

  if (menu.isPending) return <SellerLoading label="Loading your photos" />;
  if (menu.isError && menu.data === undefined) {
    return (
      <ErrorState
        message={menuErrorMessage(menu.error.code)}
        onRetry={() => void menu.refetch()}
        retrying={menu.isRefetching}
      />
    );
  }
  return <PhotosEditor business={business} menu={menu.data} scrollRef={scrollRef} />;
}

function PhotosEditor({ business, menu, scrollRef }: PhotosBodyProps & { menu: Menu }) {
  const { space } = useTheme();
  const { section } = useLocalSearchParams<{ section?: string }>();
  const upload = useUploadBusinessPhoto(business.id);
  const remove = useDeleteBusinessPhoto(business.id);
  const [banner, setBanner] = useState<string | null>(null);
  const scrolled = useRef(false);

  const sections = useMemo(() => groupPhotos(menu.photos), [menu.photos]);
  const paths = useMemo(
    () => [...sections.cover, ...sections.gallery, ...sections.menu].map((p) => p.path),
    [sections],
  );
  const { renew, urlFor } = useSignedUrls(MEDIA_BUCKET, paths);
  const cover = slotPhoto(sections.cover, urlFor);

  // "View larger": the photos that can be shown (they have a link), in page order: cover, gallery,
  // menu pages. Editing is untouched; this only adds an option to the existing photo options.
  const viewer = usePhotoViewer();
  const viewable = useMemo(() => {
    const list: ViewerPhoto[] = [];
    if (cover && typeof urlFor(cover.path) === 'string') {
      list.push({ path: cover.path, label: photoNames.cover(business.name) });
    }
    sections.gallery.forEach((photo, i) => {
      if (typeof urlFor(photo.path) === 'string') {
        list.push({
          path: photo.path,
          label: photoNames.gallery(i + 1, sections.gallery.length, business.name),
        });
      }
    });
    sections.menu.forEach((photo, i) => {
      if (typeof urlFor(photo.path) === 'string') {
        list.push({
          path: photo.path,
          label: photoNames.menu(i + 1, sections.menu.length, business.name),
        });
      }
    });
    return list;
  }, [cover, sections.gallery, sections.menu, urlFor, business.name]);
  const { open: openViewer } = viewer;
  const onExpired = useCallback((path: string) => void renew(path), [renew]);
  const uploadingKind = upload.isPending ? upload.variables?.kind : undefined;

  // One upload at a time: the buttons are disabled while one runs, and this ref also stops a second
  // start from a path that isn't a button (the cover tile's Replace option) or a double tap that
  // lands before the pending state has rendered.
  const uploadRunning = useRef(false);
  const { mutate: startUpload } = upload;
  const add = useCallback(
    (kind: PhotoKind) => {
      if (uploadRunning.current) return;
      uploadRunning.current = true;
      setBanner(null);
      startUpload(
        { kind },
        {
          onError: (error) => setBanner(photoErrorMessage(error)),
          onSettled: () => {
            uploadRunning.current = false;
          },
        },
      );
    },
    [startUpload],
  );

  const { mutate: removePhoto } = remove;
  const confirmRemove = useCallback(
    (photo: BusinessPhoto, name: string) => {
      Alert.alert(`Remove ${name.toLowerCase()}?`, undefined, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            setBanner(null);
            removePhoto(photo.id, { onError: (error) => setBanner(photoErrorMessage(error)) });
          },
        },
      ]);
    },
    [removePhoto],
  );

  // Photo options: the cover can be replaced; gallery and menu photos are removed and re-added.
  const openOptions = useCallback(
    (photo: BusinessPhoto, name: string) => {
      const viewIndex = viewable.findIndex((entry) => entry.path === photo.path);
      const buttons = [
        ...(viewIndex >= 0 ? [{ text: 'View larger', onPress: () => openViewer(viewIndex) }] : []),
        ...(photo.kind === 'cover' ? [{ text: 'Replace', onPress: () => add('cover') }] : []),
        {
          text: 'Remove',
          style: 'destructive' as const,
          onPress: () => confirmRemove(photo, name),
        },
        { text: 'Cancel', style: 'cancel' as const },
      ];
      Alert.alert(name, undefined, buttons);
    },
    [add, confirmRemove, viewable, openViewer],
  );

  const empty =
    sections.cover.length === 0 && sections.gallery.length === 0 && sections.menu.length === 0;

  return (
    <View style={{ gap: space.xl }}>
      {banner ? <Banner message={banner} /> : null}
      {business.type === 'homemade' ? <Banner tone="info" message={HOMEMADE_PHOTO_NOTE} /> : null}
      {empty ? (
        <Text color="textMuted" accessibilityRole="text">
          No photos yet
        </Text>
      ) : null}

      <Section title="Cover" count={cover ? 1 : 0} limit={1}>
        {cover ? (
          <PhotoTile
            path={cover.path}
            uri={urlFor(cover.path)}
            accessibilityLabel={photoNames.cover(business.name)}
            editLabel={photoEditLabels.cover()}
            onPress={() => openOptions(cover, 'Cover photo')}
            onExpired={onExpired}
          />
        ) : null}
        <AddPhotoButton
          label={cover ? 'Replace cover photo' : 'Add cover photo'}
          onPress={() => add('cover')}
          uploading={uploadingKind === 'cover'}
          disabledReason={
            upload.isPending && uploadingKind !== 'cover'
              ? 'Another photo is uploading.'
              : undefined
          }
        />
      </Section>

      <Section title="Gallery" count={sections.gallery.length} limit={PHOTO_LIMITS.gallery}>
        <PhotoGrid
          photos={sections.gallery}
          kind="gallery"
          businessName={business.name}
          urlFor={urlFor}
          onExpired={onExpired}
          onOpen={openOptions}
        />
        <AddPhotoButton
          label="Add gallery photo"
          onPress={() => add('gallery')}
          uploading={uploadingKind === 'gallery'}
          disabledReason={fullReason(
            sections.gallery.length,
            PHOTO_LIMITS.gallery,
            'gallery',
            upload.isPending && uploadingKind !== 'gallery',
          )}
        />
      </Section>

      <View
        onLayout={(event) => {
          if (section === 'menu' && !scrolled.current) {
            scrolled.current = true;
            scrollRef.current?.scrollTo({ y: event.nativeEvent.layout.y, animated: false });
          }
        }}
      >
        <Section title="Menu photos" count={sections.menu.length} limit={PHOTO_LIMITS.menu}>
          <Text variant="caption" color="textMuted">
            {MENU_PHOTOS_HINT}
          </Text>
          <PhotoGrid
            photos={sections.menu}
            kind="menu"
            businessName={business.name}
            urlFor={urlFor}
            onExpired={onExpired}
            onOpen={openOptions}
          />
          <AddPhotoButton
            label="Add menu photo"
            onPress={() => add('menu')}
            uploading={uploadingKind === 'menu'}
            disabledReason={fullReason(
              sections.menu.length,
              PHOTO_LIMITS.menu,
              'menu',
              upload.isPending && uploadingKind !== 'menu',
            )}
          />
        </Section>
      </View>
      <PhotoViewer
        visible={viewer.visible}
        photos={viewable}
        index={viewer.index}
        onIndexChange={viewer.setIndex}
        onClose={viewer.close}
        urlFor={urlFor}
        onExpired={onExpired}
      />
    </View>
  );
}

function fullReason(
  count: number,
  limit: number,
  kind: 'gallery' | 'menu',
  otherUploading: boolean,
): string | undefined {
  if (count >= limit) {
    return `This section is full (${limit} of ${limit}). Remove a ${kind} photo to add another.`;
  }
  return otherUploading ? 'Another photo is uploading.' : undefined;
}

function Section({
  title,
  count,
  limit,
  children,
}: {
  title: string;
  count: number;
  limit: number;
  children: ReactNode;
}) {
  const { space } = useTheme();
  return (
    <View style={{ gap: space.md }}>
      <View style={[styles.header, { gap: space.sm }]}>
        <Text variant="title" accessibilityRole="header" style={styles.flex}>
          {title}
        </Text>
        <Text color="textMuted">
          {count} of {limit}
        </Text>
      </View>
      {children}
    </View>
  );
}

type PhotoGridProps = {
  photos: BusinessPhoto[];
  kind: 'gallery' | 'menu';
  businessName: string;
  urlFor: (path: string) => string | null | undefined;
  onExpired: (path: string) => void;
  /** `name` is the spoken option title, e.g. "Gallery photo 2 of 6". */
  onOpen: (photo: BusinessPhoto, name: string) => void;
};

const GRID_NAMES = {
  gallery: { tile: photoNames.gallery, edit: photoEditLabels.gallery, option: 'Gallery photo' },
  menu: { tile: photoNames.menu, edit: photoEditLabels.menu, option: 'Menu photo' },
};

// Photos stay in upload order (reordering photos is out of scope). Props are stable, so the grid
// only re-renders when its photos or URLs change.
const PhotoGrid = memo(function PhotoGrid({
  photos,
  kind,
  businessName,
  urlFor,
  onExpired,
  onOpen,
}: PhotoGridProps) {
  const { space } = useTheme();
  if (photos.length === 0) return null;
  const names = GRID_NAMES[kind];
  return (
    <View style={[styles.grid, { gap: space.sm }]}>
      {photos.map((photo, i) => (
        <PhotoTile
          key={photo.id}
          path={photo.path}
          uri={urlFor(photo.path)}
          accessibilityLabel={names.tile(i + 1, photos.length, businessName)}
          editLabel={names.edit(i + 1, photos.length)}
          onPress={() => onOpen(photo, `${names.option} ${i + 1} of ${photos.length}`)}
          onExpired={onExpired}
        />
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
});
