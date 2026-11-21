import { useEffect, useState } from 'react';
import {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { useReduceMotion } from '@/lib/useReduceMotion';

// The promoted marker's motion (spec 16, v1 section 7): it pops in once, growing from POP_FROM to
// full size in POP_IN_MS with an ease-out and no overshoot, then rises and falls FLOAT_PX in a slow
// sine loop, FLOAT_MS each way. Each marker waits a random 0 to MAX_START_DELAY_MS before floating,
// so several ads never move in step. No repeating grow-and-shrink, ever.
export const POP_IN_MS = 220;
export const POP_FROM = 0.8;
export const FLOAT_PX = 4;
export const FLOAT_MS = 1400;
export const MAX_START_DELAY_MS = 1400;

/**
 * The animated style for a promoted marker's picture, and whether it is moving (the marker keeps
 * `tracksViewChanges` on only while it is).
 *
 * Reduce Motion means no movement at all: no pop-in and no float. Reanimated's own value is read
 * on the first frame (ours starts as false and resolves a moment later, which alone would let the
 * pop-in start); ours follows the setting live. Once Reduce Motion has been seen, this marker stays
 * still until it is drawn again, even if the setting is turned back off.
 */
export function usePromotedFloat() {
  const systemReduce = useReducedMotion();
  const liveReduce = useReduceMotion();
  const reduce = systemReduce || liveReduce;
  const [stopped, setStopped] = useState(reduce);
  if (reduce && !stopped) setStopped(true);
  const still = reduce || stopped;

  const [startDelay] = useState(() => Math.random() * MAX_START_DELAY_MS);
  const scale = useSharedValue(still ? 1 : POP_FROM);
  const y = useSharedValue(0);

  useEffect(() => {
    if (still) {
      scale.value = 1;
      y.value = 0;
      return;
    }
    scale.value = withTiming(1, { duration: POP_IN_MS, easing: Easing.out(Easing.cubic) });
    y.value = withDelay(
      POP_IN_MS + startDelay,
      withRepeat(
        withTiming(-FLOAT_PX, { duration: FLOAT_MS, easing: Easing.inOut(Easing.sin) }),
        -1,
        true,
      ),
    );
    return () => {
      cancelAnimation(scale);
      cancelAnimation(y);
    };
  }, [still, scale, y, startDelay]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: y.value }, { scale: scale.value }],
  }));

  return { animatedStyle, animating: !still };
}
