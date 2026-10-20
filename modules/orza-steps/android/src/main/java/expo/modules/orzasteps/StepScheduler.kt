package expo.modules.orzasteps

import android.app.AlarmManager
import android.app.PendingIntent
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.SystemClock
import android.util.Log
import java.time.Instant
import java.time.ZoneId

/**
 * The sampler's alarms: one-shot allow-while-idle alarms, re-armed every time they fire (allow-while-idle also exempts
 * the app from background limits for a few seconds, which Android 9+ requires before it hands a sensor event to an app
 * that isn't in front).
 * - periodic: inexact, about every hour — spaced out in stricter App Standby buckets, none in Restricted (see
 *   StepConst.PERIODIC_MS);
 * - midnight: just before and just after local midnight in the member's time zone, so each day's total splits cleanly.
 *   Exact when the member allowed "Alarms & reminders" (ÖRZA asks for it for medicine alarms; no new permission),
 *   otherwise an inexact chain whose latest possible delivery still lands before midnight (see nextInexactMidnightSample).
 */
internal object StepScheduler {
  /** UsageStatsManager.STANDBY_BUCKET_* values (API 28+). */
  private const val BUCKET_ACTIVE = 10
  private const val BUCKET_FREQUENT = 30
  private const val BUCKET_RARE = 40
  private const val BUCKET_RESTRICTED = 45

  private fun alarmManager(context: Context): AlarmManager? = context.getSystemService(AlarmManager::class.java)

  private fun pendingIntent(context: Context, action: String, requestCode: Int, create: Boolean): PendingIntent? {
    val intent = Intent(context, StepAlarmReceiver::class.java).setAction(action)
    val flags = PendingIntent.FLAG_IMMUTABLE or (if (create) PendingIntent.FLAG_UPDATE_CURRENT else PendingIntent.FLAG_NO_CREATE)
    return PendingIntent.getBroadcast(context, requestCode, intent, flags)
  }

