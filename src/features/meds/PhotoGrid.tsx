/**
 * Medicine photos: "Take photo" / "Choose from gallery", a preview grid with remove + "show on alarm".
 * The first photo is the one alarms and notifications show.
 */
import { ActivityIndicator, Alert, Linking, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut, ZoomIn } from 'react-native-reanimated';

import { pickPhotos, PhotoError, PhotoPermissionError, toUploadDataUrl, type PhotoSource } from '@/lib/image';
import { colors, radii, spacing } from '@/theme';
import { Button, IconButton, Text, toast, useLayoutTransition } from '@/ui';

import { MedPhoto } from './MedPhoto';

export interface PhotoItem {
  id: string;
  /** Server URL (saved) or data URL (not yet saved). */
  url: string;
}

/** Explain a refused permission; "blocked" offers a jump to Settings. */
export function explainPhotoPermission(e: PhotoPermissionError) {
  const what = e.source === 'camera' ? 'camera' : 'photos';
  if (e.status === 'blocked') {
    Alert.alert(
      e.source === 'camera' ? 'Allow camera access' : 'Allow photo access',
      `ÖRZA needs access to your ${what} to add medicine photos. You can turn it on in Settings.`,
      [
        { text: 'Not now', style: 'cancel' },
        { text: 'Open Settings', onPress: () => void Linking.openSettings() },
      ]
    );
  } else {
    toast.info(`${e.message} You can allow it next time.`);
  }
}

/**
 * Pick up to `max` photos and prepare each as an upload data URL. Shows friendly messages itself and returns
 * only the photos that worked ([] on cancel or refusal). `onPrepare` fires once photos were picked and are being
 * resized — not while the camera / picker is still open, so "Preparing…" never shows for a photo not chosen yet.
 */
export async function pickUploadPhotos(source: PhotoSource, max: number, onPrepare?: () => void): Promise<string[]> {
  if (max <= 0) return [];
  let picked;
  try {
    picked = await pickPhotos(source, { multiple: source === 'library' && max > 1, max });
  } catch (e) {
    if (e instanceof PhotoPermissionError) explainPhotoPermission(e);
    else toast.error(source === 'camera' ? "We couldn't open the camera. Please try again." : "We couldn't open your photos. Please try again.");
    return [];
  }
  if (picked.length) onPrepare?.();
  const out: string[] = [];
  for (const p of picked) {
    try {
      out.push((await toUploadDataUrl(p.uri)).dataUrl);
    } catch (e) {
      toast.error(e instanceof PhotoError ? e.message : "We couldn't read that photo. Please try another.");
    }
  }
  return out;
}

export function PhotoGrid({
  items,
  max,
  shownMax = max,
  busy,
  label,
  onAdd,
  onRemove,
  onMakePrimary,
  ringsOnAlarm = true,
}: {
  items: PhotoItem[];
  max: number;
  /** The limit to tell the member, when `max` counts a prescription stand-in that the first pill photo replaces. */
  shownMax?: number;
  busy?: boolean;
  label: string;
  onAdd: (source: PhotoSource) => void;
  onRemove: (id: string) => void;
  onMakePrimary?: (id: string) => void;
  /** False for an SOS medicine: it never rings, so the first photo is just its main photo. */
  ringsOnAlarm?: boolean;
}) {
  const layoutTransition = useLayoutTransition();
  const full = items.length >= max;

  return (
    <View style={styles.wrap}>
      {items.length > 0 || busy ? (
        <Animated.View layout={layoutTransition} style={styles.grid} accessibilityLabel={`${label} photos`}>
          {items.map((p, i) => (
            <Animated.View key={p.id} entering={ZoomIn.springify().damping(16).stiffness(100).mass(1)} exiting={FadeOut} layout={layoutTransition} style={styles.tile}>
              <MedPhoto url={p.url} fill radius={radii.sm} accessibilityLabel={`${label} photo ${i + 1}${i === 0 ? (ringsOnAlarm ? ' (shown on alarms)' : ' (main photo)') : ''}`} />
              {i === 0 ? (
                <View style={styles.badge}>
                  <Text variant="caption" color={colors.white} style={styles.badgeText}>
                    {ringsOnAlarm ? 'On alarm' : 'Main photo'}
                  </Text>
                </View>
              ) : onMakePrimary ? (
                <IconButton
                  icon="star"
                  variant="solid"
                  size={30}
                  iconSize={14}
                  disabled={busy}
                  accessibilityLabel={ringsOnAlarm ? `Show photo ${i + 1} on alarms` : `Make photo ${i + 1} the main photo`}
                  onPress={() => onMakePrimary(p.id)}
                  style={styles.star}
                />
              ) : null}
              <IconButton
                icon="x"
                variant="solid"
                size={30}
                iconSize={14}
                disabled={busy}
                accessibilityLabel={`Remove photo ${i + 1}`}
                onPress={() => onRemove(p.id)}
                style={styles.remove}
              />
            </Animated.View>
          ))}
          {busy ? (
            <Animated.View entering={FadeIn} exiting={FadeOut} style={[styles.tile, styles.busyTile]} accessibilityLabel="Adding photo">
              <ActivityIndicator color={colors.coral} />
              <Text variant="caption" tone="muted">
                Preparing…
              </Text>
            </Animated.View>
          ) : null}
        </Animated.View>
      ) : null}

      {!full ? (
        <View style={styles.buttons}>
          <Button label="Take photo" icon="camera" variant="secondary" size="sm" disabled={busy} onPress={() => onAdd('camera')} style={styles.flex} />
          <Button label="From gallery" icon="image" variant="secondary" size="sm" disabled={busy} onPress={() => onAdd('library')} style={styles.flex} accessibilityLabel="Choose from gallery" />
        </View>
      ) : null}
      <Text variant="caption" tone="subtle">
        {full ? `That's the maximum of ${shownMax} photos. Remove one to add another.` : `Up to ${shownMax} photos — the strip, the box and the pill itself work best.`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  wrap: { gap: spacing.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tile: { width: '31.5%', aspectRatio: 1, borderRadius: radii.sm, overflow: 'hidden' },
  busyTile: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.hairlineStrong,
    backgroundColor: colors.glassSubtle,
  },
  badge: { position: 'absolute', left: 6, top: 6, paddingHorizontal: 8, paddingVertical: 2, borderRadius: radii.pill, backgroundColor: 'rgba(7,9,12,0.66)' },
  badgeText: { fontSize: 10, lineHeight: 14 },
  star: { position: 'absolute', left: 6, top: 6 },
  remove: { position: 'absolute', right: 6, top: 6 },
  buttons: { flexDirection: 'row', gap: spacing.sm },
});
