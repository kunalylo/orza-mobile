package expo.modules.orzasteps

import android.Manifest
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorEventListener2
import android.hardware.SensorManager
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.SystemClock
import android.provider.Settings
import android.util.Log

/**
 * The hardware step counter. Every sensor callback, read and keep-alive change runs on one background thread
 * ("orza-steps"), so the state below needs no further locking.
 */
internal object StepSensor {
  private val thread: HandlerThread by lazy { HandlerThread("orza-steps").also { it.start() } }

  /** The sensor thread. */
  val handler: Handler by lazy { Handler(thread.looper) }

  /** The keep-counting listener, if registered (sensor thread only). */
  private var keeper: SensorEventListener? = null

  /** The runtime ACTION_SHUTDOWN receiver, if registered (sensor thread only). */
  private var shutdownReceiver: BroadcastReceiver? = null

  private fun sensorManager(context: Context): SensorManager? = context.getSystemService(SensorManager::class.java)

  fun stepCounter(context: Context): Sensor? =
    try {
      sensorManager(context)?.getDefaultSensor(Sensor.TYPE_STEP_COUNTER)
    } catch (e: Exception) {
      null
    }

  fun hasSensor(context: Context): Boolean = stepCounter(context) != null

  /** "Physical activity" is a run-time permission from Android 10; older versions only need the manifest entry. */
  fun hasPermission(context: Context): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return true
    return context.checkSelfPermission(Manifest.permission.ACTIVITY_RECOGNITION) == PackageManager.PERMISSION_GRANTED
  }

  fun bootCount(context: Context): Int =
    try {
      Settings.Global.getInt(context.contentResolver, Settings.Global.BOOT_COUNT, -1)
    } catch (e: Exception) {
      -1
    }

  /**
   * Reads the counter once: registers a listener (the HAL reports an on-change sensor's current value when it is
   * activated, and a flush is requested so batched steps arrive too), keeps the newest value delivered until the flush
   * completes (or SETTLE_MS after the first event when the sensor can't flush), unregisters (see OneRead). `done` runs
   * exactly once, on the sensor thread, with null when there is
   * no sensor, no permission, or no event within READ_TIMEOUT_MS — Android 9+ delivers no sensor events to an app in
   * the background unless it is briefly exempt (the app in front, an alarm set with setAndAllowWhileIdle, a boot
   * broadcast), which is why the sampler's alarms are allow-while-idle ones.
   */
  fun read(context: Context, done: (StepReading?) -> Unit) {
    val app = context.applicationContext
    val sm = sensorManager(app)
    val sensor = stepCounter(app)
    if (sm == null || sensor == null || !hasPermission(app)) {
      handler.post { done(null) }
      return
    }
    handler.post { OneRead(app, sm, sensor, done).begin() }
  }

  /**
   * Keeps the step counter activated while this process lives. The platform documents that the counter may only count
   * while some app has it registered; many phones count regardless, but where they don't this keeps ÖRZA's own
   * windows covered. Batched (KEEP_LATENCY_US) on a non-wake-up sensor, so it never wakes the CPU. Also listens for
   * the phone shutting down (see watchShutdown). Idempotent.
   */
  fun keepCounting(context: Context) {
    val app = context.applicationContext
    handler.post {
      if (!hasPermission(app)) return@post
      watchShutdown(app)
      if (keeper != null) return@post
      val sm = sensorManager(app) ?: return@post
      val sensor = stepCounter(app) ?: return@post
      val listener = object : SensorEventListener {
        override fun onSensorChanged(event: SensorEvent?) {
          // Nothing to do: reads take their own value; this registration only keeps the counter running.
        }

        override fun onAccuracyChanged(s: Sensor?, accuracy: Int) {}
      }
      val ok = try {
        sm.registerListener(listener, sensor, SensorManager.SENSOR_DELAY_NORMAL, StepConst.KEEP_LATENCY_US, handler)
      } catch (e: Exception) {
        Log.w(StepConst.TAG, "Couldn't keep the step counter registered", e)
        false
      }
      if (ok) keeper = listener
    }
  }

  /** Drops the keep-counting registration and the shutdown listener (counting turned off, permission gone). */
  fun stopCounting(context: Context) {
    val app = context.applicationContext
    handler.post {
      val receiver = shutdownReceiver
      shutdownReceiver = null
      if (receiver != null) {
        try {
          app.unregisterReceiver(receiver)
        } catch (e: Exception) {
          // Already gone.
        }
      }
      val listener = keeper ?: return@post
      keeper = null
      try {
        sensorManager(app)?.unregisterListener(listener)
      } catch (e: Exception) {
        // Already gone.
      }
    }
  }

  /**
   * From Android 9, ACTION_SHUTDOWN only reaches receivers registered at run time (the manifest one covers Android 8),
   * so while this process lives it listens itself: the counter restarts from 0 at boot, and a last sample keeps the
   * steps walked since the previous one. Best effort: a process the system has already cached and idled may get no
   * sensor event in time. Sensor thread only.
   */
  private fun watchShutdown(app: Context) {
    if (shutdownReceiver != null) return
    val receiver = StepShutdownReceiver()
    val filter = IntentFilter(Intent.ACTION_SHUTDOWN)
    try {
      // A protected system broadcast: no other app can send it, so "exported" only lets the system deliver it.
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        app.registerReceiver(receiver, filter, null, handler, Context.RECEIVER_EXPORTED)
      } else {
        app.registerReceiver(receiver, filter, null, handler)
      }
      shutdownReceiver = receiver
    } catch (e: Exception) {
      Log.w(StepConst.TAG, "Couldn't listen for shutdown", e)
    }
  }

  /**
   * One read (see `read`). Lives on the sensor thread only. A new registration first gets the sensor service's cached
   * last value, while steps batched in the sensor hub (up to KEEP_LATENCY_US with the keep-counting listener) only
   * arrive with a flush. So when flush() is accepted the read ends at onFlushCompleted (the newest value is current:
   * stamped now); otherwise SETTLE_MS after the first event, stamped with the event's own time when that is plausible
   * (the counter certainly had that value then; "now" could put batched-but-undelivered steps on the wrong side of
   * midnight).
   */
  private class OneRead(
    private val app: Context,
    private val sm: SensorManager,
    private val sensor: Sensor,
    private val done: (StepReading?) -> Unit
  ) : SensorEventListener2 {
    private var latest: StepReading? = null

    /** How old the latest event was when it arrived (ms; 0 = current or unknown). */
    private var latestAgeMs = 0L
    private var finished = false
    private var settling = false
    private var flushPending = false
    private var flushed = false
    private val timeout = Runnable { finish() }
    private val settle = Runnable { finish() }

    fun begin() {
      val registered = try {
        sm.registerListener(this, sensor, SensorManager.SENSOR_DELAY_NORMAL, StepSensor.handler)
      } catch (e: Exception) {
        Log.w(StepConst.TAG, "Couldn't register for the step counter", e)
        false
      }
      if (!registered) {
        finished = true
        done(null)
        return
      }
      StepSensor.handler.postDelayed(timeout, StepConst.READ_TIMEOUT_MS)
      flushPending = try {
        sm.flush(this)
      } catch (e: Exception) {
        false // Flush isn't supported everywhere; the activation event still arrives.
      }
    }

    private fun startSettling() {
      if (settling || finished) return
      settling = true
      StepSensor.handler.postDelayed(settle, StepConst.SETTLE_MS)
    }

    override fun onSensorChanged(event: SensorEvent?) {
      if (finished || event == null || event.values.isEmpty()) return
      val value = event.values[0]
      if (value.isNaN() || value.isInfinite() || value < 0f) return
      // Sensor timestamps share SystemClock.elapsedRealtimeNanos()'s time base (guarded: an implausible age is ignored).
      val age = (SystemClock.elapsedRealtimeNanos() - event.timestamp) / 1_000_000L
      latestAgeMs = if (age in 0L..StepConst.MAX_EVENT_AGE_MS) age else 0L
      latest = StepReading(value.toLong(), System.currentTimeMillis(), SystemClock.elapsedRealtime(), StepSensor.bootCount(app))
      if (!flushPending) startSettling()
    }

    override fun onFlushCompleted(s: Sensor?) {
      if (!flushPending) return
      flushPending = false
      flushed = true
      // Everything batched before the flush has been delivered: the latest value is current. No value yet: the
      // activation event is still to come (it then settles briefly); the timeout covers a sensor that sends nothing.
      if (latest != null) finish()
    }

    override fun onAccuracyChanged(s: Sensor?, accuracy: Int) {}

    private fun finish() {
      if (finished) return
      finished = true
      StepSensor.handler.removeCallbacks(timeout)
      StepSensor.handler.removeCallbacks(settle)
      try {
        sm.unregisterListener(this)
      } catch (e: Exception) {
        // Already unregistered.
      }
      val r = latest
      val reading = if (r != null && !flushed && latestAgeMs > 0L) {
        r.copy(ts = r.ts - latestAgeMs, elapsed = maxOf(0L, r.elapsed - latestAgeMs))
      } else {
        r
      }
      try {
        done(reading)
      } catch (t: Throwable) {
        Log.w(StepConst.TAG, "Step read callback failed", t)
      }
    }
  }
}

/**
 * The phone is shutting down (registered at run time by StepSensor.watchShutdown: Android 9+ sends ACTION_SHUTDOWN to
 * registered receivers only). A last sample of this boot, inside the system's shutdown broadcast budget.
 */
internal class StepShutdownReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != Intent.ACTION_SHUTDOWN) return
    val app = context.applicationContext
    if (!StepStore.isEnabled(app) || !StepSensor.hasPermission(app)) return
    sampleAsync(app, "shutdown")
  }
}
