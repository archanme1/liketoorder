---
name: map-markers
description: How LikeToOrder renders map markers — country-flag markers, clustering with supercluster, promoted (ad) markers with the subtle rise-and-fall animation, reduce-motion, Ad badge, bottom sheet hand-off, and homemade approximate locations. Use whenever working on the Restaurants or Homemade map, markers, clustering, promotions display, or map performance.
---

# LikeToOrder — map markers

Product rules live in `docs/product/v1.md` §6–7. This skill is the *how*.

## Libraries
- `react-native-maps` (Apple Maps iOS / Google Maps Android) — not supported on web.
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
