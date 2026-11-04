import { useLocalSearchParams } from 'expo-router';
import { useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Alert, StyleSheet, View, type ScrollViewInstance } from 'react-native';

import { Banner, ErrorState, Text } from '@/components/ui';
import { AddPhotoButton } from '@/features/media/components/AddPhotoButton';
import { PhotoTile } from '@/features/media/components/PhotoTile';
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
  const urls = useSignedUrls(MEDIA_BUCKET, paths);
  const cover = slotPhoto(sections.cover, urls.urlFor);
  const onExpired = (path: string) => void urls.renew(path);
  const uploadingKind = upload.isPending ? upload.variables?.kind : undefined;

  const add = (kind: PhotoKind) => {
    setBanner(null);
    upload.mutate({ kind }, { onError: (error) => setBanner(photoErrorMessage(error)) });
  };

  const confirmRemove = (photo: BusinessPhoto, name: string) => {
    Alert.alert(`Remove ${name.toLowerCase()}?`, undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          setBanner(null);
          remove.mutate(photo.id, { onError: (error) => setBanner(photoErrorMessage(error)) });
        },
      },
    ]);
  };

  // Photo options: the cover can be replaced; gallery and menu photos are removed and re-added.
  const openOptions = (photo: BusinessPhoto, name: string) => {
    const buttons = [
      ...(photo.kind === 'cover' ? [{ text: 'Replace', onPress: () => add('cover') }] : []),
      { text: 'Remove', style: 'destructive' as const, onPress: () => confirmRemove(photo, name) },
      { text: 'Cancel', style: 'cancel' as const },
    ];
    Alert.alert(name, undefined, buttons);
  };

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
            uri={urls.urlFor(cover.path)}
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
          urlFor={urls.urlFor}
          onExpired={onExpired}
          nameFor={(index, count) => photoNames.gallery(index, count, business.name)}
          editLabelFor={photoEditLabels.gallery}
          onOpen={(photo, index, count) => openOptions(photo, `Gallery photo ${index} of ${count}`)}
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
            urlFor={urls.urlFor}
            onExpired={onExpired}
            nameFor={(index, count) => photoNames.menu(index, count, business.name)}
            editLabelFor={photoEditLabels.menu}
            onOpen={(photo, index, count) => openOptions(photo, `Menu photo ${index} of ${count}`)}
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
  urlFor: (path: string) => string | null | undefined;
  onExpired: (path: string) => void;
  nameFor: (index: number, count: number) => string;
  editLabelFor: (index: number, count: number) => string;
  onOpen: (photo: BusinessPhoto, index: number, count: number) => void;
};

// Photos stay in upload order (reordering photos is out of scope).
function PhotoGrid({ photos, urlFor, onExpired, nameFor, editLabelFor, onOpen }: PhotoGridProps) {
  const { space } = useTheme();
  if (photos.length === 0) return null;
  return (
    <View style={[styles.grid, { gap: space.sm }]}>
      {photos.map((photo, i) => (
        <PhotoTile
          key={photo.id}
          path={photo.path}
          uri={urlFor(photo.path)}
          accessibilityLabel={nameFor(i + 1, photos.length)}
          editLabel={editLabelFor(i + 1, photos.length)}
          onPress={() => onOpen(photo, i + 1, photos.length)}
          onExpired={onExpired}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
});
