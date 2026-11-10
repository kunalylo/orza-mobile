// TalkBack label audit of the emulator's current screen (uiautomator dump --compressed) — no app code involved.
// Usage: node scripts/e2e/a11y.mjs [name]   (Git Bash: MSYS_NO_PATHCONV=1)
//   Saves the dump as $E2E_OUT/ui-<name>.xml when a name is given, then prints:
//   - every clickable / checkable / focusable-with-action node and the label TalkBack would read
//     (its content-desc, else its text, else its descendants' texts), its state (checked / disabled) and size;
//   - PROBLEMS: actionable nodes with no label, touch targets under 48 dp, texts that end in "…" (cut) or say "Loading".
// Density comes from `wm density` (dp = px / (density / 160)).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const adb = path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk', 'platform-tools', 'adb.exe');
const sh = (...a) => execFileSync(adb, ['shell', ...a], { encoding: 'utf8' });
const name = process.argv[2];

sh('rm', '-f', '/sdcard/a11y.xml');
// --compressed: only the nodes important for accessibility — what TalkBack can reach (a backdrop hidden with
// importantForAccessibility="no-hide-descendants" still shows in a full dump).
sh('uiautomator', 'dump', '--compressed', '/sdcard/a11y.xml');
const xml = sh('cat', '/sdcard/a11y.xml');
if (name) {
  const out = process.env.E2E_OUT || path.join(process.env.TEMP || '.', 'orza-e2e');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, `ui-${name}.xml`), xml);
}
// `wm` prints the physical value and, under an override (wm density / wm size), an "Override …" line after it: the
// last value is the one in use.
const last = (out, re) => [...out.matchAll(re)].pop();
const density = Number((last(sh('wm', 'density'), /(\d+)\s*$/gm) || [])[1] || 420);
const dp = (px) => Math.round(px / (density / 160));
const [, sw, shh] = last(sh('wm', 'size'), /(\d+)x(\d+)\s*$/gm) || [0, 1080, 2400];

// A tiny XML walker for uiautomator's flat <node …> / </node> output.
const attrs = (s) => Object.fromEntries([...s.matchAll(/([\w-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
const unesc = (s) => s.replace(/&#10;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'");
const root = { children: [], a: {} };
const stack = [root];
for (const m of xml.matchAll(/<node\b([^>]*?)(\/?)>|<\/node>/g)) {
  if (m[0] === '</node>') {
    stack.pop();
    continue;
  }
  const n = { a: attrs(m[1]), children: [] };
  stack[stack.length - 1].children.push(n);
  if (!m[2]) stack.push(n);
}
const bounds = (n) => (n.a.bounds?.match(/\d+/g) || [0, 0, 0, 0]).map(Number);
// Private-use icon glyphs (vector icon fonts) are read as nothing useful.
const glyph = (t) => /^[\u{E000}-\u{F8FF}\u{F0000}-\u{FFFFD}\s]*$/u.test(t);
const own = (n) => {
  const d = unesc(n.a['content-desc'] || '').trim();
  const t = unesc(n.a.text || '').trim();
  return d && !glyph(d) ? d : t && !glyph(t) ? t : '';
};
const deep = (n) => [own(n), ...n.children.map(deep)].filter(Boolean).join(' ').trim();

const rows = [];
const problems = [];
const visit = (n) => {
  const a = n.a;
  const [x1, y1, x2, y2] = bounds(n);
  const visible = x2 > x1 && y2 > y1 && x1 < sw && y1 < shh;
  const actionable = a.clickable === 'true' || a.checkable === 'true' || a['long-clickable'] === 'true';
  if (actionable && visible && a.package !== 'com.android.systemui') {
    const label = own(n) || deep(n);
    const state = [a.checkable === 'true' ? (a.checked === 'true' ? 'checked' : 'not checked') : '', a.enabled === 'false' ? 'disabled' : '']
      .filter(Boolean)
      .join(', ');
    const w = dp(x2 - x1);
    const h = dp(y2 - y1);
    rows.push(`${label || '(NO LABEL)'}${state ? ` [${state}]` : ''}  ${w}x${h}dp @ ${Math.round((x1 + x2) / 2)},${Math.round((y1 + y2) / 2)}`);
    if (!label) problems.push(`no label: ${a.class} @ ${a.bounds}`);
    // Partly scrolled-off nodes are cut by the viewport, not small: only judge nodes fully on screen.
    const whole = y1 >= 0 && y2 <= Number(shh) && x1 >= 0 && x2 <= Number(sw);
    if (whole && (w < 48 || h < 48) && a.class !== 'android.widget.EditText') problems.push(`small target ${w}x${h}dp: "${label}" @ ${a.bounds}`);
  }
  const t = unesc(a.text || '');
  if (visible && t.endsWith('…')) problems.push(`text ends in …: "${t}"`);
  if (visible && /loading/i.test(a['content-desc'] || '')) problems.push(`content-desc says loading: "${unesc(a['content-desc'])}"`);
  n.children.forEach(visit);
};
visit(root);
console.log(rows.join('\n'));
console.log(problems.length ? `PROBLEMS (${problems.length}):\n  ${problems.join('\n  ')}` : 'PROBLEMS: none');
