package expo.modules.orzaalarms

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.ContentResolver
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.net.Uri
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

/**
 * Notification channels and the alarm notification itself.
 *
 * - `orza_alarms` (HIGH, alarm audio usage, the app's `res/raw/orza_alarm` tone or the phone's alarm tone, long
 *   vibration): medicine doses. Insistent (repeats until answered, at most RING_LIMIT_MS), full-screen intent over the
 *   lock screen, medicine photos, Take / Snooze 10 min / Skip.
 * - `orza_alarms_quiet` (LOW, silent): the same alarm after it stopped ringing — stays in the shade with its buttons.
 * - `orza_reminders` (DEFAULT, normal notification sound): water / meals / weight / custom reminders and refill alerts.
 *
 * A channel's sound can't change after it is created, so the tone must be in the very first build that creates it
 * (C3 wires `assets/sounds/orza_alarm.wav` into the expo-notifications plugin `sounds`).
 */
internal object AlarmNotifier {
  const val CHANNEL_ALARMS = "orza_alarms"
  const val CHANNEL_QUIET = "orza_alarms_quiet"
  const val CHANNEL_REMINDERS = "orza_reminders"

  /** Every ÖRZA alarm notification uses this id; the alarm key is the tag. */
  const val NOTIFICATION_ID = 7301

  private const val SOUND_NAME = "orza_alarm"
  private const val QUIET_TIMEOUT_MS = 12 * 60 * 60_000L

  /**
   * Hard stop for a ringing copy: the silencer re-posts it quietly after RING_LIMIT_MS, but an inexact silencer (no
   * "Alarms & reminders" access) may run late — the sound must never go on for long, even if the alarm then vanishes.
   */
  private const val RINGING_TIMEOUT_MS = AlarmConst.RING_LIMIT_MS + 20 * 60_000L
  private const val REMINDER_TIMEOUT_MS = 6 * 60 * 60_000L
  private const val ACCENT = 0xFFFF7A6A.toInt()
  private val VIBRATION = longArrayOf(0, 800, 400, 800, 400, 800, 1600)

  /* ───────────────────────────── Channels ───────────────────────────── */

