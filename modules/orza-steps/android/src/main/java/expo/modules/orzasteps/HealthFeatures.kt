package expo.modules.orzasteps

import android.content.Context
import android.os.Build
import android.os.ext.SdkExtensions
import android.util.Log
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.HealthConnectFeatures
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.StepsRecord
import kotlinx.coroutines.withTimeoutOrNull

/**
 * What Health Connect can do for steps on this phone (`healthFeatures()` in JS; `plan.firstAsk` / `plan.sourcesOn` decide
 * from it). Every field is read on its own and falls back to "no" when it can't be read, so one failure never hides the
 * others; without Health Connect (SDK not available) the Health Connect fields are all "no".
 * - `stepTracking`: Health Connect counts this phone's steps itself — Android 14+ with SDK extension 20 or later (the
 *   exact check Google documents); `extension` is that extension level (0 below Android 14).
 * - `backgroundRead`: "available" when Health Connect supports reading in the background, else "unavailable".
 * - `backgroundGranted` / `stepsGranted`: ÖRZA holds READ_HEALTH_DATA_IN_BACKGROUND / READ_STEPS.
 */
internal object HealthFeatures {
  /** Android 14's SDK extension that brought Health Connect's own step counting. */
  private const val STEP_TRACKING_EXTENSION = 20

  /** A Health Connect binder call that hangs must not hold the JS promise for ever. */
  private const val GRANTS_TIMEOUT_MS = 5_000L

  fun extension(): Int {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) return 0
    return try {
      SdkExtensions.getExtensionVersion(Build.VERSION_CODES.UPSIDE_DOWN_CAKE)
    } catch (e: Exception) {
      Log.w(StepConst.TAG, "Couldn't read the SDK extension level", e)
      0
    }
  }

  private fun client(context: Context): HealthConnectClient? =
    try {
      if (HealthConnectClient.getSdkStatus(context) == HealthConnectClient.SDK_AVAILABLE) {
        HealthConnectClient.getOrCreate(context)
      } else {
        null
      }
    } catch (e: Exception) {
      Log.w(StepConst.TAG, "Health Connect isn't reachable", e)
      null
    }

  suspend fun read(context: Context): Map<String, Any?> {
    val app = context.applicationContext
    val extension = extension()
    val stepTracking = Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE && extension >= STEP_TRACKING_EXTENSION
    val client = client(app)
    val backgroundRead = try {
      client != null &&
        client.features.getFeatureStatus(HealthConnectFeatures.FEATURE_READ_HEALTH_DATA_IN_BACKGROUND) ==
        HealthConnectFeatures.FEATURE_STATUS_AVAILABLE
    } catch (e: Exception) {
      Log.w(StepConst.TAG, "Couldn't check Health Connect's background reading", e)
      false
    }
    val granted: Set<String> = try {
      if (client == null) emptySet() else withTimeoutOrNull(GRANTS_TIMEOUT_MS) { client.permissionController.getGrantedPermissions() } ?: emptySet()
    } catch (e: Exception) {
      Log.w(StepConst.TAG, "Couldn't read Health Connect's granted permissions", e)
      emptySet()
    }
    val stepsPermission = try {
      HealthPermission.getReadPermission(StepsRecord::class)
    } catch (e: Exception) {
      null
    }
    return mapOf(
      "stepTracking" to stepTracking,
      "extension" to extension,
      "backgroundRead" to if (backgroundRead) "available" else "unavailable",
      "backgroundGranted" to granted.contains(HealthPermission.PERMISSION_READ_HEALTH_DATA_IN_BACKGROUND),
      "stepsGranted" to (stepsPermission != null && granted.contains(stepsPermission))
    )
  }
}
