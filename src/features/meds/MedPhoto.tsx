/**
 * A medicine photo (protected `/api/media/…` URL via `mediaSource`, or a local / data URI for photos not yet saved)
 * with a warm pill placeholder when there is none or it fails to load.
 */
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { mediaSource } from '@/lib/api';
import { colors, diagonal, radii } from '@/theme';
import { Icon } from '@/ui';

export interface MedPhotoProps {
  /** Server photo URL (relative `/api/media/…`) or a local `file://` / `data:` URI. */
  url?: string | null;
  size?: number;
  radius?: number;
  /** Fill the parent instead of a fixed square. */
  fill?: boolean;
  contentFit?: 'cover' | 'contain';
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

const isLocal = (u: string) => /^(file|data|content|ph|assets-library):/.test(u);

export function MedPhoto({ url, size = 64, radius = radii.sm, fill, contentFit = 'cover', accessibilityLabel, style }: MedPhotoProps) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const source = url ? (isLocal(url) ? { uri: url } : mediaSource(url)) : undefined;
  const showImage = !!source && failedUrl !== url;
  const box: ViewStyle = fill ? { width: '100%', height: '100%', borderRadius: radius } : { width: size, height: size, borderRadius: radius };

  return (
    <View
      style={[styles.wrap, box, style]}
      accessible={!!accessibilityLabel}
      accessibilityRole={accessibilityLabel ? 'image' : undefined}
      accessibilityLabel={accessibilityLabel}
    >
      {showImage ? (
        <Image
          source={source}
          style={StyleSheet.absoluteFill}
          contentFit={contentFit}
          transition={180}
          cachePolicy="memory-disk"
          recyclingKey={url ?? undefined}
          onError={() => setFailedUrl(url ?? null)}
        />
      ) : (
        <LinearGradient colors={[colors.cream, colors.energyBg]} {...diagonal} style={[StyleSheet.absoluteFill, styles.center]}>
          <Icon name="mci:pill" size={Math.max(18, Math.round((fill ? 72 : size) * 0.36))} color={colors.energyInk} />
        </LinearGradient>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { overflow: 'hidden', backgroundColor: colors.canvas2, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline },
  center: { alignItems: 'center', justifyContent: 'center' },
});
