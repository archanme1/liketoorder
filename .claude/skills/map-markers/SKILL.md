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
| Promoted, large (spec 16) | Pill about 1.3 times the flag pill (`size.promotedFlagWidth/Height`, 42 x 31) inside the ad ring (`colors.adRing`, `stroke.adRing`) + written "Ad" badge; pops in once, then rises and falls | box `size.promotedMarker` (64), so the float never clips |
| Promoted, ringed (spec 16) | Same size flag pill inside the ad ring + "Ad" badge; still | same as organic (never bigger) |

## Clustering + promoted markers (spec 16)
- `promotedLayout.ts` (pure) picks the **large** set for the settled region: at most `LARGE_PROMOTED_LIMIT` (8), never two closer than `PROMOTED_MIN_SPACING_PX` (60 points) on screen, ordered by the daily UTC rank (`dailyRankKey`), with the last region's set kept first so a pan never reshuffles it.
- Only the large ones are kept out of supercluster: `BusinessMapScreen` builds the index from the pins **minus the large ids** and draws the large ones on their own (`zIndex` 3, selected 4). `clustering.ts` knows nothing about promotions.
- Every other promoted place is a ringed normal-size flag (`FlagMarker promotion="ring"`, `zIndex` 3) and clusters like any pin. `promotionLook(pin, large)` gives `'none' | 'ring' | 'large'`.
- Zooming out shrinks the distances, so some large markers become ringed ones and join clusters; zooming in makes room and new ones pop in.
- The large set is kept in screen state and worked out again during render only when the settled region, the pins or the map's measured size change (the same pattern as `usePinsQuery`'s last good answer). Nothing is large until the map has been measured (`onLayout`).
- Recompute clusters on `onRegionChangeComplete` (not on every frame).

## Pop-in, then rise and fall (`usePromotedFloat`, spec 16)
- **Pop-in once:** scale from 0.8 to 1 in 220 ms, `Easing.out(Easing.cubic)`, no spring, no overshoot.
- **Then float:** `translateY` to -4 and back, 1400 ms each way, `Easing.inOut(Easing.sin)`, `withRepeat(..., -1, true)`, after the pop-in plus a random 0 to 1400 ms delay drawn once per marker, so ads never move in step.
- No repeating grow-and-shrink, no flashing, no pop-out.
- **Reduce Motion = no movement at all**: no pop-in and no float, the same larger marker with ring and badge, still. Read both Reanimated's `useReducedMotion()` (correct on the first frame) and our live `useReduceMotion()` (starts as false, then follows the setting). Turned on while floating: `cancelAnimation` and back to rest. Once seen, the marker stays still until it is drawn again, even if the setting is turned back off.
- The float moves the marker's picture on screen only, never its coordinate.

## Performance rules
- Organic markers: `tracksViewChanges` is true while a marker is new or its look just changed, and false `TRACK_VIEW_MS` (300 ms) later (`useTracksViewChanges`, keyed on the look), so a late icon font still lands. This stops Android re-rasterising every marker.
- Large promoted markers keep `tracksViewChanges` on while they move (`animating`) and for 300 ms after a look change (`settling`: new, selected, cuisine loaded, or stopping for Reduce Motion, which is how the still frame gets drawn), so at most 8 re-draw continuously; with Reduce Motion they stop after that like every other marker. Ringed promoted flags behave like organic ones. The overlay fallback (an `Animated.View` placed with `mapRef.pointForCoordinate`) was not needed (spec 16 spike: go).
- Memoize marker components (`React.memo`) and pass stable callbacks (`useCallback`).
- Flags: bundle local PNG/SVG assets keyed by ISO code (`assets/flags/ca.png`) — no network fetch per marker.
- Only render markers within the visible region (+ small padding).

## Tap → bottom sheet
- `onPress` on a marker sets `selectedSellerId` (Zustand or screen state) and snaps the sheet to the half position. Do not navigate away; keep the map region.
- Snap points: `['15%', '50%', '92%']`. Swipe down dismisses and clears selection.
- Selected marker gets a slightly darker ring (not bigger).
- Promoted seller (spec 16): `SponsoredLabel` in the sheet's fixed header above the title, from the details once they have answered (`sponsored`, or false when the place is not available) and from `pin.promoted` only while they load or when their request failed (`useRestaurantSponsored` / `useHomemadeSponsored`). The sheet's `useSponsored` prop is required. The title's spoken label becomes "<name>, sponsored". Each tab's config gives the sheet `useSponsored`, which reads the same details query as the body (no extra request).

