/**
 * iPhone: Apple Health wakes ÖRZA when new steps arrive (`docs/notes/steps-v2.md` §4.3) — hourly at most, also after
 * the app was closed — and ÖRZA then saves the member's count (`sync.syncStepsInBackground`), so the website stays
 * current without opening the app.
 *
 * - The steps reader (`reader.ios.ts`) sets the delivery up natively while Apple Health is ON for the member
 *   (`configureBackgroundTypes`, kept across launches by the HealthKit module) and clears it when it goes off and at
 *   sign-out; the prefs say which (`store.hkBackground`).
 * - This module adds the JavaScript side: a `subscribeToChanges` callback for StepCount while the prefs say the
 *   delivery is set up — at start, and whenever that flips in a running app. It drops the callback when the delivery is
 *   cleared, and subscribes anew after every new setup: the native setup tears its observer down and forgets the
 *   callback it had.
 * - Imported by `index.ts` before `expo-router/entry`: when HealthKit launches ÖRZA in the background, the callback must
 *   exist early (the HealthKit module queues the wake-up's event until a callback subscribes, then hands it over). It
 *   calls HealthKit's completion handler natively (research §3.4), so the "three misses and Apple stops waking you"
 *   rule can't trigger.
 * - Loaded lazily and wrapped in try/catch: a build without the HealthKit module (Expo Go) never crashes at start.
 */
import { hkBackground, subscribeStepsStore } from './store';

const STEP_COUNT = 'HKQuantityTypeIdentifierStepCount' as const;

type Subscription = { remove: () => unknown };

let subscription: Subscription | null = null;
/** Bumped on every change: a subscription that resolves after a newer change is dropped. */
let generation = 0;
/** What the prefs said at the last change seen. */
let configured = false;

function onNewSteps() {
  void import('./sync').then((m) => m.syncStepsInBackground()).catch(() => undefined);
}

function unsubscribe() {
  const s = subscription;
  subscription = null;
  try {
    s?.remove();
  } catch {
    // already gone with the native setup
  }
}

/** Follow the native setup: a fresh callback while it is on, none while it is off. */
function follow(on: boolean) {
  generation += 1;
  const gen = generation;
  unsubscribe();
  if (!on) return;
  import('@kingstinct/react-native-healthkit')
    .then((hk) => {
      if (gen !== generation) return;
      subscription = hk.subscribeToChanges(STEP_COUNT, onNewSteps);
    })
    .catch(() => undefined); // no HealthKit module in this build
}

try {
  configured = hkBackground();
  if (configured) follow(true);
  subscribeStepsStore(() => {
    const now = hkBackground();
    if (now === configured) return;
    configured = now;
    follow(now);
  });
} catch {
  // Never stop the app's start: background delivery just doesn't reach JavaScript in this run.
}
