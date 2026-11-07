import Ionicons from '@expo/vector-icons/Ionicons';
import { useBottomSheetScrollableCreator } from '@gorhom/bottom-sheet';
import { memo, useCallback, useMemo } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { Text } from '@/components/ui';
import type { Cuisine } from '@/features/cuisines/schema';
import { CuisineGlyph } from '@/features/cuisines/components/CuisineLabel';
import { useTheme } from '@/theme/useTheme';

import type { Pin } from '../schema';

import { markerLabel } from './FlagMarker';

type PlacesListProps = {
  pins: readonly Pin[];
  cuisineByCode: ReadonlyMap<string, Cuisine>;
  onSelect: (pin: Pin) => void;
  /** Padding and gap of the scrolling content (the sheet works out the bottom space). */
  contentContainerStyle: StyleProp<ViewStyle>;
  /** Shown when there are no pins. Defaults to the restaurants wording. */
  emptyText?: string;
};

export const PLACES_TITLE = 'Places in this area';
export const NO_PLACES_MESSAGE = 'No restaurants shown here. Zoom in or move the map.';

type RowProps = {
  pin: Pin;
  cuisine: Cuisine | undefined;
  onSelect: (pin: Pin) => void;
};

const PlacesRow = memo(function PlacesRow({ pin, cuisine, onSelect }: RowProps) {
  const { colors, space, size, radius } = useTheme();
  return (
    <Pressable
      onPress={() => onSelect(pin)}
      accessibilityRole="button"
      accessibilityLabel={markerLabel(pin.name, cuisine)}
      style={[
        styles.row,
        {
          minHeight: size.touch,
          gap: space.md,
          paddingVertical: space.sm,
          paddingHorizontal: space.md,
          borderRadius: radius.md,
          borderColor: colors.border,
        },
      ]}
    >
      <CuisineGlyph cuisine={cuisine} size={size.tabIcon} />
      <View style={styles.text}>
        <Text numberOfLines={3}>{pin.name}</Text>
        {cuisine ? (
          <Text variant="caption" color="textMuted">
            {cuisine.name}
          </Text>
        ) : null}
      </View>
      <Ionicons name="chevron-forward" size={size.tabIcon} color={colors.textMuted} />
    </Pressable>
  );
});

// Rendering window. The sheet is as tall as its highest snap (so the list's viewport is taller than
// what is on screen at half); a small window keeps a 500-pin list from mounting hundreds of rows.
const INITIAL_ROWS = 12;
const WINDOW_SIZE = 5;

// The map alternative for screen-reader users: every pin currently loaded, as plain rows. It is
// the sheet's scroller in list mode, and a virtualised list because up to 500 pins can be loaded.
//
// It is a plain FlatList whose scroll component is the library's own BottomSheetScrollView (the
// one the details use), via useBottomSheetScrollableCreator. The library's BottomSheetFlatList
// wraps the whole FlatList in an animated component and a gesture detector instead, and in the
// simulator that list did not scroll at the half snap while the details did.
export function PlacesList({
  pins,
  cuisineByCode,
  onSelect,
  contentContainerStyle,
  emptyText = NO_PLACES_MESSAGE,
}: PlacesListProps) {
  const sorted = useMemo(() => [...pins].sort((a, b) => a.name.localeCompare(b.name)), [pins]);
  const ScrollComponent = useBottomSheetScrollableCreator();
  const renderItem = useCallback(
    ({ item }: { item: Pin }) => (
      <PlacesRow pin={item} cuisine={cuisineByCode.get(item.cuisine_code)} onSelect={onSelect} />
    ),
    [cuisineByCode, onSelect],
  );

  return (
    <FlatList
      testID="sheet-scroll"
      renderScrollComponent={ScrollComponent}
      initialNumToRender={INITIAL_ROWS}
      windowSize={WINDOW_SIZE}
      data={sorted}
      keyExtractor={keyOf}
      renderItem={renderItem}
      contentContainerStyle={contentContainerStyle}
      ListEmptyComponent={<Text color="textMuted">{emptyText}</Text>}
    />
  );
}

function keyOf(pin: Pin): string {
  return pin.id;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', borderWidth: StyleSheet.hairlineWidth },
  text: { flex: 1 },
});
