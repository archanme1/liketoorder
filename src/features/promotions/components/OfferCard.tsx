import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui';
import { CuisineGlyph } from '@/features/cuisines/components/CuisineLabel';
import type { Cuisine } from '@/features/cuisines/schema';
import { sponsoredLabel } from '@/features/map/components/AdBadge';
import { PhotoTile } from '@/features/media/components/PhotoTile';
import { useTheme } from '@/theme/useTheme';

import { CATEGORY_LABELS, OFFER_CARD_HINT, OFFER_TYPE_LABELS } from '../messages';
import type { Offer } from '../schema';

import { SponsoredLabel } from './SponsoredLabel';

/**
 * What a screen reader hears, in the order the card shows it:
 * "Simcoe Street Pho, Vietnam cuisine, restaurant. Special offer: Two bowls of pho for the price
 * of one. About 4 km away, sponsored". Always ends with ", sponsored" (spec 16 M3).
 */
export function offerCardLabel(
  offer: Offer,
  cuisine: Cuisine | undefined,
  distance: string | null,
) {
  const who = cuisine ? `${offer.name}, ${cuisine.name} cuisine` : offer.name;
  const kind = OFFER_TYPE_LABELS[offer.type].toLowerCase();
  const what = `${CATEGORY_LABELS[offer.category]}: ${offer.headline}`;
  return sponsoredLabel(
    distance ? `${who}, ${kind}. ${what}. ${distance}` : `${who}, ${kind}. ${what}`,
  );
}

type OfferCardProps = {
  offer: Offer;
  cuisine: Cuisine | undefined;
  /** "About 4 km away" (distance.ts), or null when it can't be worked out. */
  distance: string | null;
  /** The cover's signed URL: undefined while loading, null when there is none. */
  coverUri: string | null | undefined;
  onCoverExpired: (path: string) => void;
  onOpen: (offer: Offer) => void;
};

// One promoted place in Offers. The whole card is one button with one spoken label; the parts
// inside are hidden from screen readers so the card is heard once. "Sponsored" is written on the
// card and is the last word of the label.
function OfferCardBase({
  offer,
  cuisine,
  distance,
  coverUri,
  onCoverExpired,
  onOpen,
}: OfferCardProps) {
  const { colors, space, radius, size, type, weight, opacity } = useTheme();
  const label = offerCardLabel(offer, cuisine, distance);
  return (
    <Pressable
      onPress={() => onOpen(offer)}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={OFFER_CARD_HINT}
      style={({ pressed }) => [
        styles.card,
        {
          minHeight: size.touch,
          gap: space.md,
          padding: space.md,
          borderRadius: radius.md,
          borderColor: colors.border,
          backgroundColor: colors.surface,
          opacity: pressed ? opacity.pressed : 1,
        },
      ]}
    >
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[styles.row, { gap: space.md }]}
      >
        {offer.cover ? (
          <PhotoTile
            path={offer.cover.path}
            uri={coverUri}
            accessibilityLabel={`Cover photo, ${offer.name}`}
            onExpired={onCoverExpired}
          />
        ) : (
          <View
            testID="offer-flag-tile"
            style={[
              styles.tile,
              {
                width: size.photoThumb,
                height: size.photoThumb,
                borderRadius: radius.sm,
                backgroundColor: colors.surfaceAlt,
              },
            ]}
          >
            <CuisineGlyph cuisine={cuisine} size={type.h1} />
          </View>
        )}
        <View style={[styles.text, { gap: space.xs }]}>
          <Text variant="bodyLg" style={{ fontWeight: weight.semibold }}>
            {offer.name}
          </Text>
          <View style={[styles.row, { gap: space.xs }]}>
            <CuisineGlyph cuisine={cuisine} size={type.body} />
            <Text color="textMuted">{cuisine?.name ?? ''}</Text>
          </View>
          <Text>
            <Text
              style={{ fontWeight: weight.semibold }}
            >{`${CATEGORY_LABELS[offer.category]}: `}</Text>
            {offer.headline}
          </Text>
          {distance ? <Text color="textMuted">{distance}</Text> : null}
          <Text color="textMuted">{OFFER_TYPE_LABELS[offer.type]}</Text>
          <SponsoredLabel />
        </View>
      </View>
    </Pressable>
  );
}

export const OfferCard = memo(OfferCardBase);

const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: 'row', alignItems: 'center' },
  tile: { alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1 },
});
