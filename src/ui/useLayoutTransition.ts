import { LinearTransition, useReducedMotion } from 'react-native-reanimated';

/**
 * The app's standard layout transition (rows / chips sliding to their new place), or none while the phone asks for
 * reduced motion (Android: animations off). Under reduced motion Reanimated skips the transition but, on Android, can
 * leave the moved view drawn — and touchable — at its OLD position: text covered by the next block, a button whose
 * tap target sits elsewhere, cards stacked over each other (D1 alarms B1/B3/B5). Without a layout prop the view simply
 * moves with the layout.
 */
export function useLayoutTransition() {
  const reduceMotion = useReducedMotion();
  return reduceMotion ? undefined : LinearTransition.springify().damping(20).stiffness(100).mass(1);
}
