package expo.modules.orzasteps

import android.content.Context
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONArray

/**
 * JS API of the step sampler (`modules/orza-steps/src/index.ts`). Native code only records raw counter samples; the
 * app turns them into daily totals in the member's time zone (`src/lib/steps/counter.ts`). Everything that must work
 * with the app closed lives in the receivers + StepStore, not here.
 */
class OrzaStepsModule : Module() {
  private val context: Context
    get() = appContext.reactContext?.applicationContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("OrzaSteps")

    OnCreate {
      val app = appContext.reactContext?.applicationContext
      if (app != null && StepStore.isEnabled(app) && StepSensor.hasPermission(app)) StepSensor.keepCounting(app)
    }

    /** This phone has a hardware step counter. */
    AsyncFunction("isAvailable") {
      StepSensor.hasSensor(context)
    }

    /** "Physical activity" is granted (always true below Android 10). */
    AsyncFunction("hasPermission") {
      StepSensor.hasPermission(context)
    }

    /**
     * Counting on: remembers the member's time zone (midnight samples), arms the alarms, keeps the counter active.
     * Resolves false (arming nothing) without a step counter or the permission. Safe to call often.
     */
    AsyncFunction("start") { timeZone: String ->
      StepSampler.start(context, timeZone)
    }

    /** Counting off: cancels the alarms (samples stay until `clear`). */
    AsyncFunction<Unit>("stop") {
      StepSampler.stop(context)
    }

    /**
     * Reads the counter now. Resolves `{ts, counter, boot, elapsed, reason, stored}` — stored only when the last stored
     * sample of this boot is at least 10 min old — or null when nothing could be read (no sensor / permission / event).
     */
    AsyncFunction("sampleNow") { promise: Promise ->
      val ctx = context
      StepSampler.sample(ctx, "app", false) { sample, stored ->
        promise.resolve(sample?.toMap(stored))
      }
    }

    /** Stored samples taken at or after `sinceMs` (plus the one before), oldest first, as JSON `[{t, c, b, e, r}]`. */
    AsyncFunction("getSamples") { sinceMs: Double ->
      val arr = JSONArray()
      for (sample in StepStore.read(context, sinceMs.toLong())) arr.put(sample.toJson())
      arr.toString()
    }

    /** Forgets every stored sample (sign-out). */
    AsyncFunction<Unit>("clear") {
      StepStore.clear(context)
    }

    /** Diagnostics for the app (and D1 testing). */
    AsyncFunction("getStatus") {
      val ctx = context
      mapOf<String, Any?>(
        "available" to StepSensor.hasSensor(ctx),
        "permission" to StepSensor.hasPermission(ctx),
        "enabled" to StepStore.isEnabled(ctx),
        "armed" to StepScheduler.isArmed(ctx),
        "midnightArmed" to StepScheduler.isMidnightArmed(ctx),
        "exactMidnight" to StepScheduler.canScheduleExact(ctx),
        "standbyBucket" to StepScheduler.standbyBucket(ctx),
        "samples" to StepStore.count(ctx),
        "timeZone" to StepStore.timeZone(ctx),
        "bootCount" to StepSensor.bootCount(ctx)
      )
    }
  }
}
