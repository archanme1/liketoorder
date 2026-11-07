import BottomSheet, {
  BottomSheetScrollView,
  useBottomSheetTimingConfigs,
} from '@gorhom/bottom-sheet';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';

import { Text } from '@/components/ui';
import { CuisineLabel } from '@/features/cuisines/components/CuisineLabel';
import type { Cuisine } from '@/features/cuisines/schema';
import { useTheme } from '@/theme/useTheme';

import { useReduceMotion } from '../hooks/useReduceMotion';
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
  /** The open restaurant was picked from the list: offer a way back to it. */
  showBackToList: boolean;
  onBackToList: () => void;
  onClose: () => void;
};

// Index 0 = collapsed, 1 = half, 2 = full.
export const HALF_INDEX = 1;
export const BACK_TO_LIST = 'Back to list';
export const COLLAPSED_FRACTION = 0.15;

// Fixed-height rows need room: at large text sizes the collapsed snap grows so the name and
// flag are still visible.
export function collapsedSnap(windowHeight: number, fontScale: number, touch: number): number {
  const wanted = touch * 2 * Math.max(1, fontScale);
  return Math.round(
    Math.min(windowHeight * 0.5, Math.max(windowHeight * COLLAPSED_FRACTION, wanted)),
  );
}

export function RestaurantSheet({
  selected,
  listOpen,
  pins,
  cuisineByCode,
  onSelect,
  showBackToList,
  onBackToList,
  onClose,
}: RestaurantSheetProps) {
  const { colors, space, radius, size } = useTheme();
  const { height, fontScale } = useWindowDimensions();
  const reduceMotion = useReduceMotion();
  const sheetRef = useRef<BottomSheet>(null);
  const titleRef = useRef<ComponentRef<typeof View>>(null);
  const [index, setIndex] = useState(-1);

  const open = selected !== null || listOpen;
  const selectedId = selected?.id ?? null;
  const snapPoints = useMemo(
    () => [collapsedSnap(height, fontScale, size.touch), '50%', '92%'],
    [height, fontScale, size.touch],
  );
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
  const title = detailsMode ? selected.name : PLACES_TITLE;

  return (
    <BottomSheet
      ref={sheetRef}
      index={-1}
      snapPoints={snapPoints}
      enableDynamicSizing={false}
      enablePanDownToClose
      animationConfigs={animationConfigs}
      onChange={setIndex}
      onClose={onClose}
      backgroundStyle={{ backgroundColor: colors.surface }}
      handleIndicatorStyle={{ backgroundColor: colors.border }}
    >
      {showContent ? (
        <View
          style={styles.flex}
          // While the sheet is up (half or full) a screen reader stays inside it.
          accessibilityViewIsModal={index >= HALF_INDEX}
          accessibilityLabel={detailsMode ? 'Restaurant details' : PLACES_TITLE}
        >
          <View style={[styles.header, { gap: space.md, paddingHorizontal: space.lg }]}>
            <View style={[styles.flex, { gap: space.xs }]}>
              <View ref={titleRef} accessible accessibilityRole="header" testID="sheet-title">
                <Text variant="title" numberOfLines={3}>
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
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close"
              style={[
                styles.close,
                { width: size.touch, height: size.touch, borderRadius: radius.pill },
              ]}
            >
              <Ionicons name="close" size={size.tabIcon} color={colors.text} />
            </Pressable>
          </View>
          <BottomSheetScrollView
            contentContainerStyle={{
              padding: space.lg,
              paddingBottom: space.xxl * 2,
              gap: space.lg,
            }}
          >
            {selected && showBackToList ? (
              <Pressable
                onPress={onBackToList}
                accessibilityRole="button"
                accessibilityLabel={BACK_TO_LIST}
                style={[styles.back, { minHeight: size.touch, gap: space.xs }]}
              >
                <Ionicons name="chevron-back" size={size.tabIcon} color={colors.primary} />
                <Text color="primary">{BACK_TO_LIST}</Text>
              </Pressable>
            ) : null}
            {selected ? (
              <SheetDetails key={selected.id} id={selected.id} onClose={onClose} />
            ) : (
              <PlacesList pins={pins} cuisineByCode={cuisineByCode} onSelect={onSelect} />
            )}
          </BottomSheetScrollView>
        </View>
      ) : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'flex-start' },
  close: { alignItems: 'center', justifyContent: 'center' },
  back: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start' },
});
