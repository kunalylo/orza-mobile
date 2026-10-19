#!/usr/bin/env node
/**
 * Draws the sample medicine photo the "Test alarm" shows when the member has no medicine photo yet (no dependencies —
 * plain Node: signed-distance shapes, anti-aliased, written as a PNG with node:zlib).
 *
 *   node scripts/make-alarm-sample.mjs
 *
 * Output: assets/images/alarm-sample.png — 800×600 (4:3, the alarm screen's photo frame): a blister strip of
 * coral / amber capsules (one already popped) on ÖRZA's cream canvas, with a coral label band.
 */
import { Buffer } from 'node:buffer';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const W = 800;
const H = 600;

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mixColor = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smooth = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

/** Signed distance to a rounded rectangle centred at (cx, cy) with half sizes (hw, hh) and corner radius r. */
function sdRoundRect(x, y, cx, cy, hw, hh, r) {
  const qx = Math.abs(x - cx) - (hw - r);
  const qy = Math.abs(y - cy) - (hh - r);
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r;
}

/** Signed distance to a horizontal capsule from (ax, y0) to (bx, y0) with radius r. */
function sdCapsule(x, y, ax, bx, y0, r) {
  const px = Math.max(ax, Math.min(bx, x));
  return Math.hypot(x - px, y - y0) - r;
}

const coverage = (d) => clamp01(0.5 - d); // 1 px anti-aliasing

const CREAM = hex('#FBF7F1');
const CREAM_DEEP = hex('#F1E4D4');
const FOIL_LIGHT = hex('#EEF1F5');
const FOIL_DARK = hex('#C3CBD5');
const FOIL_EDGE = hex('#9FA9B6');
const BUBBLE = hex('#F7F9FB');
const CORAL = hex('#FF7A6A');
const AMBER = hex('#FFB454');
const PINK = hex('#FF5FA2');
const WHITE = [255, 255, 255];
const INK = hex('#2A2522');

// Strip geometry
const S = { cx: 400, cy: 286, hw: 300, hh: 196, r: 34 };
const COLS = 4;
const ROWS = 2;
const PILL = { half: 30, r: 25 };
const cells = [];
for (let row = 0; row < ROWS; row++) {
  for (let col = 0; col < COLS; col++) {
    cells.push({ x: S.cx - S.hw + 92 + col * 139, y: S.cy - 92 + row * 132, popped: row === 0 && col === 3 });
  }
}
const BAND = { cx: 400, cy: S.cy + S.hh - 34, hw: S.hw - 22, hh: 18, r: 12 };

