/**
 * Share the weekly CSV: write it to the cache directory (expo-file-system `File` / `Paths`) and open the
 * system share sheet (expo-sharing) — Save to Files, Drive, email, WhatsApp…
 */
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { weeklyCsv, weeklyCsvName } from './format';
import type { WeeklyReport } from './types';

export class ShareUnavailableError extends Error {
  constructor() {
    super("Sharing isn't available on this device.");
    this.name = 'ShareUnavailableError';
  }
}

export async function shareWeeklyCsv(w: WeeklyReport, imperial: boolean): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) throw new ShareUnavailableError();
  const file = new File(Paths.cache, weeklyCsvName(w));
  file.create({ overwrite: true });
  file.write(weeklyCsv(w, imperial));
  await Sharing.shareAsync(file.uri, {
    mimeType: 'text/csv',
    UTI: 'public.comma-separated-values-text',
    dialogTitle: 'Share your weekly report',
  });
}
