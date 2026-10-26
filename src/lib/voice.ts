/**
 * Voice input (speech → text) shared by the meal composer and Ask ÖRZA chat — expo-speech-recognition.
 *
 * INTERFACE CONTRACT — other features import exactly these exports (`VoiceLang`, `VoiceInput`, `useVoiceInput`), plus
 * `loadVoiceLang` / `saveVoiceLang` so every composer shares the member's last voice language.
 *
 * - The native module is loaded with `requireOptionalNativeModule`, never through the package's JS entry (which throws at
 *   import time when the module is missing, e.g. in Expo Go) — so a build without it simply reports `available: false`.
 * - Availability: Android needs a speech RecognitionService (Google app / Speech Services); re-checked on foreground.
 *   iOS always has SFSpeechRecognizer — when it can't run (offline, Dictation off) the attempt ends with a friendly error.
 * - One listening session app-wide: starting in one screen ends a session another screen left running; that screen
 *   stops "listening" and gets whatever it had heard so far through its `onFinal`.
 * - Final text arrives through `onFinal` (trimmed, non-empty) once recognition ends — the final result, or the last
 *   partial transcript when the platform ended without one (unless the user cancelled).
 */
import { requireOptionalNativeModule } from 'expo';
import type {
  ExpoSpeechRecognitionErrorCode,
  ExpoSpeechRecognitionErrorEvent,
  ExpoSpeechRecognitionModule as SpeechModuleValue,
  ExpoSpeechRecognitionResultEvent,
} from 'expo-speech-recognition';
import * as SecureStore from 'expo-secure-store';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';

export type VoiceLang = 'en-IN' | 'hi-IN';

export interface VoiceInput {
  /** false when speech recognition can't run on this device (no recognition service / unsupported). */
  available: boolean;
  /** true while the microphone is open. */
  listening: boolean;
  /** live partial transcript while listening ("" otherwise). */
  partial: string;
  /** friendly, user-facing error from the last attempt (permission refused, no speech heard, …), else null. */
  error: string | null;
  /** true when the user refused permission permanently — show an "Open Settings" action. */
  blocked: boolean;
  /** ask for microphone + speech permission when needed, then start listening in `lang`. */
  start: (lang: VoiceLang) => Promise<void>;
  /** stop listening and deliver the final transcript to `onFinal`. */
  stop: () => void;
  /** stop listening and discard the transcript. */
  cancel: () => void;
}

/* ───────────────────────────── Remembered language ───────────────────────────── */

/** The voice language the member last picked, shared by every composer (meal log, Ask ÖRZA). */
const VOICE_LANG_KEY = 'orza.voiceLang';
let rememberedLang: VoiceLang | null = null;

/** The last chosen voice language (in memory first, then SecureStore), or null when none was chosen yet. */
export async function loadVoiceLang(): Promise<VoiceLang | null> {
  if (rememberedLang || Platform.OS === 'web') return rememberedLang;
  try {
    const saved = await SecureStore.getItemAsync(VOICE_LANG_KEY);
    if (saved === 'en-IN' || saved === 'hi-IN') rememberedLang = saved;
  } catch {
    // a convenience only
  }
  return rememberedLang;
}

/** Remember the voice language across screens and launches. */
export function saveVoiceLang(lang: VoiceLang): void {
  rememberedLang = lang;
  if (Platform.OS !== 'web') SecureStore.setItemAsync(VOICE_LANG_KEY, lang).catch(() => {});
}

/* ───────────────────────────── Native module ───────────────────────────── */

type SpeechModule = typeof SpeechModuleValue;

let nativeModule: SpeechModule | null | undefined;

function speech(): SpeechModule | null {
  if (nativeModule === undefined) {
    try {
      nativeModule = Platform.OS === 'web' ? null : requireOptionalNativeModule<SpeechModule>('ExpoSpeechRecognition');
    } catch {
      nativeModule = null;
    }
  }
  return nativeModule;
}

function checkAvailable(): boolean {
  const mod = speech();
  if (!mod) return false;
  if (Platform.OS !== 'android') return true;
  try {
    return mod.isRecognitionAvailable();
  } catch {
    return false;
  }
}

/* ───────────────────────────── Copy ───────────────────────────── */

