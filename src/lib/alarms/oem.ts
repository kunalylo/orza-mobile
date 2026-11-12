/**
 * "Keep medicine alarms working" — phone makers whose battery managers close apps on their own (dontkillmyapp.com).
 * V2 real phone (vivo V2544, Android 16): vivo force-stopped ÖRZA at 10:39 ("stop in.co.ylo.orza due to stop"); a
 * force-stopped app's alarms and background job are gone, and nothing rings until the member opens ÖRZA again. No
 * code can undo that — only the member's settings can stop it, so ÖRZA says once, after the first medicine alarm is
 * set, which settings to change on this maker's phones, and opens the best screen it can.
 *
 * Pure (the native module's types only), so `npm run test:alarms` covers it: `makerOf` (Build.MANUFACTURER / BRAND,
 * from expo-device), `keepAliveGuide` (the steps and the screens to try), `shouldOfferKeepAlive` (the one-time sheet)
 * and `keepAliveRowShown` (the way back on Reminders & alarms › Alarms on this phone).
 *
 * The button tries the maker's own screens first, then ÖRZA's App info, then Android's battery-optimisation list
 * (`openKeepAliveSettings`). Never REQUEST_IGNORE_BATTERY_OPTIMIZATIONS: Google Play restricts it to apps whose core
 * function breaks without it, and the list is enough. vivo / iQOO and Samsung open App info first: on the V2544 it
 * holds the setting that matters (Battery usage › Background power control), and Samsung's "Unrestricted" is there too.
 */
import type { KeepAliveTarget } from '../../../modules/orza-alarms/src/OrzaAlarms.types';

/** Maker families with the same settings. */
export type Maker = 'vivo' | 'xiaomi' | 'oppo' | 'huawei' | 'samsung';

/** Build.BRAND / Build.MANUFACTURER (lower case) → the family and the name the copy uses. */
const BRANDS: Readonly<Record<string, { maker: Maker; name: string }>> = {
  vivo: { maker: 'vivo', name: 'vivo' },
  iqoo: { maker: 'vivo', name: 'iQOO' },
  xiaomi: { maker: 'xiaomi', name: 'Xiaomi' },
  redmi: { maker: 'xiaomi', name: 'Redmi' },
  poco: { maker: 'xiaomi', name: 'POCO' },
  oppo: { maker: 'oppo', name: 'OPPO' },
  realme: { maker: 'oppo', name: 'realme' },
  oneplus: { maker: 'oppo', name: 'OnePlus' },
  huawei: { maker: 'huawei', name: 'Huawei' },
  honor: { maker: 'huawei', name: 'Honor' },
  samsung: { maker: 'samsung', name: 'Samsung' },
};

export interface PhoneMaker {
  maker: Maker;
  /** "vivo", "iQOO", "Redmi", … — the brand when it is a known one (an iQOO phone is made by vivo). */
  name: string;
}

/** The phone's maker family, from Build.BRAND first (iQOO, Redmi, POCO), else Build.MANUFACTURER; null elsewhere. */
export function makerOf(manufacturer: string | null | undefined, brand?: string | null): PhoneMaker | null {
  for (const raw of [brand, manufacturer]) {
    const key = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
    const known = key ? BRANDS[key] : undefined;
    if (known) return { ...known };
  }
  return null;
}

export interface KeepAliveGuide {
  maker: Maker;
  name: string;
  title: string;
  intro: string;
  /** The settings to change, in order (each names its path, whichever screen the button opens). */
  steps: string[];
  /** What the button tries, in order: the maker's screens, App info, the battery-optimisation list. */
  targets: KeepAliveTarget[];
}

const component = (pkg: string, cls: string): KeepAliveTarget => ({ type: 'component', pkg, cls });

