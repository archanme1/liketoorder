import BottomSheet, {
  BottomSheetScrollView,
  useBottomSheetTimingConfigs,
} from '@gorhom/bottom-sheet';
import Ionicons from '@expo/vector-icons/Ionicons';
import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentRef,
  type ComponentType,
} from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';

import { Text } from '@/components/ui';
import { CuisineLabel } from '@/features/cuisines/components/CuisineLabel';
import type { Cuisine } from '@/features/cuisines/schema';
import { useTheme } from '@/theme/useTheme';

import { useReduceMotion } from '@/lib/useReduceMotion';
import type { Pin } from '../schema';

import { PlacesList, PLACES_TITLE } from './PlacesList';
import { SheetDetails } from './SheetDetails';

type RestaurantSheetProps = {
  /** The restaurant whose details are open, or null. */
  selected: Pin | null;
  /** The "Places in this area" list is open (used when nothing is selected). */
  listOpen: boolean;
  pins: readonly Pin[];
  cuisineByCode: ReadonlyMap<string, Cuisine>;
  onSelect: (pin: Pin) => void;
  /**
   * The open restaurant was picked from the list. The sheet then behaves like a stacked screen:
   * swiping it down past the lowest snap, or tapping the X, goes back to the list.
   */
  fromList: boolean;
  onBackToList: () => void;
  /** Closes everything (a flag tap, or the list itself). */
  onClose: () => void;
  /** Height of the area the sheet slides in (the map screen). 0 until it is measured. */
  containerHeight: number;
  /**
   * What differs between the tabs. All optional; the defaults are the Restaurants tab's, so the
   * Restaurants screen passes none of them.
   */
  DetailsBody?: ComponentType<SheetBodyProps>;
  detailsLabel?: string;
  placesTitle?: string;
  emptyText?: string;
};

/** What a sheet body (the details of one place) is given. */
export type SheetBodyProps = {
  id: string;
  /** Leaves this place: closes the sheet, or goes back to the list. */
  onClose: () => void;
  /** What that button is called ("Close", or "Back to list"). */
  closeLabel?: string;
};

// Index 0 = collapsed, 1 = half, 2 = full.
export const HALF_INDEX = 1;
export const BACK_TO_LIST = 'Back to list';
export const CLOSE_LABEL = 'Close';
export const COLLAPSED_FRACTION = 0.15;

// Only the sheet's big title is capped. At the largest system text size an uncapped 20 pt title
// is over 60 pt tall (and may wrap to three lines), so a single list row would fit beside it.
// 1.6 keeps it clearly bigger than the body text's smallest size while leaving room for the
// rows; the rows, prices, addresses and everything else keep scaling fully.
export const SHEET_TITLE_MAX_FONT_MULTIPLIER = 1.6;
export const HALF_FRACTION = 0.5;
export const FULL_FRACTION = 0.92;

// Fixed-height rows need room: at large text sizes the collapsed snap grows so the name and
// flag are still visible.
export function collapsedSnap(containerHeight: number, fontScale: number, touch: number): number {
  const wanted = touch * 2 * Math.max(1, fontScale);
  return Math.round(
    Math.min(
      containerHeight * HALF_FRACTION,
      Math.max(containerHeight * COLLAPSED_FRACTION, wanted),
    ),
  );
}

/** The three snap heights in points: collapsed, half, full. */
export function snapHeights(containerHeight: number, fontScale: number, touch: number): number[] {
  return [
    collapsedSnap(containerHeight, fontScale, touch),
    Math.round(containerHeight * HALF_FRACTION),
    Math.round(containerHeight * FULL_FRACTION),
  ];
}

/**
 * Space under the scrolling content so its last row can be scrolled into view at every snap.
 *
 * The library makes the sheet as tall as its HIGHEST snap and slides it up from below, so at a
 * lower snap the bottom of the sheet (and of the scroll view) is off screen. Without this, the
 * end of the content could never be scrolled above the bottom edge of the screen area.
 */
export function scrollBottomSpace(snaps: readonly number[], index: number, gap: number): number {
  const highest = Math.max(...snaps);
  const visible = snaps[Math.min(Math.max(index, 0), snaps.length - 1)];
  return Math.max(0, highest - visible) + gap;
}

