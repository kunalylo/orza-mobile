package expo.modules.orzaalarms

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/** One background thread for receiver work (photo decoding, file I/O) — keeps it off the main thread and serialised. */
internal object AlarmExecutor {
  private val executor: ExecutorService = Executors.newSingleThreadExecutor()

  /** Runs `block` off the main thread (no broadcast to keep alive). */
  fun background(block: () -> Unit) {
    executor.execute {
      try {
        block()
      } catch (t: Throwable) {
        Log.e(AlarmConst.TAG, "Alarm work failed", t)
      }
    }
  }

  /** Runs `block` off the main thread and finishes the broadcast afterwards (the alarm wakelock is held until then). */
  fun runAsync(receiver: BroadcastReceiver, block: () -> Unit) {
    val pending = receiver.goAsync()
    executor.execute {
      try {
        block()
      } catch (t: Throwable) {
        Log.e(AlarmConst.TAG, "Alarm work failed", t)
      } finally {
        try {
          pending.finish()
        } catch (e: Exception) {
          // Already finished.
        }
      }
    }
  }
}

/** What happens when an alarm is due, stops ringing, or is handled elsewhere. */
internal object AlarmFiring {
  /**
   * AlarmManager fired `key` (scheduled for `at`). Ignored if it was cancelled or re-scheduled meanwhile. Much too late
   * (held back for hours): a dose alarm no longer rings but shows silently as missed, so the dose isn't lost unseen.
   */
  fun fire(context: Context, key: String, at: Long) {
    val item = AlarmStore.takePending(context, key, at) ?: return
    val late = System.currentTimeMillis() - item.at
    if (late > AlarmConst.MAX_LATE_MS) {
      Log.w(AlarmConst.TAG, "$key fired ${late / 60_000} min late — shown as missed")
      if (late <= AlarmConst.MISSED_SHOW_MS) showMissed(context, item)
      return
    }
    show(context, item)
  }

  /**
   * A dose alarm that couldn't ring in time (the phone was off, or the alarm was held back for hours): shown silently
   * in the shade, marked "Missed", with its photos and Take / Snooze / Skip. Reminders / refills and test alarms aren't.
   */
  fun showMissed(context: Context, item: AlarmItem) {
    if (!item.ring || item.isTest) return
    if (!AlarmNotifier.post(context, item, quiet = true, missed = true)) return
    AlarmStore.putShown(context, item, quiet = true, shownAt = System.currentTimeMillis())
  }

  /** Posts the alarm now; ring items start ringing and get a silencer after RING_LIMIT_MS. */
  fun show(context: Context, item: AlarmItem) {
    val now = System.currentTimeMillis()
    if (!AlarmNotifier.post(context, item, quiet = false)) return
    if (item.ring) {
      AlarmStore.putShown(context, item, quiet = false, shownAt = now)
      AlarmScheduler.setSilencer(context, item.key, now + AlarmConst.RING_LIMIT_MS)
      // The member is using the app (no full-screen intent then, only a heads-up): JS opens the alarm screen too.
      if (AlarmLockScreen.isAppResumed) OrzaAlarmsModule.notifyAlarmShown(item)
    }
  }

  /** Re-posts a ringing alarm silently (it keeps its buttons). False if it isn't showing any more. */
  fun silence(context: Context, key: String): Boolean {
    val shown = AlarmStore.getShown(context, key) ?: return false
    if (!AlarmNotifier.showingKeys(context).contains(key)) {
      AlarmStore.takeShown(context, key)
      return false
    }
    if (shown.quiet) return false
    AlarmScheduler.cancelSilencer(context, key)
    AlarmNotifier.cancel(context, key)
    if (AlarmNotifier.post(context, shown.item, quiet = true)) {
      AlarmStore.putShown(context, shown.item, quiet = true, shownAt = shown.shownAt)
    } else {
      AlarmStore.takeShown(context, key)
    }
    return true
  }

  /** Silences every ringing ÖRZA alarm (the alarm screen is open, the member has seen it). */
  fun silenceAll(context: Context): Int {
    var count = 0
    for ((key, shown) in AlarmStore.readShown(context)) {
      if (shown.quiet) continue
      if (silence(context, key)) count++
    }
    return count
  }

  /**
   * Removes `key` from the shade (handled elsewhere) — and, when its alarm is already due but hasn't been delivered yet
   * (held back by Doze / the inexact fallback), that alarm too: it must not ring for doses that were handled.
   * Never touches a future alarm.
   */
  fun dismiss(context: Context, key: String) {
    AlarmScheduler.cancelSilencer(context, key)
    AlarmStore.takeShown(context, key)
    AlarmNotifier.cancel(context, key)
    if (AlarmStore.takePendingIfDue(context, key, System.currentTimeMillis()) != null) AlarmScheduler.cancelAlarm(context, key)
  }

  /**
   * An alarm still showing whose doses were partly handled elsewhere (e.g. one of two medicines taken in the app): it
   * is shown again, silently, with only the open doses — `item` is the same alarm rebuilt by JS for them — so its
   * Take / Snooze / Skip and photos no longer include the handled one. Only when the shown alarm is silent already
   * (a ringing one is left alone: re-posting would restart the sound / full screen) and `item`'s doses are a strict
   * subset of the shown ones. Under the store lock, so an action pressed meanwhile can't be undone by the re-post.
   * True when it was re-shown.
   */
  fun refresh(context: Context, item: AlarmItem): Boolean = AlarmStore.locked {
    val shown = AlarmStore.getShown(context, item.key)
    if (shown == null || !shown.quiet) return@locked false
    if (!AlarmNotifier.showingKeys(context).contains(item.key)) {
      AlarmStore.takeShown(context, item.key)
      return@locked false
    }
    val open = item.doses.map { doseId(it) }.toSet()
    val showing = shown.item.doses.map { doseId(it) }.toSet()
    if (open.isEmpty() || open.size >= showing.size || !showing.containsAll(open)) return@locked false
    val next = item.copy(at = shown.item.at, nativeActionId = null)
    if (AlarmNotifier.post(context, next, quiet = true)) {
      AlarmStore.putShown(context, next, quiet = true, shownAt = shown.shownAt)
    }
    true
  }

  private fun doseId(d: AlarmDose): String = "${d.medId}|${d.scheduledFor}"
}

/** AlarmManager → ring (ACTION_FIRE) or stop ringing (ACTION_SILENCE). Not exported: only our PendingIntents reach it. */
class AlarmReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val action = intent.action ?: return
    val key = intent.getStringExtra(AlarmConst.EXTRA_KEY) ?: return
    val at = intent.getLongExtra(AlarmConst.EXTRA_AT, 0L)
    val app = context.applicationContext
    when (action) {
      AlarmConst.ACTION_FIRE -> AlarmExecutor.runAsync(this) { AlarmFiring.fire(app, key, at) }
      AlarmConst.ACTION_SILENCE -> AlarmExecutor.runAsync(this) { AlarmFiring.silence(app, key) }
    }
  }
}
