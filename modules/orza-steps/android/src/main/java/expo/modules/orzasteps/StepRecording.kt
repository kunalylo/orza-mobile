package expo.modules.orzasteps

import android.content.Context
import android.util.Log
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import com.google.android.gms.common.api.ApiException
import com.google.android.gms.fitness.FitnessLocal
import com.google.android.gms.fitness.FitnessStatusCodes
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
 *
 * - Play services is called only when `status()` is "available": with Play services disabled its pre-check (an APK
 *   version compare) still passes, the connection then fails with SERVICE_DISABLED and Play services posts its "enable
 *   Google Play services" notification under ÖRZA's name. Otherwise subscribe / read answer "Unavailable <status>".
 * - Without "Physical activity" nothing is called either (NO_PERMISSION), and the subscription time is forgotten — also
 *   when the module starts (`forgetWithoutPermission`) or a call fails for lack of it: the API records nothing while
 *   the permission is off, so the coverage must start again at the next successful subscribe (plan A-3).
 * - Everything runs on the sensor thread (calls, Task callbacks, the store's file I/O), so an unsubscribe and a
 *   subscribe still on its way are ordered (`generation`).
 */
internal object StepRecording {
  /** Task callbacks run on the sensor thread (the store's file I/O stays off the main thread). */
  private val executor = Executor { StepSensor.handler.post(it) }

  /** Answer when the permission is missing (subscribe / read). */
  const val NO_PERMISSION = "NoPermission"

  /**
   * Bumped whenever the subscription time is forgotten (unsubscribe, the permission gone) — sensor thread only. A
   * subscribe already on its way then stores no time when it succeeds: kept "first only", that stale time would
   * survive every later subscribe and make the hours before it look counted.
   */
  private var generation = 0L

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

  /** Sensor thread: forgets the subscription time (a later subscribe starts a new coverage). */
  private fun forget(app: Context) {
    generation++
    StepStore.clearRecordingSubscribed(app)
  }

  /**
   * A failed call that says the permission is gone: missing now, a SecurityException, or one of Play services'
   * permission status codes.
   */
  private fun lostPermission(app: Context, e: Throwable?): Boolean {
    if (!StepSensor.hasPermission(app)) return true
    var cause = e
    while (cause != null) {
      if (cause is SecurityException) return true
      if (cause is ApiException && cause.statusCode in PERMISSION_CODES) return true
      cause = cause.cause
    }
    return false
  }

  /** Sensor thread: why Play services can't be called now ("Unavailable <status>" / NO_PERMISSION); null when it can. */
  private fun blocked(app: Context): String? {
    val status = status(app)
    if (status != "available") return "Unavailable $status"
    if (!StepSensor.hasPermission(app)) {
      forget(app)
      return NO_PERMISSION
    }
    return null
  }

  /**
   * The module started: without "Physical activity" the subscription time is forgotten (Android kills the app on a
   * revoke, so this may be the first ÖRZA code to see it gone).
   */
  fun forgetWithoutPermission(context: Context) {
    val app = context.applicationContext
    StepSensor.handler.post {
      if (!StepSensor.hasPermission(app) && StepStore.recordingSubscribedAt(app) != null) forget(app)
    }
  }

  /**
   * Subscribes to step recording (subscribing again does nothing) — only when `status()` is "available" and with the
   * permission (see the class doc). On success the first subscription time is kept — only when none is stored: the
   * API has no data from before it, so the app's first counted day starts there — unless an unsubscribe came after this
   * call (`generation`; answered SUPERSEDED). `done(ok, error)` runs once, on the sensor thread.
   */
  fun subscribe(context: Context, done: (Boolean, String?) -> Unit) {
    val app = context.applicationContext
    StepSensor.handler.post {
      val blocked = blocked(app)
      if (blocked != null) {
        done(false, blocked)
        return@post
      }
      val started = generation
      try {
        client(app).subscribe(LocalDataType.TYPE_STEP_COUNT_DELTA).addOnCompleteListener(executor) { t ->
          when {
            !t.isSuccessful -> {
              val error = describe(t.exception)
              Log.w(StepConst.TAG, "Recording API subscribe failed: $error", t.exception)
              if (lostPermission(app, t.exception)) forget(app)
              done(false, error)
            }
            started != generation -> done(false, SUPERSEDED)
            else -> {
              StepStore.markRecordingSubscribed(app, System.currentTimeMillis())
              done(true, null)
            }
          }
        }
      } catch (e: Exception) {
        Log.w(StepConst.TAG, "Recording API subscribe failed", e)
        if (lostPermission(app, e)) forget(app)
        done(false, describe(e))
      }
    }
  }

  /**
   * Unsubscribes (the collected data becomes unreadable) and always forgets the subscription time, whatever Play
   * services answers — a later subscribe starts a new coverage, and one still on its way stores nothing. Play services
   * is asked only when `status()` is "available" (else `done(false, "Unavailable <status>")`). `done(ok, error)` runs
   * once, on the sensor thread.
   */
  fun unsubscribe(context: Context, done: (Boolean, String?) -> Unit) {
    val app = context.applicationContext
    StepSensor.handler.post {
      forget(app)
      val status = status(app)
      if (status != "available") {
        done(false, "Unavailable $status")
        return@post
      }
      try {
        client(app).unsubscribe(LocalDataType.TYPE_STEP_COUNT_DELTA).addOnCompleteListener(executor) { t ->
          if (t.isSuccessful) {
            done(true, null)
          } else {
            val error = describe(t.exception)
            Log.w(StepConst.TAG, "Recording API unsubscribe failed: $error", t.exception)
            done(false, error)
          }
        }
      } catch (e: Exception) {
        Log.w(StepConst.TAG, "Recording API unsubscribe failed", e)
        done(false, describe(e))
      }
    }
  }

  /**
   * Steps in `bucketMinutes` buckets over [startMs, lastMs] — both ends inclusive, exactly as `recordingRange()` gives
   * them (never minus 1 again). `ok` gets JSON `[[bucketStartMs, bucketEndMs, steps], …]` with the non-zero buckets;
   * `failed` gets `describe(exception)`, or "Unavailable <status>" / NO_PERMISSION without calling Play services (a bad
   * range neither). Exactly one of them runs, once, on the sensor thread.
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
    StepSensor.handler.post { readNow(app, startMs, lastMs, bucketMinutes, ok, failed) }
  }

  /** `read` on the sensor thread. */
  private fun readNow(
    app: Context,
    startMs: Long,
    lastMs: Long,
    bucketMinutes: Int,
    ok: (String) -> Unit,
    failed: (String, Throwable?) -> Unit
  ) {
    val request = try {
      require(startMs >= 0L && lastMs >= startMs) { "Bad range $startMs..$lastMs" }
      require(bucketMinutes in 1..MAX_BUCKET_MINUTES) { "Bad bucket size $bucketMinutes" }
      LocalDataReadRequest.Builder()
        .aggregate(LocalDataType.TYPE_STEP_COUNT_DELTA)
        .bucketByTime(bucketMinutes, TimeUnit.MINUTES)
        .setTimeRange(startMs, lastMs, TimeUnit.MILLISECONDS)
        .build()
    } catch (e: Exception) {
      Log.w(StepConst.TAG, "Recording API read refused", e)
      failed(describe(e), e)
      return
    }
    val blocked = blocked(app)
    if (blocked != null) {
      failed(blocked, null)
      return
    }
    val task: Task<LocalDataReadResponse> = try {
      client(app).readData(request)
    } catch (e: Exception) {
      Log.w(StepConst.TAG, "Recording API read failed", e)
      if (lostPermission(app, e)) forget(app)
      failed(describe(e), e)
      return
    }
    task.addOnCompleteListener(executor) { t ->
      val response = if (t.isSuccessful) t.result else null
      if (response == null) {
        val error = describe(t.exception)
        Log.w(StepConst.TAG, "Recording API read failed: $error", t.exception)
        if (lostPermission(app, t.exception)) forget(app)
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

  /** A subscribe answer when an unsubscribe came after it (the subscription is being removed). */
  private const val SUPERSEDED = "Superseded"

  /** Play services' answers for a missing permission. */
  private val PERMISSION_CODES = setOf(FitnessStatusCodes.NEEDS_OAUTH_PERMISSIONS, FitnessStatusCodes.INVALID_PERMISSION)
}
