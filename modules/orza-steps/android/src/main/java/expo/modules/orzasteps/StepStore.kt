package expo.modules.orzasteps

import android.content.Context
import android.util.AtomicFile
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileNotFoundException
import java.io.FileOutputStream
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Raw samples (a bounded ring buffer: KEEP_MS / MAX_SAMPLES) and the sampler's settings (on / off, the member's time
 * zone), as two small JSON files in `noBackupFilesDir` — never part of Auto Backup or a device transfer, so a new phone
 * never inherits another phone's counter readings or an "on" switch. Written through AtomicFile (synced, then renamed:
 * a shutdown sample survives the power-off that follows it). Every read-modify-write happens under one lock (receivers,
 * the sensor thread and JS calls overlap).
 */
internal object StepStore {
  private val lock = Any()
  private val legacyChecked = AtomicBoolean(false)

  private fun file(context: Context, name: String): File = File(context.applicationContext.noBackupFilesDir, name)

  /** Earlier builds kept everything in SharedPreferences "orza_steps" (backed up) — drop it once per process. */
  private fun dropLegacy(context: Context) {
    if (!legacyChecked.compareAndSet(false, true)) return
    try {
      context.applicationContext.deleteSharedPreferences(StepConst.LEGACY_PREFS)
    } catch (e: Exception) {
      // Nothing there.
    }
  }

  private fun readText(file: File): String? =
    try {
      String(AtomicFile(file).readFully(), Charsets.UTF_8)
    } catch (e: FileNotFoundException) {
      null
    } catch (e: Exception) {
      Log.w(StepConst.TAG, "Couldn't read ${file.name}", e)
      null
    }

  private fun writeText(file: File, text: String): Boolean {
    val atomic = AtomicFile(file)
    var out: FileOutputStream? = null
    return try {
      out = atomic.startWrite()
      out.write(text.toByteArray(Charsets.UTF_8))
      atomic.finishWrite(out)
      true
    } catch (e: Exception) {
      if (out != null) atomic.failWrite(out)
      Log.w(StepConst.TAG, "Couldn't write ${file.name}", e)
      false
    }
  }

  /* ───────────────────────────── Samples ───────────────────────────── */

  private fun readUnlocked(context: Context): MutableList<StepSample> {
    dropLegacy(context)
    val raw = readText(file(context, StepConst.SAMPLES_FILE)) ?: return ArrayList()
    return try {
      val arr = JSONArray(raw)
      val out = ArrayList<StepSample>(arr.length())
      for (i in 0 until arr.length()) {
        val o = arr.optJSONObject(i) ?: continue
        val sample = StepSample.fromJson(o) ?: continue
        out.add(sample)
      }
      out
    } catch (e: Exception) {
      Log.w(StepConst.TAG, "Stored step samples were unreadable — starting over", e)
      ArrayList()
    }
  }

  private fun writeUnlocked(context: Context, samples: List<StepSample>): Boolean {
    val arr = JSONArray()
    for (s in samples) arr.put(s.toJson())
    return writeText(file(context, StepConst.SAMPLES_FILE), arr.toString())
  }

  /**
   * Stores `sample` (appended: the list stays in the order the readings were taken) unless it adds nothing. Against the
   * last stored sample of the same boot:
   * - a read the app asked for (`force` false) within MIN_STORE_GAP_MS is not stored;
   * - a forced sample within DUPLICATE_MS replaces it (dropped when the counter didn't move) — cumulative counter, so
   *   no step is lost, and a burst of broadcasts can't flood the buffer.
   * Then drops samples older than KEEP_MS and the oldest beyond MAX_SAMPLES. True when stored.
   */
  fun add(context: Context, sample: StepSample, force: Boolean): Boolean {
    synchronized(lock) {
      val samples = readUnlocked(context)
      val last = samples.lastOrNull()
      if (last != null && last.boot == sample.boot) {
        val gap = if (last.elapsed >= 0L && sample.elapsed >= last.elapsed) {
          sample.elapsed - last.elapsed
        } else {
          sample.ts - last.ts
        }
        if (gap >= 0L && gap < StepConst.MIN_STORE_GAP_MS) {
          if (!force) return false
          if (gap < StepConst.DUPLICATE_MS) {
            if (last.counter == sample.counter) return false
            samples.removeAt(samples.size - 1)
          }
        }
      }
      samples.add(sample)
      val cutoff = sample.ts - StepConst.KEEP_MS
      samples.removeAll { it.ts < cutoff }
      while (samples.size > StepConst.MAX_SAMPLES) samples.removeAt(0)
      return writeUnlocked(context, samples)
    }
  }

  /**
   * Samples taken at or after `sinceMs`, in the order they were taken, plus the last one before it (the day math needs
   * the reading that starts the first interval).
   */
  fun read(context: Context, sinceMs: Long): List<StepSample> {
    synchronized(lock) {
      val all = readUnlocked(context)
      if (all.isEmpty()) return all
      val first = all.indexOfFirst { it.ts >= sinceMs }
      return when {
        first < 0 -> listOf(all[all.size - 1])
        first == 0 -> all
        else -> ArrayList(all.subList(first - 1, all.size))
      }
    }
  }

  fun count(context: Context): Int {
    synchronized(lock) {
      return readUnlocked(context).size
    }
  }

  fun clear(context: Context) {
    synchronized(lock) {
      dropLegacy(context)
      try {
        AtomicFile(file(context, StepConst.SAMPLES_FILE)).delete()
      } catch (e: Exception) {
        Log.w(StepConst.TAG, "Couldn't clear the step samples", e)
      }
    }
  }

  /* ───────────────────────────── Settings ───────────────────────────── */

  private fun readState(context: Context): JSONObject {
    dropLegacy(context)
    val raw = readText(file(context, StepConst.STATE_FILE)) ?: return JSONObject()
    return try {
      JSONObject(raw)
    } catch (e: Exception) {
      JSONObject()
    }
  }

  private fun updateState(context: Context, change: (JSONObject) -> Unit) {
    synchronized(lock) {
      val state = readState(context)
      change(state)
      writeText(file(context, StepConst.STATE_FILE), state.toString())
    }
  }

  fun timeZone(context: Context): String? {
    synchronized(lock) {
      val tz = readState(context).optString("tz", "")
      return tz.ifEmpty { null }
    }
  }

  fun setTimeZone(context: Context, timeZone: String) {
    updateState(context) { it.put("tz", timeZone) }
  }

  fun isEnabled(context: Context): Boolean {
    synchronized(lock) {
      return readState(context).optBoolean("enabled", false)
    }
  }

  fun setEnabled(context: Context, enabled: Boolean) {
    updateState(context) { it.put("enabled", enabled) }
  }
}
