package expo.modules.orzaalarms

import android.content.Context
import expo.modules.core.interfaces.Package
import expo.modules.core.interfaces.ReactActivityLifecycleListener

/**
 * Found by expo-modules-autolinking (a `*Package.kt` importing `expo.modules.core.interfaces.Package`), like
 * expo-linking's ExpoLinkingPackage: hooks the main activity so an alarm can show over the lock screen.
 */
class OrzaAlarmsPackage : Package {
  override fun createReactActivityLifecycleListeners(activityContext: Context?): List<ReactActivityLifecycleListener> {
    return listOf(AlarmActivityListener())
  }
}
