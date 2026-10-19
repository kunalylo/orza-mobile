package expo.modules.orzaalarms

import android.app.Activity
import android.app.Application
import android.app.KeyguardManager
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.WindowManager
import expo.modules.core.interfaces.ReactActivityLifecycleListener
import java.lang.ref.WeakReference

/**
 * Shows the app's activity over the lock screen (and turns the screen on) when it was opened by an alarm's
 * full-screen intent — and only then, and only briefly: the rest of the app must never stay reachable without
 * unlocking. Released by JS (`releaseLockScreen`, when the alarm screen closes), when the activity stops, or after
 * MAX_OVER_LOCK_MS. The screen is also kept on for KEEP_ON_MS so the member can read the photos.
 * All methods run on the main thread.
 */
internal object AlarmLockScreen {
  private const val KEEP_ON_MS = 3 * 60_000L
  private const val MAX_OVER_LOCK_MS = 10 * 60_000L

  /** A stop this soon after showing is part of the launch transition, not the member leaving. */
  private const val MIN_SHOWN_BEFORE_STOP_MS = 1_500L

  private val handler = Handler(Looper.getMainLooper())
  private var activityRef: WeakReference<Activity>? = null
  private var callbacksRegistered = false

  @Volatile
  var isShownOverLockScreen = false
    private set

  /** The app's (React) activity is in the foreground right now — an alarm firing then also opens the alarm screen. */
  @Volatile
  var isAppResumed = false
    private set
  private var shownAt = 0L

  private val stopKeepingOn = Runnable {
    activityRef?.get()?.window?.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
  }
  private val autoRelease = Runnable { activityRef?.get()?.let { release(it) } }

  fun isAlarmIntent(intent: Intent?): Boolean =
    intent?.getBooleanExtra(AlarmConst.EXTRA_SHOW_OVER_LOCK, false) == true

  fun attach(activity: Activity) {
    activityRef = WeakReference(activity)
    if (!callbacksRegistered) {
      activity.application.registerActivityLifecycleCallbacks(stopWatcher)
      callbacksRegistered = true
    }
  }

  fun currentActivity(): Activity? = activityRef?.get()

  fun show(activity: Activity) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      activity.setShowWhenLocked(true)
      activity.setTurnScreenOn(true)
    } else {
      @Suppress("DEPRECATION")
      activity.window.addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON)
    }
    activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    isShownOverLockScreen = true
    shownAt = SystemClock.elapsedRealtime()
    // Consumed: a re-created activity (or a later plain launch) must not show over the lock screen again.
    activity.intent?.removeExtra(AlarmConst.EXTRA_SHOW_OVER_LOCK)
    handler.removeCallbacks(stopKeepingOn)
    handler.removeCallbacks(autoRelease)
    handler.postDelayed(stopKeepingOn, KEEP_ON_MS)
    handler.postDelayed(autoRelease, MAX_OVER_LOCK_MS)
  }

  fun release(activity: Activity) {
    handler.removeCallbacks(stopKeepingOn)
    handler.removeCallbacks(autoRelease)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      activity.setShowWhenLocked(false)
      activity.setTurnScreenOn(false)
    } else {
      @Suppress("DEPRECATION")
      activity.window.clearFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON)
    }
    activity.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    isShownOverLockScreen = false
  }

  /** From JS (any thread). True when there was an activity to release. */
  fun releaseFromAnyThread(): Boolean {
    val activity = activityRef?.get() ?: return false
    handler.post { release(activity) }
    return true
  }

  /** Asks the system to unlock (PIN / fingerprint) — e.g. "Open ÖRZA" from the alarm. Main thread. */
  fun requestUnlock(activity: Activity, done: (Boolean) -> Unit) {
    val km = activity.getSystemService(KeyguardManager::class.java)
    if (km == null || !km.isKeyguardLocked) {
      done(true)
      return
    }
    km.requestDismissKeyguard(activity, object : KeyguardManager.KeyguardDismissCallback() {
      override fun onDismissSucceeded() = done(true)
      override fun onDismissCancelled() = done(false)
      override fun onDismissError() = done(false)
    })
  }

  private val stopWatcher = object : Application.ActivityLifecycleCallbacks {
    override fun onActivityStopped(activity: Activity) {
      if (!isShownOverLockScreen || activity !== activityRef?.get()) return
      if (SystemClock.elapsedRealtime() - shownAt < MIN_SHOWN_BEFORE_STOP_MS) return
      release(activity)
    }

    override fun onActivityDestroyed(activity: Activity) {
      if (activity === activityRef?.get()) {
        handler.removeCallbacks(stopKeepingOn)
        handler.removeCallbacks(autoRelease)
        isShownOverLockScreen = false
        isAppResumed = false
      }
    }

    override fun onActivityResumed(activity: Activity) {
      if (activity === activityRef?.get()) isAppResumed = true
    }

    override fun onActivityPaused(activity: Activity) {
      if (activity === activityRef?.get()) isAppResumed = false
    }

    override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) {}
    override fun onActivityStarted(activity: Activity) {}
    override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) {}
  }
}

