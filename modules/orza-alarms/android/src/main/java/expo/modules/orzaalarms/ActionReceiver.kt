package expo.modules.orzaalarms

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * Take / Snooze 10 min / Skip pressed on an alarm notification — works with the app killed and offline:
 * the alarm goes away at once, the action is recorded for JS (`takeNativeActions` / `onAlarmAction`), and Snooze
 * schedules the re-ring right here under the key the next JS plan will use (C1 `snoozeAlarmKey`).
 */
class ActionReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val key = intent.getStringExtra(AlarmConst.EXTRA_KEY) ?: return
    val action = intent.getStringExtra(AlarmConst.EXTRA_DOSE_ACTION)
    if (action == null || !AlarmConst.isDoseAction(action)) return
    val itemJson = intent.getStringExtra(AlarmConst.EXTRA_ITEM)
    val app = context.applicationContext
    // Stop the ringing right away, before any file work.
    AlarmNotifier.cancel(app, key)
    AlarmExecutor.runAsync(this) { handle(app, key, action, itemJson) }
  }

  private fun handle(context: Context, key: String, action: String, itemJson: String?) {
    val now = System.currentTimeMillis()
    AlarmScheduler.cancelSilencer(context, key)
    val shown = AlarmStore.takeShown(context, key)
    val item = shown?.item ?: AlarmItem.fromJsonString(itemJson)
    if (item == null) {
      Log.w(AlarmConst.TAG, "Action $action on $key without its alarm data — ignored")
      return
    }

    val snoozing = action == AlarmConst.SNOOZE
    val recorded = if (!item.isTest && item.doses.isNotEmpty()) {
      AlarmStore.addAction(context, key, action, item.doses, if (snoozing) AlarmConst.SNOOZE_MINUTES else null, now)
    } else {
      null
    }

    if (snoozing) {
      val snoozeKey = if (item.isTest) item.key else (item.snoozeKey ?: item.key)
      val again = item.copy(
        key = snoozeKey,
        at = now + AlarmConst.SNOOZE_MINUTES * 60_000L,
        nativeActionId = recorded?.id
      )
      AlarmScheduler.scheduleOne(context, again)
    }

    if (recorded != null) OrzaAlarmsModule.notifyActionRecorded(recorded)
  }
}
