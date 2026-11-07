---
name: liketoorder-ui
description: LikeToOrder's design system and UI rules for React Native screens and components — theme tokens, typography, spacing, shared components, bottom sheet content, request status chips, activity grid visuals, empty/error/loading states, and accessibility. Use whenever designing or building any screen, component, or visual polish in the app.
---

# LikeToOrder — UI

Feel: warm, food-first, photo-led, calm. Food photos are the color; the chrome stays neutral.

## Before building
Open `src/theme/tokens.ts` and `src/components/ui/` and reuse what exists. If a needed component is missing, add it to `ui/` (not inside a feature) when it will be used by 2+ features.

## Tokens (create in spec 01, extend — don't fork)
```ts
export const colors = {
  bg: '#FFFDF9', surface: '#FFFFFF', surfaceAlt: '#F6F1EA',
  text: '#1F1A17', textMuted: '#6B625B', border: '#E8E0D6',
  primary: '#CF471C', primaryText: '#FFFFFF',          // warm paprika; 4.59:1 with white, 4.52:1 with bg (WCAG AA)
  success: '#2E7D4F', warning: '#B7791F', danger: '#C0392B', info: '#2B6CB0',
  grid0: '#EFE8DF', grid1: '#F9C9A8', grid2: '#F08A55', grid3: '#C2410C', // activity intensity
  adRing: '#F4B400',
};
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radius = { sm: 6, md: 10, lg: 16, pill: 999 };
export const type = { caption: 12, body: 15, bodyLg: 17, title: 20, h1: 28 };
export const opacity = { disabled: 0.5, pressed: 0.8 }; // inactive controls / press feedback
```
`primary` must stay ≥ 4.5:1 against both `primaryText` (white) and `bg` — `src/theme/__tests__/tokens.test.ts` enforces it.
Don't place primary-colored text controls (secondary/ghost buttons, links) on `surfaceAlt` (only ~4.1:1); put them on `surface` or `bg` instead.
Provide a dark variant later; always read colors through a `useTheme()` hook so it's possible.

## Shared components (src/components/ui)
`Screen` (safe area + bg) · `Text` (variants) · `Button` (primary/secondary/ghost, loading state) · `Card` · `Chip` · `StatusChip` · `Avatar` · `FlagIcon` (ISO code → bundled asset) · `EmptyState` · `ErrorState` (with Retry) · `Skeleton` · `TextField` (react-hook-form compatible) · `Sheet` (wraps @gorhom/bottom-sheet).

## Request status chips — never ambiguous
Use `StatusChip` (`src/components/ui`), fed by `STATUS_INFO` in `src/features/requests/status.ts`. The status shown is always the server's `display_status`.
| Status | Label | Color | Icon |
|---|---|---|---|
| pending | "Waiting" (sentence: "Waiting for <business> to respond") | warning | clock |
| accepted | "Accepted" | success | check |
| declined | "Declined" | danger | x |
| expired | "Expired" | textMuted | hourglass |
| cancelled | "Cancelled" | textMuted | ban |
| completed | "Completed" | info | bag |
| no_show | "No-show" | danger | alert |
Always icon + text, never color alone. A pending request is never described as confirmed, booked or on its way: no "confirmed" wording anywhere, including screen-reader labels (spec 09).

## Activity grid visuals
- Square 12–14pt with 3pt gap, radius 3. Week columns, Sun→Sat rows; month labels above.
- Intensity: 0 `grid0`, 1 `grid1`, 2–3 `grid2`, 4+ `grid3`. Legend "Less ▢▢▢▢ More" under the grid.
- Cuisine view: same cell size; flag image fills the cell (rounded); mixed day shows 🌍; faint intensity color behind the flag.
- Today outlined; selected day has a 2pt `text` border.
- Phone: last ~17 weeks visible, horizontal scroll to the past, "View full year" opens a modal.
- Each cell: `accessibilityLabel="Oct 12, 3 uploads"` (cuisine view: "Oct 12, Italian" / "Oct 12, 3 cuisines"), role `button`.
- Day panel row: 48pt thumbnail, flag, one-line description (`numberOfLines={1}`), time.

## Screen states
Every data screen: `Skeleton` while loading → `EmptyState` (friendly line + action) → `ErrorState` with Retry → content. Pull-to-refresh on lists.

## Lists that can grow are infinite lists
A list that can grow without a cap (My requests today; the seller inbox in spec 10 and table requests in spec 11 next) loads a page at a time with `useInfiniteQuery` and a `FlatList`: load the next page near the end (`onEndReached`, once at a time), a small footer spinner while it loads, and on failure an inline "Try again" in the footer that keeps the rows already loaded. A full-screen error is only for a first load that failed; a failed refresh with rows on screen is a small banner. Pull-to-refresh starts again from page 1. Show each row once (de-duplicate by id). Lists capped by the database (menu items, photos) or by a reference table (currencies, cuisines) can render all rows.

## Imagery
`expo-image` with `contentFit="cover"`, blurhash/placeholder, fixed aspect ratios (1:1 food log, 4:3 menu photos). Never stretch.

## Motion
Short (150–250 ms) and purposeful. Only looping animation in the app is the promoted marker float. Respect reduce-motion everywhere.

## Copy
Short, friendly, plain. Buttons are verbs ("Request pickup", "Send table request"). Homemade sheets always show the food-safety & allergy note as a small disclosure row (title + info icon, whole row is the button, collapsed by default at every text size, full text inline on tap, a screen reader hears the whole warning); it sits above the menu and, once requests exist, above the request button. Sheet content order (both tabs): fixed header, 88 pt cover banner, (homemade) safety row, menu-page thumbnails, menu items, gallery, address + Directions or the approximate-area note.
