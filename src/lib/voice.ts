/**
 * Voice input (speech → text) shared by the meal composer and Ask ÖRZA chat.
 *
 * INTERFACE CONTRACT — other features import exactly these exports. The implementation is owned
 * by the Meals work-stream (expo-speech-recognition); until then this is a typed stub that reports
 * voice as unavailable, so consumers simply hide or disable their mic button.
 */

export type VoiceLang = "en-IN" | "hi-IN";

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

/**
 * `onFinal` receives the final transcript (trimmed, non-empty) once recognition ends.
 * Stops listening automatically when the component unmounts.
 */
export function useVoiceInput(opts: { onFinal: (text: string) => void }): VoiceInput {
  void opts;
  return {
    available: false,
    listening: false,
    partial: "",
    error: null,
    blocked: false,
    start: async () => {},
    stop: () => {},
    cancel: () => {},
  };
}
