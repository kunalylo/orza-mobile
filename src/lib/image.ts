/**
 * Photo capture + upload preparation shared by Snap & Know (meals), medicine photos and
 * prescription scans.
 *
 * INTERFACE CONTRACT — other features import exactly these exports (built in step B2a).
 *
 * Server limits (see the web API): images are sent as JSON `data:image/jpeg;base64,…` URLs,
 * ≤ 1.5 MB after compression for medicine/prescription photos and ≤ ~6 MB for meal scans.
 *
 * - `pickPhotos` uses the system photo picker for the library (no permission prompt needed on iOS 14+ / Android)
 *   and asks for camera access only when the camera is used.
 * - `toUploadDataUrl` uses the contextual expo-image-manipulator API (EXIF orientation applied, metadata dropped),
 *   then steps size / quality down until the JPEG fits under `MAX_UPLOAD_BYTES` (or the caller's `maxBytes`).
 */
import { ImageManipulator, SaveFormat, type ImageRef } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

export type PhotoSource = 'camera' | 'library';

export interface PickedPhoto {
  uri: string; // local file URI (show with expo-image)
  width: number;
  height: number;
}

export type PhotoPermission = 'granted' | 'denied' | 'blocked';

/** Encoded image bytes we aim for — a little under the server's 1,500,000-byte limit. */
export const MAX_UPLOAD_BYTES = 1_400_000;

/** A photo that couldn't be read or made small enough. `message` is written for people. */
export class PhotoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PhotoError';
  }
}

export class PhotoPermissionError extends Error {
  constructor(public status: Exclude<PhotoPermission, 'granted'>, public source: PhotoSource) {
    super(source === 'camera' ? 'Camera access is needed to take a photo.' : 'Photo access is needed to choose a photo.');
  }
}

/* ───────────────────────────── Picking ───────────────────────────── */

async function ensureCameraPermission(): Promise<void> {
  let res = await ImagePicker.getCameraPermissionsAsync();
  if (res.granted) return;
  if (res.canAskAgain) res = await ImagePicker.requestCameraPermissionsAsync();
  if (res.granted) return;
  throw new PhotoPermissionError(res.canAskAgain ? 'denied' : 'blocked', 'camera');
}

async function ensureLibraryPermission(): Promise<void> {
  let res = await ImagePicker.getMediaLibraryPermissionsAsync();
  if (res.granted) return;
  if (res.canAskAgain) res = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (res.granted) return;
  throw new PhotoPermissionError(res.canAskAgain ? 'denied' : 'blocked', 'library');
}

function toPicked(result: ImagePicker.ImagePickerResult, max: number): PickedPhoto[] {
  if (result.canceled || !result.assets?.length) return [];
  return result.assets
    .filter((a) => !a.type || a.type === 'image' || a.type === 'livePhoto')
    .slice(0, Math.max(1, max))
    .map((a) => ({ uri: a.uri, width: a.width, height: a.height }));
}

/**
 * Ask for camera / photo-library permission when needed and let the user take or choose photos.
 * Returns [] when the user cancels. Throws `PhotoPermissionError` when permission is refused
 * (status "blocked" means the user must enable it in system Settings).
 */
export async function pickPhotos(source: PhotoSource, opts: { multiple?: boolean; max?: number } = {}): Promise<PickedPhoto[]> {
  const max = Math.max(1, Math.floor(opts.max ?? (opts.multiple ? 10 : 1)));
  const multiple = !!opts.multiple && max > 1;

  if (source === 'camera') {
    await ensureCameraPermission();
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1, exif: false, base64: false });
    return toPicked(result, 1);
  }

  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: ['images'],
    quality: 1,
    exif: false,
    base64: false,
    allowsMultipleSelection: multiple,
    selectionLimit: multiple ? max : 1,
    orderedSelection: multiple,
  };
  try {
    return toPicked(await ImagePicker.launchImageLibraryAsync(options), max);
  } catch (e) {
    // The system picker needs no permission (Android uses the Photo Picker; READ_MEDIA_IMAGES is blocked in
    // app.json). Older iOS versions may — ask once, then retry.
    if (Platform.OS !== 'ios') throw e;
    await ensureLibraryPermission();
    try {
      return toPicked(await ImagePicker.launchImageLibraryAsync(options), max);
    } catch {
      throw e;
    }
  }
}

