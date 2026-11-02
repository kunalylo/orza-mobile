/**
 * App entry. The alarm engine's background task must be defined in the bundle's global scope BEFORE Expo Router
 * loads: when the OS starts the app only to run it (WorkManager / BGTaskScheduler), no views mount, so nothing under
 * src/app is evaluated. Likewise Apple Health's background delivery of new steps (iPhone; a no-op file elsewhere): its
 * callback must exist when HealthKit launches the app in the background. `expo-router/entry` must stay the last import
 * (docs: "Custom entry point").
 */
import './src/lib/alarms/background';
import './src/lib/steps/healthkitObserver';
import 'expo-router/entry';
