package expo.modules.orzasteps

import org.json.JSONObject

internal object StepConst {
  const val TAG = "OrzaSteps"

  /**
   * Everything lives in noBackupFilesDir: never in Auto Backup or a device-to-device transfer (another phone's counter
   * readings must never be bridged to this phone's). Earlier builds used SharedPreferences "orza_steps", which ARE
   * backed up (expo-secure-store's backup rules include every shared-prefs file) — removed on first use.
   */
  const val SAMPLES_FILE = "orza-steps-samples.json"
  const val STATE_FILE = "orza-steps-state.json"
  const val LEGACY_PREFS = "orza_steps"

  /** Raw samples older than this are dropped (the app reads at most the last 7 days, plus 36 h before them). */
  const val KEEP_MS = 10L * 24 * 60 * 60 * 1000

  /** Hard cap on stored samples (about-hourly alarms + the app's reads stay far below it in 10 days). */
  const val MAX_SAMPLES = 2_000

  /**
   * A read the app asked for is only stored when the last stored sample of the same boot is at least this old: the
   * counter is cumulative, so skipping a reading loses no steps, only time resolution.
   */
  const val MIN_STORE_GAP_MS = 10L * 60 * 1000

  /**
   * A forced sample (alarm, boot, shutdown) taken less than this after the last stored sample of the same boot replaces
   * it (or is dropped when the counter didn't move): the counter is cumulative, so nothing is lost, and a burst of
   * broadcasts can't flood the ring buffer.
   */
  const val DUPLICATE_MS = 60L * 1000

  /** How long a read waits for the sensor's first event. */
  const val READ_TIMEOUT_MS = 3_000L

  /**
   * When the sensor can't flush (flush() returned false / threw), wait this long after the first event for a newer
   * value. When it can, the read waits for onFlushCompleted instead (up to READ_TIMEOUT_MS).
   */
  const val SETTLE_MS = 400L

  /** A reading whose sensor event is at most this old (and the flush didn't complete) is stamped with the event time. */
  const val MAX_EVENT_AGE_MS = 15L * 60 * 1000

  /** A receiver's own time budget (goAsync): it always finishes well before the system's broadcast timeout. */
  const val RECEIVER_BUDGET_MS = 6_000L

  /**
   * The periodic sample (inexact, re-armed on every run, so the system decides the exact time). Spaced out when Android
   * puts ÖRZA in a stricter App Standby bucket, whose alarm quota (Frequent 2/h, Rare 1/h) medicine reminders share;
   * none at all in Restricted (1 alarm a day). The counter is cumulative: periodic samples only bound what a reboot can
   * lose and keep long gaps (estimates) short.
   */
  const val PERIODIC_MS = 60L * 60 * 1000
  const val PERIODIC_FREQUENT_MS = 3L * 60 * 60 * 1000
  const val PERIODIC_RARE_MS = 4L * 60 * 60 * 1000

  /** Exact midnight samples ("Alarms & reminders" allowed): this long before and after local midnight. */
  const val MIDNIGHT_OFFSET_MS = 5L * 60 * 1000

  /**
   * Inexact midnight samples (no "Alarms & reminders"): Android may deliver an inexact alarm up to 75 % of its lead time
   * late (capped at 1 h from Android 12). The pre-midnight alarm is therefore set so that even its latest delivery is
   * PRE_MIDNIGHT_MARGIN_MS before midnight, and each run re-arms a closer one (a shorter lead = a smaller window) until
   * a sample lands within CHAIN_FINAL_GAP_MS of that deadline; then one sample POST_MIDNIGHT_OFFSET_MS after midnight.
   * In the Frequent / Rare buckets one pre-midnight sample within CHAIN_COARSE_GAP_MS is enough (fewer alarms).
   */
  const val PRE_MIDNIGHT_MARGIN_MS = 2L * 60 * 1000
  const val CHAIN_FINAL_GAP_MS = 15L * 60 * 1000
  const val CHAIN_COARSE_GAP_MS = 3L * 60 * 60 * 1000
  const val POST_MIDNIGHT_OFFSET_MS = 3L * 60 * 1000
  const val INEXACT_WINDOW_CAP_MS = 60L * 60 * 1000

  /** Batching latency of the keep-counting listener: the sensor hub buffers steps and the CPU keeps sleeping. */
  const val KEEP_LATENCY_US = 10 * 60 * 1_000_000

  const val ACTION_PERIODIC = "expo.modules.orzasteps.action.PERIODIC"
  const val ACTION_MIDNIGHT = "expo.modules.orzasteps.action.MIDNIGHT"
  const val REQUEST_PERIODIC = 7101
  const val REQUEST_MIDNIGHT = 7102
}

/**
 * One raw reading of the hardware step counter (Sensor.TYPE_STEP_COUNTER). `counter` is the number of steps since the
 * phone booted and restarts from 0 at every boot — the app turns consecutive samples into daily totals
 * (`src/lib/steps/counter.ts`), so nothing here knows about days.
 */
internal data class StepSample(
  /** Wall clock, epoch ms. */
  val ts: Long,
  val counter: Long,
  /** Settings.Global.BOOT_COUNT, -1 when unknown. */
  val boot: Int,
  /** SystemClock.elapsedRealtime() at the reading: ms since this boot (survives wall-clock changes). */
  val elapsed: Long,
  /** Why it was taken: app / periodic / midnight / boot / updated / shutdown (diagnostics). */
  val reason: String
) {
  fun toJson(): JSONObject {
    val o = JSONObject()
    o.put("t", ts)
    o.put("c", counter)
    o.put("b", boot)
    o.put("e", elapsed)
    o.put("r", reason)
    return o
  }

  fun toMap(stored: Boolean): Map<String, Any?> = mapOf(
    "ts" to ts.toDouble(),
    "counter" to counter.toDouble(),
    "boot" to boot,
    "elapsed" to elapsed.toDouble(),
    "reason" to reason,
    "stored" to stored
  )

  companion object {
    fun fromJson(o: JSONObject): StepSample? {
      val ts = o.optLong("t", -1L)
      val counter = o.optLong("c", -1L)
      if (ts <= 0L || counter < 0L) return null
      return StepSample(ts, counter, o.optInt("b", -1), o.optLong("e", -1L), o.optString("r", ""))
    }
  }
}

/** A current value of the step counter, as read from the sensor. */
internal data class StepReading(val counter: Long, val ts: Long, val elapsed: Long, val boot: Int)
