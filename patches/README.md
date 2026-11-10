# Patched dependencies (patch-package, applied by `npm install` / `npm ci` → `postinstall`)

| Patch | Why | Drop when |
|---|---|---|
| `expo-background-task+57.0.21.patch` | `BackgroundTaskScheduler.getWorkerInfo` took the first WorkInfo of the unique APPEND chain — the previous run's finished one — so a cold-start task restore enqueued with REPLACE and cancelled the RUNNING worker (steps v2 V1 E-7: cold background runs read Health Connect but were frozen before saving). Same fix as upstream 58.0.12. | The SDK 58 upgrade (remove the `buildFromSource` entry below too). |

**Android modules are PREBUILT in SDK 57.** `expo-background-task` ships a compiled AAR in its `local-maven-repo`, and
Expo's autolinking links that AAR instead of compiling `android/src` — a patch of its Kotlin sources does nothing unless
the module is built from source. So `package.json` has `expo.autolinking.android.buildFromSource: ["expo-background-task"]`.
Check after a native build: Gradle's "Using expo modules" list must show `expo-background-task` WITHOUT the
prebuilt marker (`[📦]`, printed as `[?]` in a Windows console), and the build runs
`:expo-background-task:compileReleaseKotlin` (or `compileDebugKotlin`).
