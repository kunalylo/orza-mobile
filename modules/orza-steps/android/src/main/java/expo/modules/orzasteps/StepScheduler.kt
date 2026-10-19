package expo.modules.orzasteps

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.SystemClock
import android.util.Log
import java.time.Instant
import java.time.ZoneId

/**
 * The sampler's alarms. Never exact (no "Alarms & reminders" permission needed): one-shot `setAndAllowWhileIdle`
 * alarms, re-armed every time they fire. Allow-while-idle alarms also exempt the app from background limits for a few
 * seconds, which Android 9+ requires before it hands a sensor event to an app that isn't in front.
 * - periodic: about every hour (the system batches and may delay it);
 * - midnight: 5 min before and 5 min after local midnight in the member's time zone, so each day's total splits cleanly.
 */
internal object StepScheduler {
  private fun alarmManager(context: Context): AlarmManager? = context.getSystemService(AlarmManager::class.java)

  private fun pendingIntent(context: Context, action: String, requestCode: Int, create: Boolean): PendingIntent? {
    val intent = Intent(context, StepAlarmReceiver::class.java).setAction(action)
    val flags = PendingIntent.FLAG_IMMUTABLE or (if (create) PendingIntent.FLAG_UPDATE_CURRENT else PendingIntent.FLAG_NO_CREATE)
    return PendingIntent.getBroadcast(context, requestCode, intent, flags)
  }

  fun armAll(context: Context) {
    armPeriodic(context)
    armMidnight(context)
  }

  fun armPeriodic(context: Context) {
    val am = alarmManager(context) ?: return
    val pi = pendingIntent(context, StepConst.ACTION_PERIODIC, StepConst.REQUEST_PERIODIC, true) ?: return
    try {
      am.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, SystemClock.elapsedRealtime() + StepConst.PERIODIC_MS, pi)
    } catch (e: Exception) {
      Log.w(StepConst.TAG, "Couldn't set the periodic step sample", e)
    }
  }

  fun armMidnight(context: Context) {
    val am = alarmManager(context) ?: return
    val pi = pendingIntent(context, StepConst.ACTION_MIDNIGHT, StepConst.REQUEST_MIDNIGHT, true) ?: return
    val at = nextMidnightSample(System.currentTimeMillis(), zone(context))
    try {
      am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
    } catch (e: Exception) {
      Log.w(StepConst.TAG, "Couldn't set the midnight step sample", e)
    }
  }

  fun cancelAll(context: Context) {
    val am = alarmManager(context)
    val alarms = listOf(
      StepConst.ACTION_PERIODIC to StepConst.REQUEST_PERIODIC,
      StepConst.ACTION_MIDNIGHT to StepConst.REQUEST_MIDNIGHT
    )
    for ((action, requestCode) in alarms) {
      val pi = pendingIntent(context, action, requestCode, false) ?: continue
      try {
        am?.cancel(pi)
      } catch (e: Exception) {
        // Nothing set.
      }
      pi.cancel()
    }
  }

  /** The periodic alarm's PendingIntent exists (set and not cancelled). */
  fun isArmed(context: Context): Boolean =
    pendingIntent(context, StepConst.ACTION_PERIODIC, StepConst.REQUEST_PERIODIC, false) != null

  /** The member's time zone as last passed by the app, else the phone's. */
  fun zone(context: Context): ZoneId {
    val id = StepStore.timeZone(context)
    if (!id.isNullOrEmpty()) {
      try {
        return ZoneId.of(id)
      } catch (e: Exception) {
        // Unknown id — fall through.
      }
    }
    return ZoneId.systemDefault()
  }

  /** The next of "midnight − 5 min" / "midnight + 5 min" in `zone` that is at least a minute away. */
  fun nextMidnightSample(now: Long, zone: ZoneId): Long {
    val today = Instant.ofEpochMilli(now).atZone(zone).toLocalDate()
    val offset = StepConst.MIDNIGHT_OFFSET_MS
    for (days in 0L..2L) {
      val midnight = today.plusDays(days).atStartOfDay(zone).toInstant().toEpochMilli()
      if (midnight - offset > now + 60_000L) return midnight - offset
      if (midnight + offset > now + 60_000L) return midnight + offset
    }
    return now + StepConst.PERIODIC_MS
  }
}
