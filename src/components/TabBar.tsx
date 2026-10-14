/**
 * Floating glass tab bar: Today · Meals · [Snap] · Medicines · More. The centre Snap button is raised,
 * energy-gradient and haloed; the active tab's icon lifts and a small energy dot springs in under it.
 * iOS gets real blur; Android (where blur needs a BlurTargetView behind every screen) gets dense glass.
 * Hidden while the keyboard is up on Android so it never rides on top of the keyboard.
 */
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { useEffect, useState } from 'react';
import { Keyboard, Platform, Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { haptics } from '@/lib/haptics';
import { colors, diagonal, gradients, layout, motion, radii, shadows } from '@/theme';
import { Icon, PressableScale, Text, type IconName } from '@/ui';

const TABS: Record<string, { label: string; icon: IconName; iconActive: IconName }> = {
  index: { label: 'Today', icon: 'mci:white-balance-sunny', iconActive: 'mci:white-balance-sunny' },
  meals: { label: 'Meals', icon: 'mci:silverware-fork-knife', iconActive: 'mci:silverware-fork-knife' },
  snap: { label: 'Snap', icon: 'mci:camera-outline', iconActive: 'mci:camera' },
  medicines: { label: 'Medicines', icon: 'mci:pill', iconActive: 'mci:pill' },
  more: { label: 'More', icon: 'mci:dots-grid', iconActive: 'mci:dots-grid' },
};

function TabItem({ label, icon, focused, onPress, onLongPress, index, count }: {
  label: string;
  icon: IconName;
  focused: boolean;
  onPress: () => void;
  onLongPress: () => void;
  index: number;
  count: number;
}) {
  const lift = useAnimatedStyle(() => ({
    transform: [{ translateY: withSpring(focused ? -2 : 0, motion.spring) }, { scale: withSpring(focused ? 1.08 : 1, motion.spring) }],
  }));
  const dot = useAnimatedStyle(() => ({
    opacity: withTiming(focused ? 1 : 0, { duration: motion.fast }),
    transform: [{ scale: withSpring(focused ? 1 : 0.2, motion.spring) }],
  }));

  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={`${label}, tab ${index + 1} of ${count}`}
      accessibilityState={{ selected: focused }}
      onPress={onPress}
      onLongPress={onLongPress}
      style={styles.item}
      hitSlop={{ top: 8, bottom: 8 }}
    >
      <Animated.View style={lift}>
        <Icon name={icon} size={23} color={focused ? colors.ink : colors.subtle} />
      </Animated.View>
      <Text variant="caption" weight={focused ? 'semibold' : 'medium'} tone={focused ? 'ink' : 'subtle'} style={styles.label} numberOfLines={1} maxFontSizeMultiplier={1.15}>
        {label}
      </Text>
      <Animated.View style={[styles.dot, dot]}>
        <LinearGradient colors={gradients.energy} start={diagonal.start} end={diagonal.end} style={StyleSheet.absoluteFill} />
      </Animated.View>
    </Pressable>
  );
}

function SnapButton({ focused, onPress, onLongPress }: { focused: boolean; onPress: () => void; onLongPress: () => void }) {
  const reduce = useReducedMotion();
  const halo = useSharedValue(0);

  useEffect(() => {
    if (reduce) return;
    halo.set(withRepeat(withSequence(withTiming(1, { duration: 1800, easing: Easing.out(Easing.quad) }), withTiming(0, { duration: 0 })), -1));
  }, [reduce, halo]);

  const haloStyle = useAnimatedStyle(() => ({
    opacity: 0.45 * (1 - halo.get()),
    transform: [{ scale: 1 + halo.get() * 0.38 }],
  }));

  return (
    <View style={styles.snapSlot}>
      <Animated.View pointerEvents="none" style={[styles.halo, haloStyle]} />
      <PressableScale
        accessibilityRole="tab"
        accessibilityLabel="Snap a meal"
        accessibilityHint="Opens the camera to scan food"
        accessibilityState={{ selected: focused }}
        haptic="firm"
        scaleTo={0.9}
        onPress={onPress}
        onLongPress={onLongPress}
        style={styles.snap}
      >
        <LinearGradient colors={gradients.energy} start={diagonal.start} end={diagonal.end} style={[StyleSheet.absoluteFill, styles.snapFill]} />
        <Icon name="mci:camera-iris" size={28} color={colors.white} />
      </PressableScale>
      <Text variant="caption" weight={focused ? 'semibold' : 'medium'} tone={focused ? 'ink' : 'subtle'} style={styles.snapLabel} maxFontSizeMultiplier={1.15}>
        Snap
      </Text>
    </View>
  );
}

