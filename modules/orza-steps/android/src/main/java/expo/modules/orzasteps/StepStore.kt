package expo.modules.orzasteps

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import org.json.JSONArray

/**
 * Raw samples (a bounded ring buffer: KEEP_MS / MAX_SAMPLES) and the sampler's settings, in SharedPreferences.
 * Every read-modify-write of the samples happens under one lock (receivers, the sensor thread and JS calls overlap).
 */
internal object StepStore {
  private val lock = Any()

  private fun prefs(context: Context): SharedPreferences =
    context.getSharedPreferences(StepConst.PREFS, Context.MODE_PRIVATE)

  private fun readUnlocked(context: Context): MutableList<StepSample> {
    val raw = prefs(context).getString(StepConst.KEY_SAMPLES, null) ?: return ArrayList()
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
    return prefs(context).edit().putString(StepConst.KEY_SAMPLES, arr.toString()).commit()
  }

  /**
   * Stores `sample` (appended: the list stays in the order the readings were taken) unless it adds nothing:
   * - a read the app asked for (`force` false) within MIN_STORE_GAP_MS of the last stored sample of the same boot;
   * - a forced sample identical to one stored less than DUPLICATE_MS ago.
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
          if (gap < StepConst.DUPLICATE_MS && last.counter == sample.counter) return false
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
      prefs(context).edit().remove(StepConst.KEY_SAMPLES).commit()
    }
  }

  fun timeZone(context: Context): String? = prefs(context).getString(StepConst.KEY_TIME_ZONE, null)

  fun setTimeZone(context: Context, timeZone: String) {
    prefs(context).edit().putString(StepConst.KEY_TIME_ZONE, timeZone).apply()
  }

  fun isEnabled(context: Context): Boolean = prefs(context).getBoolean(StepConst.KEY_ENABLED, false)

  fun setEnabled(context: Context, enabled: Boolean) {
    prefs(context).edit().putBoolean(StepConst.KEY_ENABLED, enabled).commit()
  }
}
