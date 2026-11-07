---
name: map-markers
description: How LikeToOrder renders map markers — country-flag markers, clustering with supercluster, promoted (ad) markers with the subtle rise-and-fall animation, reduce-motion, Ad badge, bottom sheet hand-off, and homemade approximate locations. Use whenever working on the Restaurants or Homemade map, markers, clustering, promotions display, or map performance.
---

# LikeToOrder — map markers

Product rules live in `docs/product/v1.md` §6–7. This skill is the *how*.

## Libraries
- `react-native-maps` with `PROVIDER_GOOGLE` on **both** iOS and Android (Places content must be shown on a Google map; never Apple Maps). Needs a development build, not Expo Go. Not supported on web. With no Maps key the screen shows "Map isn't configured" and never mounts the map.
- `supercluster` for clustering (pure JS, run in a `useMemo` keyed on data + region zoom).
- `react-native-reanimated` for animation. `@gorhom/bottom-sheet` for the sheet.

## Marker types
| Type | Look | Size |
|---|---|---|
| Organic | Country flag in a rounded pill with soft shadow | 32×24 flag, 40pt hit area |
| Neutral | Cuisine icon in same pill (no country fits) | same |
| Cluster | Circle with count; may show up to 3 mini flags | 36–48 by count |
| Promoted | Same flag pill + small "Ad" badge + highlight ring, rises and falls | same size as organic (never bigger) |

## Clustering + promoted markers
- Feed **only organic** sellers into supercluster.
- Render promoted sellers **separately, never clustered**, with higher `zIndex`, so when zoomed out they "pop out" of the cluster with their highlight.
- Zoomed in: organic markers render individually; promoted keep animating.
- Recompute clusters on `onRegionChangeComplete` (not on every frame).

## The rise-and-fall animation
```tsx
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withTiming,
  Easing, useReducedMotion } from 'react-native-reanimated';

const AMPLITUDE = 4;      // points — subtle
const DURATION = 1400;    // ms per half-cycle

export function useFloat() {
  const reduceMotion = useReducedMotion();
  const y = useSharedValue(0);
  useEffect(() => {
    if (reduceMotion) { y.value = 0; return; }
    y.value = withRepeat(
      withTiming(-AMPLITUDE, { duration: DURATION, easing: Easing.inOut(Easing.sin) }),
      -1, true,
    );
  }, [reduceMotion]);
  return useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
}
```
- Easing must be `inOut(sin)` — smooth, no bounce, no flashing, no scale pulsing.
- Reduce motion ON → no movement; the highlight ring alone marks it.
- Add a small random start delay per marker so several ads don't move in lockstep.

## Performance rules
- Organic markers: `tracksViewChanges={false}` after the flag image has loaded (set true → false on image `onLoad`). This stops Android re-rasterising every marker.
- Promoted markers need `tracksViewChanges={true}` to animate on Android. That's OK because they're few. If profiling shows jank, fall back to an overlay: an `Animated.View` positioned with `mapRef.pointForCoordinate` above the map.
- Memoize marker components (`React.memo`) and pass stable callbacks (`useCallback`).
- Flags: bundle local PNG/SVG assets keyed by ISO code (`assets/flags/ca.png`) — no network fetch per marker.
- Only render markers within the visible region (+ small padding).

## Tap → bottom sheet
- `onPress` on a marker sets `selectedSellerId` (Zustand or screen state) and snaps the sheet to the half position. Do not navigate away; keep the map region.
- Snap points: `['15%', '50%', '92%']`. Swipe down dismisses and clears selection.
- Selected marker gets a slightly darker ring (not bigger).
- Promoted seller: sheet shows a "Sponsored" label at the top.

## Accessibility
- Marker `accessibilityLabel`: "<Business name>, <Cuisine> cuisine" + ", sponsored" for ads.
- Cluster: "<n> places, double tap to zoom in".
- Provide a "List view" button on the map for screen-reader users.

## Homemade markers
- Always use the **public approximate coordinates** (`approx_lat`, `approx_lng`) — never the exact address table.
- Show a translucent circle (~300 m radius) instead of a pinpoint for homemade sellers when zoomed in close.

## Lessons from spec 07 (read before any map work)
Each one cost a fix after the spec 07 manual run. Source: `.claude/specs/07-restaurant-map.md` (Decisions 23–31, device-run notes).

**Taps and events**
- A marker press also fires the map's `onPress` on iOS (both are bubbling events), so a flag tap closed the sheet at once. Fix twice over: every marker type (flag, cluster, and any new one) sets `stopPropagation`, **and** the map's `onPress` ignores bubbled marker presses (`isMarkerPressEvent` in `src/features/map/mapEvents.ts`: `nativeEvent.action === 'marker-press'`).
- The jest map fake must bubble events like the real library, with a switch to ignore `stopPropagation` so the second layer can be tested alone. A fake that does not bubble hid this bug until the simulator.
- Picking a place from a list moves the camera (one short move that puts the pin in the free part of the map above the half-open sheet, never zooming out); tapping a flag on the map never moves the camera.

**Bottom sheet**
- Sheet content uses the library's own scroll component. Long lists are a plain virtualised `FlatList` that renders `BottomSheetScrollView` (`useBottomSheetScrollableCreator`), not `BottomSheetFlatList`, which did not scroll at the half snap.
- The library makes the sheet as tall as its highest snap, so at a lower snap the bottom of the scroll view is off screen. Give the content bottom space of (highest snap − current snap) + a gap (`scrollBottomSpace` in `RestaurantSheet.tsx`), and compute snap heights from the measured screen area, not the window. jest checks the arithmetic only; check the real layout in the simulator.
- A place opened from a list sits on top of it like a stacked screen: swipe-down past the lowest snap and the X both go back to the list (X labelled "Back to list"). From a flag, they just close. Tapping the bare map clears the stack.

**Large text**
- Cap only the big titles and the tab labels (`maxFontSizeMultiplier`: sheet titles 1.6, tab labels 1.3); body text, rows, prices and addresses keep scaling. The collapsed snap grows with font scale. Check at the largest iOS "Larger Accessibility Sizes".

**Map look**
- Hide Google's own business labels with `customMapStyle` and one rule, `poi.business` off (`src/features/map/mapStyle.ts`). Nothing else. Android may prefer cloud styling over the JSON; check on a device.
- Wait for the map to be ready (`onMapReady`) before moving the camera.
- Stable callbacks (`useCallback`) and memoised markers (`React.memo`), as in "Performance rules".

**Location and privacy**
- Exact position never leaves the phone. The request box is rounded outward to a coarse grid (`snapBox`, 0.05°), so the box's middle can never be the person's position. Permission texts and the pre-permission note must say exactly this ("We only receive the map area you're looking at"); changing the iOS string needs a rebuild.
- Re-read the location permission on "Locate me" and when the app returns from Settings (`AppState` change to `active`, in `useLocationPermission`).

**Setup and tests**
- The app needs the `expo-dev-client` development build (`npx expo run:ios`, run by Archan); Expo Go cannot run the map.
- Local demo seed data makes pgTAP tests that count rows fail until `npx supabase db reset`.
