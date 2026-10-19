package expo.modules.orzasteps

import android.content.BroadcastReceiver
import android.content.Context
import android.util.Log
import java.util.concurrent.atomic.AtomicBoolean

/** Takes and stores samples; turns counting on / off. */
internal object StepSampler {
  /**
   * Reads the counter and stores the sample (see StepStore.add for when it isn't stored). `done` runs once, on the
   * sensor thread, with the sample (null when nothing could be read) and whether it was stored.
   */
  fun sample(context: Context, reason: String, force: Boolean, done: (StepSample?, Boolean) -> Unit) {
    val app = context.applicationContext
    StepSensor.read(app) { reading ->
      if (reading == null) {
        done(null, false)
      } else {
        val sample = StepSample(reading.ts, reading.counter, reading.boot, reading.elapsed, reason)
        val stored = try {
          StepStore.add(app, sample, force)
        } catch (e: Exception) {
          Log.w(StepConst.TAG, "Couldn't store a step sample", e)
          false
        }
        done(sample, stored)
      }
    }
  }

  /**
   * The app turned counting on (permission granted): remember the member's time zone, arm the alarms and keep the
   * counter active. False when this phone has no step counter or the permission is missing (nothing is armed then).
   */
  fun start(context: Context, timeZone: String?): Boolean {
    val app = context.applicationContext
    if (!timeZone.isNullOrEmpty()) StepStore.setTimeZone(app, timeZone)
    if (!StepSensor.hasSensor(app) || !StepSensor.hasPermission(app)) return false
    StepStore.setEnabled(app, true)
    StepScheduler.armAll(app)
    StepSensor.keepCounting(app)
    return true
  }

  /** Counting off (sign-out): cancel the alarms and the keep-alive registration. Samples stay until `clear`. */
  fun stop(context: Context) {
    val app = context.applicationContext
    StepStore.setEnabled(app, false)
    StepScheduler.cancelAll(app)
    StepSensor.stopCounting(app)
  }

  /**
   * Counting is on and still possible. When the permission was taken away (or the sensor is gone) the alarms are
   * cancelled — the app starts them again once it has the permission back.
   */
  fun shouldRun(context: Context): Boolean {
    if (!StepStore.isEnabled(context)) return false
    if (!StepSensor.hasSensor(context) || !StepSensor.hasPermission(context)) {
      StepScheduler.cancelAll(context)
      StepSensor.stopCounting(context)
      return false
    }
    return true
  }
}

/**
 * Samples from a receiver: goAsync() so the read can finish off the main thread, with a hard budget so the broadcast
 * (and the system's wakelock for it) always ends — when the sample is stored, or after RECEIVER_BUDGET_MS at the latest.
 */
internal fun BroadcastReceiver.sampleAsync(context: Context, reason: String) {
  val app = context.applicationContext
  val pending = goAsync()
  val finished = AtomicBoolean(false)
  val finish = Runnable {
    if (finished.compareAndSet(false, true)) {
      try {
        pending.finish()
      } catch (e: Exception) {
        // Already finished.
      }
    }
  }
  StepSensor.handler.postDelayed(finish, StepConst.RECEIVER_BUDGET_MS)
  try {
    StepSampler.sample(app, reason, true) { _, _ ->
      StepSensor.handler.removeCallbacks(finish)
      finish.run()
    }
  } catch (t: Throwable) {
    Log.w(StepConst.TAG, "Step sample failed", t)
    StepSensor.handler.removeCallbacks(finish)
    finish.run()
  }
}
