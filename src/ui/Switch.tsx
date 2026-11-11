/**
 * The app's on/off switch: React Native's native switch with a touch box of at least 48 × 48 dp on Android, where the
 * native switch measures about 46 × 27 dp and takes touches only inside its own bounds (a native view gets no hit
 * slop). Android draws the track centred top to bottom and at the box's end, so the look is unchanged (steps-v2-V1
 * run 6, `docs/notes/a11y-polish.md`).
 *
 * - `fit="native"` (default): the row keeps its height. Negative margins give the box the native switch's own size in
 *   the layout, and the box reaches 10.5 dp above and below it (2 dp at its start) into the row's padding. Android hands
 *   a native view only the touches inside every parent's bounds, so a row without that much padding around the switch
 *   adds `switchRowSlack`.
 * - `fit="box"`: the whole box is laid out (a row that already makes room for it).
 *
 * iOS is left as it is: UISwitch keeps its own 51 × 31 pt whatever its frame, so a bigger box wouldn't centre it.
 */
import { StyleSheet, Switch as RNSwitch, type SwitchProps as RNSwitchProps, type ViewStyle } from 'react-native';

import { isIOS, layout } from '@/theme';

export interface SwitchProps extends RNSwitchProps {
  fit?: 'native' | 'box';
}

/** Android's native switch as laid out, dp (`a11y.mjs`, steps-v2-V1 run 6). */
const NATIVE = { width: 46, height: 27 };
/** How far the 48 dp box reaches past the native switch above and below it, dp. */
const OVERHANG = (layout.hit - NATIVE.height) / 2;

export function Switch({ fit = 'native', style, ...rest }: SwitchProps) {
  return <RNSwitch {...rest} style={[isIOS ? null : fit === 'box' ? styles.box : [styles.box, styles.native], style]} />;
}

/** The switch's box on Android (for a spinner that stands in for a `fit="box"` switch). */
export const switchBoxStyle: ViewStyle | undefined = isIOS ? undefined : { minWidth: layout.hit, minHeight: layout.hit };

/**
 * For a row with no padding around its switch: grows the row's bounds by the box's overhang above and below without
 * moving anything (padding plus the same negative margin, on top of the row's own `top` / `bottom` margins). The row
 * passes touches through itself (`box-none`), so its wider bounds never cover a neighbour's button.
 */
export function switchRowSlack({ top = 0, bottom = 0 }: { top?: number; bottom?: number } = {}): ViewStyle {
  if (isIOS) return { marginTop: top, marginBottom: bottom };
  return { paddingVertical: OVERHANG, marginTop: top - OVERHANG, marginBottom: bottom - OVERHANG, pointerEvents: 'box-none' };
}

const styles = StyleSheet.create({
  box: { minWidth: layout.hit, minHeight: layout.hit },
  native: { marginVertical: -OVERHANG, marginStart: NATIVE.width - layout.hit },
});
