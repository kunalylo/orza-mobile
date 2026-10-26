/**
 * Big swipeable medicine photos for the alarm (paging list, dots, prev / next buttons, screen-reader adjustable).
 * No photo → a large pill illustration with "Add a photo".
 */
import { useRef, useState } from 'react';
import { FlatList, StyleSheet, View, type AccessibilityActionEvent } from 'react-native';
import Animated, { LinearTransition, useReducedMotion } from 'react-native-reanimated';

import { MedPhoto } from '@/features/meds/MedPhoto';
import { haptics } from '@/lib/haptics';
import { colors, radii, spacing } from '@/theme';
import { Button, IconButton, Text } from '@/ui';

import { PillIllustration } from './PillIllustration';

export function PhotoCarousel({
  urls,
  title,
  aspect = 4 / 3,
  onAddPhoto,
}: {
  urls: string[];
  title: string;
  /** width / height */
  aspect?: number;
  onAddPhoto?: () => void;
}) {
  const [width, setWidth] = useState(0);
  const [index, setIndex] = useState(0);
  // No layout transition with Reduce Motion (Reanimated would leave the dots where they were).
  const reduceMotion = useReducedMotion();
  const listRef = useRef<FlatList<string>>(null);
  const count = urls.length;
  const height = width ? Math.round(width / aspect) : 0;

  if (!count) {
    return (
      <View style={[styles.frame, styles.empty, { aspectRatio: aspect }]}>
        <PillIllustration size={aspect > 1.45 ? 120 : 150} />
        <Text variant="small" tone="heroMuted" align="center" style={styles.emptyText}>
          Add a photo of the strip or bottle so this alarm shows exactly what to take.
        </Text>
        {onAddPhoto ? (
          <Button label="Add a photo" icon="camera" variant="heroOutline" size="sm" onPress={onAddPhoto} accessibilityLabel={`Add a photo of ${title}`} />
        ) : null}
      </View>
    );
  }

  const go = (i: number) => {
    const n = Math.max(0, Math.min(count - 1, i));
    if (n === index) return;
    haptics.select();
    listRef.current?.scrollToOffset({ offset: n * width, animated: true });
    setIndex(n);
  };

  const onA11yAction = (e: AccessibilityActionEvent) => {
    if (e.nativeEvent.actionName === 'increment') go(index + 1);
    if (e.nativeEvent.actionName === 'decrement') go(index - 1);
  };

  return (
    <View>
      <View
        style={[styles.frame, { aspectRatio: aspect }]}
        onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width))}
        accessible={count > 1}
        accessibilityRole={count > 1 ? 'adjustable' : 'image'}
        accessibilityLabel={count > 1 ? `Photos of ${title}` : `Photo of ${title}`}
        accessibilityValue={count > 1 ? { text: `${index + 1} of ${count}` } : undefined}
        accessibilityActions={count > 1 ? [{ name: 'increment' }, { name: 'decrement' }] : undefined}
        onAccessibilityAction={onA11yAction}
      >
        {width > 0 ? (
          <FlatList
            ref={listRef}
            data={urls}
            keyExtractor={(u, i) => `${i}:${u}`}
            horizontal
            pagingEnabled
            bounces={false}
            showsHorizontalScrollIndicator={false}
            getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
            onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / Math.max(1, width)))}
            renderItem={({ item, index: i }) => (
              <View style={{ width, height }}>
                <MedPhoto url={item} fill radius={0} contentFit="contain" accessibilityLabel={`${title}, photo ${i + 1} of ${count}`} style={styles.photo} />
              </View>
            )}
          />
        ) : null}

        {count > 1 ? (
          <>
            {index > 0 ? (
              <IconButton icon="chevron-left" variant="hero" size={40} accessibilityLabel="Previous photo" onPress={() => go(index - 1)} haptic="none" style={[styles.arrow, styles.left]} />
            ) : null}
            {index < count - 1 ? (
              <IconButton icon="chevron-right" variant="hero" size={40} accessibilityLabel="Next photo" onPress={() => go(index + 1)} haptic="none" style={[styles.arrow, styles.right]} />
            ) : null}
            <View style={styles.counter} pointerEvents="none">
              <Text variant="caption" color={colors.heroText}>
                {index + 1}/{count}
              </Text>
            </View>
          </>
        ) : null}
      </View>

      {count > 1 ? (
        <View style={styles.dots} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          {urls.map((u, i) => (
            <Animated.View key={`${i}:${u}`} layout={reduceMotion ? undefined : LinearTransition.springify().damping(18).stiffness(100).mass(1)} style={[styles.dot, i === index && styles.dotOn]} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    width: '100%',
    borderRadius: radii.lg,
    overflow: 'hidden',
    backgroundColor: '#0E1319',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.heroGlassBorder,
  },
  photo: { backgroundColor: 'transparent', borderWidth: 0 },
  empty: { alignItems: 'center', justifyContent: 'center', padding: spacing.lg, gap: spacing.sm, backgroundColor: colors.heroGlass },
  emptyText: { maxWidth: 260 },
  arrow: { position: 'absolute', top: '50%', marginTop: -20 },
  left: { left: spacing.sm },
  right: { right: spacing.sm },
  counter: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(7,9,12,0.6)',
  },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: spacing.md },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.35)' },
  dotOn: { width: 20, backgroundColor: colors.white },
});