export function TabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const [keyboardUp, setKeyboardUp] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardUp(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardUp(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  if (keyboardUp) return null;

  const routes = state.routes.filter((r) => TABS[r.name]);
  const bottom = Math.max(insets.bottom, layout.tabBarGap);

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { bottom }]}>
      <View style={styles.bar}>
        {Platform.OS === 'ios' ? (
          <BlurView intensity={60} tint="systemChromeMaterialLight" style={[StyleSheet.absoluteFill, styles.blur]} />
        ) : null}
        <View style={[StyleSheet.absoluteFill, styles.glass]} />
        {routes.map((route, i) => {
          const meta = TABS[route.name];
          const focused = state.routes[state.index]?.key === route.key;
          const options = descriptors[route.key]?.options;
          const onPress = () => {
            const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            if (!focused && !event.defaultPrevented) {
              if (route.name !== 'snap') haptics.select();
              navigation.navigate(route.name, route.params);
            }
          };
          const onLongPress = () => navigation.emit({ type: 'tabLongPress', target: route.key });
          if (route.name === 'snap') return <SnapButton key={route.key} focused={focused} onPress={onPress} onLongPress={onLongPress} />;
          return (
            <TabItem
              key={route.key}
              label={typeof options?.tabBarLabel === 'string' ? options.tabBarLabel : meta.label}
              icon={focused ? meta.iconActive : meta.icon}
              focused={focused}
              onPress={onPress}
              onLongPress={onLongPress}
              index={i}
              count={routes.length}
            />
          );
        })}
      </View>
    </View>
  );
}

const SNAP = layout.snapSize;

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 12, right: 12, alignItems: 'center' },
  bar: {
    width: '100%',
    maxWidth: 520,
    height: layout.tabBarHeight,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radii.xl + 4,
    borderWidth: 1,
    borderColor: colors.hairline,
    ...shadows.floating,
  },
  blur: { borderRadius: radii.xl + 4, overflow: 'hidden' },
  glass: {
    borderRadius: radii.xl + 4,
    backgroundColor: Platform.OS === 'ios' ? 'rgba(255,255,255,0.55)' : 'rgba(255,253,250,0.96)',
  },
  item: { flex: 1, height: '100%', alignItems: 'center', justifyContent: 'center', paddingTop: 2 },
  label: { fontSize: 11, lineHeight: 14, marginTop: 2 },
  dot: { width: 5, height: 5, borderRadius: 2.5, overflow: 'hidden', marginTop: 3 },
  snapSlot: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', height: '100%', paddingBottom: 8 },
  halo: {
    position: 'absolute',
    top: -SNAP / 2 + 2,
    width: SNAP,
    height: SNAP,
    borderRadius: SNAP / 2,
    backgroundColor: colors.coral,
  },
  snap: {
    position: 'absolute',
    top: -SNAP / 2 + 2,
    width: SNAP,
    height: SNAP,
    borderRadius: SNAP / 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: colors.canvas,
    overflow: 'hidden',
    ...shadows.energy,
  },
  snapFill: { borderRadius: SNAP / 2 },
  snapLabel: { fontSize: 11, lineHeight: 14 },
});
