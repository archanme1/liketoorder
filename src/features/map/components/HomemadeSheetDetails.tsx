import { useCallback, useMemo } from 'react';
import { View } from 'react-native';

import { Button, Skeleton, Text } from '@/components/ui';
import { useSignedUrls } from '@/features/media/hooks/useSignedUrls';
import { deviceLocale, useCurrencies } from '@/features/menu/hooks/useCurrencies';
import { MEDIA_BUCKET } from '@/features/menu/photos';
import { useTheme } from '@/theme/useTheme';

import { useHomemadeDetails } from '../hooks/useHomemadeDetails';
import { HOMEMADE_AREA_NOTE, HOMEMADE_NOT_AVAILABLE_MESSAGE } from '../homemadeText';
import { mapErrorMessage, RATE_LIMITED_MESSAGE } from '../messages';
import type { DetailsPhoto, HomemadeDetails } from '../schema';

import { HomemadeDisclaimer } from './HomemadeDisclaimer';
import type { SheetBodyProps } from './RestaurantSheet';
import { SheetMenu } from './SheetMenu';
import { useCoverAndGallery } from './SheetPhotos';

// The body of the sheet for one home cook: loading, not available, error with Retry, or (menu
// first, spec 08 Decision 15) the cover banner, the small food-safety row, menu pages, menu items,
// gallery, and at the very bottom the "approximate area" note. On purpose there is no address,
// no Directions and no Request or Report buttons (those arrive in specs 09, 11 and 17).
export function HomemadeSheetDetails({ id, onClose, closeLabel = 'Close' }: SheetBodyProps) {
  const { space, size, type } = useTheme();
  const details = useHomemadeDetails(id);

  if (details.isPending) {
    return (
      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel="Loading homemade cook"
        style={{ gap: space.md }}
      >
        <Skeleton height={size.photoThumb} rounded="md" />
        <Skeleton height={type.bodyLg} />
        <Skeleton height={type.bodyLg} />
        <Skeleton height={type.bodyLg} />
      </View>
    );
  }

  if (details.isError) {
    const rateLimited = details.error.code === 'rate_limited';
    return (
      <View style={{ gap: space.md }}>
        <Text accessibilityRole={rateLimited ? undefined : 'alert'}>
          {rateLimited
            ? RATE_LIMITED_MESSAGE
            : mapErrorMessage(details.error.code, 'homemade cooks')}
        </Text>
        <Button
          title={rateLimited ? 'Try again' : 'Retry'}
          onPress={() => void details.refetch()}
          loading={details.isFetching}
        />
      </View>
    );
  }

  if (details.data === null) {
    return (
      <View style={{ gap: space.md }}>
        <Text accessibilityRole="alert">{HOMEMADE_NOT_AVAILABLE_MESSAGE}</Text>
        <Button title={closeLabel} onPress={onClose} variant="secondary" />
      </View>
    );
  }

  return <DetailsBody details={details.data} />;
}

function DetailsBody({ details }: { details: HomemadeDetails }) {
  const { space } = useTheme();

  const paths = useMemo(() => details.photos.map((photo) => photo.path), [details.photos]);
  const { urlFor, renew } = useSignedUrls(MEDIA_BUCKET, paths);
  const onExpired = useCallback(
    (path: string) => {
      renew(path);
    },
    [renew],
  );

  const sections = useMemo(() => {
    let cover: DetailsPhoto | undefined;
    const gallery: DetailsPhoto[] = [];
    const menuPhotos: DetailsPhoto[] = [];
    const itemPhotos = new Map<string, DetailsPhoto>();
    for (const photo of details.photos) {
      if (photo.kind === 'cover') cover ??= photo;
      else if (photo.kind === 'gallery') gallery.push(photo);
      else if (photo.kind === 'menu') menuPhotos.push(photo);
      else if (photo.menu_item_id && !itemPhotos.has(photo.menu_item_id)) {
        itemPhotos.set(photo.menu_item_id, photo);
      }
    }
    return { cover, gallery, menuPhotos, itemPhotos };
  }, [details.photos]);

  const photos = useCoverAndGallery({
    name: details.name,
    cover: sections.cover,
    gallery: sections.gallery,
    urlFor,
    onExpired,
  });

  // Prices use the cook's own currency; an unknown code hides prices rather than guessing.
  const currencies = useCurrencies();
  const currency = useMemo(() => {
    const found = currencies.data?.find((entry) => entry.code === details.currency_code);
    return found ? { code: found.code, minorUnits: found.minor_units } : null;
  }, [currencies.data, details.currency_code]);

  return (
    <View style={{ gap: space.lg }}>
      {photos.banner}
      <HomemadeDisclaimer />
      <SheetMenu
        name={details.name}
        items={details.items}
        menuPhotos={sections.menuPhotos}
        itemPhotos={sections.itemPhotos}
        currency={currency}
        locale={deviceLocale()}
        urlFor={urlFor}
        onExpired={onExpired}
      />
      {photos.gallerySection}
      <View style={{ gap: space.xs }}>
        <Text variant="bodyLg" accessibilityRole="header">
          Where
        </Text>
        <Text>{HOMEMADE_AREA_NOTE}</Text>
      </View>
      {photos.viewer}
    </View>
  );
}
