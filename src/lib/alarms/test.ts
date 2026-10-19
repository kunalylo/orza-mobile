/**
 * "Test alarm" — rings on this phone in 10 s exactly like a medicine alarm, so the member (and their family) can see
 * and hear what a dose looks like before the first real one:
 * - Android: the native alarm (`scheduleOne`, key `test:<ts>`): alarm channel, sound + vibration, full screen over the
 *   lock screen, the photo, Take / Snooze / Skip (they record nothing for a test).
 * - iOS: a time-sensitive notification with the alarm sound and the photo attached (a copy — iOS moves attachments).
 * The photo is the first medicine's alarm photo (downloaded if needed) or a bundled sample strip. Tapping / the full
 * screen opens `/alarm?test=<at>` (the alarm's key is `test:<at>`), a demo of the alarm screen that records nothing.
 * What the test showed is kept in a small file, so the demo screen still finds it when the alarm starts the app.
 */
import { Directory, File, Paths } from 'expo-file-system';
import { Image } from 'expo-image';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import type { OrzaNotificationData } from '@/lib/notifications';

import * as OrzaAlarms from '../../../modules/orza-alarms';
import sampleAlarmPhoto from '../../../assets/images/alarm-sample.png';

import { alarmAdapter } from './adapter';
import { alarmSound, buildContent, copyForAttachment, dateTrigger, discardCopy } from './notifications-ios';
import { ensureAlarmPhoto } from './photos';
import { PHOTOS_PER_MEDICINE } from './plan';
import { readJsonFile, TEST_ALARM_FILE, writeJsonFile } from './store';
import { requestAlarmPermission } from './sync';
import { deepLinkFor, type PlanMedication } from './types';

export const TEST_ALARM_DELAY_MS = 10_000;
/** In-app route of the test alarm due at `at` (epoch ms). */
export const testAlarmPath = (at: number) => `/alarm?test=${at}`;
/** Key of the test alarm due at `at` (`test` param of its route). */
export const testAlarmKey = (test: string | number) => `test:${test}`;
const TITLE = '💊 Test alarm — this is how ÖRZA rings';

/** The bundled sample photo (module id for `<Image source>`). */
export const SAMPLE_ALARM_PHOTO: number = sampleAlarmPhoto;

export type TestAlarmResult =
  | { ok: true; at: number; photo: 'medicine' | 'sample' | 'none'; medicine?: string }
  | { ok: false; reason: 'unsupported' | 'permission' | 'failed' };

interface TestRecord {
  at: number;
  photoUri: string | null;
  medicine?: string;
}

/** What the last test showed (the demo alarm screen shows the same photo). */
let lastTest: TestRecord | null = null;

const fileExists = (uri: string | null): boolean => {
  if (!uri) return false;
  try {
    return new File(uri).exists;
  } catch {
    return false;
  }
};

/**
 * The photo and medicine name the test alarm `test` showed — from memory, else the file (the alarm may have started
 * the app). The bundled sample's JPEG when the record is gone. Never throws.
 */
export function testAlarmDetails(test: string | null | undefined): { photoUri: string | null; medicine?: string } {
  const stored = lastTest ?? readJsonFile<TestRecord>(TEST_ALARM_FILE);
  const record = stored && (!test || String(stored.at) === test) ? stored : null;
  if (record && fileExists(record.photoUri)) return { photoUri: record.photoUri, ...(record.medicine ? { medicine: record.medicine } : {}) };
  const sample = sampleFile();
  return { photoUri: sample && fileExists(sample.uri) ? sample.uri : null, ...(record?.medicine ? { medicine: record.medicine } : {}) };
}

function sampleFile(): File | null {
  try {
    return new File(Paths.cache, 'orza-alarm-test', 'sample-v1.jpg');
  } catch {
    return null;
  }
}

/** The first active, alarm-ringing medicine with a photo. */
function photoMedicine(meds: readonly PlanMedication[]): PlanMedication | null {
  return meds.find((m) => m.active !== false && !m.as_needed && (m.photo_ids?.length ?? 0) > 0) ?? null;
}