const MSG = {
  denied: 'ÖRZA needs the microphone to hear you. Tap the mic again to allow it — or just type.',
  blocked:
    Platform.OS === 'ios'
      ? 'Microphone or Speech Recognition is turned off for ÖRZA. Turn both on in Settings to use voice — or just type.'
      : 'Microphone access is turned off for ÖRZA. Turn it on in Settings to use voice — or just type.',
  restricted: 'Speech recognition is restricted on this phone (Screen Time or a work profile). You can type instead.',
  unavailable:
    Platform.OS === 'android'
      ? "Voice input needs Google's speech services on this phone. You can type instead."
      : "Voice input isn't available on this phone right now. You can type instead.",
  noSpeech: "Didn't catch that — tap the mic and try again, a little closer.",
  network: 'Voice input needs an internet connection. Check it and try again — or type instead.',
  busy: 'The microphone is busy right now. Wait a moment and try again.',
  audio: "Couldn't use the microphone — another app may be using it. Try again in a moment.",
  interrupted: 'Listening was interrupted (a call or an alarm). Tap the mic to try again.',
  serviceOff:
    Platform.OS === 'ios'
      ? 'Voice input is switched off on this iPhone (Settings → General → Keyboard → Dictation). You can type instead.'
      : "Voice input isn't available on this phone right now. You can type instead.",
  startFailed: "Couldn't start the microphone. Please try again.",
  unknown: 'Voice input stopped unexpectedly. Please try again.',
} as const;

function errorText(code: ExpoSpeechRecognitionErrorCode, lang: VoiceLang): string {
  switch (code) {
    case 'no-speech':
    case 'speech-timeout':
      return MSG.noSpeech;
    case 'network':
      return MSG.network;
    case 'busy':
      return MSG.busy;
    case 'audio-capture':
      return MSG.audio;
    case 'interrupted':
      return MSG.interrupted;
    case 'not-allowed':
      return MSG.denied;
    case 'service-not-allowed':
      return MSG.serviceOff;
    case 'language-not-supported':
      return lang === 'hi-IN'
        ? "Hindi voice input isn't available on this phone yet — try English, or type instead."
        : "English (India) voice input isn't available on this phone — you can type instead.";
    default:
      return MSG.unknown;
  }
}

/** Words ÖRZA hears a lot — biases the recogniser toward Indian food names and portions (where supported). */
const HINTS = [
  'roti', 'chapati', 'paratha', 'dal', 'katori', 'chawal', 'rajma', 'chole', 'paneer', 'dahi', 'raita', 'sabzi', 'bhindi',
  'aloo', 'poha', 'upma', 'idli', 'dosa', 'sambar', 'khichdi', 'biryani', 'thali', 'chai', 'lassi', 'half plate',
];

/* ───────────────────────────── Permissions ───────────────────────────── */

type Permission = 'granted' | 'denied' | 'blocked' | 'restricted';

async function ensurePermission(mod: SpeechModule): Promise<Permission> {
  let p = await mod.getPermissionsAsync();
  if (p.granted) return 'granted';
  if (p.restricted) return 'restricted';
  // Android: a status check's `canAskAgain` is only what the LAST request ended with (Expo persists "blocked"), so it
  // stays false after the member reset the permission in Settings ("Ask every time") — and we'd show "Open Settings"
  // forever without ever asking. Asking is harmless: when it really is blocked, Android answers at once, no dialog.
  if (p.canAskAgain || Platform.OS === 'android') {
    p = await mod.requestPermissionsAsync();
    if (p.granted) return 'granted';
    if (p.restricted) return 'restricted';
  }
  return p.canAskAgain ? 'denied' : 'blocked';
}

/* ───────────────────────────── One session app-wide ───────────────────────────── */

interface Owner {
  onStart: () => void;
  onResult: (e: ExpoSpeechRecognitionResultEvent) => void;
  onNoMatch: () => void;
  onError: (e: ExpoSpeechRecognitionErrorEvent) => void;
  onEnd: () => void;
  /** Another screen took the recogniser over: its events (incl. `end`) no longer reach this owner, so wrap up now. */
  onAbandon: () => void;
}

