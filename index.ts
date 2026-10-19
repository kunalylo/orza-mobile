/**
 * App entry. The alarm engine's background task must be defined in the bundle's global scope BEFORE Expo Router
 * loads: when the OS starts the app only to run it (WorkManager / BGTaskScheduler), no views mount, so nothing under
 * src/app is evaluated. `expo-router/entry` must stay the last import (docs: "Custom entry point").
 */
import './src/lib/alarms/background';
import 'expo-router/entry';
