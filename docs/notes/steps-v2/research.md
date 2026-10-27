# Auto steps v2: research

Date: 2026-10-27. Scope: ÖRZA mobile (Expo SDK 57, RN 0.86, new architecture, package `in.co.ylo.orza`).
I only read `E:\aylo\orza-mobile` and changed nothing there. Numbers in square brackets like [S3] point to the
**Sources** list at the end. Code is cited as `path:line`, relative to `E:\aylo\orza-mobile`.

Client requirement: steps count by themselves with no typing, "like other health apps", and sync with other health
apps in both directions where that makes sense. Apple and Google review is strict, so every permission needs a clear
reason and a declaration.

---

## 0. Summary of findings and recommendations

1. **Android 14+ already counts phone steps inside Health Connect (HC).** On Android 14 with SDK extension 20 or
   later, HC reads the phone's `TYPE_STEP_COUNTER`. It starts as soon as any app holds `READ_STEPS`, and it writes
   about once a minute. Phone steps are already part of an HC aggregate that has no origin filter [S5][S9]. So on
   these phones the "like other health apps" source is HC itself, and ÖRZA only needs `READ_STEPS`. Today currently
   asks for "Physical activity" only. HC steps are read only after the member connects all 8 HC types on the Health
   screen (`src/lib/steps/sync.ts:162`, `src/lib/health/bridge.android.ts:42`).
2. **The Recording API on mobile (Play services `LocalRecordingClient`) should be the phone source on Android 9–13**,
   and the backup on 14+ when HC isn't granted. Facts:
   - it records steps in the background with no alarms and no foreground service, and keeps 10 days;
   - it needs only `ACTIVITY_RECOGNITION` and no Google account;
   - it needs Play services ≥ 241500000 for steps only, or ≥ 250500000 for steps + distance + calories
     [S1][S2][S3].

   Our own `orza-steps` sampler (hourly allow-while-idle alarms, boot and shutdown receivers) stays as the backup for
   phones without new enough Play services. Google's HC steps guide recommends exactly this pairing for users on
   Android 13 and lower [S5].
3. **Reading and de-duplication are already correct in principle.** HC `aggregate` with no `dataOriginFilter` keeps
   only the highest-priority app wherever sources overlap (Activity and Sleep types only) [S6]. HealthKit statistics
   (`cumulativeSum`) merge all sources first, so iPhone + Apple Watch count once [S15]. ÖRZA then takes the higher of
   health store and phone counter per day (`src/lib/steps/shared.ts:33-50`). A max never adds the two together, so it
   never double counts.
4. **Writing steps:**
   - **iOS: never write steps to HealthKit.** iPhone and Watch already record them [S16]. A newly added source goes to
     the **top** of the Health priority list [S18], so ÖRZA's copy would override Watch data. Guideline 5.1.3(ii) also
     forbids inaccurate data [S19].
   - **Android 14+ (SDK ext ≥ 20): don't write.** HC already holds the phone's steps, and a second copy only adds raw
     duplicates [S5][S7].
   - **Android 9–13: optional, opt-in write** of ÖRZA's *own* counted intervals only. Write only when no other app
     (Google Fit, Samsung Health, Fitbit…) is already writing steps for that period. Use `autoRecorded` metadata with
     `Device(TYPE_PHONE, manufacturer, model)`, a deterministic `clientRecordId` and the real zone offsets [S7].
     Ship it later (phase 2), and only if the client still wants "both ways" after hearing why.
5. **Background updates are missing on both platforms:**
   - Android: HC reads from the hourly background task fail without `READ_HEALTH_DATA_IN_BACKGROUND`, which is not
     declared (`app.json:49-56`; the swallowed error is at `bridge.android.ts:252`) [S8].
   - iOS: the HealthKit plugin has `"background": false` (`app.json:144`), so there is no `HKObserverQuery` /
     background delivery. Step count can wake the app at most **hourly** [S13].
   - `@kingstinct/react-native-healthkit` 16.2.0 already has `configureBackgroundTypes` + `subscribeToChanges`, with
     launch-time observer registration and no AppDelegate change.
