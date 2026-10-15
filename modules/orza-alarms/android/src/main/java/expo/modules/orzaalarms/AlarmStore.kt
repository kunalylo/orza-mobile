package expo.modules.orzaalarms

import android.content.Context
import android.util.AtomicFile
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream

/**
 * What survives a reboot or a killed app: the pending alarms (re-scheduled by BootReceiver), the alarms showing now
 * (to silence / dismiss them) and the actions pressed while JS wasn't running. JSON files in `noBackupFilesDir`
 * (never restored onto another phone), written atomically. One process-wide lock — receivers (executor thread) and
 * module calls (modules queue) never interleave a read-modify-write.
 */
internal object AlarmStore {
  private const val DIR = "orza-alarms"
  private const val PENDING = "pending.json"
  private const val SHOWN = "shown.json"
  private const val ACTIONS = "actions.json"

  /** Actions older than this are dropped (JS drops them too). */
  private const val ACTION_MAX_AGE_MS = 72 * 60 * 60_000L
  private const val ACTION_MAX_COUNT = 300

  /** A "showing" record older than this is forgotten (the notification timed out long ago). */
  private const val SHOWN_MAX_AGE_MS = 24 * 60 * 60_000L

  private val lock = Any()

  fun <T> locked(block: () -> T): T = synchronized(lock) { block() }

  /* ───────────────────────────── Pending ───────────────────────────── */

  fun readPending(context: Context): LinkedHashMap<String, AlarmItem> = locked {
    val o = readObject(context, PENDING)
    val out = LinkedHashMap<String, AlarmItem>()
    val keys = o.keys()
    while (keys.hasNext()) {
      val key = keys.next()
      AlarmItem.fromJson(o.optJSONObject(key))?.let { out[key] = it }
    }
    out
  }

  fun writePending(context: Context, items: Map<String, AlarmItem>) = locked {
    val o = JSONObject()
    for ((key, item) in items) o.put(key, item.toJson())
    writeText(context, PENDING, o.toString())
  }

  fun putPending(context: Context, item: AlarmItem) = locked {
    val all = readPending(context)
    all[item.key] = item
    writePending(context, all)
  }

  /** Removes and returns the pending alarm `key` if it is the one scheduled for `at` (± 1 s); null otherwise. */
  fun takePending(context: Context, key: String, at: Long): AlarmItem? = locked {
    val all = readPending(context)
    val item = all[key]
    if (item == null || (at > 0L && Math.abs(item.at - at) > 1_000L)) {
      null
    } else {
      all.remove(key)
      writePending(context, all)
      item
    }
  }

  fun pendingCount(context: Context): Int = readPending(context).size

  /* ───────────────────────────── Showing ───────────────────────────── */

  class Shown(val item: AlarmItem, val shownAt: Long, val quiet: Boolean)

  fun readShown(context: Context): LinkedHashMap<String, Shown> = locked {
    val o = readObject(context, SHOWN)
    val out = LinkedHashMap<String, Shown>()
    val now = System.currentTimeMillis()
    val keys = o.keys()
    while (keys.hasNext()) {
      val key = keys.next()
      val entry = o.optJSONObject(key) ?: continue
      val item = AlarmItem.fromJson(entry.optJSONObject("item")) ?: continue
      val shownAt = entry.optLong("shownAt", 0L)
      if (now - shownAt > SHOWN_MAX_AGE_MS) continue
      out[key] = Shown(item, shownAt, entry.optBoolean("quiet", false))
    }
    out
  }

  private fun writeShown(context: Context, all: Map<String, Shown>) {
    val o = JSONObject()
    for ((key, s) in all) {
      val entry = JSONObject()
      entry.put("item", s.item.toJson())
      entry.put("shownAt", s.shownAt)
      entry.put("quiet", s.quiet)
      o.put(key, entry)
    }
    writeText(context, SHOWN, o.toString())
  }

  fun putShown(context: Context, item: AlarmItem, quiet: Boolean, shownAt: Long) = locked {
    val all = readShown(context)
    all[item.key] = Shown(item, shownAt, quiet)
    writeShown(context, all)
  }

  fun getShown(context: Context, key: String): Shown? = readShown(context)[key]

  fun takeShown(context: Context, key: String): Shown? = locked {
    val all = readShown(context)
    val s = all.remove(key)
    if (s != null) writeShown(context, all)
    s
  }

  fun clearShown(context: Context) = locked {
    writeText(context, SHOWN, "{}")
  }

  /* ───────────────────────────── Actions ───────────────────────────── */

  private fun readActionsFile(context: Context): Pair<Long, MutableList<AlarmAction>> {
    val o = readObject(context, ACTIONS)
    val seq = o.optLong("seq", 0L)
    val list = ArrayList<AlarmAction>()
    val arr = o.optJSONArray("items")
    if (arr != null) for (i in 0 until arr.length()) AlarmAction.fromJson(arr.optJSONObject(i))?.let { list.add(it) }
    return Pair(seq, list)
  }

  private fun writeActionsFile(context: Context, seq: Long, list: List<AlarmAction>) {
    val o = JSONObject()
    o.put("seq", seq)
    val arr = JSONArray()
    for (a in list) arr.put(a.toJson())
    o.put("items", arr)
    writeText(context, ACTIONS, o.toString())
  }

  fun addAction(context: Context, key: String, action: String, doses: List<AlarmDose>, snoozeMinutes: Int?, at: Long): AlarmAction = locked {
    val (seq, list) = readActionsFile(context)
    val id = seq + 1
    val recorded = AlarmAction(id, key, action, doses, snoozeMinutes, at)
    val kept = list.filter { at - it.at <= ACTION_MAX_AGE_MS }.toMutableList()
    kept.add(recorded)
    while (kept.size > ACTION_MAX_COUNT) kept.removeAt(0)
    writeActionsFile(context, id, kept)
    recorded
  }

  /** Every recorded action, oldest first; the queue is emptied (the sequence number is kept). */
  fun drainActions(context: Context): List<AlarmAction> = locked {
    val (seq, list) = readActionsFile(context)
    if (list.isNotEmpty()) writeActionsFile(context, seq, emptyList())
    val now = System.currentTimeMillis()
    list.filter { now - it.at <= ACTION_MAX_AGE_MS }
  }

  fun hasAction(context: Context, id: Long): Boolean = locked {
    readActionsFile(context).second.any { it.id == id }
  }

  /* ───────────────────────────── Files ───────────────────────────── */

  private fun file(context: Context, name: String): AtomicFile {
    val dir = File(context.noBackupFilesDir, DIR)
    if (!dir.exists()) dir.mkdirs()
    return AtomicFile(File(dir, name))
  }

  private fun readObject(context: Context, name: String): JSONObject {
    return try {
      val f = file(context, name)
      if (!f.baseFile.exists()) {
        JSONObject()
      } else {
        val text = String(f.readFully(), Charsets.UTF_8)
        if (text.isBlank()) JSONObject() else JSONObject(text)
      }
    } catch (e: Exception) {
      Log.w(AlarmConst.TAG, "Unreadable $name — starting empty", e)
      JSONObject()
    }
  }

  private fun writeText(context: Context, name: String, text: String) {
    val f = file(context, name)
    var out: FileOutputStream? = null
    try {
      out = f.startWrite()
      out.write(text.toByteArray(Charsets.UTF_8))
      f.finishWrite(out)
    } catch (e: Exception) {
      Log.e(AlarmConst.TAG, "Couldn't write $name", e)
      if (out != null) f.failWrite(out)
    }
  }
}
