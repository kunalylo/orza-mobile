/**
 * A Snap photo that survived Android stopping ÖRZA while the camera / photo picker was open (low memory). The tabs
 * layout picks it up once per app start (`recoverSnapPhoto`) and opens Snap, which takes it from here.
 */
import { router } from 'expo-router';

import { takePendingPhotos, type PickedPhoto } from '@/lib/image';

/** `owner` for `pickPhotos` from the Snap screen. */
export const SNAP_PICK_OWNER = 'snap';

let pending: PickedPhoto | null = null;
let checked = false;

/** Once per app start: when the last Snap camera / gallery pick came back to a restarted app, open Snap with it. */
export async function recoverSnapPhoto(): Promise<void> {
  if (checked) return;
  checked = true;
  const [photo] = await takePendingPhotos(SNAP_PICK_OWNER);
  if (!photo) return;
  pending = photo;
  router.navigate('/snap');
}

/** The recovered photo, handed out once. */
export function takeRecoveredSnapPhoto(): PickedPhoto | null {
  const photo = pending;
  pending = null;
  return photo;
}
