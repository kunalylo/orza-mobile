package expo.modules.orzasteps

import org.json.JSONObject

internal object StepConst {
  const val TAG = "OrzaSteps"

  const val PREFS = "orza_steps"
  const val KEY_SAMPLES = "samples"
  const val KEY_TIME_ZONE = "time_zone"
  const val KEY_ENABLED = "enabled"

  /** Raw samples older than this are dropped (the app reads a few days at most; Today + the last 2 days). */
  const val KEEP_MS = 10L * 24 * 60 * 60 * 1000

  /** Hard cap on stored samples (about-hourly alarms + the app's reads stay far below it in 10 days). */
  const val MAX_SAMPLES = 2_000

  /**
   * A read the app asked for is only stored when the last stored sample of the same boot is at least this old: the
   * counter is cumulative, so skipping a reading loses no steps, only time resolution.
   */
  const val MIN_STORE_GAP_MS = 10L * 60 * 1000

  /** A forced sample (alarm, boot, shutdown) identical to one stored less than this long ago isn't stored again. */
  const val DUPLICATE_MS = 60L * 1000

  /** How long a read waits for the sensor's first event. */
  const val READ_TIMEOUT_MS = 3_000L

  /** After the first event, wait this long for a newer (flushed) value before finishing the read. */
  const val SETTLE_MS = 400L

  /** A receiver's own time budget (goAsync): it always finishes well before the system's broadcast timeout. */
  const val RECEIVER_BUDGET_MS = 6_000L

  /** The periodic sample: inexact and re-armed on every run, so the system decides (roughly every 1–2 h). */
  const val PERIODIC_MS = 60L * 60 * 1000

  /** Samples this long before and after local midnight, so each day's total splits cleanly. */
  const val MIDNIGHT_OFFSET_MS = 5L * 60 * 1000

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