/** The native session in flight; `owner: null` = orphaned (being aborted, its events are ignored). */
let active: { owner: Owner | null } | null = null;
let subscribed = false;
let idleWaiters: (() => void)[] = [];

function ensureListeners(mod: SpeechModule) {
  if (subscribed) return;
  subscribed = true;
  mod.addListener('start', () => active?.owner?.onStart());
  mod.addListener('result', (e) => active?.owner?.onResult(e));
  mod.addListener('nomatch', () => active?.owner?.onNoMatch());
  mod.addListener('error', (e) => active?.owner?.onError(e));
  // `end` is always the last event of a session, errors and aborts included.
  mod.addListener('end', () => {
    const owner = active?.owner;
    active = null;
    owner?.onEnd();
    const waiters = idleWaiters;
    idleWaiters = [];
    waiters.forEach((w) => w());
  });
}

/** Resolves once no native session is running (its `end` arrived), or after `timeoutMs` as a safety net. */
function waitForIdle(timeoutMs = 1200): Promise<void> {
  if (!active) return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    idleWaiters.push(finish);
    setTimeout(() => {
      if (done) return;
      active = null;
      finish();
    }, timeoutMs);
  });
}

/** Abort whatever session is running and ignore the rest of its events. */
function abortActive(mod: SpeechModule) {
  if (!active) return;
  active.owner = null;
  try {
    mod.abort();
  } catch {
    active = null;
  }
}

/* ───────────────────────────── Hook ───────────────────────────── */

interface Session {
  lang: VoiceLang;
  final: string;
  partial: string;
  cancelled: boolean;
  /** Wrapped up already — `end`, stop / cancel, the stop safety net and a takeover can race to finish a session. */
  done: boolean;
}

/**
 * `onFinal` receives the final transcript (trimmed, non-empty) once recognition ends.
 * Stops listening automatically when the component unmounts.
 */
