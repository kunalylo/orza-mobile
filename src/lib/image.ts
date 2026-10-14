/**
 * Photo capture + upload preparation shared by Snap & Know (meals), medicine photos and
 * prescription scans.
 *
 * INTERFACE CONTRACT — other features import exactly these exports. The implementation is
 * owned by the Medicines work-stream (B2); until then these are typed stubs.
 *
 * Server limits (see the web API): images are sent as JSON `data:image/jpeg;base64,…` URLs,
 * ≤ 1.5 MB after compression for medicine/prescription photos and ≤ ~6 MB for meal scans.
 */

export type PhotoSource = "camera" | "library";

export interface PickedPhoto {
  uri: string; // local file URI (show with expo-image)
  width: number;
  height: number;
}

export type PhotoPermission = "granted" | "denied" | "blocked";

/**
 * Ask for camera / photo-library permission when needed and let the user take or choose photos.
 * Returns [] when the user cancels. Throws `PhotoPermissionError` when permission is refused
 * (status "blocked" means the user must enable it in system Settings).
 */
export async function pickPhotos(source: PhotoSource, opts: { multiple?: boolean; max?: number } = {}): Promise<PickedPhoto[]> {
  void source;
  void opts;
  throw new Error("pickPhotos is implemented by the Medicines stream (B2)");
}

/**
 * Resize (longest side ≤ maxSide, default 1280 px), re-encode as JPEG (default quality 0.8) and
 * return a `data:image/jpeg;base64,…` URL ready for the API. Also returns the encoded size in bytes.
 */
export async function toUploadDataUrl(uri: string, opts: { maxSide?: number; quality?: number } = {}): Promise<{ dataUrl: string; bytes: number }> {
  void uri;
  void opts;
  throw new Error("toUploadDataUrl is implemented by the Medicines stream (B2)");
}

export class PhotoPermissionError extends Error {
  constructor(public status: Exclude<PhotoPermission, "granted">, public source: PhotoSource) {
    super(source === "camera" ? "Camera access is needed to take a photo." : "Photo access is needed to choose a photo.");
  }
}
