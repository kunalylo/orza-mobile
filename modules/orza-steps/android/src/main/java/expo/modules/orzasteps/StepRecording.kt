package expo.modules.orzasteps

import android.content.Context
import android.util.Log
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import com.google.android.gms.common.api.ApiException
import com.google.android.gms.fitness.FitnessLocal
import com.google.android.gms.fitness.LocalRecordingClient
import com.google.android.gms.fitness.data.LocalDataType
import com.google.android.gms.fitness.data.LocalField
import com.google.android.gms.fitness.request.LocalDataReadRequest
import com.google.android.gms.fitness.result.LocalDataReadResponse
import com.google.android.gms.tasks.Task
import org.json.JSONArray
import java.util.concurrent.Executor
import java.util.concurrent.TimeUnit

/**
 * The Recording API on mobile (Google Play services `LocalRecordingClient`): once ÖRZA has subscribed, Play services
 * counts this phone's steps in the background — on the device, no Google account, the last 10 days — and ÖRZA reads
 * them in time buckets. Steps only (TYPE_STEP_COUNT_DELTA), so the steps-only minimum Play services version applies.
 * Needs "Physical activity" like the sampler. Turning buckets into the member's days is pure TypeScript
 * (`src/lib/steps/recording.ts`), which also picks the read range (`recordingRange`: both ends inclusive, passed as is).
 */
internal object StepRecording {
  /** Task callbacks run on the sensor thread (the store's file I/O stays off the main thread). */
  private val executor = Executor { StepSensor.handler.post(it) }

  private fun client(context: Context): LocalRecordingClient = FitnessLocal.getLocalRecordingClient(context.applicationContext)

  /** Exception class (+ the Play services status code) — for logs and the JS error message, never shown to members. */
  fun describe(e: Throwable?): String =
    when (e) {
      null -> "Cancelled"
      is ApiException -> "${e.javaClass.simpleName} ${e.statusCode}"
      else -> e.javaClass.simpleName
    }

  /**
   * "no_sensor" without a hardware step counter; else Play services' answer for the steps-only minimum version:
   * "available" | "update_required" | "missing" | "disabled" | "unavailable".
   */
  fun status(context: Context): String {
    if (!StepSensor.hasSensor(context)) return "no_sensor"
    return try {
      val code = GoogleApiAvailability.getInstance()
        .isGooglePlayServicesAvailable(context, LocalRecordingClient.LOCAL_RECORDING_CLIENT_STEPS_MIN_VERSION_CODE)
      when (code) {
        ConnectionResult.SUCCESS -> "available"
        ConnectionResult.SERVICE_VERSION_UPDATE_REQUIRED, ConnectionResult.SERVICE_UPDATING -> "update_required"
        ConnectionResult.SERVICE_MISSING, ConnectionResult.SERVICE_INVALID -> "missing"
        ConnectionResult.SERVICE_DISABLED -> "disabled"
        else -> "unavailable"
      }
    } catch (e: Exception) {
      Log.w(StepConst.TAG, "Couldn't check Google Play services", e)
      "unavailable"
    }
  }

  /** Runs `done(ok, error)` once, on the sensor thread, when `task` ends (error = `describe`, null when it worked). */
  private fun <T> settle(task: Task<T>, what: String, done: (Boolean, String?) -> Unit) {
    task.addOnCompleteListener(executor) { t ->
      if (t.isSuccessful) {
        done(true, null)
      } else {
        val error = describe(t.exception)
        Log.w(StepConst.TAG, "Recording API $what failed: $error", t.exception)
        done(false, error)
      }
    }
  }

  /**
   * Subscribes to step recording (subscribing again does nothing). On success the first subscription time is kept —
   * only when none is stored: the API has no data from before it, so the app's first counted day starts there.
   * `done(ok, error)` runs once, on the sensor thread.
   */
  fun subscribe(context: Context, done: (Boolean, String?) -> Unit) {
    val app = context.applicationContext
    try {
      settle(client(app).subscribe(LocalDataType.TYPE_STEP_COUNT_DELTA), "subscribe") { ok, error ->
        if (ok) StepStore.markRecordingSubscribed(app, System.currentTimeMillis())
        done(ok, error)
      }
    } catch (e: Exception) {
      Log.w(StepConst.TAG, "Recording API subscribe failed", e)
      StepSensor.handler.post { done(false, describe(e)) }
    }
  }