  /** Exact alarms are allowed ("Alarms & reminders"; always below Android 12) — same rule as orza-alarms. */
  fun canScheduleExact(context: Context): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true
    val am = alarmManager(context) ?: return false
    return try {
      am.canScheduleExactAlarms()
    } catch (e: Exception) {
      false
    }
  }

  /** ÖRZA's App Standby bucket (own app: no permission needed); "active" below Android 9 or when unknown. */
  fun standbyBucket(context: Context): Int {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) return BUCKET_ACTIVE
    return try {
      context.getSystemService(UsageStatsManager::class.java)?.appStandbyBucket ?: BUCKET_ACTIVE
    } catch (e: Exception) {
      BUCKET_ACTIVE
    }
  }

  /** The periodic sample's spacing for `bucket`, null = none (Restricted: 1 alarm a day, kept for medicine reminders). */
  fun periodicInterval(bucket: Int): Long? =
    when {
      bucket >= BUCKET_RESTRICTED -> null
      bucket >= BUCKET_RARE -> StepConst.PERIODIC_RARE_MS
      bucket >= BUCKET_FREQUENT -> StepConst.PERIODIC_FREQUENT_MS
      else -> StepConst.PERIODIC_MS
    }

  fun armAll(context: Context) {
    armPeriodic(context)
    armMidnight(context)
  }

  fun armPeriodic(context: Context) {
    val am = alarmManager(context) ?: return
    val every = periodicInterval(standbyBucket(context))
    if (every == null) {
      cancel(context, StepConst.ACTION_PERIODIC, StepConst.REQUEST_PERIODIC)
      return
    }
    val pi = pendingIntent(context, StepConst.ACTION_PERIODIC, StepConst.REQUEST_PERIODIC, true) ?: return
    try {
      am.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, SystemClock.elapsedRealtime() + every, pi)
    } catch (e: Exception) {
      Log.w(StepConst.TAG, "Couldn't set the periodic step sample", e)
    }
  }

  fun armMidnight(context: Context) {
    val am = alarmManager(context) ?: return
    val bucket = standbyBucket(context)
    if (bucket >= BUCKET_RESTRICTED) {
      cancel(context, StepConst.ACTION_MIDNIGHT, StepConst.REQUEST_MIDNIGHT)
      return
    }
    val pi = pendingIntent(context, StepConst.ACTION_MIDNIGHT, StepConst.REQUEST_MIDNIGHT, true) ?: return
    val now = System.currentTimeMillis()
    val zone = zone(context)
    if (canScheduleExact(context)) {
      try {
        am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, nextMidnightSample(now, zone), pi)
        return
      } catch (e: SecurityException) {
        Log.w(StepConst.TAG, "Exact midnight sample refused — using the inexact chain", e)
      } catch (e: Exception) {
        Log.w(StepConst.TAG, "Couldn't set the exact midnight step sample", e)
      }
    }
    val capped = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
    val at = nextInexactMidnightSample(now, zone, capped, refine = bucket < BUCKET_FREQUENT)
    try {
      am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
    } catch (e: Exception) {
      Log.w(StepConst.TAG, "Couldn't set the midnight step sample", e)
    }
  }

  private fun cancel(context: Context, action: String, requestCode: Int) {
    val pi = pendingIntent(context, action, requestCode, false) ?: return
    try {
      alarmManager(context)?.cancel(pi)
    } catch (e: Exception) {
      // Nothing set.
    }
    pi.cancel()
  }

  fun cancelAll(context: Context) {
    cancel(context, StepConst.ACTION_PERIODIC, StepConst.REQUEST_PERIODIC)
    cancel(context, StepConst.ACTION_MIDNIGHT, StepConst.REQUEST_MIDNIGHT)
  }

  /** The periodic alarm's PendingIntent exists (set and not cancelled). */
  fun isArmed(context: Context): Boolean =
    pendingIntent(context, StepConst.ACTION_PERIODIC, StepConst.REQUEST_PERIODIC, false) != null

  /** The midnight alarm's PendingIntent exists. */
  fun isMidnightArmed(context: Context): Boolean =
    pendingIntent(context, StepConst.ACTION_MIDNIGHT, StepConst.REQUEST_MIDNIGHT, false) != null

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

  private fun midnightAfter(now: Long, zone: ZoneId, days: Long): Long =
    Instant.ofEpochMilli(now).atZone(zone).toLocalDate().plusDays(days).atStartOfDay(zone).toInstant().toEpochMilli()

  /** Exact: the next of "midnight − 5 min" / "midnight + 5 min" in `zone` that is at least a minute away. */
  fun nextMidnightSample(now: Long, zone: ZoneId): Long {
    val offset = StepConst.MIDNIGHT_OFFSET_MS
    for (days in 0L..2L) {
      val midnight = midnightAfter(now, zone, days)
      if (midnight - offset > now + 60_000L) return midnight - offset
      if (midnight + offset > now + 60_000L) return midnight + offset
    }
    return now + StepConst.PERIODIC_MS
  }

  /**
   * Inexact: Android delivers an allow-while-idle alarm set `x` ahead up to 0.75·x late (at most 1 h late from Android
   * 12, `capped`). Before each midnight the alarm goes to the latest time whose worst-case delivery is still
   * PRE_MIDNIGHT_MARGIN_MS before midnight; each run re-arms from its own time (shorter lead = smaller window) until a
   * run lands within CHAIN_FINAL_GAP_MS of that deadline (CHAIN_COARSE_GAP_MS when `refine` is false: fewer alarms in
   * the stricter standby buckets). Then one sample POST_MIDNIGHT_OFFSET_MS after midnight.
   */
  fun nextInexactMidnightSample(now: Long, zone: ZoneId, capped: Boolean, refine: Boolean): Long {
    val enough = if (refine) StepConst.CHAIN_FINAL_GAP_MS else StepConst.CHAIN_COARSE_GAP_MS
    for (days in 0L..2L) {
      val midnight = midnightAfter(now, zone, days)
      val deadline = midnight - StepConst.PRE_MIDNIGHT_MARGIN_MS
      if (deadline - now > enough) return latestTriggerBefore(now, deadline, capped)
      val post = midnight + StepConst.POST_MIDNIGHT_OFFSET_MS
      if (post > now + 60_000L) return post
    }
    return now + StepConst.PERIODIC_MS
  }

  /** The latest trigger time after `now` whose latest possible inexact delivery is still at or before `deadline`. */
  fun latestTriggerBefore(now: Long, deadline: Long, capped: Boolean): Long {
    val lead = deadline - now
    // Uncapped: x + 0.75·x ≤ lead. Capped: x + min(0.75·x, 1 h) ≤ lead → x may also be lead − 1 h.
    var x = (lead / 1.75).toLong()
    if (capped) x = maxOf(x, lead - StepConst.INEXACT_WINDOW_CAP_MS)
    return now + maxOf(x, 60_000L)
  }
}
