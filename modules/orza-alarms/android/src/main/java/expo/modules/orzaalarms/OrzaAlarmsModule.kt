package expo.modules.orzaalarms

import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import android.util.Log
import androidx.core.app.NotificationManagerCompat
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONArray
import org.json.JSONObject
import java.lang.ref.WeakReference

/**
 * JS API of the ÖRZA medicine alarms (`modules/orza-alarms/src/OrzaAlarms.ts`). Items and actions cross the bridge as
 * JSON strings. Everything that must work with the app killed lives in the receivers + AlarmStore, not here.
 */
class OrzaAlarmsModule : Module() {
  private val context: Context
    get() = appContext.reactContext?.applicationContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("OrzaAlarms")

    Events(EVENT_ACTION, EVENT_SHOWN)

    OnCreate {
      current = WeakReference(this@OrzaAlarmsModule)
      appContext.reactContext?.applicationContext?.let { AlarmNotifier.ensureChannels(it) }
    }

    OnDestroy {
      if (current?.get() === this@OrzaAlarmsModule) current = null
    }

    /** Replaces every pending alarm with these (`NativeAlarmItem[]` as JSON). Resolves with the number pending. */
    AsyncFunction("scheduleAll") { itemsJson: String ->
      val ctx = context
      AlarmNotifier.ensureChannels(ctx)
      AlarmScheduler.scheduleAll(ctx, AlarmItem.listFromJsonString(itemsJson))
    }

    /** Adds / replaces one alarm, leaving the rest (test alarms). False when it is in the past or invalid. */
    AsyncFunction("scheduleOne") { itemJson: String ->
      val ctx = context
      val item = AlarmItem.fromJsonString(itemJson) ?: return@AsyncFunction false
      AlarmNotifier.ensureChannels(ctx)
      AlarmScheduler.scheduleOne(ctx, item)
    }

    AsyncFunction<Unit>("cancelAll") {
      AlarmScheduler.cancelAll(context)
    }

    /** Removes the alarm `key` if it is showing / ringing; never cancels a pending one. */
    AsyncFunction("dismiss") { key: String ->
      AlarmFiring.dismiss(context, key)
    }

    /** Stops every ringing alarm but keeps it in the shade with its buttons. Resolves with how many were silenced. */
    AsyncFunction("silenceRinging") {
      return@AsyncFunction AlarmFiring.silenceAll(context)
    }

