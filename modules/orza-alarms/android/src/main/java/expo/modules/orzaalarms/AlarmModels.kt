package expo.modules.orzaalarms

import org.json.JSONArray
import org.json.JSONObject

/** Intent extras, actions and limits shared by the receivers, the scheduler and the module. */
internal object AlarmConst {
  const val TAG = "OrzaAlarms"

  const val ACTION_FIRE = "expo.modules.orzaalarms.FIRE"
  const val ACTION_SILENCE = "expo.modules.orzaalarms.SILENCE"
  const val ACTION_DOSE = "expo.modules.orzaalarms.DOSE_ACTION"

  const val EXTRA_KEY = "orza_alarm_key"
  const val EXTRA_AT = "orza_alarm_at"
  const val EXTRA_DOSE_ACTION = "orza_dose_action"
  const val EXTRA_ITEM = "orza_alarm_item"

  /** Set on the full-screen intent only: show the activity over the lock screen and turn the screen on. */
  const val EXTRA_SHOW_OVER_LOCK = "orza_alarm"

  /** Set on a ring item's tap intent: the member opened it, so it stops ringing (it stays in the shade). */
  const val EXTRA_OPENED = "orza_alarm_opened"

  const val TAKE = "take"
  const val SKIP = "skip"
  const val SNOOZE = "snooze"

  /** "Snooze 10 min" (C1's DEFAULT_SNOOZE_MINUTES). */
  const val SNOOZE_MINUTES = 10

  /** Prefix of C4's test alarms: no dose is recorded for them, and `scheduleAll` keeps them. */
  const val TEST_PREFIX = "test:"

  /** Ring at most this long, then the alarm stays silently in the shade. */
  const val RING_LIMIT_MS = 10 * 60_000L

  /** An alarm that fires later than this (deep Doze / inexact fallback) is dropped instead of ringing. */
  const val MAX_LATE_MS = 3 * 60 * 60_000L

  /** After a reboot, ring alarms missed while the phone was off up to this long ago. */
  const val MISSED_GRACE_MS = 30 * 60_000L

  fun isDoseAction(action: String?): Boolean = action == TAKE || action == SKIP || action == SNOOZE
}

/** One medicine dose of an alarm (enough to record an action and to show its line). */
internal data class AlarmDose(
  val medId: String,
  val scheduledFor: String,
  val label: String,
  val line: String
) {
  fun toJson(): JSONObject {
    val o = JSONObject()
    o.put("medId", medId)
    o.put("scheduledFor", scheduledFor)
    o.put("label", label)
    o.put("line", line)
    return o
  }

  companion object {
    fun fromJson(o: JSONObject?): AlarmDose? {
      if (o == null) return null
      val medId = o.str("medId") ?: return null
      val scheduledFor = o.str("scheduledFor") ?: return null
      return AlarmDose(medId, scheduledFor, o.str("label") ?: "", o.str("line") ?: "")
    }

    fun listFromJson(a: JSONArray?): List<AlarmDose> {
      if (a == null) return emptyList()
      val out = ArrayList<AlarmDose>(a.length())
      for (i in 0 until a.length()) fromJson(a.optJSONObject(i))?.let { out.add(it) }
      return out
    }

    fun listToJson(doses: List<AlarmDose>): JSONArray {
      val a = JSONArray()
      for (d in doses) a.put(d.toJson())
      return a
    }
  }
}

/**
 * One alarm as JS hands it over (`NativeAlarmItem` in src/OrzaAlarms.types.ts), persisted as JSON.
 * `photos` are local file:// JPEGs (already chosen and ordered by JS: one per medicine for a multi-medicine alarm).
 */
