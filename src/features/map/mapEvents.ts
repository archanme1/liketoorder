/**
 * True for the map press that a marker press leaves behind. On iOS a marker's press and the map's
 * press are both bubbling events, so tapping a flag also reaches the MapView's `onPress` unless
 * the marker stops it. The map's handler ignores these, so a flag tap can never be undone by
 * the "tap the bare map" handler.
 */
export function isMarkerPressEvent(event: unknown): boolean {
  if (typeof event !== 'object' || event === null) return false;
  const native = (event as { nativeEvent?: unknown }).nativeEvent;
  if (typeof native !== 'object' || native === null) return false;
  return (native as { action?: unknown }).action === 'marker-press';
}
