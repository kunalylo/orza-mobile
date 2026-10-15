/**
 * Take or choose one prescription photo and prepare it for upload. Explains refused permissions (with a jump to
 * Settings when blocked); returns null on cancel or refusal. Throws PhotoError when the photo can't be prepared.
 */
import { Alert, Linking } from 'react-native';

import { pickPhotos, PhotoPermissionError, toUploadDataUrl, type PhotoSource } from '@/lib/image';
import { toast } from '@/ui';

export interface RxPhoto {
  /** Local file URI for the preview. */
  uri: string;
  /** JPEG data URL for the API. */
  dataUrl: string;
}

function explain(e: PhotoPermissionError) {
  const camera = e.source === 'camera';
  if (e.status === 'blocked') {
    Alert.alert(
      camera ? 'Allow camera access' : 'Allow photo access',
      `ÖRZA needs access to your ${camera ? 'camera' : 'photos'} to read your prescription. You can turn it on in Settings — or type the medicines instead.`,
      [
        { text: 'Not now', style: 'cancel' },
        { text: 'Open Settings', onPress: () => void Linking.openSettings() },
      ]
    );
  } else {
    toast.info(`${e.message} You can allow it next time, or type the medicines instead.`);
  }
}

/** Opens the camera / photo library. `onPrepare` fires once a photo was picked and is being resized. */
export async function pickRxPhoto(source: PhotoSource, onPrepare?: () => void): Promise<RxPhoto | null> {
  let picked;
  try {
    picked = await pickPhotos(source, { multiple: false, max: 1 });
  } catch (e) {
    if (e instanceof PhotoPermissionError) explain(e);
    else toast.error(source === 'camera' ? "We couldn't open the camera. Please try again." : "We couldn't open your photos. Please try again.");
    return null;
  }
  const first = picked[0];
  if (!first) return null;
  onPrepare?.();
  // A prescription needs its small print legible: keep a generous size, toUploadDataUrl steps down if too big.
  const { dataUrl } = await toUploadDataUrl(first.uri, { maxSide: 1600, quality: 0.8 });
  return { uri: first.uri, dataUrl };
}