export function useVoiceInput(opts: { onFinal: (text: string) => void }): VoiceInput {
  const [available, setAvailable] = useState(checkAvailable);
  const [listening, setListening] = useState(false);
  const [partial, setPartial] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);

  const onFinalRef = useRef(opts.onFinal);
  const ownerRef = useRef<Owner | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const startingRef = useRef(false);
  const abandonRef = useRef(false);
  const mountedRef = useRef(true);
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    onFinalRef.current = opts.onFinal;
  });

  const clearStopTimer = useCallback(() => {
    if (stopTimer.current) clearTimeout(stopTimer.current);
    stopTimer.current = null;
  }, []);

  /** Wrap up this hook's session (once): reset the UI and (unless cancelled) hand over the text. */
  const finish = useCallback(
    (session: Session, deliver: boolean) => {
      if (session.done) return;
      session.done = true;
      // A late wrap-up of an older session must not reset a newer one.
      const current = sessionRef.current === session;
      if (current) {
        clearStopTimer();
        ownerRef.current = null;
        sessionRef.current = null;
      }
      if (!mountedRef.current) return;
      if (current) {
        setListening(false);
        setPartial('');
      }
      const text = (session.final || session.partial).replace(/\s+/g, ' ').trim();
      if (deliver && !session.cancelled && text) onFinalRef.current(text);
    },
    [clearStopTimer]
  );

  // Unmount: close the microphone if this screen still owns it.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abandonRef.current = true;
      if (stopTimer.current) clearTimeout(stopTimer.current);
      const mod = speech();
      if (mod && ownerRef.current && active?.owner === ownerRef.current) abortActive(mod);
      ownerRef.current = null;
      sessionRef.current = null;
    };
  }, []);

  // Back from Settings / another app: the recognition service or the permission may have changed.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      setAvailable(checkAvailable());
      const mod = speech();
      if (!mod) return;
      mod
        .getPermissionsAsync()
        .then((p) => {
          if (!mountedRef.current || !p.granted) return;
          setBlocked(false);
          setError((prev) => (prev === MSG.blocked || prev === MSG.denied ? null : prev));
        })
        .catch(() => {});
    });
    return () => sub.remove();
  }, []);

  const start = useCallback(
    async (lang: VoiceLang) => {
      const mod = speech();
      if (!mod || startingRef.current || ownerRef.current) return;
      setError(null);
      if (!checkAvailable()) {
        setAvailable(false);
        setError(MSG.unavailable);
        return;
      }
      startingRef.current = true;
      abandonRef.current = false;
      try {
        let permission: Permission;
        try {
          permission = await ensurePermission(mod);
        } catch {
          permission = 'denied';
        }
        if (!mountedRef.current || abandonRef.current) return;
        if (permission !== 'granted') {
          setBlocked(permission === 'blocked');
          setError(permission === 'blocked' ? MSG.blocked : permission === 'restricted' ? MSG.restricted : MSG.denied);
          return;
        }
        setBlocked(false);

        // Another screen (or a stale session) holds the recogniser — end it first, and tell that screen: once orphaned,
        // its session's `end` never reaches it, so it would otherwise stay "listening" (and its own mic stay locked).
        if (active) {
          const previous = active.owner;
          abortActive(mod);
          previous?.onAbandon();
          await waitForIdle();
          if (!mountedRef.current || abandonRef.current) return;
        }

        ensureListeners(mod);
        const session: Session = { lang, final: '', partial: '', cancelled: false, done: false };
        const owner: Owner = {
          onStart: () => {
            if (mountedRef.current) setListening(true);
          },
          onResult: (e) => {
            const text = e.results[0]?.transcript ?? '';
            if (e.isFinal) {
              if (text.trim()) session.final = text;
            } else {
              session.partial = text;
            }
            if (mountedRef.current && !session.cancelled) setPartial(text);
          },
          onNoMatch: () => {
            if (!session.final.trim() && !session.partial.trim() && mountedRef.current) setError(MSG.noSpeech);
          },
          onError: (e) => {
            if (e.error === 'aborted' || session.cancelled || !mountedRef.current) return;
            if (e.error === 'not-allowed') {
              mod
                .getPermissionsAsync()
                .then((p) => {
                  if (!mountedRef.current) return;
                  const isBlocked = !p.granted && !p.canAskAgain;
                  setBlocked(isBlocked);
                  setError(isBlocked ? MSG.blocked : MSG.denied);
                })
                .catch(() => setError(MSG.denied));
              return;
            }
            // Whatever was heard before a late error (e.g. network after a partial) is still delivered on `end`.
            if ((session.final || session.partial).trim()) return;
            setError(errorText(e.error, session.lang));
          },
          onEnd: () => finish(session, true),
          // Taken over by another screen: stop "listening" here and keep what was heard so far.
          onAbandon: () => finish(session, true),
        };
        ownerRef.current = owner;
        sessionRef.current = session;
        active = { owner };
        setPartial('');
        setListening(true);
        try {
          mod.start({ lang, interimResults: true, continuous: false, maxAlternatives: 1, contextualStrings: HINTS });
        } catch {
          if (active?.owner === owner) active = null;
          ownerRef.current = null;
          sessionRef.current = null;
          setListening(false);
          setError(MSG.startFailed);
        }
      } finally {
        startingRef.current = false;
      }
    },
    [finish]
  );

  const stop = useCallback(() => {
    if (startingRef.current) {
      // Still asking for permission / waiting for another session — don't open the mic after all.
      abandonRef.current = true;
      return;
    }
    const mod = speech();
    const owner = ownerRef.current;
    const session = sessionRef.current;
    if (!mod || !owner || !session) return;
    if (active?.owner !== owner) {
      finish(session, true);
      return;
    }
    try {
      mod.stop();
    } catch {
      abortActive(mod);
      finish(session, true);
      return;
    }
    // Safety net: if the recogniser never reports `end`, release the mic and keep what was heard.
    clearStopTimer();
    stopTimer.current = setTimeout(() => {
      if (ownerRef.current !== owner) return;
      abortActive(mod);
      finish(session, true);
    }, 4000);
  }, [finish, clearStopTimer]);

  const cancel = useCallback(() => {
    if (startingRef.current) {
      abandonRef.current = true;
      return;
    }
    const mod = speech();
    const owner = ownerRef.current;
    const session = sessionRef.current;
    if (!owner || !session) return;
    session.cancelled = true;
    if (mod && active?.owner === owner) abortActive(mod);
    finish(session, false);
  }, [finish]);

  return { available, listening, partial, error, blocked, start, stop, cancel };
}
