package expo.modules.orzaalarms

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Alarms don't survive a reboot (and exact ones are reset when "Alarms & reminders" is granted): set the stored ones
 * again. Exported for system / OEM boot broadcasts; nothing is read from the intent except its action.
 * Note: BOOT_COMPLETED arrives after the first unlock — alarms due before that unlock ring as "missed" right after it
 * (up to MISSED_GRACE_MS late).
 */
class BootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val action = intent.action ?: return
    val ringMissed = when (action) {
      Intent.ACTION_BOOT_COMPLETED, QUICKBOOT, HTC_QUICKBOOT -> true
      Intent.ACTION_MY_PACKAGE_REPLACED, Intent.ACTION_TIME_CHANGED, Intent.ACTION_TIMEZONE_CHANGED, EXACT_ALARM_GRANTED -> false
      else -> return
    }
    val app = context.applicationContext
    AlarmExecutor.runAsync(this) {
      AlarmNotifier.ensureChannels(app)
      AlarmScheduler.rescheduleStored(app, ringMissed)
    }
  }

  private companion object {
    const val QUICKBOOT = "android.intent.action.QUICKBOOT_POWERON"
    const val HTC_QUICKBOOT = "com.htc.intent.action.QUICKBOOT_POWERON"

    /** AlarmManager.ACTION_SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED (API 31) as a literal, so no API check is needed. */
    const val EXACT_ALARM_GRANTED = "android.app.action.SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED"
  }
}