export const RestaurantSheet = memo(function RestaurantSheet({
  selected,
  listOpen,
  pins,
  cuisineByCode,
  onSelect,
  fromList,
  onBackToList,
  onClose,
  containerHeight,
  DetailsBody = SheetDetails,
  detailsLabel = 'Restaurant details',
  placesTitle = PLACES_TITLE,
  emptyText,
}: RestaurantSheetProps) {
  const { colors, space, radius, size } = useTheme();
  const { height: windowHeight, fontScale } = useWindowDimensions();
  const height = containerHeight > 0 ? containerHeight : windowHeight;
  const reduceMotion = useReduceMotion();
  const sheetRef = useRef<BottomSheet>(null);
  const titleRef = useRef<ComponentRef<typeof View>>(null);
  const [index, setIndex] = useState(-1);
  // Set when a swipe down already took us back to the list, so the "closed" report that can
  // follow the same swipe is not mistaken for a request to close everything.
  const wentBack = useRef(false);
  // Where the sheet is heading (or rests): it opens at half, so that is the starting guess.
  const [snapIndex, setSnapIndex] = useState(HALF_INDEX);

  const open = selected !== null || listOpen;
  const selectedId = selected?.id ?? null;
  const snaps = useMemo(
    () => snapHeights(height, fontScale, size.touch),
    [height, fontScale, size.touch],
  );
  const snapPoints = useMemo(() => [snaps[0], '50%', '92%'], [snaps]);
  // Reduce motion: the sheet jumps instead of gliding.
  const animationConfigs = useBottomSheetTimingConfigs({ duration: reduceMotion ? 1 : 250 });

  // Tapping a flag (or a list row) opens the sheet at half; clearing the selection closes it.
  useEffect(() => {
    if (open) sheetRef.current?.snapToIndex(HALF_INDEX);
    else sheetRef.current?.close();
  }, [open, selectedId, listOpen]);

  // A screen reader lands on the title when the sheet opens.
  useEffect(() => {
    if (!open) return;
    if (titleRef.current) AccessibilityInfo.sendAccessibilityEvent(titleRef.current, 'focus');
  }, [open, selectedId, listOpen]);

  // Nothing is mounted while the sheet is closed, so a screen reader never lands on hidden rows.
  // It stays mounted while the sheet is still sliding out (index is -1 only once it has closed).
  const showContent = open || index >= 0;
  const detailsMode = selected !== null;
  // Stacked screens: a restaurant opened from the list goes back to it; anything else closes.
  const backMode = detailsMode && fromList;
  const dismiss = backMode ? onBackToList : onClose;
  const dismissLabel = backMode ? BACK_TO_LIST : CLOSE_LABEL;
  const contentStyle = {
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
    paddingBottom: scrollBottomSpace(snaps, snapIndex, space.xxl),
    gap: space.lg,
  };
  const title = detailsMode ? selected.name : placesTitle;

  return (
    <BottomSheet
      ref={sheetRef}
      index={-1}
      snapPoints={snapPoints}
      enableDynamicSizing={false}
      enablePanDownToClose
      animationConfigs={animationConfigs}
      onChange={(next) => {
        setIndex(next);
        if (next >= 0) setSnapIndex(next);
      }}
      onAnimate={(_from, to) => {
        if (to >= 0) {
          wentBack.current = false;
          setSnapIndex(to);
        } else if (backMode) {
          // Swiped down past the lowest snap: go back to the list at once, so it is shown again
          // instead of the sheet closing and having to reopen.
          wentBack.current = true;
          onBackToList();
        }
      }}
      onClose={() => {
        if (wentBack.current) {
          wentBack.current = false;
          return;
        }
        dismiss();
      }}
      backgroundStyle={{ backgroundColor: colors.surface }}
      handleIndicatorStyle={{ backgroundColor: colors.border }}
    >
      {showContent ? (
        <View
          style={styles.flex}
          // While the sheet is up (half or full) a screen reader stays inside it.
          accessibilityViewIsModal={index >= HALF_INDEX}
          accessibilityLabel={detailsMode ? detailsLabel : placesTitle}
        >
          <View style={[styles.header, { gap: space.md, paddingHorizontal: space.lg }]}>
            <View style={[styles.flex, { gap: space.xs }]}>
              <View ref={titleRef} accessible accessibilityRole="header" testID="sheet-title">
                <Text
                  variant="title"
                  numberOfLines={3}
                  maxFontSizeMultiplier={SHEET_TITLE_MAX_FONT_MULTIPLIER}
                >
                  {title}
                </Text>
              </View>
              {detailsMode ? (
                <CuisineLabel
                  code={selected.cuisine_code}
                  cuisine={cuisineByCode.get(selected.cuisine_code)}
                />
              ) : null}
            </View>
            <Pressable
              onPress={dismiss}
              accessibilityRole="button"
              accessibilityLabel={dismissLabel}
              style={[
                styles.close,
                { width: size.touch, height: size.touch, borderRadius: radius.pill },
              ]}
            >
              <Ionicons name="close" size={size.tabIcon} color={colors.text} />
            </Pressable>
          </View>
          {selected ? (
            <BottomSheetScrollView testID="sheet-scroll" contentContainerStyle={contentStyle}>
              <DetailsBody
                key={selected.id}
                id={selected.id}
                onClose={dismiss}
                closeLabel={dismissLabel}
              />
            </BottomSheetScrollView>
          ) : (
            <PlacesList
              pins={pins}
              cuisineByCode={cuisineByCode}
              onSelect={onSelect}
              contentContainerStyle={{ ...contentStyle, gap: space.xs }}
              emptyText={emptyText}
            />
          )}
        </View>
      ) : null}
    </BottomSheet>
  );
});

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'flex-start' },
  close: { alignItems: 'center', justifyContent: 'center' },
});