  fun ensureChannels(context: Context) {
    val nm = context.getSystemService(NotificationManager::class.java) ?: return
    try {
      val alarms = NotificationChannel(CHANNEL_ALARMS, "Medicine alarms", NotificationManager.IMPORTANCE_HIGH)
      alarms.description = "Rings at each medicine time with the medicine photos until you take, snooze or skip it."
      alarms.setSound(
        alarmSoundUri(context),
        AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_ALARM)
          .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
          .build()
      )
      alarms.enableVibration(true)
      alarms.vibrationPattern = VIBRATION
      alarms.enableLights(true)
      alarms.lightColor = ACCENT
      alarms.lockscreenVisibility = Notification.VISIBILITY_PUBLIC
      alarms.setShowBadge(true)

      val quiet = NotificationChannel(CHANNEL_QUIET, "Unanswered medicine alarms", NotificationManager.IMPORTANCE_LOW)
      quiet.description = "A medicine alarm that stopped ringing stays here until you take, snooze or skip it."
      quiet.setSound(null, null)
      quiet.enableVibration(false)
      quiet.lockscreenVisibility = Notification.VISIBILITY_PUBLIC
      quiet.setShowBadge(true)

      val reminders = NotificationChannel(CHANNEL_REMINDERS, "Reminders", NotificationManager.IMPORTANCE_DEFAULT)
      reminders.description = "Water, meal, weigh-in and refill reminders from ÖRZA."
      reminders.enableVibration(true)
      reminders.enableLights(true)
      reminders.lightColor = ACCENT
      reminders.lockscreenVisibility = Notification.VISIBILITY_PUBLIC

      // Creating an existing channel only updates its name / description; the user's choices are kept.
      nm.createNotificationChannels(listOf(alarms, quiet, reminders))
    } catch (e: Exception) {
      Log.w(AlarmConst.TAG, "Couldn't create the notification channels", e)
    }
  }

  /** False when the user turned this channel off in the phone's settings. */
  fun channelEnabled(context: Context, channelId: String): Boolean {
    val nm = context.getSystemService(NotificationManager::class.java) ?: return true
    val channel = nm.getNotificationChannel(channelId) ?: return true
    return channel.importance != NotificationManager.IMPORTANCE_NONE
  }

  private fun findChannel(context: Context, channelId: String): NotificationChannel? =
    try {
      context.getSystemService(NotificationManager::class.java)?.getNotificationChannel(channelId)
    } catch (e: Exception) {
      null
    }

  /**
   * The channel is on but can't make a sound: set to "Silent" (importance below DEFAULT) or its sound set to "None".
   * Alarms then only appear in the shade — they don't ring. (Turned off completely = `channelEnabled` false.)
   */
  fun channelSilenced(context: Context, channelId: String): Boolean {
    val channel = findChannel(context, channelId) ?: return false
    if (channel.importance == NotificationManager.IMPORTANCE_NONE) return false
    if (channel.importance < NotificationManager.IMPORTANCE_DEFAULT) return true
    // "None" in the sound picker: null, or an empty URI on some Settings apps.
    val sound: Uri? = channel.sound
    return sound == null || sound == Uri.EMPTY || sound.toString().isEmpty()
  }

  /** The channel may pop up on screen (heads-up) — needed for the full-screen alarm too (HIGH importance). */
  fun channelPopsUp(context: Context, channelId: String): Boolean {
    val channel = findChannel(context, channelId) ?: return true
    if (channel.importance == NotificationManager.IMPORTANCE_NONE) return true // reported as off instead
    return channel.importance >= NotificationManager.IMPORTANCE_HIGH
  }

  fun customSoundId(context: Context): Int =
    context.resources.getIdentifier(SOUND_NAME, "raw", context.packageName)

  /** `android.resource://<pkg>/raw/orza_alarm` (by name: survives resource-id changes between builds) or the alarm tone. */
  private fun alarmSoundUri(context: Context): Uri {
    if (customSoundId(context) != 0) {
      return Uri.parse("${ContentResolver.SCHEME_ANDROID_RESOURCE}://${context.packageName}/raw/$SOUND_NAME")
    }
    return RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
      ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
      ?: android.provider.Settings.System.DEFAULT_NOTIFICATION_URI
  }

  private fun smallIcon(context: Context): Int {
    val id = context.resources.getIdentifier("notification_icon", "drawable", context.packageName)
    return if (id != 0) id else android.R.drawable.ic_lock_idle_alarm
  }

  private fun accentColor(context: Context): Int {
    val id = context.resources.getIdentifier("notification_icon_color", "color", context.packageName)
    if (id == 0) return ACCENT
    return try {
      context.getColor(id)
    } catch (e: Exception) {
      ACCENT
    }
  }

  /* ───────────────────────────── Intents ───────────────────────────── */

  /** Opens the app's launch activity on `deepLink` (ACTION_VIEW + data, so React Native's Linking delivers the URL). */
  fun openAppIntent(context: Context, item: AlarmItem, fullScreen: Boolean): Intent {
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(item.deepLink))
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
    val component = launch?.component
    if (component != null) {
      intent.component = component
    } else {
      intent.setPackage(context.packageName)
    }
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    intent.putExtra(AlarmConst.EXTRA_KEY, item.key)
    if (fullScreen) {
      // Phone locked / screen off: show over the lock screen and keep ringing until answered.
      intent.putExtra(AlarmConst.EXTRA_SHOW_OVER_LOCK, true)
    } else if (item.ring) {
      // Tapped: the member is looking at it now.
      intent.putExtra(AlarmConst.EXTRA_OPENED, true)
    }
    return intent
  }

  fun contentPendingIntent(context: Context, item: AlarmItem): PendingIntent =
    PendingIntent.getActivity(
      context,
      requestCode("content:${item.key}"),
      openAppIntent(context, item, false),
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
    )

  private fun fullScreenPendingIntent(context: Context, item: AlarmItem): PendingIntent =
    PendingIntent.getActivity(
      context,
      requestCode("full:${item.key}"),
      openAppIntent(context, item, true),
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
    )

  private fun actionPendingIntent(context: Context, item: AlarmItem, action: String): PendingIntent {
    val intent = Intent(context, ActionReceiver::class.java)
    intent.action = AlarmConst.ACTION_DOSE
    intent.data = Uri.parse("orza-alarm://action/$action/${Uri.encode(item.key)}")
    intent.putExtra(AlarmConst.EXTRA_KEY, item.key)
    intent.putExtra(AlarmConst.EXTRA_DOSE_ACTION, action)
    // The whole item rides along, so Snooze can re-ring even if the "showing" record is gone.
    intent.putExtra(AlarmConst.EXTRA_ITEM, item.toJson().toString())
    return PendingIntent.getBroadcast(
      context,
      requestCode("action:$action:${item.key}"),
      intent,
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
    )
  }

  fun requestCode(seed: String): Int = seed.hashCode()

  /* ───────────────────────────── Posting ───────────────────────────── */

  /**
   * Shows `item`. `quiet` = the silent copy of a ring item (after RING_LIMIT_MS or `silenceRinging`); `missed` (with
   * `quiet`) marks a dose alarm that couldn't ring in time ("Missed" next to the app name).
   * Returns false when notifications are off (nothing can show).
   */
  fun post(context: Context, item: AlarmItem, quiet: Boolean, missed: Boolean = false): Boolean {
    ensureChannels(context)
    val manager = NotificationManagerCompat.from(context)
    if (!manager.areNotificationsEnabled()) return false
    val ringing = item.ring && !quiet
    val channel = when {
      !item.ring -> CHANNEL_REMINDERS
      quiet -> CHANNEL_QUIET
      else -> CHANNEL_ALARMS
    }

    val builder = NotificationCompat.Builder(context, channel)
      .setSmallIcon(smallIcon(context))
      .setColor(accentColor(context))
      .setContentTitle(item.title)
      .setContentText(item.body)
      .setWhen(item.at)
      .setShowWhen(true)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setCategory(if (item.ring) NotificationCompat.CATEGORY_ALARM else NotificationCompat.CATEGORY_REMINDER)
      .setPriority(if (ringing) NotificationCompat.PRIORITY_MAX else if (quiet) NotificationCompat.PRIORITY_LOW else NotificationCompat.PRIORITY_DEFAULT)
      .setContentIntent(contentPendingIntent(context, item))
      .setAutoCancel(!item.ring)
      .setOnlyAlertOnce(quiet)
      .setTimeoutAfter(if (ringing) RINGING_TIMEOUT_MS else if (item.ring) QUIET_TIMEOUT_MS else REMINDER_TIMEOUT_MS)
    if (missed) builder.setSubText("Missed")

    val photos = AlarmPhotos.load(item.photos)
    if (photos != null) {
      builder.setLargeIcon(photos.thumbnail)
      builder.setStyle(
        NotificationCompat.BigPictureStyle()
          .bigPicture(photos.picture)
          .bigLargeIcon(null as Bitmap?)
          .setSummaryText(item.body)
      )
    } else {
      val text = item.details?.takeIf { it.isNotBlank() } ?: item.body
      builder.setStyle(NotificationCompat.BigTextStyle().bigText(text))
    }

    if (item.ring && (item.doses.isNotEmpty() || item.isTest)) {
      builder.addAction(0, "Take", actionPendingIntent(context, item, AlarmConst.TAKE))
      builder.addAction(0, "Snooze ${AlarmConst.SNOOZE_MINUTES} min", actionPendingIntent(context, item, AlarmConst.SNOOZE))
      builder.addAction(0, "Skip", actionPendingIntent(context, item, AlarmConst.SKIP))
    }
    if (ringing) builder.setFullScreenIntent(fullScreenPendingIntent(context, item), true)

    val notification = builder.build()
    if (ringing) notification.flags = notification.flags or Notification.FLAG_INSISTENT

    return try {
      manager.notify(item.key, NOTIFICATION_ID, notification)
      true
    } catch (e: SecurityException) {
      Log.w(AlarmConst.TAG, "Notification permission missing", e)
      false
    } catch (e: Exception) {
      Log.e(AlarmConst.TAG, "Couldn't post the alarm ${item.key}", e)
      false
    }
  }

  fun cancel(context: Context, key: String) {
    try {
      NotificationManagerCompat.from(context).cancel(key, NOTIFICATION_ID)
    } catch (e: Exception) {
      Log.w(AlarmConst.TAG, "Couldn't cancel $key", e)
    }
  }

  /** Tags of every ÖRZA alarm notification currently in the shade. */
  fun showingKeys(context: Context): Set<String> {
    val nm = context.getSystemService(NotificationManager::class.java) ?: return emptySet()
    return try {
      nm.activeNotifications
        .filter { it.id == NOTIFICATION_ID && it.tag != null }
        .mapNotNull { it.tag }
        .toSet()
    } catch (e: Exception) {
      emptySet()
    }
  }
}
