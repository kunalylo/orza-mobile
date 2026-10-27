/**
 * Package visibility for Health Connect's per-app permission page.
 *
 * Health sync › "Open Health Connect" / "Manage access" (src/lib/health/bridge.android.ts `openManage`) opens ÖRZA's
 * own page in Health Connect with `Linking.sendIntent(MANAGE_HEALTH_PERMISSIONS, [PACKAGE_NAME])`. React Native only
 * starts an intent that `resolveActivity` can see, and on Android 11+ an app sees another app's activities only when its
 * manifest `<queries>` names them. react-native-health-connect's manifest only declares the Health Connect APK package
 * (`com.google.android.apps.healthdata`); on Android 14+ Health Connect is part of the system
 * (`com.google.android.healthconnect.controller`), so the intent was invisible and the app fell back to the Health
 * Connect home screen. After two "Don't allow"s that page is the only way back in, so it should be one tap away.
 *
 * Declares the two intent actions (Android 14+ platform and the Android 9–13 APK) as intent queries — enough to resolve
 * whichever package handles them, without naming system packages that differ between phone makers.
 */
const { withAndroidManifest } = require('expo/config-plugins');

const ACTIONS = [
  'android.health.connect.action.MANAGE_HEALTH_PERMISSIONS', // Android 14+ (Health Connect in the system)
  'androidx.health.ACTION_MANAGE_HEALTH_PERMISSIONS', // Android 9–13 (Health Connect app from Play)
];

function declaresAction(queries, action) {
  return queries.some((q) => (q.intent ?? []).some((i) => (i.action ?? []).some((a) => a.$?.['android:name'] === action)));
}

module.exports = function withHealthConnectQueries(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    const queries = (manifest.queries = manifest.queries ?? []);
    const missing = ACTIONS.filter((action) => !declaresAction(queries, action));
    if (missing.length) {
      queries.push({ intent: missing.map((action) => ({ action: [{ $: { 'android:name': action } }] })) });
    }
    return cfg;
  });
};
