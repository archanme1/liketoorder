import { useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui';
import { PhotoOpenTarget } from '@/features/media/components/PhotoOpenTarget';
import { PhotoTile } from '@/features/media/components/PhotoTile';
import { PhotoViewer } from '@/features/media/components/PhotoViewer';
import { usePhotoViewer } from '@/features/media/hooks/usePhotoViewer';
import { photoNames } from '@/features/menu/photos';
import { formatPrice } from '@/features/menu/price';
import { useTheme } from '@/theme/useTheme';

import type { DetailsItem, DetailsPhoto } from '../schema';

export type SheetCurrency = { code: string; minorUnits: number };

type SheetMenuProps = {
  name: string;
  items: readonly DetailsItem[];
  menuPhotos: readonly DetailsPhoto[];
  /** Photos of single items, by item id. */
  itemPhotos: ReadonlyMap<string, DetailsPhoto>;
  /** The business's own currency, or null when unknown (prices are then hidden, never guessed). */
  currency: SheetCurrency | null;
  locale: string;
  urlFor: (path: string) => string | null | undefined;
  onExpired: (path: string) => void;
};

export const AVAILABLE = 'Available';
export const SOLD_OUT = 'Sold out';
export const NO_PRICE = 'Price not listed';

export function menuPageLabel(name: string, index: number, count: number): string {
  return `${name}, menu page ${index} of ${count}`;
}

/** The price in the business's own currency; null when there is nothing safe to show. */
export function itemPrice(
  item: Pick<DetailsItem, 'price_minor'>,
  currency: SheetCurrency | null,
  locale: string,
): string | null {
  if (item.price_minor === null || !currency) return null;
  return formatPrice(item.price_minor, currency.code, currency.minorUnits, locale);
}

export function SheetMenu({
  name,
  items,
  menuPhotos,
  itemPhotos,
  currency,
  locale,
  urlFor,
  onExpired,
}: SheetMenuProps) {
  const { colors, space, radius, size, weight } = useTheme();
  const viewer = usePhotoViewer();
  const viewerPhotos = useMemo(
    () =>
      menuPhotos.map((photo, index) => ({
        path: photo.path,
        label: menuPageLabel(name, index + 1, menuPhotos.length),
      })),
    [menuPhotos, name],
  );

  if (items.length === 0 && menuPhotos.length === 0) {
    return (
      <View style={{ gap: space.sm }}>
        <Text variant="bodyLg" accessibilityRole="header">
          Menu
        </Text>
        <Text color="textMuted">No menu yet.</Text>
      </View>
    );
  }

  return (
    <View style={{ gap: space.md }}>
      <Text variant="bodyLg" accessibilityRole="header">
        Menu
      </Text>

      {menuPhotos.length > 0 ? (
        <ScrollView
          horizontal
          nestedScrollEnabled
          testID="menu-pages"
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: space.sm }}
        >
          {menuPhotos.map((photo, index) => (
            <PhotoOpenTarget
              key={photo.id}
              accessibilityLabel={`${menuPageLabel(name, index + 1, menuPhotos.length)}. Opens photo viewer.`}
              onPress={() => viewer.open(index)}
            >
              <PhotoTile
                path={photo.path}
                uri={urlFor(photo.path)}
                size={size.photoThumb}
                accessibilityLabel={menuPageLabel(name, index + 1, menuPhotos.length)}
                onExpired={onExpired}
              />
            </PhotoOpenTarget>
          ))}
        </ScrollView>
      ) : null}
      <PhotoViewer
        visible={viewer.visible}
        photos={viewerPhotos}
        index={viewer.index}
        onIndexChange={viewer.setIndex}
        onClose={viewer.close}
        urlFor={urlFor}
        onExpired={onExpired}
      />

      {items.map((item) => {
        const price = itemPrice(item, currency, locale);
        const photo = itemPhotos.get(item.id);
        const availability = item.is_available ? AVAILABLE : SOLD_OUT;
        const priceText = item.price_minor === null ? NO_PRICE : price;
        // One spoken line per item: name, price, availability, then the description.
        const spoken = [item.name, priceText, availability, item.description]
          .filter((part): part is string => Boolean(part))
          .join(', ');
        return (
          <View
            key={item.id}
            accessible
            accessibilityLabel={spoken}
            style={[
              styles.row,
              {
                gap: space.md,
                padding: space.md,
                borderRadius: radius.md,
                borderColor: colors.border,
              },
            ]}
          >
            <View style={[styles.text, { gap: space.xs }]}>
              <Text style={{ fontWeight: weight.semibold }} numberOfLines={3}>
                {item.name}
              </Text>
              {item.description ? <Text color="textMuted">{item.description}</Text> : null}
              <Text color={item.is_available ? 'text' : 'textMuted'}>
                {[priceText, availability].filter(Boolean).join(' · ')}
              </Text>
            </View>
            {photo ? (
              <PhotoTile
                path={photo.path}
                uri={urlFor(photo.path)}
                size={size.avatarMd}
                accessibilityLabel={photoNames.item(item.name)}
                onExpired={onExpired}
              />
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', borderWidth: StyleSheet.hairlineWidth },
  text: { flex: 1 },
});