## Sheet content order (spec 08 Decision 15, both tabs)
- Fixed header (name, flag, cuisine) outside the scroll. Inside the scroll, top to bottom: cover banner (88 pt, `size.coverBanner`, `PhotoTile width="100%"`, nothing when there is no cover), homemade safety row (`HomemadeDisclaimer`, collapsed by default at every size), menu-page thumbnails (96 pt, `size.photoThumb`, own viewer), menu items, gallery (`useCoverAndGallery`: banner and gallery share one viewer; "No photos yet" only with neither), then the address + Directions (restaurant) or the approximate-area note (homemade).
- At the half snap the menu items start at or below the fold: that is expected; check the real layout in the Simulator.
- **Action row (spec 09 Gate F):** under the fixed header and also outside the scroll sits the fixed action row (`SheetActionRow`, `testID="sheet-actions"`): one or two wrapping buttons, today Request pickup, later Reserve a table (spec 11). It is given to the sheet as the `Actions` prop (set in each tab's config) and built from `useSheetActions`; it is shown at the half and full snaps and **hidden at the collapsed snap**, which has room for the header only. Do not grow the collapsed snap for it: `collapsedSnap`, `snapHeights` and `scrollBottomSpace` are pinned by spec 07 tests. It costs about 56 pt of the scroll area (a restaurant shows about one item row less at half). A new sheet action is a new entry in `useSheetActions`, never a button inside the scrolling body.

## Accessibility
- Marker `accessibilityLabel`: "<Business name>, <Cuisine> cuisine" + ", sponsored" for ads (`sponsoredLabel` in `AdBadge.tsx`; large and ringed alike; homemade: "..., homemade, approximate area, sponsored").
- The "Ad" badge and the "Sponsored" label are written text, hidden from screen readers because the spoken label already says it. The badge does not scale with text size (the marker is a fixed-size picture); `SponsoredLabel` does.
- The places list rows of promoted places show "Sponsored" and say ", sponsored".
- Cluster: "<n> places, double tap to zoom in".
- Provide a "List view" button on the map for screen-reader users.

## Homemade markers (spec 08)
- Pins come only from `map_homemade_in_bounds`, which returns the server's shifted public point (`businesses.map_lat` / `map_lng`) as `lat` / `lng`. The exact coordinates and the address stay in `business_locations` and are never returned. The app never receives, computes, rounds or offsets a homemade point.
- A flag at that point inside a translucent circle of **500 m** (`CIRCLE_RADIUS_M` in `region.ts`). 500 m is the largest shift the server applies, so the real home is always inside; never draw it smaller. Colours come from `mapArea` in `tokens.ts`.
- Draw the circle only while the view is zoomed in (`latitudeDelta <= CIRCLE_MAX_DELTA`, 0.05); none when zoomed out, and none for clustered pins (clusters render `ClusterMarker`, so they cannot get one). The screen passes the markers one boolean (`zoomedIn`), so a pan re-renders them only when it flips.
- `Circle` goes under every flag (`zIndex` 0; flags are 1 and 2).
- **The circle is not tappable.** react-native-maps 1.29 gives `Circle` no `onPress`, no `tappable` and no `stopPropagation` (only `Marker` has `stopPropagation`), on iOS or Android; the Android `overlay-press` event is for ground overlays, not circles. A tap inside a circle reaches the map as a plain map press (iOS: no `action` field; Android: `action: 'press'`), so it clears the selection like any bare-map tap. Only the flag opens the sheet. The jest `Circle` fake has no press either.
- The sheet says "approximate area" on purpose: no address, no Directions, no place ID. Marker label: "<Name>, <Cuisine> cuisine, homemade, approximate area".
- A promoted cook (spec 16) keeps exactly the same circle (500 m, the server point, the same colours, only when zoomed in); only the flag becomes large or ringed. The float is a screen offset of the picture, never a different map position.

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

## Lessons from spec 16 (promoted markers)
Source: `.claude/specs/16-promotions.md` (Decision D14 and the PR 3 gates).

- **Spike result: go.** Reanimated inside react-native-maps custom markers (`tracksViewChanges` on only for the animating ones) shows the pop-in and the float. Judged **by eye on the iOS Simulator only** (13 active campaigns from `scripts/seed/promotions.ts --many`): visible motion, no clipping, smooth idle and pan, taps open and close the sheet. No frame-rate numbers were collected. The frame rate with 8 animated markers and 500 pins on a real iPhone and a real Android phone is a before-launch item (v1 section 16).
- A marker is drawn as a picture of its box: give an animated marker room for its movement (`size.promotedMarker`), or the top of the float is cut off.
- Reanimated needs no babel change (babel-preset-expo adds the worklets plugin) and no rebuild (the dev build already has it, through @gorhom/bottom-sheet).
- **jest:** the official `react-native-reanimated/mock` fails under jest-expo with Reanimated 4.7.1 (its index runs the native CSS setup). `jest.setup.ts` has a hand-written fake: animation helpers return their end value and are jest.fns (`withTiming`, `withDelay`, `withRepeat`, `cancelAnimation`), `useReducedMotion` is a jest.fn, and `__reset()` runs after each test (guarded: expo-router's `renderRouter` suites install their own reanimated mock). Prove "no motion" by asserting those spies were never called. The style it returns is the first frame only (nothing re-renders when a shared value changes). A name it lacks throws "not in the jest Reanimated fake"; the names react-native-gesture-handler feature-detects are declared absent.
- The map's `onLayout` gives width and height; screen tests must fire it (`fireEvent(screen.getByTestId('map-screen'), 'layout', ...)`) before anything is large.
- With both press layers in place (`stopPropagation` and `isMarkerPressEvent`), removing one alone does not reopen the closing-sheet bug, so each layer has its own test: the marker's `stopPropagation` prop, and the screen with `__setIgnoreStopPropagation(true)`.
