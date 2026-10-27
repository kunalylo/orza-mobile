import { useEffect, useRef, useState } from 'react';
import { Easing, useReducedMotion, useSharedValue, withDelay, withSpring, withTiming, type WithSpringConfig } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

export interface RevealOptions {
  /** Wait this long before starting (ms). */
  delay?: number;
  /** Spring to 1 with this config; otherwise an ease-out timing of `duration`. */
  spring?: WithSpringConfig;
  /** Timing length (ms) when there is no `spring`. Default 900. */
  duration?: number;
}

/**
 * A chart's entrance (bars growing, a line drawing in): `progress` runs 0 → 1 once `ready` (the chart has a width),
 * and again whenever `key` changes; `done` turns true when it has finished (at once with Reduce Motion).
 *
 * Draw the animated version only while `done` is false — afterwards render the final state with plain props React
 * owns. On Android (Fabric, Reanimated 4) a settled animated style / prop was sometimes put back to its FIRST frame
 * when the screen re-rendered (Health › Trends: switch 30 → 90 → 30 days and the steps bars were gone for good; the
 * same as the Today progress bars, ProgressBar.tsx) — what a chart shows must not depend on an animation's last frame
 * surviving.
 */
export function useReveal(ready: boolean, key = '', options: RevealOptions = {}) {
  const reduce = useReducedMotion();
  const progress = useSharedValue(reduce ? 1 : 0);
  const [finished, setFinished] = useState<string | null>(null);
  const opts = useRef(options);

  useEffect(() => {
    if (reduce || !ready) return;
    const { delay = 0, spring, duration = 900 } = opts.current;
    progress.set(0);
    const run = spring
      ? withSpring(1, spring, (ok) => {
          if (ok) scheduleOnRN(setFinished, key);
        })
      : withTiming(1, { duration, easing: Easing.out(Easing.cubic) }, (ok) => {
          if (ok) scheduleOnRN(setFinished, key);
        });
    progress.set(delay ? withDelay(delay, run) : run);
  }, [reduce, ready, key, progress]);

  return { progress, done: reduce || finished === key };
}