internal data class AlarmItem(
  val key: String,
  val kind: String,
  /** Epoch ms. */
  val at: Long,
  val title: String,
  val body: String,
  /** Alarm-style (doses / snoozes): alarm channel, insistent, full screen, Take / Snooze / Skip. */
  val ring: Boolean,
  val deepLink: String,
  val photos: List<String>,
  val doses: List<AlarmDose>,
  /** Key the native Snooze re-ring uses (C1 `snoozeAlarmKey`), so the next JS plan replaces it instead of doubling it. */
  val snoozeKey: String?,
  /** Expanded text when there is no photo (one line per medicine). */
  val details: String?,
  /** Set on a snooze created natively: kept by `scheduleAll` until JS has collected that action. */
  val nativeActionId: Long?
) {
  val isTest: Boolean
    get() = key.startsWith(AlarmConst.TEST_PREFIX)

  fun toJson(): JSONObject {
    val o = JSONObject()
    o.put("key", key)
    o.put("kind", kind)
    o.put("at", at)
    o.put("title", title)
    o.put("body", body)
    o.put("ring", ring)
    o.put("deepLink", deepLink)
    val p = JSONArray()
    for (uri in photos) p.put(uri)
    o.put("photos", p)
    o.put("doses", AlarmDose.listToJson(doses))
    if (snoozeKey != null) o.put("snoozeKey", snoozeKey)
    if (details != null) o.put("details", details)
    if (nativeActionId != null) o.put("nativeActionId", nativeActionId.toLong())
    return o
  }

  companion object {
    fun fromJson(o: JSONObject?): AlarmItem? {
      if (o == null) return null
      val key = o.str("key") ?: return null
      val at = o.optLong("at", 0L)
      if (at <= 0L) return null
      val photosJson = o.optJSONArray("photos")
      val photos = ArrayList<String>()
      if (photosJson != null) {
        for (i in 0 until photosJson.length()) {
          val uri = photosJson.optString(i, "")
          if (uri.isNotEmpty() && uri != "null") photos.add(uri)
        }
      }
      val nativeActionId = if (o.has("nativeActionId") && !o.isNull("nativeActionId")) o.optLong("nativeActionId", 0L) else 0L
      return AlarmItem(
        key = key,
        kind = o.str("kind") ?: "dose",
        at = at,
        title = o.str("title") ?: "",
        body = o.str("body") ?: "",
        ring = o.optBoolean("ring", false),
        deepLink = o.str("deepLink") ?: "orza://",
        photos = photos,
        doses = AlarmDose.listFromJson(o.optJSONArray("doses")),
        snoozeKey = o.str("snoozeKey"),
        details = o.str("details"),
        nativeActionId = if (nativeActionId > 0L) nativeActionId else null
      )
    }

    fun fromJsonString(json: String?): AlarmItem? {
      if (json.isNullOrEmpty()) return null
      return try {
        fromJson(JSONObject(json))
      } catch (e: Exception) {
        null
      }
    }

    /** Parses the JS array; invalid entries are skipped. Throws on malformed JSON (the JS call then rejects). */
    fun listFromJsonString(json: String): List<AlarmItem> {
      val a = JSONArray(json)
      val out = ArrayList<AlarmItem>(a.length())
      for (i in 0 until a.length()) fromJson(a.optJSONObject(i))?.let { out.add(it) }
      return out
    }
  }
}

/** A Take / Snooze / Skip pressed on an alarm, waiting for JS to collect it (`takeNativeActions`). */
internal data class AlarmAction(
  val id: Long,
  val key: String,
  val action: String,
  val doses: List<AlarmDose>,
  val snoozeMinutes: Int?,
  /** Epoch ms when it was pressed. */
  val at: Long
) {
  fun toJson(): JSONObject {
    val o = JSONObject()
    o.put("id", id)
    o.put("key", key)
    o.put("action", action)
    o.put("doses", AlarmDose.listToJson(doses))
    if (snoozeMinutes != null) o.put("snoozeMinutes", snoozeMinutes.toInt())
    o.put("at", at)
    return o
  }

  companion object {
    fun fromJson(o: JSONObject?): AlarmAction? {
      if (o == null) return null
      val id = o.optLong("id", 0L)
      val key = o.str("key") ?: return null
      val action = o.str("action") ?: return null
      if (id <= 0L || !AlarmConst.isDoseAction(action)) return null
      val minutes = if (o.has("snoozeMinutes") && !o.isNull("snoozeMinutes")) o.optInt("snoozeMinutes", AlarmConst.SNOOZE_MINUTES) else null
      return AlarmAction(id, key, action, AlarmDose.listFromJson(o.optJSONArray("doses")), minutes, o.optLong("at", 0L))
    }
  }
}

/** A string field, or null when missing / JSON null / empty (org.json's optString turns null into "null"). */
internal fun JSONObject.str(name: String): String? {
  if (!has(name) || isNull(name)) return null
  val v = optString(name, "")
  return if (v.isEmpty()) null else v
}
