#!/usr/bin/env bash
# Emulator helpers for end-to-end testing (Git Bash on Windows). Source it:  . scripts/e2e/adb.sh
#   shot <name>        screenshot → $E2E_OUT/<name>.png (read the PNG to see the screen)
#   ui                 visible texts / accessibility labels with their tap centres (from uiautomator)
#   tap <x> <y>        tap (device pixels, 1080x2400)
#   tapl "<label>"     tap the first element whose text or content-desc contains <label>
#   type "<text>"      type text into the focused field (spaces handled)
#   key <code>         keyevent (4=back, 66=enter, 111=escape/hide keyboard, 26=power)
#   wait_text "<t>" [s] wait until <t> appears on screen (default 20 s)
#   app_start          (re)open the app on the local Metro;  app_logs  recent JS logs
A="${A:-$LOCALAPPDATA/Android/Sdk/platform-tools/adb.exe}"
E2E_OUT="${E2E_OUT:-${TMPDIR:-/tmp}/orza-e2e}"
mkdir -p "$E2E_OUT"
export MSYS_NO_PATHCONV=1

shot() { "$A" exec-out screencap -p > "$E2E_OUT/$1.png" && echo "$E2E_OUT/$1.png"; }
# Removes the previous dump first: when uiautomator cannot get an idle screen (endless animations) it writes nothing,
# and a stale file would show the previous screen.
_dump() { "$A" shell rm -f /sdcard/ui.xml; "$A" shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; "$A" shell cat /sdcard/ui.xml 2>/dev/null; }
ui() {
  _dump | tr '>' '\n' | grep -oE '(text|content-desc)="[^"]+"[^/]*bounds="\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]"' |
    sed -E 's/^(text|content-desc)="([^"]+)".*bounds="\[([0-9]+),([0-9]+)\]\[([0-9]+),([0-9]+)\]"/\2|\3 \4 \5 \6/' |
    awk -F'|' '{ split($2,b," "); printf "%s  @ %d,%d\n", $1, (b[1]+b[3])/2, (b[2]+b[4])/2 }'
}
tap() { "$A" shell input tap "$1" "$2"; }
tapl() {
  local line; line=$(ui | grep -F -- "$1" | head -1)
  [ -z "$line" ] && { echo "tapl: '$1' not on screen" >&2; return 1; }
  local xy=${line##*@ }; tap "${xy%,*}" "${xy#*,}"; echo "tapped: $line"
}
type() { "$A" shell input text "$(printf '%s' "$1" | sed -e 's/ /%s/g' -e "s/'/\\\\'/g")"; }
key() { "$A" shell input keyevent "$1"; }
wait_text() {
  local t="$1" s="${2:-20}" i=0
  while [ $i -lt "$s" ]; do _dump | grep -qF -- "$t" && return 0; sleep 1; i=$((i+1)); done
  echo "wait_text: '$t' not seen in ${s}s" >&2; return 1
}
# Metro through `adb reverse` (localhost:8081): loading the bundle over 10.0.2.2:8081 can fail with a chunked-encoding
# ProtocolException (blank screen). The API still goes to 10.0.2.2:3100 (run the safety gate first).
app_start() {
  "$A" reverse tcp:8081 tcp:8081 >/dev/null
  "$A" shell am force-stop in.co.ylo.orza
  # A slow emulator can take seconds to reap the old process; starting before that cancels the launch
  # ("refused to die while trying to launch … cancelling the process start") and leaves the home screen.
  local i=0; while [ $i -lt 20 ] && "$A" shell pidof in.co.ylo.orza >/dev/null 2>&1; do sleep 1; i=$((i+1)); done
  sleep 3 # the system notices the death a little after the pid disappears
  "$A" shell am start -a android.intent.action.VIEW -d "exp+orza://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081" in.co.ylo.orza >/dev/null
}
app_logs() { "$A" logcat -d -s ReactNativeJS:V | tail -"${1:-40}"; }
# PC-side paths must be Windows paths for adb.exe (MSYS path conversion is off for the device-side /sdcard paths).
APK="${APK:-E:/aylo/orza-mobile-build/android/app/build/outputs/apk/debug/app-debug.apk}"
apk_install() { "$A" install -r "$(cygpath -w "${1:-$APK}")" | tail -1; }
push_file() { "$A" push "$(cygpath -w "$1")" "$2" >/dev/null && "$A" shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d "file://$2" >/dev/null && echo "pushed $2"; }