6. **Store hygiene to do with v2:**
   - Drop `NSHealthUpdateUsageDescription` (ÖRZA doesn't write; the plugin accepts `false`).
   - Ask for steps-only Health access just in time from Today instead of all 8 types.
   - Declare `READ_HEALTH_DATA_IN_BACKGROUND` (and `WRITE_STEPS` only if phase 2 ships) in the Play Health apps
     declaration with a reason for each.
   - Data safety: "Fitness info", collected. App Store privacy labels: Health & Fitness › Fitness + Health [S20]–[S26].

---

## 1. Google Play services Recording API on mobile

### 1.1 Facts (official)

| Item | Value | Source |
|---|---|---|
| Purpose | "Client which enables low-power, always-on background collection of local sensor data" | [S2] |
| Gradle | `com.google.android.gms:play-services-fitness` — guide shows `21.2.0`; latest on Google Maven is **21.3.0** (released 2025-08-05; adds distance + calories) | [S1][S3][S4] |
| Min Play services (steps only) | `LocalRecordingClient.LOCAL_RECORDING_CLIENT_STEPS_MIN_VERSION_CODE = 241500000`, which "only has support for TYPE_STEP_COUNT_DELTA" | [S2] |
| Min Play services (all types) | `LOCAL_RECORDING_CLIENT_MIN_VERSION_CODE = 250500000` (raised in 21.3.0) | [S2][S4] |
| Version check | `GoogleApiAvailability.isGooglePlayServicesAvailable(context, <min code>) != ConnectionResult.SUCCESS` means "prompt user to update"; a too-old version gives `ConnectionResult.SERVICE_VERSION_UPDATE_REQUIRED` | [S1] |
| Permission | `android.permission.ACTIVITY_RECOGNITION` (runtime on Android 10+) | [S1] |
| Account | "accountless … does not require a Google Account … data is stored on-device" | [S1] |
| Data types | `TYPE_STEP_COUNT_DELTA`, `TYPE_DISTANCE_DELTA`, `TYPE_CALORIES_EXPENDED` | [S1] |
| Retention | "stores up to 10 days of data"; "Once the recording subscription starts or is renewed, data since the latest subscription — for up to 10 days — is accessible" | [S1] |
| Subscription | `subscribe` "Subscribes to background collection … on behalf of the current application"; subscribing again to an existing subscription does nothing; `unsubscribe` makes collected data inaccessible | [S1][S2] |
| Background / battery | records "in a battery-efficient way"; "continuously updates its collection"; Google suggests WorkManager to collect it periodically (10-day window) | [S1] |
| Read | `readData(LocalDataReadRequest)`: `.aggregate(type)` + `.bucketByTime(n, unit)` or `.read(type)`; `.setTimeRange(start, end, unit)` is required, and **start and end are both inclusive** | [S1][S2a] |
| Value | `dataPoint.getValue(LocalField.FIELD_STEPS).asInt()` (throws if the format isn't INT32) | [S2b][S3a] |
| Health Connect | Google: use HC to read other sources; HC "provides access to on-device steps natively on Android 14 (API level 34) and higher". Recording API data is not said to be shared with HC or with other apps | [S1] |
| Google Fit | The Recording API on mobile replaces the deprecated Google Fit Android API; Fit APIs are supported until the end of 2026, so don't use Fit APIs | [S1][S11] |

**Not documented (check on a real phone):**

- **Emulator support.** Nothing official. On a "Google Play" AVD with Play services ≥ 24.15, the availability check,
  `subscribe` and an empty `readData` should all work. Real counts need a step sensor, and the project's Medium_Phone
  AVD has none (`docs/PROGRESS.md:403`).
- **How fresh the data is** (how soon a step appears in `readData`).
- **Whether the subscription survives a reboot or app update.** It is cheap and idempotent, so call `subscribe` on
  every launch and every background run.
- **Android 8–9 (API 26–28).** `ACTIVITY_RECOGNITION` is not a runtime permission there. The old Fit API needed the
  GMS permission `com.google.android.gms.permission.ACTIVITY_RECOGNITION` on API ≤ 28 [S12], but the Recording API
  page doesn't say. Test on an Android 9 phone, and add that (normal, install-time) permission only if `subscribe`
  fails there.

### 1.2 Kotlin for `modules/orza-steps` (Expo module)

`modules/orza-steps/android/build.gradle` currently has no `dependencies` block. Add:

```groovy
dependencies {
  implementation 'com.google.android.gms:play-services-fitness:21.3.0'
}
```

`play-services-fitness` pulls in play-services-base, which provides `GoogleApiAvailability`. Recent base releases need
minSdk 24 [S4], and ÖRZA's minSdk is 26.

```kotlin
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import com.google.android.gms.fitness.FitnessLocal
import com.google.android.gms.fitness.LocalRecordingClient
import com.google.android.gms.fitness.data.LocalDataType
import com.google.android.gms.fitness.data.LocalField
import com.google.android.gms.fitness.request.LocalDataReadRequest
import java.util.concurrent.TimeUnit

internal object StepRecording {
  /** "available" | "update_required" | "missing" | "disabled" | "unavailable" */
  fun status(ctx: Context): String =
    when (GoogleApiAvailability.getInstance()
        .isGooglePlayServicesAvailable(ctx, LocalRecordingClient.LOCAL_RECORDING_CLIENT_STEPS_MIN_VERSION_CODE)) {
      ConnectionResult.SUCCESS -> "available"
      ConnectionResult.SERVICE_VERSION_UPDATE_REQUIRED, ConnectionResult.SERVICE_UPDATING -> "update_required"
      ConnectionResult.SERVICE_MISSING, ConnectionResult.SERVICE_INVALID -> "missing"
      ConnectionResult.SERVICE_DISABLED -> "disabled"
      else -> "unavailable"
    }

  fun client(ctx: Context) = FitnessLocal.getLocalRecordingClient(ctx)
}

// In OrzaStepsModule.definition():
AsyncFunction("recordingStatus") { StepRecording.status(context) }

AsyncFunction("recordingSubscribe") { promise: Promise ->
  val ctx = context
  if (StepRecording.status(ctx) != "available" || !StepSensor.hasPermission(ctx)) { promise.resolve(false); return@AsyncFunction }
  StepRecording.client(ctx).subscribe(LocalDataType.TYPE_STEP_COUNT_DELTA)
    .addOnSuccessListener { StepStore.markRecordingSubscribed(ctx); promise.resolve(true) } // keep first-subscribe time (partial first day)
    .addOnFailureListener { promise.resolve(false) }                                       // ApiException / SecurityException → sampler fallback
}

/** 15-min buckets [startMs, endMs] as JSON [[start, end, steps], …] (non-zero only). */
AsyncFunction("recordingRead") { startMs: Double, endMs: Double, promise: Promise ->
  val req = LocalDataReadRequest.Builder()
    .aggregate(LocalDataType.TYPE_STEP_COUNT_DELTA)
    .bucketByTime(15, TimeUnit.MINUTES)
    .setTimeRange(startMs.toLong(), endMs.toLong() - 1, TimeUnit.MILLISECONDS) // end is inclusive
    .build()
  StepRecording.client(context).readData(req)
    .addOnSuccessListener { resp ->
      val out = org.json.JSONArray()
      for (b in resp.buckets) {
        var steps = 0
        for (ds in b.dataSets) for (dp in ds.dataPoints) steps += dp.getValue(LocalField.FIELD_STEPS).asInt()
        if (steps > 0) out.put(org.json.JSONArray().put(b.getStartTime(TimeUnit.MILLISECONDS)).put(b.getEndTime(TimeUnit.MILLISECONDS)).put(steps))
      }
      promise.resolve(out.toString())
    }
    .addOnFailureListener { e -> promise.reject("ERR_RECORDING_READ", e.message, e) }
}
```

Design notes for v2:

- **Use 15-minute buckets and add them up per local day in JS.** Every real UTC offset is a multiple of 15 minutes
  (India +05:30, Nepal +05:45). So buckets that start on a UTC quarter-hour split exactly at the member's midnight,
  and DST days stay correct. A single `bucketByTime(1, DAYS)` would not handle that. Start the range on a quarter-hour
  boundary.
- **Pass `partialFrom` for the first subscribed day.** Data exists only from the first subscription
  (`markRecordingSubscribed`). This keeps the existing START-base logic working (`src/lib/steps/policy.ts:119-128`).
- **Keep one phone source per day.** Use the Recording API when `recordingStatus() == "available"` and the
  subscription succeeded; otherwise arm the sampler (`StepSampler.start`). Don't switch sources inside a day other
  than falling back: the day-base maths re-anchors on a source change (`policy.ts:97-102`). Internally, tag the source
  as e.g. `phone` vs `phone_play`, even if the UI label stays "Counted by this phone".
- **Read in the background too.** Call `recordingRead` from the existing hourly background task
  (`src/lib/alarms/background.ts:20-37`). That is the WorkManager-style periodic collection Google suggests [S1], and
  it fits easily inside the 10-day window (`FINAL_DAYS = 7`, `src/lib/steps/plan.ts:11`).
- **Turn the sampler off while the Recording API works.** That drops the hourly alarm and the boot/shutdown work. The
  sampler code stays as the backup for Huawei, Fire, old Play services, or phones where Play services is disabled.
- **Live freshness while Today is open:** measure it on a real phone. If the Recording API lags noticeably, keep the
  module's one-shot `sampleNow()` for the foreground only. Note that adding a live counter on top of Recording API
  data would need a shared anchor. Taking the higher of the two sources per day (as today) is safe; adding them is not.

---

## 2. Health Connect

### 2.1 Reading (what we do and why it de-duplicates)

- **Current code.** `stepsBetween` calls `aggregateRecord({recordType: 'Steps', timeRangeFilter: between(dayStart,
  dayEnd)})` with **no `dataOriginFilter`** (`src/lib/health/bridge.android.ts:234-259`). The 30-day Health sync uses
  `aggregateGroupByPeriod(DAYS)` (`bridge.android.ts:106-117`).
- **De-duplication.** "When you perform an aggregate read, the Aggregate API accounts for any duplicate data and keeps
  only the data from the app with the highest priority." This applies to Activity and Sleep types only, and only the
  user can change the priority list [S6]. Google's steps guide says to "use `aggregate()` instead of `readRecords()`
  to avoid double counting from multiple sources" [S8]. **So aggregate with no origin filter is the right read.**
  Never add up `readRecords` results across origins.
- **On-device steps (Android 14+, SDK ext ≥ 20).**
  - "If any app has been granted the READ_STEPS permission, Health Connect starts capturing steps from the
    Android-powered device." It uses `TYPE_STEP_COUNTER` and writes about once a minute.
  - These steps are attributed to `android`. From June 2026 they use a per-device, per-app **synthetic package name**
    (`getCurrentDeviceDataSource()`, which needs SDK ext 22 and the framework API, not Jetpack).
  - "If your app reads aggregated steps and doesn't filter by DataOrigin, on-device steps are included automatically
    … no changes are required" [S5].
  - Phone steps have the **lowest priority** by default. The user can move or remove the phone under HC › Devices
    [S9].
  - Collection starts at the grant; there is no history from before it [S9].
- **Who contributed.** The aggregate result carries `dataOrigins`: "Set of DataOrigins that contributed to the
  aggregation result" [S10]. `react-native-health-connect` 4.1.3 returns it as `dataOrigins: string[]`
  (`node_modules/react-native-health-connect/src/types/aggregate.types.ts:15`,
  `android/.../records/ReactStepsRecord.kt:73`). ÖRZA ignores it today. v2 can use it to:
  - label the source ("From Samsung Health", "From your phone");
  - decide whether anyone else writes steps (section 2.3).
- **Per-origin reads in RNHC.**
  - `aggregateRecord({recordType:'Steps', timeRangeFilter, dataOriginFilter:['com.sec.android.app.shealth']})`
  - `readRecords('Steps', {timeRangeFilter, dataOriginFilter:[...]})`. Records carry `metadata.dataOrigin`,
    `metadata.device`, `metadata.recordingMethod` and `clientRecordId` (`.../utils/HealthConnectUtils.kt:218-230`).
  - The phone's own on-device steps are origin `android` (pre-June-2026 data) plus the SPN. RNHC has no
    `getCurrentDeviceDataSource`, so it would need a small Kotlin function in `orza-steps`.
- **Background reads.** "By requesting an extra permission from the user, you can read data after the user or system
  places your app in the background." The permission is `android.permission.health.READ_HEALTH_DATA_IN_BACKGROUND`,
  checked with `getFeatureStatus(FEATURE_READ_HEALTH_DATA_IN_BACKGROUND)`. It has been in connect-client since 1.1.0,
  and since alpha11 it also covers Android 13 and lower [S8][S8a][S8b].
  - RNHC can **request** it: `{accessType:'read', recordType:'BackgroundAccessPermission'}`
    (`.../permissions/PermissionUtils.kt:26-27`).
  - RNHC 4.1.3 has **no `getFeatureStatus`**. Either check the grant after asking, or add a 5-line Kotlin
    `HealthConnectClient.getOrCreate(ctx).features.getFeatureStatus(...)` to `orza-steps`.
  - Without the permission, ÖRZA's hourly task (`src/lib/alarms/background.ts:27`) gets an error that
    `bridge.android.ts:252` turns into `null`. So members who rely on HC (watch only, no phone sensor) get nothing
    saved until they open the app.
- **History.** Apps can read 30 days back from the first grant unless they hold `READ_HEALTH_DATA_HISTORY` [S6][S8].
  That is enough for steps (7 pending days).
- **Library versions.** RNHC is 4.1.3 (latest on npm) on `androidx.health.connect:connect-client:1.1.0` (latest
  stable, 2025-10-08). The latest alpha is 1.2.0-alpha06 [S8b].

### 2.2 Writing — facts (official)

- **Permission:** `android.permission.health.WRITE_STEPS`, requested with
  `HealthPermission.getWritePermission(StepsRecord::class)` [S5].
- **Metadata** [S7]:
  - "As of version 1.1.0-rc01, RecordingMethod and DeviceType are mandatory requirements when writing data."
  - Use the factories: `Metadata.autoRecorded(device[, clientRecordId, clientRecordVersion])`,
    `activelyRecorded(…)`, `manualEntry(…)`, `unknownRecordingMethod(…)`. The constructor became internal in
    1.1.0-alpha12 [S8b].
  - The device needs a `type`; the guide also lists manufacturer and model.
- **Upserts** [S7]:
  - "The insertRecords function has the ability to upsert data. If the data exists in Health Connect based on the
    given set of Client Record IDs, it gets overwritten."
  - With `clientRecordVersion`, the overwrite happens only if the new version is higher. Versions don't increase on
    their own; the app supplies them.
- **Zone offsets:** don't default to UTC; compute them from `ZoneId.systemDefault()` [S7].
- **Cadence** [S7]: steps are expected every minute; "the maximum interval between writes should be 15 minutes";
  "only write new data and updated data"; at most 1000 records per request; "Only write zero values when it reflects
  true inactivity."
- **Good-citizen rules** [S7]:
  - "Your app should write all supported first-party data."
  - "if your app has read data from Health Connect, that data shouldn't be written back into Health Connect."
  - "If data in your app has been imported from another app, then the responsibility falls onto the other app to
    write its own data."
- **How HC handles multiple writers** [S6][S9]:
  - Overlapping steps from several apps are de-duplicated in aggregates by the user's app priority list.
  - Phone (on-device) steps rank lowest by default.
  - Google's pages don't say where a newly granted writer is placed in that list.
  - Apps that read raw records without de-duplicating would still see both copies.
- **RNHC write support (4.1.3).**
  - `insertRecords([{recordType:'Steps', startTime, endTime, count, metadata:{clientRecordId, clientRecordVersion,
    recordingMethod: RecordingMethod.RECORDING_METHOD_AUTOMATICALLY_RECORDED, device:{type: DeviceType.TYPE_PHONE,
    manufacturer, model}}}])` returns the record ids. It maps to the Metadata factories
    (`.../utils/HealthConnectUtils.kt:182-216`).
  - `deleteRecordsByUuids('Steps', recordIds, clientRecordIds)` also exists.
  - **Gap:** RNHC's Steps writer hard-codes `startZoneOffset = null, endZoneOffset = null`
    (`.../records/ReactStepsRecord.kt:25-26`), against the zone-offset guidance. Either patch RNHC (patch-package)
    or write natively in `orza-steps` with `connect-client:1.1.0` (the same version RNHC uses, so no conflict). The
    native route is better: it also gives the SDK-extension check and `getFeatureStatus`.

### 2.3 Should ÖRZA write steps to HC? Recommendation

| Phone | Write? | Why |
|---|---|---|
| Android 14+ with SDK ext ≥ 20 (`Build.VERSION.SDK_INT >= 34 && SdkExtensions.getExtensionVersion(UPSIDE_DOWN_CAKE) >= 20` [S5]) | **No** | HC already records this phone's steps natively once any app has `READ_STEPS` (ÖRZA will). ÖRZA's count would be a second copy of the same walking. The aggregate de-duplicates by priority, but raw-record readers would double count, and the member's priority list gets one more entry to manage. Every app on the phone already sees the phone's steps, so "sharing" is inherent. |
| Android 9–13, or 14 without ext 20 | **Opt-in, phase 2** — only if no other app writes steps | Here HC has no phone source of its own, so ÖRZA's Recording API / sampler steps can be real first-party data. A good citizen writes only when nobody else covers the phone: check the day's (or interval's) `aggregate.dataOrigins`; if any origin other than `in.co.ylo.orza` is present (Google Fit, Samsung Health, Fitbit…), skip that period. |
| iOS | **Never** | See section 3.2. |

**Rules for the phase-2 writer, if it is built:**

- Write only intervals counted by ÖRZA's own phone source. Never write:
  - a count that came from HC (the `bestOf` winner may be HC);
  - the member's manual edits or bases (they are corrections, not measurements);
  - long-gap estimates (`DaySteps.estimated`).
- Use 15-minute `StepsRecord`s from the Recording API buckets, or sampler deltas.
- Metadata: `Metadata.autoRecorded(Device(type = Device.TYPE_PHONE, manufacturer = Build.MANUFACTURER, model =
  Build.MODEL), clientRecordId = "orza-steps:<bucketStartEpochMs>", clientRecordVersion = <write time ms>)`. Set
  zone offsets from `ZoneId.systemDefault()`.
- Re-writing a bucket is then an idempotent upsert.
- Write from the hourly background task and on app foreground. That is within the 15-minute guidance only while the
  app is open. Background cadence is OS-limited, which the guide allows for data "that sync less frequently" [S7].
- If another origin shows up later for a period ÖRZA already wrote, delete its own records there
  (`deleteRecordsByUuids` with ÖRZA's clientRecordIds) or stop writing from that day on. Either way, the member's
  totals never come from two phone writers.
- Gate it behind a toggle ("Share this phone's steps with Health Connect") with its own `WRITE_STEPS` request, and
  add `WRITE_STEPS` to the manifest and the Play Health declaration only when it ships (section 4.1).

**Other apps' steps into ÖRZA** (the "in" direction) already works: HC aggregate and Apple Health statistics. In v2 it
should not depend on the member finding the Health screen (section 5, gaps G1/G4).

---

## 3. iOS

### 3.1 Reading from HealthKit is the right design (confirmed)

- "The system automatically records [stepCount] samples on iPhone and Apple Watch" [S16].
- Statistics queries "automatically merge the data from all of your data sources before performing the calculations"
  (`separateBySource` turns that off) [S15]. The Health app resolves overlaps by source priority: by default manual
  entries first, then iPhone and Apple Watch, then apps [S18].
- ÖRZA uses `queryStatisticsForQuantity(StepCount, ['cumulativeSum'])` per local day (`src/lib/health/bridge.ios.ts:155-182`)
  and `queryStatisticsCollectionForQuantity(..., {day: 1})` for the 30-day sync (`bridge.ios.ts:50-69`). Both are the
  merged, de-duplicated totals the Health app shows.
- Caveats:
  - HealthKit never says whether reading was denied: "From the app's point of view, no data of that type exists"
    [S17]. The current code already treats 0 as "no data" (`src/lib/steps/reader.ios.ts:86-87`).
  - The store is encrypted while the phone is locked, so background reads can fail [S17]. `bridge.ios.ts:175`
    already returns `null` in that case.

### 3.2 ÖRZA must not write steps to HealthKit

- iPhone and Watch already record steps [S16]. ÖRZA would only re-save a number it read from Health or from the same
  motion coprocessor (CMPedometer).
- "New apps or devices that you add are listed at the top automatically, above your iPhone or iPad" [S18]. An ÖRZA
  steps source would therefore **win over Apple Watch data by default** in every overlapping period.
- Guideline 5.1.3(ii): "Apps must not write false or inaccurate data into HealthKit" [S19].
- Writing would add a share permission and need `NSHealthUpdateUsageDescription` [S17], which means more review
  surface for no member benefit.
- **So: read only.** Also set `NSHealthUpdateUsageDescription: false` in the healthkit plugin, since ÖRZA writes
  nothing. Today's text "ÖRZA only reads from Apple Health today. If it ever saves something…" (`app.json:143`)
  describes a non-use. Guideline 5.1.1(ii) asks that purpose strings "clearly and completely describe your use of the
  data" [S19]. The plugin supports `false`: `node_modules/@kingstinct/react-native-healthkit/app.plugin.ts:17, 31-40`.

### 3.3 CMPedometer only as a fallback

- "Only the past seven days worth of data is stored and available" [S14]. It needs `NSMotionUsageDescription` or the
  app crashes [S14]. That string is already set via the expo-sensors plugin (`app.json:124`).
- CMPedometer counts the iPhone only (no Watch). HealthKit already holds the iPhone's steps, so with Health access
  CMPedometer adds only:
  - liveness: HealthKit's iPhone samples arrive in batches; the size of that lag isn't documented, so measure it;
  - a source for members who refuse Health access.
- Recommended v2 order:
  1. Today's single CTA requests HealthKit read for **StepCount only**, just in time.
  2. If HealthKit returns no step source, offer "Use Motion & Fitness instead" (CMPedometer). Detect this with
     `querySources('HKQuantityTypeIdentifierStepCount')` returning empty, or no `sumQuantity` over 7 days: either
     read was denied or Fitness Tracking is off.
  3. Keep taking the higher of the two per day where both are allowed (`reader.ios.ts:75-95`).
- Today the order is reversed: the Today CTA asks Motion & Fitness (`reader.ios.ts:57-65`), and HealthKit counts only
  after the member connects Apple Health on the Health screen (`reader.ios.ts:80`, `src/lib/steps/sync.ts:162`). So
  Apple Watch steps and history older than 7 days are missed by default.

### 3.4 Background delivery (counts update without opening the app)

- Apple [S13]:
  - Since iOS 15, `enableBackgroundDelivery` needs the `com.apple.developer.healthkit.background-delivery`
    entitlement, otherwise it fails with `errorAuthorizationDenied`.
  - The app is woken at most once per frequency period, and "on iOS, stepCount samples have an hourly maximum
    frequency."
  - Observer queries should be set up in `application(_:didFinishLaunchingWithOptions:)`, and the completion handler
    must be called. After three missed calls, HealthKit stops sending updates.
  - "Background server queries aren't supported on the Simulator."
- `@kingstinct/react-native-healthkit` **16.2.0** (installed, latest on npm) supports all of this:
  - **Entitlement.** Plugin option `background` defaults to true and adds the background-delivery entitlement
    (`node_modules/@react-native-healthkit/core/src/plugin/index.ts:28-44`). ÖRZA sets `"background": false`
    (`app.json:144`).
  - **`configureBackgroundTypes(['HKQuantityTypeIdentifierStepCount'], UpdateFrequency.hourly)`** (enum
    `immediate=1, hourly=2, daily=3, weekly=4`). It stores the types in UserDefaults and registers the
    `HKObserverQuery` + `enableBackgroundDelivery` natively on `UIApplicationDidFinishLaunchingNotification` on
    every cold launch. No AppDelegate change is needed (`.../core/ios/BackgroundDeliveryManager.swift:42-120`).
  - When an observer fires, it opens a `beginBackgroundTask` window, queues the event until JS subscribes, and calls
    HealthKit's completion handler right away (`BackgroundDeliveryManager.swift:186-260`).
  - **`subscribeToChanges('HKQuantityTypeIdentifierStepCount', cb)`** is routed through that native observer when the
    type is background-configured (`node_modules/@kingstinct/react-native-healthkit/ios/CoreModule.swift:396-408`).
    Register it at **global scope in the entry file**, like the alarms task (`src/lib/alarms/background.ts:7-11`), so
    it exists on a background cold launch. In `cb`, call `syncStepsInBackground()`.
  - `clearBackgroundTypes()` belongs on sign-out and on disconnect.
- **App Store.** Background delivery is part of the HealthKit capability (entitlement). Apple's doc lists no
  `UIBackgroundModes` key for it [S13]. EAS syncs capabilities from the entitlements file.
- **Reality check:** at most hourly, and a read can fail while the phone is locked [S17]. Together with the existing
  BGTaskScheduler task (expo-background-task, `minimumInterval: 60`), the website is usually at most about an hour
  behind. It is not live.

---

## 4. Store policy

### 4.1 Google Play

- **Health apps declaration** (Policy › App content › Health apps) [S20][S21]:
  - It is mandatory for every app. Step 1: pick health features. ÖRZA: Activity and fitness (steps), Nutrition and
    weight management, Sleep management, Medication management, etc.
  - Step 2: "provide an explanation of how your app uses each listed Health Connect data type".
  - "Only request permissions and access data types that support the specific, user-facing health features you
    offer."
  - The privacy policy linked in HC must be the same as the Play listing's.
  - Re-file the declaration when the set of data types changes.
  - Access is allow-listed per package name; a new version may be reviewed again.
- **For steps v2, declare:**
  - `READ_STEPS`: already declared, `app.json:49`. Reason: Today counts steps automatically from watches, other
    apps and the phone, to show progress to the member's step goal and in reports.
  - `READ_HEALTH_DATA_IN_BACKGROUND`: new. Reason: keep the daily step total current on the member's account while
    the app is closed.
  - `WRITE_STEPS`: only if phase 2 ships. Reason: an opt-in toggle shares the steps this phone counted with other
    fitness apps through HC.
  - "Needed for app functionality" is explicitly too vague [S22].
- **Health Connect policy** [S22][S23]:
  - Approved use cases include "fitness and wellness … fitness coaching".
  - Minimum scope: "You must only request access to the permissions that are necessary".
  - Limited use: no ads, no sale, no third-party transfer without explicit consent, human access restricted.
  - No headless apps.
  - The rationale / privacy-policy activity is added by the RNHC config plugin (comment at
    `src/lib/health/bridge.android.ts:1-5`).
- **Activity recognition.** `ACTIVITY_RECOGNITION` is a normal runtime permission. It is not among Play's
  declaration-form permissions; the "Permissions and APIs that Access Sensitive Information" text [S23] doesn't list
  it. Policy still requires:
  - incremental, in-context requests;
  - respecting denial [S23];
  - disclosure in the privacy policy and Data safety.

  The Today card already explains before the system prompt (`src/features/today/StepsCard.tsx:270-300, 328`). Only
  add the GMS `com.google.android.gms.permission.ACTIVITY_RECOGNITION` if Android 9 testing needs it (section 1.1).
- **Data safety form** [S24]:
  - Steps are **Health and fitness › Fitness info** ("Information about a user's fitness, such as exercise or other
    physical activity"). Collected, because they are sent to ÖRZA's server (`POST /api/track/steps`,
    `/api/health/import`).
  - Purpose: App functionality (+ Personalization if targets use it). Optional for the user, encrypted in transit,
    deletable.
  - Processing that stays on the phone is not collection.
  - Writing to HC (phase 2) is "transferring data to another app on the device". The form treats that as sharing
    unless it is user-initiated or behind prominent consent [S24]. The opt-in toggle is user-initiated, but it is
    safest to mention it in the privacy policy too. Google's pages don't address HC writes explicitly.
- **Recording API.** No extra Play declaration is documented. It is covered by `ACTIVITY_RECOGNITION` plus Fitness
  info in Data safety [S1][S23].

### 4.2 App Store

- **HealthKit** [S17][S19]:
  - `NSHealthShareUsageDescription` is required to read. Keep it specific; the current string `app.json:142` is fine.
  - `NSHealthUpdateUsageDescription` only when writing, so **remove it** (plugin `false`).
  - HealthKit may be used only for health and fitness, with that use clear in the UI and marketing (2.5.1).
  - No ads or data mining (5.1.3(i)); no inaccurate data written and no personal health information in iCloud
    (5.1.3(ii)); a privacy policy is required.
- **Motion.** `NSMotionUsageDescription` is required for CMPedometer [S14]; it is set at `app.json:124`. If
  CMPedometer becomes fallback-only, request Motion only from the fallback path (just in time).
- **Consent and permission UX** (5.1.1): "Ensure your purpose strings clearly and completely describe your use of the
  data"; "Apps must respect the user's permission settings and not attempt to manipulate, trick, or force people to
  consent" [S19]. The app must stay usable when steps access is denied: manual entry remains the fallback, and that is
  fine.
- **App privacy labels** [S25]:
  - Health & Fitness › **Fitness** ("including … the Motion and Fitness API") and › **Health** (HealthKit).
  - Collected (they go to ÖRZA's server), linked to the user, App Functionality.
  - "Data that is processed only on device is not 'collected'."
- **Entitlements:**
  - `com.apple.developer.healthkit` (already added by the plugin);
  - `com.apple.developer.healthkit.background-delivery` (new);
  - **no** `healthkit.access` / health-records (not used) [S26].

---

## 5. Current code vs the requirement: gaps

**What works today:**

- **Android.** HC aggregate (when connected) plus the native step-counter sampler
  (`src/lib/steps/reader.android.ts:103-120`). The sampler uses an hourly allow-while-idle alarm, exact or inexact
  midnight alarms, and boot/shutdown receivers. It keeps a 10-day ring buffer (`modules/orza-steps/.../StepModels.kt:18,
  57-59`). The day maths is pure (`src/lib/steps/counter.ts:1-14`).
- **iOS.** Apple Health statistics (when connected) plus CMPedometer, 7 days (`src/lib/steps/reader.ios.ts:15-16,
  75-95`).
- **Combining and saving.** Higher of the sources per day (`src/lib/steps/shared.ts:33-50`). Saves go through
  `POST /api/track/steps`, never lowering the server count and treating edits as bases
  (`src/lib/steps/policy.ts:1-17`, `src/lib/steps/save.ts:86-149`). The web mirror also only raises
  (`E:\aylo\orza\src\lib\care\health.ts:355-379`).
- **Background.** One hourly expo-background-task (WorkManager / BGTaskScheduler) also saves steps
  (`src/lib/alarms/background.ts:20-37`).

| # | Gap | Where | Fix in v2 |
|---|---|---|---|
| G1 | **Android 14+:** HC's native phone step counting is never switched on unless the member connects HC on the Health screen (all 8 read types at once). The Today CTA asks only Physical activity. | `reader.android.ts:16,77-92`; `sync.ts:162`; `bridge.android.ts:42,166-174` | The Today CTA on Android: Physical activity (Recording API), then an optional "Include your watch and other apps" that requests **only** `READ_STEPS` (incremental). That alone turns on HC on-device steps [S5][S9]. Read HC steps whenever `READ_STEPS` is granted, not only when "connected". |
| G2 | **Android 9–13 phone source is our own alarm-driven sampler.** Steps between the last sample and a shutdown, or in the Restricted bucket (no periodic alarm), are lost or estimated. It needs alarms, boot receivers and exact-alarm logic. | `modules/orza-steps/*`; `StepScheduler.kt:14-23`; `docs/notes/steps-fix-and-device-test.md` (N3 loss window up to ~2 h) | Recording API as the primary phone source (section 1); sampler only when Play services is missing or too old. |
| G3 | **No HC background read.** `READ_HEALTH_DATA_IN_BACKGROUND` isn't declared or requested; background HC reads error and become `null`. | `app.json:49-56`; `bridge.android.ts:252`; `background.ts:27` | Declare it, request `BackgroundAccessPermission` with steps, gate on feature status. |
| G4 | **iOS: Apple Watch steps and history older than 7 days are missing by default.** HealthKit is read only after the Health screen connect; the Today CTA asks Motion. | `reader.ios.ts:57-65,78-81`; `sync.ts:162` | Today CTA = HealthKit StepCount read (just in time); CMPedometer only as fallback (section 3.3). |
| G5 | **iOS: no background delivery.** The plugin has `background: false`; only BGTaskScheduler, which runs at iOS's discretion. | `app.json:144`; `background.ts` | `background: true`, `configureBackgroundTypes([StepCount], hourly)`, global `subscribeToChanges` that calls `syncStepsInBackground()` (section 3.4). |
| G6 | **No "out" direction.** ÖRZA writes steps nowhere. | — | By design on iOS and Android 14+ (section 2.3). Optional, opt-in HC write on Android 9–13 when no other writer (phase 2). Explain to the client: on iOS and Android 14+, phone steps are already visible to every health app. |
| G7 | **`NSHealthUpdateUsageDescription` declared without any HealthKit write.** | `app.json:143` | `"NSHealthUpdateUsageDescription": false` |
| G8 | **Source attribution is coarse.** HC `dataOrigins` is ignored, so the UI shows only "From Health Connect". | `bridge.android.ts:245-250`; `StepsCard.tsx:33-39` | Return `dataOrigins` from `stepsBetween`; show "From Samsung Health" / "From your phone"; also use it for the phase-2 writer check. |
| G9 | **RNHC Steps writer drops zone offsets.** It matters only if phase 2 uses RNHC. | `node_modules/react-native-health-connect/android/.../ReactStepsRecord.kt:25-26` | Write natively in `orza-steps` with connect-client 1.1.0 (`ZoneId.systemDefault()` offsets), or patch RNHC. |
| G10 | **No SDK-extension or feature checks.** JS can't tell whether HC records phone steps (ext ≥ 20), or whether background read is available. | — | Small Kotlin functions in `orza-steps`: `SdkExtensions.getExtensionVersion(UPSIDE_DOWN_CAKE)` (API 34+), `HealthConnectClient.features.getFeatureStatus(...)`. |
| G11 | **The first day is partial for new sources.** HC on-device steps and the Recording API both start at the grant or subscription, with no history. | `policy.ts:119-128` (START base applies only to source `phone` with `partialFrom`) | Pass `partialFrom` for the Recording API's first subscribed day. For HC on-device steps, the existing "never lower" rule keeps an earlier typed or saved number. Consider the START base for a HC first day too. |
| G12 | **Manual entry still shows** when no phone counter exists or permission is denied, even if HC/Health is connected but empty that day. | `StepsCard.tsx:97,218-220` | Fine as the last resort. With G1/G4 fixed, it appears only when every automatic source is refused or absent. Keep "Edit" (corrections) as is. |
| G13 | **The phone source may be stale while Today is open** (Recording API freshness unknown). | — | Measure on a device; keep `sampleNow()` as a foreground-only live top-up if needed (section 1.2). |
| G14 | **Not verified on real hardware.** The emulator has no step counter; HK background delivery doesn't run on the Simulator. | `docs/PROGRESS.md:403-410,423` | Real-device checklist: Android 9–13 + Android 14/15/16 (Pixel or Samsung) and an iPhone (+ Watch if possible). |

**Suggested source matrix for v2:**

| Platform | Phone source | Health store source | Day value | Background | Write |
|---|---|---|---|---|---|
| Android 14+ (ext ≥ 20) | Recording API (backup: sampler) | HC aggregate (includes HC on-device phone steps once `READ_STEPS` is granted, plus watch and apps) | higher of the two | hourly task: Recording API read + HC read with background permission | none |
| Android 9–13 / 14 without ext 20 | Recording API (backup: sampler) | HC aggregate when installed and granted (Fit / Samsung / Fitbit…) | higher of the two | same | phase 2: opt-in, only if no other origin |
| iOS | CMPedometer only if Health gives no steps | HealthKit statistics `cumulativeSum` (iPhone + Watch) | higher of the two | HK background delivery (hourly) + BGTask | none |

---

## 6. Open questions to verify on devices

1. Recording API: latency from walking to `readData`; whether the subscription survives a reboot or app update; Android
   9 permission behaviour; what `subscribe` and `readData` return when the user turns "Physical activity" off
   (likely `SecurityException` / `ApiException`).
2. HC on Android 14+: does `getFeatureStatus` / SDK ext 20 hold on Samsung (One UI) as well as Pixel? Where does a new
   writer land in the priority list? (Undocumented [S6][S9].)
3. iOS: how long iPhone steps take to reach HealthKit compared with CMPedometer live counts; whether the
   `beginBackgroundTask` window (kingstinct) is long enough for `syncStepsInBackground()` (a GET + POST) on a cold
   background launch.
4. Whether `READ_HEALTH_DATA_IN_BACKGROUND` is needed for the Expo background task when it runs in a fresh process,
   versus the app being cached. Treat it as always needed.

---

## Sources

- [S1] Recording API on mobile (guide): https://developer.android.com/health-and-fitness/guides/recording-api
- [S2] LocalRecordingClient reference (constants 250500000 / 241500000, subscribe, unsubscribe, readData): https://developers.google.com/android/reference/com/google/android/gms/fitness/LocalRecordingClient
- [S2a] LocalDataReadRequest.Builder reference: https://developers.google.com/android/reference/com/google/android/gms/fitness/request/LocalDataReadRequest.Builder
- [S2b] LocalValue reference (`asInt`): https://developers.google.com/android/reference/com/google/android/gms/fitness/data/LocalValue
- [S3] Google Maven metadata, play-services-fitness (latest 21.3.0): https://dl.google.com/android/maven2/com/google/android/gms/play-services-fitness/maven-metadata.xml
- [S3a] Official sample, Recording API on mobile (ViewModel: subscribe, aggregate/read, `LocalField.FIELD_STEPS`): https://github.com/android/health-samples/tree/main/recording-api-on-mobile/RecordingApiOnMobileSample
- [S4] Google Play services release notes (play-services-fitness 21.3.0, 2025-08-05; base minSdk changes): https://developers.google.com/android/guides/releases
- [S5] Health Connect, Track steps (on-device steps, SDK ext 20/22, SPN, read and write examples, Recording API advice for Android ≤ 13): https://developer.android.com/health-and-fitness/health-connect/features/steps
- [S6] Health Connect, Read aggregated data (priority de-duplication, `dataOriginFilter`, 30-day limit): https://developer.android.com/health-and-fitness/health-connect/aggregate-data
- [S7] Health Connect, Write data (mandatory metadata, `clientRecordId` upserts, zone offsets, cadence, first-party data rules): https://developer.android.com/health-and-fitness/health-connect/write-data
- [S8] Health Connect, Read raw data (background reads, `READ_HEALTH_DATA_IN_BACKGROUND`, history, "use aggregate() … to avoid double counting"): https://developer.android.com/health-and-fitness/health-connect/read-data
- [S8a] HealthConnectFeatures reference: https://developer.android.com/reference/kotlin/androidx/health/connect/client/HealthConnectFeatures and https://developer.android.com/health-and-fitness/health-connect/features/availability
- [S8b] Jetpack Health Connect releases (1.1.0 stable 2025-10-08; Metadata factories alpha12; background/history permissions): https://developer.android.com/jetpack/androidx/releases/health-connect
- [S9] Google Help, Track your steps with Health Connect (Android 14+, starts on read-steps grant, phone lowest priority): https://support.google.com/android/answer/16786157 ; Manage your Health Connect data (priority list): https://support.google.com/android/answer/12990553
- [S10] AggregationResult reference (`dataOrigins`): https://developer.android.com/reference/kotlin/androidx/health/connect/client/aggregate/AggregationResult
- [S11] Health Connect publish / Fit deprecation banner ("Google Fit APIs will be supported until the end of 2026"): https://developer.android.com/health-and-fitness/health-connect/publish
- [S12] Google Fit Android authorization (ACTIVITY_RECOGNITION, GMS permission on API ≤ 28; legacy Fit API, used only as a hint): https://developers.google.com/fit/android/authorization
- [S13] Apple, `enableBackgroundDelivery(for:frequency:withCompletion:)` (entitlement, hourly stepCount maximum, observer setup, completion handler, Simulator): https://developer.apple.com/documentation/healthkit/hkhealthstore/enablebackgrounddelivery(for:frequency:withcompletion:) ; HKObserverQuery: https://developer.apple.com/documentation/healthkit/hkobserverquery
- [S14] Apple, CMPedometer (NSMotionUsageDescription) and `queryPedometerData(from:to:withHandler:)` (7 days): https://developer.apple.com/documentation/coremotion/cmpedometer ; https://developer.apple.com/documentation/coremotion/cmpedometer/querypedometerdata(from:to:withhandler:)
- [S15] Apple, HKStatistics ("automatically merge the data from all of your data sources"; `separateBySource`): https://developer.apple.com/documentation/healthkit/hkstatistics ; HKStatisticsOptions: https://developer.apple.com/documentation/healthkit/hkstatisticsoptions
- [S16] Apple, `stepCount` ("The system automatically records samples on iPhone and Apple Watch"): https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier/stepcount
- [S17] Apple, Protecting user privacy (read-denial invisible, encryption while locked, Share/Update usage keys, HealthKit rules): https://developer.apple.com/documentation/healthkit/protecting-user-privacy ; Authorizing access to health data: https://developer.apple.com/documentation/healthkit/authorizing-access-to-health-data
- [S18] Apple Support, Manage Health data (default priority; new sources listed at the top): https://support.apple.com/en-us/108779
- [S19] App Store Review Guidelines 2.5.1, 5.1.1, 5.1.3: https://developer.apple.com/app-store/review/guidelines/
- [S20] Play Console Help, Health apps declaration form: https://support.google.com/googleplay/android-developer/answer/14738291
- [S21] Android Developers, Publish your health app (declaration steps, per-type explanations, checklist): https://developer.android.com/health-and-fitness/health-connect/publish
- [S22] Play Console Help, Health Connect permissions / health data policy: https://support.google.com/googleplay/android-developer/answer/12991134
- [S23] Play Console Help, Permissions and APIs that Access Sensitive Information (Health Connect section): https://support.google.com/googleplay/android-developer/answer/16558241 and https://support.google.com/googleplay/android-developer/answer/9888170
- [S24] Play Console Help, Data safety form (Fitness info, collection vs sharing): https://support.google.com/googleplay/android-developer/answer/10787469
- [S25] Apple, App privacy details (Health, Fitness; "collect"; on-device processing): https://developer.apple.com/app-store/app-privacy-details/
- [S26] Library sources read locally: `node_modules/@kingstinct/react-native-healthkit` 16.2.0 (app.plugin.ts, src/specs/CoreModule.nitro.ts, ios/CoreModule.swift), `node_modules/@react-native-healthkit/core` 16.2.0 (src/plugin/index.ts, ios/BackgroundDeliveryManager.swift), `node_modules/react-native-health-connect` 4.1.3 (src/index.tsx, src/types/*, android/.../HealthConnectUtils.kt, ReactStepsRecord.kt, PermissionUtils.kt); npm latest checked 2026-10-27 (RNHC 4.1.3, kingstinct 16.2.0).
- Non-official context (not relied on): Samsung developer forum on Samsung Health writing steps to HC: https://forum.developer.samsung.com/t/samsung-health-not-writing-steps-to-health-connect/23284
