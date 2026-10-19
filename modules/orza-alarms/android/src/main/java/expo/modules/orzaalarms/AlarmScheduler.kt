package expo.modules.orzaalarms

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.util.Log

/**
 * AlarmManager side: one alarm per item, re-set from the store after a reboot.
 *
 * Exact alarms allowed (Android < 12, or "Alarms & reminders" granted): ring items use `setAlarmClock` (precise,
 * leaves Doze, shows the system's alarm icon), reminders / refills `setExactAndAllowWhileIdle`. Not allowed: two
 * inexact alarms on separate PendingIntents — `setWindow(at, 10 min)` (on time while the phone is awake) and
 * `setAndAllowWhileIdle(at)` (still fires in Doze); whichever comes first rings, the other finds nothing pending.
 */
internal object AlarmScheduler {
  private const val VARIANT_MAIN = 0
  private const val VARIANT_IDLE = 1
  private const val WINDOW_MS = 10 * 60_000L

  private fun alarmManager(context: Context): AlarmManager? = context.getSystemService(AlarmManager::class.java)

  fun canScheduleExact(context: Context): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true
    val am = alarmManager(context) ?: return false
    return try {
      am.canScheduleExactAlarms()
    } catch (e: Exception) {
      false
    }
  }

  /* ───────────────────────────── Whole set ───────────────────────────── */

  /** pending.json couldn't be written: nothing was changed (the JS call rejects and the engine reports it). */
  class StoreWriteException : IllegalStateException("Couldn't save the alarms on this phone — is its storage full?")

  /**
   * Replaces the pending set with `incoming` (future items only — the plan never carries past instants). Kept from the
   * old set:
   * - alarms already due that haven't been delivered yet (an inexact / Doze-delayed alarm, or one whose broadcast is
   *   queued right now), up to MAX_LATE_MS — firing removes an item, so one still here never rang. They are set again
   *   (they fire at once). The engine removes one whose doses were handled meanwhile with `dismiss(key)`;
   * - future test alarms;
   * - natively created snoozes whose action JS hasn't collected yet (a plan computed before that Snooze press would
   *   otherwise cancel it).
   * Throws StoreWriteException (before touching AlarmManager) when the new set can't be saved — every alarm that fires
   * is looked up there, so alarms set without it would never ring. Returns how many alarms are now pending.
   */
  fun scheduleAll(context: Context, incoming: List<AlarmItem>): Int = AlarmStore.locked {
    // Under the store lock (AlarmManager calls are quick): a Snooze pressed meanwhile can't interleave.
    val now = System.currentTimeMillis()
    val old = AlarmStore.readPending(context)
    val next = LinkedHashMap<String, AlarmItem>()
    for (item in incoming) if (item.at > now) next[item.key] = item
    for ((key, item) in old) {
      if (next.containsKey(key)) continue
      if (item.at <= now) {
        if (now - item.at <= AlarmConst.MAX_LATE_MS) next[key] = item
        continue
      }
      val nativeSnooze = item.nativeActionId
      val keep = item.isTest || (nativeSnooze != null && AlarmStore.hasAction(context, nativeSnooze))
      if (keep) next[key] = item
    }
    if (!AlarmStore.writePending(context, next)) throw StoreWriteException()
    for (key in old.keys) if (!next.containsKey(key)) cancelAlarm(context, key)
    val exact = canScheduleExact(context)
    for (item in next.values) setAlarm(context, item, exact)
    next.size
  }

  /**
   * Adds or replaces one alarm without touching the others (C4's test alarm, a snooze re-ring). False when it is in
   * the past; throws StoreWriteException when it can't be saved (nothing is set then).
   */
  fun scheduleOne(context: Context, item: AlarmItem): Boolean {
    if (item.at <= System.currentTimeMillis()) return false
    AlarmStore.locked {
      if (!AlarmStore.putPending(context, item)) throw StoreWriteException()
      setAlarm(context, item)
    }
    return true
  }

  /**
   * Cancels every pending alarm and silencer, removes every ÖRZA alarm notification and forgets recorded actions
   * (sign-out, permission gone — the engine collects pending actions before it ever cancels for a permission reason).
   */
  fun cancelAll(context: Context) {
    val shown = AlarmStore.locked {
      val pending = AlarmStore.readPending(context)
      AlarmStore.writePending(context, emptyMap())
      for (key in pending.keys) cancelAlarm(context, key)
      val showing = AlarmStore.readShown(context)
      AlarmStore.clearShown(context)
      AlarmStore.clearActions(context)
      showing
    }
    for (key in shown.keys) cancelSilencer(context, key)
    for (key in shown.keys + AlarmNotifier.showingKeys(context)) AlarmNotifier.cancel(context, key)
  }

  /**
   * After a reboot / app update / clock change / exact-alarm grant: set every stored future alarm again.
   * - After a reboot (`ringMissed`; the phone's alarms were wiped): ring items missed by ≤ MISSED_GRACE_MS ring now,
   *   older ones (≤ MISSED_SHOW_MS) show silently as missed; other past items are dropped.
   * - Otherwise the alarms still exist: past items not delivered yet are set again (they fire at once) up to
   *   MAX_LATE_MS, like `scheduleAll`; older dose alarms show silently as missed.
   */
  fun rescheduleStored(context: Context, ringMissed: Boolean) {
    val now = System.currentTimeMillis()
    val ringNow = ArrayList<AlarmItem>()
    val missed = ArrayList<AlarmItem>()
    AlarmStore.locked {
      val keep = LinkedHashMap<String, AlarmItem>()
      for ((key, item) in AlarmStore.readPending(context)) {
        val late = now - item.at
        when {
          item.at > now -> keep[key] = item
          ringMissed && item.ring && late <= AlarmConst.MISSED_GRACE_MS -> ringNow.add(item)
          !ringMissed && late <= AlarmConst.MAX_LATE_MS -> keep[key] = item
          item.ring && late <= AlarmConst.MISSED_SHOW_MS -> missed.add(item)
        }
      }
      AlarmStore.writePending(context, keep)
      val exact = canScheduleExact(context)
      for (item in keep.values) setAlarm(context, item, exact)
    }
    for (item in ringNow) AlarmFiring.show(context, item)
    for (item in missed) AlarmFiring.showMissed(context, item)
  }

  /* ───────────────────────────── One alarm ───────────────────────────── */

  fun setAlarm(context: Context, item: AlarmItem, exactAllowed: Boolean = canScheduleExact(context)) {
    val am = alarmManager(context) ?: return
    val fire = firePendingIntent(context, item.key, item.at, VARIANT_MAIN)
    if (exactAllowed) {
      try {
        if (item.ring) {
          am.setAlarmClock(AlarmManager.AlarmClockInfo(item.at, AlarmNotifier.contentPendingIntent(context, item)), fire)
        } else {
          am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, item.at, fire)
        }
        cancelVariant(context, item.key, VARIANT_IDLE)
        return
      } catch (e: SecurityException) {
        Log.w(AlarmConst.TAG, "Exact alarm refused — falling back to inexact for ${item.key}", e)
      } catch (e: Exception) {
        Log.e(AlarmConst.TAG, "Couldn't set the exact alarm ${item.key}", e)
      }
    }
    try {
      am.setWindow(AlarmManager.RTC_WAKEUP, item.at, WINDOW_MS, fire)
      am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, item.at, firePendingIntent(context, item.key, item.at, VARIANT_IDLE))
    } catch (e: Exception) {
      Log.e(AlarmConst.TAG, "Couldn't set the alarm ${item.key}", e)
    }
  }

  fun cancelAlarm(context: Context, key: String) {
    cancelVariant(context, key, VARIANT_MAIN)
    cancelVariant(context, key, VARIANT_IDLE)
  }

  private fun fireIntent(context: Context, key: String, at: Long, variant: Int): Intent {
    val intent = Intent(context, AlarmReceiver::class.java)
    intent.action = AlarmConst.ACTION_FIRE
    // The data URI makes every alarm's PendingIntent distinct, whatever its request code.
    intent.data = Uri.parse("orza-alarm://fire/$variant/${Uri.encode(key)}")
    intent.putExtra(AlarmConst.EXTRA_KEY, key)
    intent.putExtra(AlarmConst.EXTRA_AT, at)
    return intent
  }

  private fun firePendingIntent(context: Context, key: String, at: Long, variant: Int): PendingIntent =
    PendingIntent.getBroadcast(
      context,
      AlarmNotifier.requestCode("fire$variant:$key"),
      fireIntent(context, key, at, variant),
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
    )

  private fun cancelVariant(context: Context, key: String, variant: Int) {
    val pi: PendingIntent? = PendingIntent.getBroadcast(
      context,
      AlarmNotifier.requestCode("fire$variant:$key"),
      fireIntent(context, key, 0L, variant),
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_NO_CREATE
    )
    if (pi != null) {
      alarmManager(context)?.cancel(pi)
      pi.cancel()
    }
  }

  /* ───────────────────────────── Silencer ───────────────────────────── */

  private fun silencerIntent(context: Context, key: String): Intent {
    val intent = Intent(context, AlarmReceiver::class.java)
    intent.action = AlarmConst.ACTION_SILENCE
    intent.data = Uri.parse("orza-alarm://silence/${Uri.encode(key)}")
    intent.putExtra(AlarmConst.EXTRA_KEY, key)
    return intent
  }

  /** Stops the ringing of `key` at `at` (it stays in the shade, silent). */
  fun setSilencer(context: Context, key: String, at: Long) {
    val am = alarmManager(context) ?: return
    val pi = PendingIntent.getBroadcast(
      context,
      AlarmNotifier.requestCode("silence:$key"),
      silencerIntent(context, key),
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
    )
    try {
      if (canScheduleExact(context)) {
        am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
      } else {
        am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
      }
    } catch (e: Exception) {
      try {
        am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
      } catch (e2: Exception) {
        Log.w(AlarmConst.TAG, "Couldn't set the silencer for $key", e2)
      }
    }
  }

  fun cancelSilencer(context: Context, key: String) {
    val pi: PendingIntent? = PendingIntent.getBroadcast(
      context,
      AlarmNotifier.requestCode("silence:$key"),
      silencerIntent(context, key),
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_NO_CREATE
    )
    if (pi != null) {
      alarmManager(context)?.cancel(pi)
      pi.cancel()
    }
  }
}
