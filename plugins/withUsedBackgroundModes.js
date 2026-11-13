/**
 * iOS background modes: keep only the ones ÖRZA uses (App Review 2.5.4).
 *
 * expo-task-manager's own plugin (applied automatically because the package is installed) always adds `fetch`, the
 * mode for background app refresh (`setMinimumBackgroundFetchInterval` / BGAppRefreshTask). ÖRZA never uses it: the
 * hourly alarm re-plan runs through expo-background-task, a BGProcessingTask under `processing` (kept), and Apple
 * Health's background delivery needs only the HealthKit entitlement. So `fetch` is taken out again.
 *
 * App.json plugins are registered before the automatic ones, so this mod runs after theirs and sees the full list.
 * Check: `npx expo config --type introspect` → `ios.infoPlist.UIBackgroundModes` is `["processing"]`.
 */
const { withInfoPlist } = require('expo/config-plugins');

const UNUSED = ['fetch'];

module.exports = function withUsedBackgroundModes(config) {
  return withInfoPlist(config, (cfg) => {
    const modes = cfg.modResults.UIBackgroundModes;
    if (Array.isArray(modes)) {
      const kept = modes.filter((m) => !UNUSED.includes(m));
      if (kept.length) cfg.modResults.UIBackgroundModes = kept;
      else delete cfg.modResults.UIBackgroundModes;
    }
    return cfg;
  });
};
