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
 *   and asks for camera access only when the camera is used. `photoPermission` reads the status without asking.
 * - `takePendingPhotos` recovers a photo taken just before Android stopped the app (pass `owner` to `pickPhotos`).
 * - `toUploadDataUrl` uses the contextual expo-image-manipulator API (EXIF orientation applied, metadata dropped),
 *   then steps size / quality down until the JPEG fits under `MAX_UPLOAD_BYTES` (or the caller's `maxBytes`).
 */
import { ImageManipulator, SaveFormat, type ImageRef } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

import { KEYS, readSecureJson, writeSecureJson } from './secure';

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

// Not granted → always ask, even when `canAskAgain` reads false. On Android that flag is remembered from the *last*
// request: after a "Don't allow" twice, then "Ask every time" in system Settings, it still reads false although the
// system would show its dialog again — skipping the request left the camera unusable short of "Allow" in Settings.
// A request for a really blocked permission returns at once without any dialog (Android and iOS) and refreshes the flag.
async function ensureCameraPermission(): Promise<void> {
  let res = await ImagePicker.getCameraPermissionsAsync();
  if (res.granted) return;
  res = await ImagePicker.requestCameraPermissionsAsync();
  if (res.granted) return;
  throw new PhotoPermissionError(res.canAskAgain ? 'denied' : 'blocked', 'camera');
}

async function ensureLibraryPermission(): Promise<void> {
  let res = await ImagePicker.getMediaLibraryPermissionsAsync();
  if (res.granted) return;
  res = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (res.granted) return;
  throw new PhotoPermissionError(res.canAskAgain ? 'denied' : 'blocked', 'library');
}

/**
 * The current camera / photo-library permission, without asking — e.g. to refresh a "needs access" message when the
 * app comes back from system Settings. ("blocked" can be stale on Android until the next request — see above.)
 */
export async function photoPermission(source: PhotoSource): Promise<PhotoPermission> {
  const res = source === 'camera' ? await ImagePicker.getCameraPermissionsAsync() : await ImagePicker.getMediaLibraryPermissionsAsync();
  if (res.granted) return 'granted';
  return res.canAskAgain ? 'denied' : 'blocked';
}

function toPicked(result: ImagePicker.ImagePickerResult, max: number): PickedPhoto[] {
  if (result.canceled || !result.assets?.length) return [];
  return result.assets
    .filter((a) => !a.type || a.type === 'image' || a.type === 'livePhoto')
    .slice(0, Math.max(1, max))
    .map((a) => ({ uri: a.uri, width: a.width, height: a.height }));
}

/* Android can stop ÖRZA while the camera / photo picker is in front (low memory — common on 2–3 GB phones). The system
   then restarts the app and hands it the photo, which `ImagePicker.getPendingResultAsync` returns once. Callers that can
   pick up again pass an `owner`; it is remembered while the picker is open so the restarted app knows whose photo it is.
   Not verifiable on the dev-client build: there the restarted app gets `null` (the dev launcher creates the React
   context ~20 s after the camera's result arrives) — the mark is read correctly; check the photo comes back on a
   release / preview build (camera open → `adb shell am kill in.co.ylo.orza` → take the photo). */
type PendingPick = { owner: string; at: number };
const PENDING_MAX_AGE_MS = 30 * 60_000;

async function withPendingMark<T>(owner: string | undefined, launch: () => Promise<T>): Promise<T> {
  const mark = !!owner && Platform.OS === 'android';
  if (mark) await writeSecureJson(KEYS.pendingPick, { owner, at: Date.now() } satisfies PendingPick);
  try {
    return await launch();
  } finally {
    if (mark) void writeSecureJson(KEYS.pendingPick, null);
  }
}

/**
 * Android only: the photos `owner` took / chose just before Android stopped ÖRZA (see above) — [] when there are none,
 * or when the camera was opened by another screen (left for that screen). Read once per app start.
 */
export async function takePendingPhotos(owner: string, max = 1): Promise<PickedPhoto[]> {
  if (Platform.OS !== 'android') return [];
  const mark = await readSecureJson<PendingPick>(KEYS.pendingPick);
  if (!mark || mark.owner !== owner) return [];
  await writeSecureJson(KEYS.pendingPick, null);
  if (!(Date.now() - mark.at < PENDING_MAX_AGE_MS)) return [];
  try {
    const result = await ImagePicker.getPendingResultAsync();
    return result && 'assets' in result ? toPicked(result, max) : [];
  } catch {
    return [];
  }
}

/**
 * Ask for camera / photo-library permission when needed and let the user take or choose photos.
 * Returns [] when the user cancels. Throws `PhotoPermissionError` when permission is refused
 * (status "blocked" means the user must enable it in system Settings). `owner`: see `takePendingPhotos`.
 */
export async function pickPhotos(
  source: PhotoSource,
  opts: { multiple?: boolean; max?: number; owner?: string } = {}
): Promise<PickedPhoto[]> {
  const max = Math.max(1, Math.floor(opts.max ?? (opts.multiple ? 10 : 1)));
  const multiple = !!opts.multiple && max > 1;

  if (source === 'camera') {
    await ensureCameraPermission();
    const result = await withPendingMark(opts.owner, () =>
      ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1, exif: false, base64: false })
    );
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
    return toPicked(await withPendingMark(opts.owner, () => ImagePicker.launchImageLibraryAsync(options)), max);
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
