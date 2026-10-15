/**
 * Medicine photos for alarms, kept on the phone so an alarm shows them offline, with the app killed, on a locked phone.
 *
 * - Downloaded from the protected `/api/media/<id>` URL with the Bearer header (`mediaSource`, like every photo in the
 *   app) into `Documents/orza-alarm-photos/<mediaId>.jpg`, cached by media id (a media id's image never changes).
 * - Normalised to JPEG, longest side ≤ 1080 px: iOS notification attachments accept JPEG / PNG / GIF only (members
 *   may have uploaded WebP on the website), and a full-screen alarm doesn't need more.
 * - Never blocks an alarm: a failed or slow download just leaves the photo out (the alarm still rings); it is retried
 *   on a later sync (backing off per photo), and the next plan carries it once it's there.
 * - Files no medicine uses any more are deleted; the folder is capped in size (oldest first).
 */
import { Directory, File, FileMode, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import { mediaSource } from '@/lib/api';

import type { AlarmPlanItem, PhotoRef } from './types';

const DIR_NAME = 'orza-alarm-photos';
const MAX_TOTAL_BYTES = 40 * 1024 * 1024;
const MAX_SIDE = 1080;
const JPEG_QUALITY = 0.8;
const DOWNLOAD_TIMEOUT_MS = 20_000;
const DEFAULT_BUDGET_MS = 25_000;
const CONCURRENCY = 2;
/** After a failed download, wait this long before trying that photo again. */
const RETRY_AFTER_MS = 10 * 60_000;

const failedAt = new Map<string, number>();

function photoDir(): Directory | null {
  try {
    const dir = new Directory(Paths.document, DIR_NAME);
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
    return dir;
  } catch {
    return null; // web preview / storage unavailable
  }
}

/** Media ids are server ids; keep file names to a safe alphabet. */
const fileStem = (id: string) => id.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80);

const IMAGE_EXT = /\.(jpg|png)$/i;

/** Cached photo files by stem. Stray partial downloads are removed. */
function listCached(dir: Directory): Map<string, File> {
  const out = new Map<string, File>();
  try {
    for (const entry of dir.list()) {
      if (!(entry instanceof File)) continue;
      const name = entry.name;
      if (IMAGE_EXT.test(name)) out.set(name.replace(IMAGE_EXT, ''), entry);
      else if (/\.part$/.test(name)) safeDelete(entry);
    }
  } catch {
    // unreadable folder — behave as empty
  }
  return out;
}

function safeDelete(f: File | Directory) {
  try {
    if (f.exists) f.delete();
  } catch {
    // ignore
  }
}

function sniff(file: File): 'jpg' | 'png' | null {
  try {
    const handle = file.open(FileMode.ReadOnly);
    try {
      const b = handle.readBytes(8);
      if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
      if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
      return null;
    } finally {
      handle.close();
    }
  } catch {
    return null;
  }
}

/** Re-encode `part` as a JPEG (longest side ≤ MAX_SIDE) at `dest`. Falls back to the original when it's JPEG / PNG. */
async function normalise(part: File, dir: Directory, stem: string): Promise<File | null> {
  try {
    const ctx = ImageManipulator.manipulate(part.uri);
    let saved: { uri: string };
    try {
      const original = await ctx.renderAsync();
      let ref = original;
      const longest = Math.max(original.width, original.height);
      if (longest > MAX_SIDE) {
        const resize = ImageManipulator.manipulate(original);
        try {
          resize.resize(original.width >= original.height ? { width: MAX_SIDE } : { height: MAX_SIDE });
          ref = await resize.renderAsync();
        } finally {
          resize.release();
        }
      }
      saved = await ref.saveAsync({ format: SaveFormat.JPEG, compress: JPEG_QUALITY });
      if (ref !== original) ref.release();
      original.release();
    } finally {
      ctx.release();
    }
    const out = new File(saved.uri);
    const dest = new File(dir, `${stem}.jpg`);
    out.move(dest, { overwrite: true });
    safeDelete(part);
    return dest;
  } catch {
    const kind = sniff(part);
    if (!kind) {
      safeDelete(part);
      return null;
    }
    try {
      const dest = new File(dir, `${stem}.${kind}`);
      part.move(dest, { overwrite: true });
      return dest;
    } catch {
      safeDelete(part);
      return null;
    }
  }
}