/** The sample strip as a JPEG file (Android's big picture and iOS attachments need a `file://`). Cached. */
async function samplePhotoFile(): Promise<string | null> {
  try {
    const dir = new Directory(Paths.cache, 'orza-alarm-test');
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
    const dest = sampleFile() ?? new File(dir, 'sample-v1.jpg');
    if (dest.exists) return dest.uri;
    const ref = await Image.loadAsync(SAMPLE_ALARM_PHOTO);
    const ctx = ImageManipulator.manipulate(ref);
    try {
      const rendered = await ctx.renderAsync();
      const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.85 });
      rendered.release();
      new File(saved.uri).move(dest, { overwrite: true });
    } finally {
      ctx.release();
      ref.release();
    }
    return dest.exists ? dest.uri : null;
  } catch {
    return null;
  }
}

async function pickPhoto(meds: readonly PlanMedication[]): Promise<{ uri: string | null; kind: 'medicine' | 'sample' | 'none'; medicine?: string }> {
  const med = photoMedicine(meds);
  if (med) {
    const ids = (med.photo_ids ?? []).slice(0, PHOTOS_PER_MEDICINE);
    const urls = med.photo_urls ?? [];
    const id = ids[0];
    const uri = id ? await ensureAlarmPhoto({ id, url: urls[0] || `/api/media/${encodeURIComponent(id)}` }) : null;
    if (uri) return { uri, kind: 'medicine', medicine: med.name };
  }
  const sample = await samplePhotoFile();
  return { uri: sample, kind: sample ? 'sample' : 'none' };
}

async function scheduleIos(key: string, at: number, body: string, photo: string | null): Promise<boolean> {
  const path = testAlarmPath(at);
  const data: OrzaNotificationData = {
    orza: 1,
    key,
    kind: 'dose',
    ring: true,
    at,
    path,
    url: path,
    deepLink: deepLinkFor(path),
    doses: [],
  };
  const source = { title: TITLE, body, ring: true, doses: [] };
  const attempt = async (withPhoto: boolean) => {
    const copy = withPhoto && photo ? await copyForAttachment(photo, key) : null;
    try {
      await Notifications.scheduleNotificationAsync({
        identifier: key,
        content: buildContent(source, data, { sound: alarmSound(), attachment: copy }),
        trigger: dateTrigger(at),
      });
      return true;
    } catch {
      discardCopy(copy);
      return false;
    }
  };
  return (await attempt(true)) || (!!photo && (await attempt(false)));
}

/**
 * Schedule the test ring in `TEST_ALARM_DELAY_MS`. Asks for notification permission first when it can. Never throws.
 */
export async function scheduleTestAlarm(meds: readonly PlanMedication[]): Promise<TestAlarmResult> {
  if (alarmAdapter.maxScheduled <= 0 || (Platform.OS !== 'ios' && Platform.OS !== 'android')) return { ok: false, reason: 'unsupported' };
  try {
    let status = await alarmAdapter.status();
    if (status.notifications !== 'granted' && status.canAskNotifications) status = await requestAlarmPermission();
    if (status.notifications !== 'granted') return { ok: false, reason: 'permission' };

    const photo = await pickPhoto(meds);
    const at = Date.now() + TEST_ALARM_DELAY_MS;
    const key = testAlarmKey(at);
    const body = photo.kind === 'medicine' ? `Real alarms show each medicine's photo — like ${photo.medicine}.` : 'Real alarms show the photo of each medicine to take.';
    let ok: boolean;
    if (Platform.OS === 'android') {
      ok = await OrzaAlarms.scheduleOne({
        key,
        kind: 'test',
        at,
        title: TITLE,
        body,
        ring: true,
        deepLink: deepLinkFor(testAlarmPath(at)),
        photos: photo.uri ? [photo.uri] : [],
        doses: [],
        details: `${body}\nTake / Snooze / Skip record nothing on a test.`,
      });
    } else {
      ok = await scheduleIos(key, at, body, photo.uri);
    }
    if (!ok) return { ok: false, reason: 'failed' };
    lastTest = { at, photoUri: photo.uri, ...(photo.medicine ? { medicine: photo.medicine } : {}) };
    writeJsonFile(TEST_ALARM_FILE, lastTest);
    return { ok: true, at, photo: photo.kind, ...(photo.medicine ? { medicine: photo.medicine } : {}) };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}
