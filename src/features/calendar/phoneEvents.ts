/**
 * The words of a medicine dose in the phone's ÖRZA calendar (`deviceCalendar.ts`). Pure, so `npm run test:calendar`
 * loads it in Node.
 *
 * iPhone (App Review 5.1.3(ii), D3 decision D4): the ÖRZA calendar is made in the default calendar's account, on most
 * iPhones iCloud, which copies it to Apple's servers and the member's other devices. So an iPhone event names no
 * medicine and carries none of its details (strength, timing, who it is for): only "💊 Medicine time · ÖRZA", whether
 * the dose was taken or skipped, and the way back into ÖRZA (the event's `orza://alarm` link opens the dose with its
 * name and photos). Android is unchanged: its calendar is under a local account that syncs nowhere.
 */
import type { DoseEventStatus } from './types';

export type PhonePlatform = 'ios' | 'android';

export const PHONE_EVENT_COPY = {
  /** iPhone: the title of every medicine dose event. */
  iosMedicineTitle: '💊 Medicine time · ÖRZA',
  /** iPhone: the event's note (after the taken / skipped line). */
  iosMedicineNote: 'Open ÖRZA to see which medicine it is and mark the dose.',
  /** Android: the event's note (after the dose details and the taken / skipped line). */
  androidMedicineNote: "Open ÖRZA to see the medicine's photos and mark the dose.",
  taken: 'Marked as taken in ÖRZA.',
  skipped: 'Marked as skipped in ÖRZA.',
  /** iPhone: the Calendar screen's "Add ÖRZA to my phone calendar" card, after its first sentence. */
  iosCardNote: 'Medicine events say “Medicine time” without the medicine’s name, because your calendar can sync to iCloud. Open ÖRZA to see which medicine it is.',
} as const;

export interface DoseEventText {
  /** The medicine's name. */
  title: string;
  /** "500 mg · After food · for Mom" (the server's dose, timing and person, joined by " · "). */
  subtitle?: string;
  status?: DoseEventStatus;
}

/** Title and notes of a dose event on `platform`. `webLink`: the dose's page on the website, the notes' last line. */
export function medicineEventText(e: DoseEventText, platform: PhonePlatform, webLink: string): { title: string; notes: string } {
  const statusLine = e.status === 'taken' ? PHONE_EVENT_COPY.taken : e.status === 'skipped' ? PHONE_EVENT_COPY.skipped : '';
  if (platform === 'ios') {
    return {
      title: PHONE_EVENT_COPY.iosMedicineTitle,
      notes: [statusLine, PHONE_EVENT_COPY.iosMedicineNote, webLink].filter(Boolean).join('\n'),
    };
  }
  const [doseText, ...rest] = (e.subtitle || '').split(' · ');
  return {
    title: `💊 ${e.title}${doseText ? ` — ${doseText}` : ''}`,
    notes: [[doseText, ...rest].filter(Boolean).join(' · '), statusLine, PHONE_EVENT_COPY.androidMedicineNote, webLink].filter(Boolean).join('\n'),
  };
}