async function download(ref: PhotoRef, dir: Directory): Promise<File | null> {
  const source = mediaSource(ref.url);
  if (!source) return null;
  const stem = fileStem(ref.id);
  const part = new File(dir, `${stem}.part`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const got = await File.downloadFileAsync(source.uri, part, {
      headers: { ...('headers' in source ? source.headers : {}), Accept: 'image/*', 'X-ORZA-Client': 'mobile' },
      idempotent: true,
      signal: controller.signal,
    });
    return await normalise(got, dir, stem);
  } catch {
    safeDelete(part); // Android may leave a partial file behind
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function refsOf(items: AlarmPlanItem[]): Map<string, PhotoRef> {
  const refs = new Map<string, PhotoRef>();
  for (const item of items) {
    for (const r of item.photoRefs) refs.set(r.id, r);
    for (const d of item.doses ?? []) for (const r of d.photoRefs) refs.set(r.id, r);
  }
  return refs;
}

export interface PhotoResult {
  downloaded: number;
  failed: number;
  /** Photos the items asked for that are on the phone. */
  available: number;
}

/**
 * Makes sure the items' photos are on the phone (downloading what's missing, within `budgetMs`), then fills
 * `item.photos` / `dose.photos` with local URIs, in `photoRefs` order. `keepIds`: other media ids worth keeping
 * (e.g. photos of medicines whose alarms are beyond the cap). Never throws.
 */
export async function attachAlarmPhotos(
  items: AlarmPlanItem[],
  opts: { keepIds?: Iterable<string>; budgetMs?: number } = {}
): Promise<PhotoResult> {
  const result: PhotoResult = { downloaded: 0, failed: 0, available: 0 };
  const dir = photoDir();
  if (!dir) return result;
  const cached = listCached(dir);
  const wanted = refsOf(items);
  const now = Date.now();
  const missing = [...wanted.values()].filter((r) => !cached.has(fileStem(r.id)) && now - (failedAt.get(r.id) ?? 0) > RETRY_AFTER_MS);

  // Download what's missing — a couple at a time, stopping when the time budget is spent.
  const deadline = now + (opts.budgetMs ?? DEFAULT_BUDGET_MS);
  let next = 0;
  const worker = async () => {
    while (next < missing.length && Date.now() < deadline) {
      const ref = missing[next++];
      const file = await download(ref, dir);
      if (file) {
        cached.set(fileStem(ref.id), file);
        failedAt.delete(ref.id);
        result.downloaded++;
      } else {
        failedAt.set(ref.id, Date.now());
        result.failed++;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, missing.length) }, worker));

  const local = (ref: PhotoRef) => cached.get(fileStem(ref.id))?.uri;
  for (const item of items) {
    item.photos = item.photoRefs.map(local).filter((u): u is string => !!u);
    for (const d of item.doses ?? []) d.photos = d.photoRefs.map(local).filter((u): u is string => !!u);
  }
  result.available = [...wanted.values()].filter((r) => !!local(r)).length;

  prune(cached, new Set([...wanted.keys(), ...(opts.keepIds ?? [])].map(fileStem)), new Set([...wanted.keys()].map(fileStem)));
  return result;
}

/** Delete photos nobody needs, then the oldest until the folder fits the cap (never one the current plan uses). */
function prune(cached: Map<string, File>, keep: Set<string>, inUse: Set<string>) {
  for (const [stem, file] of cached) {
    if (!keep.has(stem)) {
      safeDelete(file);
      cached.delete(stem);
    }
  }
  const sized = [...cached.entries()].map(([stem, file]) => {
    let size = 0;
    let modified = 0;
    try {
      size = file.size ?? 0;
      modified = file.lastModified ?? 0;
    } catch {
      // unreadable — counts as empty
    }
    return { stem, file, size, modified };
  });
  let total = sized.reduce((sum, f) => sum + f.size, 0);
  if (total <= MAX_TOTAL_BYTES) return;
  for (const f of sized.sort((a, b) => a.modified - b.modified)) {
    if (total <= MAX_TOTAL_BYTES) break;
    if (inUse.has(f.stem)) continue;
    safeDelete(f.file);
    cached.delete(f.stem);
    total -= f.size;
  }
}

/** Delete every cached alarm photo (sign-out). */
export function clearAlarmPhotos(): void {
  failedAt.clear();
  try {
    const dir = new Directory(Paths.document, DIR_NAME);
    if (dir.exists) dir.delete();
  } catch {
    // ignore
  }
}