    AsyncFunction("getStatus") {
      val ctx = context
      val nm = ctx.getSystemService(NotificationManager::class.java)
      val exact: Boolean? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) AlarmScheduler.canScheduleExact(ctx) else null
      val fullScreen: Boolean? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
        try {
          nm?.canUseFullScreenIntent() ?: true
        } catch (e: Exception) {
          true
        }
      } else {
        null
      }
      return@AsyncFunction mapOf<String, Any?>(
        "notificationsEnabled" to NotificationManagerCompat.from(ctx).areNotificationsEnabled(),
        "alarmChannelEnabled" to AlarmNotifier.channelEnabled(ctx, AlarmNotifier.CHANNEL_ALARMS),
        "remindersChannelEnabled" to AlarmNotifier.channelEnabled(ctx, AlarmNotifier.CHANNEL_REMINDERS),
        "exact" to exact,
        "fullScreen" to fullScreen,
        "sdkInt" to Build.VERSION.SDK_INT,
        "scheduled" to AlarmStore.pendingCount(ctx),
        "customSound" to (AlarmNotifier.customSoundId(ctx) != 0),
        "overLockScreen" to AlarmLockScreen.isShownOverLockScreen,
        "batteryUnrestricted" to batteryUnrestricted(ctx)
      )
    }

    /** Pending alarms as JSON `[{key, at, kind, ring}]`, soonest first (diagnostics / the "Alarms on this phone" card). */
    AsyncFunction("getScheduled") {
      val items = AlarmStore.readPending(context).values.sortedBy { it.at }
      val arr = JSONArray()
      for (item in items) {
        val o = JSONObject()
        o.put("key", item.key)
        o.put("at", item.at)
        o.put("kind", item.kind)
        o.put("ring", item.ring)
        arr.put(o)
      }
      return@AsyncFunction arr.toString()
    }

    /** Actions pressed on alarms that JS hasn't collected yet, as JSON; each is returned once. */
    AsyncFunction("takeNativeActions") {
      val arr = JSONArray()
      for (a in AlarmStore.drainActions(context)) arr.put(a.toJson())
      return@AsyncFunction arr.toString()
    }

    AsyncFunction("openExactAlarmSettings") {
      val pkg = context.packageName
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        val intent = Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:$pkg"))
        if (startSettings(intent)) return@AsyncFunction true
      }
      return@AsyncFunction startSettings(appDetailsIntent(pkg))
    }

    AsyncFunction("openFullScreenSettings") {
      val pkg = context.packageName
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
        val intent = Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:$pkg"))
        if (startSettings(intent)) return@AsyncFunction true
      }
      return@AsyncFunction startSettings(appNotificationSettingsIntent(pkg)) || startSettings(appDetailsIntent(pkg))
    }

    /** The alarm channel's settings when only that channel is off, else the app's notification settings. */
    AsyncFunction("openNotificationSettings") {
      val ctx = context
      val pkg = ctx.packageName
      val appEnabled = NotificationManagerCompat.from(ctx).areNotificationsEnabled()
      if (appEnabled && !AlarmNotifier.channelEnabled(ctx, AlarmNotifier.CHANNEL_ALARMS)) {
        val channel = Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS)
          .putExtra(Settings.EXTRA_APP_PACKAGE, pkg)
          .putExtra(Settings.EXTRA_CHANNEL_ID, AlarmNotifier.CHANNEL_ALARMS)
        if (startSettings(channel)) return@AsyncFunction true
      }
      return@AsyncFunction startSettings(appNotificationSettingsIntent(pkg)) || startSettings(appDetailsIntent(pkg))
    }

    AsyncFunction("openAppSettings") {
      return@AsyncFunction startSettings(appDetailsIntent(context.packageName))
    }

    /** The battery-optimisation list ("Unrestricted" / "Don't optimise"), else the app's info page. */
    AsyncFunction("openBatterySettings") {
      return@AsyncFunction startSettings(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)) ||
        startSettings(appDetailsIntent(context.packageName))
    }

    /** Stop showing over the lock screen (the alarm screen closed). True when there was an activity to release. */
    AsyncFunction("releaseLockScreen") {
      return@AsyncFunction AlarmLockScreen.releaseFromAnyThread()
    }

    /** Asks for the PIN / fingerprint; resolves true once unlocked (or already unlocked), false if cancelled. */
    AsyncFunction("requestUnlock") { promise: Promise ->
      val activity = appContext.currentActivity
      if (activity == null) {
        promise.resolve(false)
        return@AsyncFunction
      }
      try {
        AlarmLockScreen.requestUnlock(activity) { ok -> promise.resolve(ok) }
      } catch (e: Exception) {
        Log.w(AlarmConst.TAG, "requestDismissKeyguard failed", e)
        promise.resolve(false)
      }
    }.runOnQueue(Queues.MAIN)
  }

  /** The app is exempt from battery optimisation (Doze / app standby can't hold its alarms back as much). */
  private fun batteryUnrestricted(ctx: Context): Boolean =
    try {
      ctx.getSystemService(PowerManager::class.java)?.isIgnoringBatteryOptimizations(ctx.packageName) ?: false
    } catch (e: Exception) {
      false
    }

  private fun appDetailsIntent(pkg: String): Intent =
    Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$pkg"))

  private fun appNotificationSettingsIntent(pkg: String): Intent =
    Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, pkg)

  private fun startSettings(intent: Intent): Boolean {
    return try {
      val activity = appContext.currentActivity
      if (activity != null) {
        activity.startActivity(intent)
      } else {
        context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      }
      true
    } catch (e: Exception) {
      Log.w(AlarmConst.TAG, "Couldn't open ${intent.action}", e)
      false
    }
  }

  companion object {
    private const val EVENT_ACTION = "onAlarmAction"
    private const val EVENT_SHOWN = "onAlarmShown"

    @Volatile
    private var current: WeakReference<OrzaAlarmsModule>? = null

    /** Called by ActionReceiver: tells a running JS app that an action is waiting (`takeNativeActions` collects it). */
    internal fun notifyActionRecorded(action: AlarmAction) {
      val module = current?.get() ?: return
      try {
        module.sendEvent(
          EVENT_ACTION,
          mapOf<String, Any?>(
            "id" to action.id.toDouble(),
            "key" to action.key,
            "action" to action.action
          )
        )
      } catch (t: Throwable) {
        Log.w(AlarmConst.TAG, "Couldn't notify JS of an alarm action", t)
      }
    }

    /** Called when a ring alarm is posted while the app is in the foreground: JS opens the alarm screen. */
    internal fun notifyAlarmShown(item: AlarmItem) {
      val module = current?.get() ?: return
      try {
        module.sendEvent(
          EVENT_SHOWN,
          mapOf<String, Any?>(
            "key" to item.key,
            "deepLink" to item.deepLink,
            "at" to item.at.toDouble()
          )
        )
      } catch (t: Throwable) {
        Log.w(AlarmConst.TAG, "Couldn't notify JS of a ringing alarm", t)
      }
    }
  }
}
