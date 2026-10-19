package expo.modules.orzasteps

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** The sampler's own alarms (periodic / around midnight): set the next one, then take a sample. */
class StepAlarmReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val app = context.applicationContext
    val action = intent.action ?: return
    if (action != StepConst.ACTION_PERIODIC && action != StepConst.ACTION_MIDNIGHT) return
    if (!StepSampler.shouldRun(app)) return
    // Re-arm first, so the chain survives even if this process dies during the read. The periodic run also re-sets
    // the midnight alarm (same trigger time — it heals a chain broken by a crash or a force-stop).
    if (action == StepConst.ACTION_PERIODIC) StepScheduler.armAll(app) else StepScheduler.armMidnight(app)
    StepSensor.keepCounting(app)
    sampleAsync(app, if (action == StepConst.ACTION_MIDNIGHT) "midnight" else "periodic")
  }
}

/**
 * Boot / app update: re-arm the alarms and take a baseline sample (the counter restarts from 0 at boot). Clock or
 * time-zone change: move the midnight samples. Shutdown: a last sample of this boot (below Android 9 only — newer
 * versions send ACTION_SHUTDOWN to registered receivers only; the day math copes without it). Exported so system /
 * OEM broadcasts arrive; nothing is read from the intent except its action.
 */
class StepBootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val action = intent.action ?: return
    val app = context.applicationContext
    when (action) {
      Intent.ACTION_SHUTDOWN, QUICKBOOT_POWEROFF, HTC_QUICKBOOT_POWEROFF -> {
        if (!StepStore.isEnabled(app) || !StepSensor.hasPermission(app)) return
        sampleAsync(app, "shutdown")
      }
      Intent.ACTION_BOOT_COMPLETED, QUICKBOOT_POWERON, HTC_QUICKBOOT_POWERON, Intent.ACTION_MY_PACKAGE_REPLACED -> {
        if (!StepSampler.shouldRun(app)) return
        StepScheduler.armAll(app)
        StepSensor.keepCounting(app)
        sampleAsync(app, if (action == Intent.ACTION_MY_PACKAGE_REPLACED) "updated" else "boot")
      }
      Intent.ACTION_TIME_CHANGED, Intent.ACTION_TIMEZONE_CHANGED -> {
        if (!StepSampler.shouldRun(app)) return
        StepScheduler.armMidnight(app)
      }
    }
  }

  private companion object {
    const val QUICKBOOT_POWERON = "android.intent.action.QUICKBOOT_POWERON"
    const val HTC_QUICKBOOT_POWERON = "com.htc.intent.action.QUICKBOOT_POWERON"
    const val QUICKBOOT_POWEROFF = "android.intent.action.QUICKBOOT_POWEROFF"
    const val HTC_QUICKBOOT_POWEROFF = "com.htc.intent.action.QUICKBOOT_POWEROFF"
  }
}