/**
 * Hooks the main (React) activity: an alarm's full-screen intent → over the lock screen; a tapped ringing alarm →
 * stops ringing (it stays in the shade with its buttons).
 */
class AlarmActivityListener : ReactActivityLifecycleListener {
  override fun onCreate(activity: Activity?, savedInstanceState: Bundle?) {
    if (activity == null) return
    AlarmLockScreen.attach(activity)
    if (savedInstanceState == null) {
      handle(activity, activity.intent)
    } else {
      // Re-created later (e.g. from Recents after the process died) with the old launch intent: not an alarm now.
      activity.intent?.removeExtra(AlarmConst.EXTRA_SHOW_OVER_LOCK)
      activity.intent?.removeExtra(AlarmConst.EXTRA_OPENED)
    }
  }

  override fun onResume(activity: Activity?) {
    // The resumed state itself comes from the Application callbacks registered in onCreate (this runs deferred).
    if (activity != null) AlarmLockScreen.attach(activity)
  }

  override fun onNewIntent(intent: Intent?): Boolean {
    val activity = AlarmLockScreen.currentActivity()
    if (activity != null && intent != null) {
      // An alarm's deep link becomes the activity's intent. When the process was dead, Android re-creates the activity
      // from Recents with its OLD launcher intent and hands the alarm over here, while JS is still loading — React
      // Native then drops the `url` event ("context is not ready") and the app's initial URL (`getIntent()`) would be
      // the launcher's: the app would open its home over the lock screen instead of the alarm. A running app still
      // gets React Native's `url` event as usual.
      if (isAlarmDeepLink(intent)) activity.setIntent(intent)
      handle(activity, intent)
    }
    // false: React Native still handles the intent (the deep link to the alarm screen).
    return false
  }

  /** Our notification / full-screen intents: ACTION_VIEW on `orza://…` carrying the alarm key. */
  private fun isAlarmDeepLink(intent: Intent): Boolean =
    intent.action == Intent.ACTION_VIEW && intent.data != null && intent.hasExtra(AlarmConst.EXTRA_KEY)

  private fun handle(activity: Activity, intent: Intent?) {
    if (intent == null) return
    if (AlarmLockScreen.isAlarmIntent(intent)) {
      AlarmLockScreen.show(activity)
      intent.removeExtra(AlarmConst.EXTRA_SHOW_OVER_LOCK)
    }
    if (intent.getBooleanExtra(AlarmConst.EXTRA_OPENED, false)) {
      intent.removeExtra(AlarmConst.EXTRA_OPENED)
      val key = intent.getStringExtra(AlarmConst.EXTRA_KEY)
      val app = activity.applicationContext
      if (key != null) AlarmExecutor.background { AlarmFiring.silence(app, key) }
    }
  }
}
