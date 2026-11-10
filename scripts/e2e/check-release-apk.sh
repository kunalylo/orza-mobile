#!/usr/bin/env bash
# Safety checks for the LOCAL-ONLY release-type test build (docs/notes/D1-wrap-up.md W11) before `adb install`.
# Usage (Git Bash): bash scripts/e2e/check-release-apk.sh [path/to/app-release.apk]
# Prints SAFE only when all hold:
#   1. the manifest's <application> uses networkSecurityConfig → xml/d1_test_network_security;
#   2. that resource allows cleartext only for 10.0.2.2 and pins vercel.app (+ subdomains) to the bogus all-A pin;
#   3. assets/index.android.bundle contains "10.0.2.2:3100";
#   4. the APK is NOT debuggable.
# A release build references resources by id and stores them under shortened paths (res/Xy.xml): both are resolved.
set -u
APK="${1:-E:/aylo/orza-mobile-build/android/app/build/outputs/apk/release/app-release.apk}"
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
  # Per domain-config: its cleartext flag, its domains, whether it has the bogus pin.
  # aapt2 prints texts as T: '…' (or T: "…").
  summary="$(awk '
    /E: domain-config/ { n++; clear[n] = "false"; pin[n] = "no-pin"; sd = "" }
    /cleartextTrafficPermitted/ && /=true/ { clear[n] = "true" }
    /E: domain \(/ { sd = "" }
    /includeSubdomains/ { sd = (/=true/) ? "+sub" : "" }
    /T: / && !/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=/ { t = $0; sub(/.*T: ./, "", t); sub(/.$/, "", t); dom[n] = dom[n] t sd }
    /AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=/ { pin[n] = "bogus-pin" }
    END { for (i = 1; i <= n; i++) printf "[%s cleartext=%s %s]", dom[i], clear[i], pin[i] }
  ' "$tmp/nsc.txt")"
  base_clear="$(grep -c 'E: base-config' "$tmp/nsc.txt")"
  if [ "$summary" = "[10.0.2.2 cleartext=true no-pin][vercel.app+sub cleartext=false bogus-pin]" ] && [ "$base_clear" = "0" ]; then
    echo "ok 2: $summary"
  else
    echo "FAIL 2: network security config is: $summary (base-config cleartext: $base_clear)"; fail=1
  fi
else
  echo "FAIL 2: couldn't read the network security config"; fail=1
fi

if unzip -p "$APK" assets/index.android.bundle > "$tmp/bundle" 2>/dev/null && grep -aq '10.0.2.2:3100' "$tmp/bundle"; then
  echo "ok 3: bundle contains 10.0.2.2:3100"
else
  echo "FAIL 3: bundle lacks 10.0.2.2:3100"; fail=1
fi

if [ $fail = 0 ]; then echo SAFE; else echo STOP; exit 1; fi