  /**
   * Unsubscribes (the collected data becomes unreadable) and always forgets the subscription time, whatever Play
   * services answers — a later subscribe starts a new coverage. `done(ok, error)` runs once, on the sensor thread.
   */
  fun unsubscribe(context: Context, done: (Boolean, String?) -> Unit) {
    val app = context.applicationContext
    StepStore.clearRecordingSubscribed(app)
    try {
      settle(client(app).unsubscribe(LocalDataType.TYPE_STEP_COUNT_DELTA), "unsubscribe", done)
    } catch (e: Exception) {
      Log.w(StepConst.TAG, "Recording API unsubscribe failed", e)
      StepSensor.handler.post { done(false, describe(e)) }
    }
  }

  /**
   * Steps in `bucketMinutes` buckets over [startMs, lastMs] — both ends inclusive, exactly as `recordingRange()` gives
   * them (never minus 1 again). `ok` gets JSON `[[bucketStartMs, bucketEndMs, steps], …]` with the non-zero buckets;
   * `failed` gets `describe(exception)`. Exactly one of them runs, once, on the sensor thread.
   */
  fun read(
    context: Context,
    startMs: Long,
    lastMs: Long,
    bucketMinutes: Int,
    ok: (String) -> Unit,
    failed: (String, Throwable?) -> Unit
  ) {
    val app = context.applicationContext
    val task: Task<LocalDataReadResponse> = try {
      require(startMs >= 0L && lastMs >= startMs) { "Bad range $startMs..$lastMs" }
      require(bucketMinutes in 1..MAX_BUCKET_MINUTES) { "Bad bucket size $bucketMinutes" }
      val request = LocalDataReadRequest.Builder()
        .aggregate(LocalDataType.TYPE_STEP_COUNT_DELTA)
        .bucketByTime(bucketMinutes, TimeUnit.MINUTES)
        .setTimeRange(startMs, lastMs, TimeUnit.MILLISECONDS)
        .build()
      client(app).readData(request)
    } catch (e: Exception) {
      Log.w(StepConst.TAG, "Recording API read failed", e)
      StepSensor.handler.post { failed(describe(e), e) }
      return
    }
    task.addOnCompleteListener(executor) { t ->
      val response = if (t.isSuccessful) t.result else null
      if (response == null) {
        val error = describe(t.exception)
        Log.w(StepConst.TAG, "Recording API read failed: $error", t.exception)
        failed(error, t.exception)
        return@addOnCompleteListener
      }
      val json = try {
        bucketsJson(response)
      } catch (e: Exception) {
        Log.w(StepConst.TAG, "Recording API answer was unreadable", e)
        failed(describe(e), e)
        return@addOnCompleteListener
      }
      ok(json)
    }
  }

  /** The response's non-zero buckets as `[[start, end, steps], …]` (epoch ms). */
  private fun bucketsJson(response: LocalDataReadResponse): String {
    val out = JSONArray()
    for (bucket in response.buckets) {
      var steps = 0L
      for (set in bucket.dataSets) {
        for (point in set.dataPoints) steps += point.getValue(LocalField.FIELD_STEPS).asInt().toLong()
      }
      if (steps <= 0L) continue
      out.put(
        JSONArray()
          .put(bucket.getStartTime(TimeUnit.MILLISECONDS))
          .put(bucket.getEndTime(TimeUnit.MILLISECONDS))
          .put(steps)
      )
    }
    return out.toString()
  }

  /** A day: the app reads 15-minute buckets (days) and 1-minute buckets (a base's "counted since"). */
  private const val MAX_BUCKET_MINUTES = 24 * 60
}
