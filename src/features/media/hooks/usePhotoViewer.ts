import { useCallback, useState } from 'react';

/**
 * Open/close state and the photo shown, so the three places that open the viewer (the map sheet
 * strip, the menu pages, the seller's Photos screen) share one pattern.
 */
export function usePhotoViewer() {
  const [state, setState] = useState<{ visible: boolean; index: number }>({
    visible: false,
    index: 0,
  });
  const open = useCallback((index: number) => setState({ visible: true, index }), []);
  const close = useCallback(() => setState((current) => ({ ...current, visible: false })), []);
  const setIndex = useCallback(
    (index: number) => setState((current) => ({ ...current, index })),
    [],
  );
  return { visible: state.visible, index: state.index, open, close, setIndex };
}