const px = Buffer.alloc((W * 3 + 1) * H);
for (let y = 0; y < H; y++) {
  px[y * (W * 3 + 1)] = 0; // filter: none
  for (let x = 0; x < W; x++) {
    const sx = x + 0.5;
    const sy = y + 0.5;
    // Canvas: soft vertical cream gradient with a warm glow top-right.
    let c = mixColor(CREAM, CREAM_DEEP, sy / H);
    const glow = Math.exp(-((sx - 660) ** 2 + (sy - 70) ** 2) / (2 * 190 ** 2));
    c = mixColor(c, mixColor(AMBER, PINK, 0.3), glow * 0.16);

    // Drop shadow of the strip.
    const ds = sdRoundRect(sx, sy, S.cx + 6, S.cy + 16, S.hw, S.hh, S.r);
    c = mixColor(c, INK, (1 - smooth(-6, 30, ds)) * 0.16);

    // Foil strip.
    const dStrip = sdRoundRect(sx, sy, S.cx, S.cy, S.hw, S.hh, S.r);
    const aStrip = coverage(dStrip);
    if (aStrip > 0) {
      const sheen = 0.5 + 0.5 * Math.sin((sx * 0.9 + sy * 1.4) / 95);
      let foil = mixColor(FOIL_DARK, FOIL_LIGHT, clamp01(0.35 + 0.5 * sheen - (sy - (S.cy - S.hh)) / (4 * S.hh)));
      // Edge line.
      foil = mixColor(foil, FOIL_EDGE, coverage(Math.abs(dStrip + 1.5) - 1.2));
      // Perforation between the columns.
      for (let col = 1; col < COLS; col++) {
        const lx = S.cx - S.hw + 92 + col * 139 - 69.5;
        if (Math.abs(sx - lx) < 1.2 && Math.floor(sy / 9) % 2 === 0 && sy < BAND.cy - BAND.hh - 8) foil = mixColor(foil, FOIL_EDGE, 0.55);
      }
      c = mixColor(c, foil, aStrip);
    }

    // Pills in their bubbles.
    for (const cell of cells) {
      const dBubble = sdCapsule(sx, sy, cell.x - PILL.half, cell.x + PILL.half, cell.y, PILL.r + 11);
      if (dBubble > 2) continue;
      // Bubble (raised clear plastic): light fill + a darker rim.
      const rim = coverage(Math.abs(dBubble + 1) - 1.4);
      let bubble = mixColor(BUBBLE, FOIL_LIGHT, clamp01((sy - cell.y + 30) / 70));
      c = mixColor(c, bubble, coverage(dBubble) * 0.92);
      c = mixColor(c, FOIL_EDGE, rim * 0.7);
      if (cell.popped) {
        // Popped: torn foil hole.
        const dHole = sdCapsule(sx, sy, cell.x - PILL.half + 6, cell.x + PILL.half - 6, cell.y, PILL.r - 2);
        c = mixColor(c, mixColor(FOIL_DARK, INK, 0.25), coverage(dHole) * 0.85);
        continue;
      }
      // Pill shadow, then the two-tone capsule.
      const dShadow = sdCapsule(sx, sy, cell.x - PILL.half + 3, cell.x + PILL.half + 3, cell.y + 7, PILL.r);
      c = mixColor(c, INK, (1 - smooth(-4, 10, dShadow)) * 0.18);
      const dPill = sdCapsule(sx, sy, cell.x - PILL.half, cell.x + PILL.half, cell.y, PILL.r);
      const aPill = coverage(dPill);
      if (aPill > 0) {
        const left = sx < cell.x;
        const shade = clamp01((sy - (cell.y - PILL.r)) / (2 * PILL.r));
        let pill = left ? mixColor(CORAL, mixColor(CORAL, PINK, 0.35), shade) : mixColor(AMBER, mixColor(AMBER, CORAL, 0.35), shade);
        // Seam.
        pill = mixColor(pill, INK, coverage(Math.abs(sx - cell.x) - 0.9) * 0.18);
        // Highlight streak.
        const dHi = sdCapsule(sx, sy, cell.x - PILL.half + 6, cell.x + PILL.half - 10, cell.y - PILL.r * 0.45, 5.5);
        pill = mixColor(pill, WHITE, (1 - smooth(-3, 4, dHi)) * 0.55);
        c = mixColor(c, pill, aPill);
      }
    }

    // Label band with "text" bars.
    const dBand = sdRoundRect(sx, sy, BAND.cx, BAND.cy, BAND.hw, BAND.hh, BAND.r);
    const aBand = coverage(dBand);
    if (aBand > 0) {
      let band = mixColor(CORAL, PINK, clamp01((sx - (BAND.cx - BAND.hw)) / (2 * BAND.hw)) * 0.45);
      const bars = [
        [BAND.cx - BAND.hw + 34, 92],
        [BAND.cx - BAND.hw + 146, 54],
        [BAND.cx + BAND.hw - 120, 86],
      ];
      for (const [x0, len] of bars) {
        const dBar = sdCapsule(sx, sy, x0, x0 + len, BAND.cy, 4);
        band = mixColor(band, WHITE, coverage(dBar) * 0.9);
      }
      c = mixColor(c, band, aBand);
    }

    const o = y * (W * 3 + 1) + 1 + x * 3;
    px[o] = Math.round(c[0]);
    px[o + 1] = Math.round(c[1]);
    px[o + 2] = Math.round(c[2]);
  }
}

/* ── PNG ── */
const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 2; // RGB
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(px, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'assets', 'images', 'alarm-sample.png');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, png);
console.log(`Wrote ${out} (${(png.length / 1024).toFixed(0)} KB, ${W}×${H})`);