/** The maker's own screens (autostart / app launch managers), known from dontkillmyapp.com and AutoStarter. */
const SCREENS: Record<Maker, KeepAliveTarget[]> = {
  vivo: [],
  samsung: [],
  xiaomi: [
    component('com.miui.securitycenter', 'com.miui.permcenter.autostart.AutoStartManagementActivity'),
    component('com.miui.powerkeeper', 'com.miui.powerkeeper.ui.HiddenAppsConfigActivity'),
  ],
  oppo: [
    component('com.coloros.safecenter', 'com.coloros.safecenter.permission.startup.StartupAppListActivity'),
    component('com.coloros.safecenter', 'com.coloros.safecenter.startupapp.StartupAppListActivity'),
    component('com.oppo.safe', 'com.oppo.safe.permission.startup.StartupAppListActivity'),
    component('com.oneplus.security', 'com.oneplus.security.chainlaunch.view.ChainLaunchAppListActivity'),
  ],
  huawei: [
    component('com.huawei.systemmanager', 'com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity'),
    component('com.huawei.systemmanager', 'com.huawei.systemmanager.optimize.process.ProtectActivity'),
    component('com.hihonor.systemmanager', 'com.hihonor.systemmanager.startupmgr.ui.StartupNormalAppListActivity'),
  ],
};

const STEPS: Record<Maker, string[]> = {
  vivo: [
    'Battery: choose “Allow background power usage” in Settings › Apps › ÖRZA › Battery usage › Background power control.',
    'Autostart: turn it on for ÖRZA in Settings › Apps › Autostart, if your phone has it.',
  ],
  xiaomi: [
    'Autostart: turn it on in Settings › Apps › Manage apps › ÖRZA › Autostart.',
    'Battery saver: choose “No restrictions” in Settings › Apps › Manage apps › ÖRZA › Battery saver.',
  ],
  oppo: [
    'Battery: turn on “Allow background activity” in Settings › Apps › ÖRZA › Battery usage.',
    'Auto launch: turn on “Allow auto launch” on the same page, or in Settings › Apps › Auto launch.',
  ],
  huawei: [
    'App launch: in Settings › Battery › App launch, turn off “Manage automatically” for ÖRZA and keep Auto-launch, Secondary launch and Run in background on.',
  ],
  samsung: [
    'Battery: choose “Unrestricted” in Settings › Apps › ÖRZA › Battery.',
    'Sleeping apps: make sure ÖRZA isn’t listed in Settings › Battery › Background usage limits.',
  ],
};

/** The guide for `phone`: its steps and the screens the button tries (App info and the battery list always last). */
export function keepAliveGuide(phone: PhoneMaker): KeepAliveGuide {
  const fallbacks: KeepAliveTarget[] = [{ type: 'app' }, { type: 'battery' }];
  return {
    maker: phone.maker,
    name: phone.name,
    title: 'Keep medicine alarms working',
    intro: `${phone.name} phones can close ÖRZA to save battery. Its medicine alarms then can’t ring until you open ÖRZA again. Change this once:`,
    steps: STEPS[phone.maker],
    targets: [...SCREENS[phone.maker], ...fallbacks],
  };
}

export interface KeepAliveOfferInputs {
  /** This phone's maker family (null: not one known to close apps). */
  maker: Maker | null;
  /** The sheet was shown on this install before. */
  seen: boolean;
  /** Medicine alarms set on this phone (the engine's last run). */
  doseAlarms: number;
  /** Notifications are allowed (the alarms can ring). */
  notificationsGranted: boolean;
  /** Another sheet is up ("Let your medicine alarms ring", an alarm on screen). */
  busy: boolean;
  /** Android's battery-optimisation exemption ("Unrestricted"); null / undefined: not known. */
  batteryUnrestricted?: boolean | null;
}

/**
 * Samsung puts apps to sleep unless their battery is "Unrestricted", which also takes them out of its sleeping
 * lists — so there the guide is for a phone without it. Other makers' managers close apps whatever Android's
 * exemption says.
 */
export function keepAliveRowShown(maker: Maker | null, batteryUnrestricted?: boolean | null): boolean {
  if (!maker) return false;
  return maker !== 'samsung' || batteryUnrestricted !== true;
}

/** The one-time sheet: right after the member's first medicine alarm is set on such a phone, once per install. */
export function shouldOfferKeepAlive(i: KeepAliveOfferInputs): boolean {
  if (i.seen || i.busy || !i.notificationsGranted || i.doseAlarms <= 0) return false;
  return keepAliveRowShown(i.maker, i.batteryUnrestricted);
}
