import { useCallback, useMemo, useState } from 'react';
import { Linking, View } from 'react-native';

import { Button, Skeleton, Text } from '@/components/ui';
import { useSignedUrls } from '@/features/media/hooks/useSignedUrls';
import { deviceLocale, useCurrencies } from '@/features/menu/hooks/useCurrencies';
import { MEDIA_BUCKET } from '@/features/menu/photos';
import { useTheme } from '@/theme/useTheme';

import { buildDirectionsUrl, directionsLabel } from '../directions';
import { useRestaurantDetails } from '../hooks/useRestaurantDetails';
import { mapErrorMessage, RATE_LIMITED_MESSAGE } from '../messages';
import type { DetailsPhoto, RestaurantDetails } from '../schema';

import { RequestPickupButton } from './RequestPickupButton';
import { SheetMenu } from './SheetMenu';
import { useCoverAndGallery } from './SheetPhotos';

export const NOT_AVAILABLE_MESSAGE = "This restaurant isn't available right now.";

type SheetDetailsProps = {
  id: string;
  /** Leaves this restaurant: closes the sheet, or goes back to the list. */
  onClose: () => void;
  /** What that button is called ("Close", or "Back to list"). */
  closeLabel?: string;
};

// The body of the sheet for one restaurant: loading, not available, error with Retry, or (menu
// first, spec 08 Decision 15) the cover banner, menu pages, menu items, gallery, and at the very
// bottom the address and Directions. The Request pickup button sits right after the menu items
// (spec 09); there is no Report button yet.
export function SheetDetails({ id, onClose, closeLabel = 'Close' }: SheetDetailsProps) {
  const { space, size, type } = useTheme();
  const details = useRestaurantDetails(id);

  if (details.isPending) {
    return (
      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel="Loading restaurant"
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
          {rateLimited ? RATE_LIMITED_MESSAGE : mapErrorMessage(details.error.code)}
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
        <Text accessibilityRole="alert">{NOT_AVAILABLE_MESSAGE}</Text>
        <Button title={closeLabel} onPress={onClose} variant="secondary" />
      </View>
    );
  }

  return <DetailsBody details={details.data} />;
}

function DetailsBody({ details }: { details: RestaurantDetails }) {
  const { space } = useTheme();
  const [openFailed, setOpenFailed] = useState(false);

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

  // Prices use the business's own currency and the currencies table's decimals. If the code is
  // unknown to the app (or the list is still loading) prices are hidden, not guessed.
  const currencies = useCurrencies();
  const currency = useMemo(() => {
    const found = currencies.data?.find((entry) => entry.code === details.currency_code);
    return found ? { code: found.code, minorUnits: found.minor_units } : null;
  }, [currencies.data, details.currency_code]);

  const openDirections = useCallback(() => {
    setOpenFailed(false);
    // Google Maps only: never an Apple Maps link, never coordinates.
    Linking.openURL(buildDirectionsUrl(details.name, details.place_id)).catch(() =>
      setOpenFailed(true),
    );
  }, [details.name, details.place_id]);

  return (
    <View style={{ gap: space.lg }}>
      {photos.banner}
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
      <RequestPickupButton businessId={details.id} name={details.name} />
      {photos.gallerySection}
      <View style={{ gap: space.xs }}>
        <Text variant="bodyLg" accessibilityRole="header">
          Address
        </Text>
        <Text>{details.public_address ?? 'Address not listed'}</Text>
      </View>
      <View style={{ gap: space.sm }}>
        <Button
          title="Directions"
          accessibilityLabel={directionsLabel(details.name)}
          onPress={openDirections}
        />
        {openFailed ? <Text accessibilityRole="alert">{"Couldn't open Google Maps."}</Text> : null}
      </View>
      {photos.viewer}
    </View>
  );
}
