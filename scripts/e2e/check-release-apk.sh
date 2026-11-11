#!/usr/bin/env bash
# Safety checks for the LOCAL-ONLY release-type test build (docs/notes/D1-wrap-up.md W11) before `adb install`.
# Usage (Git Bash): bash scripts/e2e/check-release-apk.sh [path/to/app-release.apk] [host:port]
#   host:port = the local server the build must use (default 10.0.2.2:3100, the emulator's host; a real phone over USB
#   uses 127.0.0.1:3100 through `adb reverse tcp:3100 tcp:3100`).
# Prints SAFE only when all hold:
#   1. the manifest's <application> uses networkSecurityConfig → xml/d1_test_network_security;
#   2. that resource allows cleartext only for the host (127.0.0.1 → "127.0.0.1" then "localhost", nothing else; no
#      subdomains) and pins vercel.app (+ subdomains) to the bogus all-A pin; no base-config;
#   3. assets/index.android.bundle contains "http://host:port" as the inlined API URL — an occurrence right after
#      "EXPO_PUBLIC_API_URL=" doesn't count: that is the dev-only config-error help text (src/app/_layout.tsx), which every
#      bundle carries for 10.0.2.2:3100;
#   4. the APK is NOT debuggable.
# A release build references resources by id and stores them under shortened paths (res/Xy.xml): both are resolved.
set -u
APK="E:/aylo/orza-mobile-build/android/app/build/outputs/apk/release/app-release.apk"
ORIGIN="10.0.2.2:3100"
for a in "$@"; do
  case "$a" in
    *.apk) APK="$a" ;;
    *) ORIGIN="${a#http://}" ;;
  esac
done
HOST="${ORIGIN%%:*}"
if [ "$HOST" = "127.0.0.1" ] || [ "$HOST" = "localhost" ]; then CLEAR_DOMS="127.0.0.1,localhost"; else CLEAR_DOMS="$HOST"; fi
EXPECT_NSC="[$CLEAR_DOMS cleartext=true no-pin][vercel.app+sub cleartext=false bogus-pin]"
echo "expected origin: http://$ORIGIN"
SDK="${ANDROID_HOME:-$LOCALAPPDATA/Android/Sdk}"
AAPT2="$(ls "$SDK"/build-tools/*/aapt2.exe 2>/dev/null | tail -1)"
[ -f "$APK" ] || { echo "STOP: no APK at $APK"; exit 1; }
[ -x "$AAPT2" ] || { echo "STOP: aapt2 not found"; exit 1; }
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
fail=0

"$AAPT2" dump xmltree --file AndroidManifest.xml "$APK" > "$tmp/manifest.txt"
# The <application> element's own attributes (up to its first child element).
awk '/E: application/{f=1; next} f && /E: /{exit} f' "$tmp/manifest.txt" > "$tmp/app.txt"
"$AAPT2" dump resources "$APK" > "$tmp/res.txt"

nid="$(grep -oE 'networkSecurityConfig\(0x01010527\)=@0x[0-9a-f]+' "$tmp/app.txt" | grep -oE '0x[0-9a-f]+$')"
nname="" nfile=""
if [ -n "$nid" ]; then
  nname="$(grep -E "^ *resource $nid " "$tmp/res.txt" | awk '{print $3}')"
  nfile="$(grep -A1 -E "^ *resource $nid " "$tmp/res.txt" | grep -oE 'res/[^ ]+\.xml' | head -1)"
fi
if [ "$nname" = "xml/d1_test_network_security" ] && [ -n "$nfile" ]; then
  echo "ok 1: networkSecurityConfig → $nid = $nname ($nfile)"
else
  echo "FAIL 1: networkSecurityConfig is '${nid:-none}' = '${nname:-?}', not xml/d1_test_network_security"; fail=1
fi

if grep 'debuggable' "$tmp/app.txt" | grep -qE '=true|0xffffffff|"true"'; then
  echo "FAIL 4: <application> is android:debuggable"; fail=1
else
  echo "ok 4: not debuggable"
fi

if [ -n "$nfile" ] && "$AAPT2" dump xmltree --file "$nfile" "$APK" > "$tmp/nsc.txt" 2>&1; then
  # Per domain-config: its cleartext flag, its domains (in file order, comma-separated, "+sub" = includeSubdomains),
  # whether it has the bogus pin. aapt2 prints texts as T: '…' (or T: "…"); only a <domain>'s own text is a domain.
  summary="$(awk '
    /E: domain-config/ { n++; clear[n] = "false"; pin[n] = "no-pin"; indom = 0; next }
    /E: domain \(/ { indom = 1; sd = ""; next }
    /E: / { indom = 0 }
    /cleartextTrafficPermitted/ && /=true/ { clear[n] = "true" }
    indom && /includeSubdomains/ { sd = (/=true/) ? "+sub" : "" }
    indom && /T: / { t = $0; sub(/.*T: ./, "", t); sub(/.$/, "", t); if (t != "") dom[n] = dom[n] (dom[n] == "" ? "" : ",") t sd }
    /AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=/ { pin[n] = "bogus-pin" }
    END { for (i = 1; i <= n; i++) printf "[%s cleartext=%s %s]", dom[i], clear[i], pin[i] }
  ' "$tmp/nsc.txt")"
  base_clear="$(grep -c 'E: base-config' "$tmp/nsc.txt")"
  if [ "$summary" = "$EXPECT_NSC" ] && [ "$base_clear" = "0" ]; then
    echo "ok 2: $summary"
  else
    echo "FAIL 2: network security config is: $summary (base-config cleartext: $base_clear)"; fail=1
  fi
else
  echo "FAIL 2: couldn't read the network security config"; fail=1
fi

ORIGIN_RE="$(printf '%s' "$ORIGIN" | sed 's/[.]/\\./g')"
if unzip -p "$APK" assets/index.android.bundle > "$tmp/bundle" 2>/dev/null; then
  inlined="$(LC_ALL=C grep -aoE ".{0,20}http://$ORIGIN_RE" "$tmp/bundle" | LC_ALL=C grep -vcF "EXPO_PUBLIC_API_URL=http://")"
else
  inlined=0
fi
if [ "${inlined:-0}" -gt 0 ]; then
  echo "ok 3: bundle contains http://$ORIGIN (inlined API URL)"
else
  echo "FAIL 3: bundle lacks http://$ORIGIN as the API URL"; fail=1
fi

if [ $fail = 0 ]; then echo SAFE; else echo STOP; exit 1; fi
