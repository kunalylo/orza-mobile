package expo.modules.orzasteps

import android.Manifest
import android.content.Context
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
   * activated, and a flush is requested so batched steps arrive too), keeps the newest value delivered within
   * SETTLE_MS of the first event, unregisters. `done` runs exactly once, on the sensor thread, with null when there is
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
   * windows covered. Batched (KEEP_LATENCY_US) on a non-wake-up sensor, so it never wakes the CPU. Idempotent.
   */
  fun keepCounting(context: Context) {
    val app = context.applicationContext
    handler.post {
      if (keeper != null) return@post
      val sm = sensorManager(app) ?: return@post
      val sensor = stepCounter(app) ?: return@post
      if (!hasPermission(app)) return@post
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

  /** Drops the keep-counting registration (counting turned off, permission gone). */
  fun stopCounting(context: Context) {
    val app = context.applicationContext
    handler.post {
      val listener = keeper ?: return@post
      keeper = null
      try {
        sensorManager(app)?.unregisterListener(listener)
      } catch (e: Exception) {
        // Already gone.
      }
    }
  }

  /** One read (see `read`). Lives on the sensor thread only. */
  private class OneRead(
    private val app: Context,
    private val sm: SensorManager,
    private val sensor: Sensor,
    private val done: (StepReading?) -> Unit
  ) : SensorEventListener2 {
    private var latest: StepReading? = null
    private var finished = false
    private var settling = false
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
      try {
        sm.flush(this)
      } catch (e: Exception) {
        // Flush isn't supported everywhere; the activation event still arrives.
      }
    }

    override fun onSensorChanged(event: SensorEvent?) {
      if (finished || event == null || event.values.isEmpty()) return
      val value = event.values[0]
      if (value.isNaN() || value.isInfinite() || value < 0f) return
      latest = StepReading(value.toLong(), System.currentTimeMillis(), SystemClock.elapsedRealtime(), StepSensor.bootCount(app))
      if (!settling) {
        settling = true
        StepSensor.handler.postDelayed(settle, StepConst.SETTLE_MS)
      }
    }

    override fun onFlushCompleted(s: Sensor?) {
      // Everything batched before the flush has been delivered: the latest value is current.
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
      try {
        done(latest)
      } catch (t: Throwable) {
        Log.w(StepConst.TAG, "Step read callback failed", t)
      }
    }
  }
}