/* ───────────────────────────── Encoding ───────────────────────────── */

/** Decoded size of a base64 payload. */
function base64Bytes(b64: string): number {
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - padding;
}

/** Render `source` (a file URI, or an already-rendered image), scaling its longest side down to `maxSide`. */
async function render(source: string | ImageRef, maxSide?: number): Promise<ImageRef> {
  const ctx = ImageManipulator.manipulate(source);
  try {
    if (maxSide && typeof source !== 'string') {
      const longest = Math.max(source.width, source.height);
      if (longest > maxSide) {
        ctx.resize(source.width >= source.height ? { width: maxSide } : { height: maxSide });
      }
    }
    return await ctx.renderAsync();
  } finally {
    ctx.release();
  }
}

async function encode(ref: ImageRef, quality: number): Promise<{ dataUrl: string; bytes: number }> {
  const saved = await ref.saveAsync({ format: SaveFormat.JPEG, compress: quality, base64: true });
  if (!saved.base64) throw new PhotoError("We couldn't read that photo. Please try another.");
  return { dataUrl: `data:image/jpeg;base64,${saved.base64}`, bytes: base64Bytes(saved.base64) };
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * Resize (longest side ≤ maxSide, default 1280 px), re-encode as JPEG (default quality 0.8) and
 * return a `data:image/jpeg;base64,…` URL ready for the API. Also returns the encoded size in bytes.
 * Steps size / quality down automatically when the result is above the upload limit (`maxBytes`, default
 * `MAX_UPLOAD_BYTES` — meal scans may pass more); throws `PhotoError` (friendly message) when the photo can't be read
 * or made small enough.
 */
export async function toUploadDataUrl(
  uri: string,
  opts: { maxSide?: number; quality?: number; maxBytes?: number } = {}
): Promise<{ dataUrl: string; bytes: number }> {
  const maxSide = Math.round(clamp(opts.maxSide ?? 1280, 320, 4096));
  const quality = clamp(opts.quality ?? 0.8, 0.3, 1);
  const maxBytes = Math.round(clamp(opts.maxBytes ?? MAX_UPLOAD_BYTES, 100_000, 6_000_000));

  let original: ImageRef;
  try {
    original = await render(uri); // applies EXIF orientation, so width / height are what people see
  } catch {
    throw new PhotoError("We couldn't read that photo. Please try another.");
  }

  // Each step renders from the previous (already smaller) image and frees the one before, so only one
  // full-size bitmap is ever held.
  let ref = original;
  try {
    const attempts: [number, number][] = [
      [maxSide, quality],
      [Math.min(maxSide, 1280), Math.min(quality, 0.7)],
      [Math.min(maxSide, 1100), Math.min(quality, 0.65)],
      [Math.min(maxSide, 960), Math.min(quality, 0.6)],
      [Math.min(maxSide, 800), Math.min(quality, 0.5)],
    ];
    let lastSide = -1;
    for (const [side, q] of attempts) {
      if (side !== lastSide) {
        const next = await render(ref, side);
        release(ref);
        ref = next;
        lastSide = side;
      }
      const out = await encode(ref, q);
      if (out.bytes <= maxBytes) return out;
    }
    throw new PhotoError('That photo is too detailed to upload. Please try a closer, simpler shot.');
  } catch (e) {
    if (e instanceof PhotoError) throw e;
    throw new PhotoError("We couldn't process that photo. Please try another.");
  } finally {
    release(ref);
  }
}

function release(ref: ImageRef) {
  try {
    ref.release();
  } catch {
    // already released
  }
}
