#!/usr/bin/env node
/**
 * Generates ÖRZA's app icons + splash image as real PNGs (no dependencies — Node's zlib only).
 *
 *   node scripts/generate-icons.mjs
 *
 * The mark is the web app's orb (public/icons/icon-512.png in the web repo): a warm
 * amber → coral → pink sphere with a cream highlight, glowing on the dark hero colour #07090C,
 * circled by a faint cyan energy orbit with one violet satellite.
 *
 * Outputs (assets/images):
 *   icon.png                     1024² opaque — iOS + default icon (iOS rounds the corners itself)
 *   android-icon-foreground.png  1024² transparent — adaptive icon foreground (mark inside the 66/108 safe zone)
 *   android-icon-background.png  1024² opaque — adaptive icon background (dark + warm glow)
 *   android-icon-monochrome.png  1024² transparent — Android 13+ themed icon (alpha silhouette)
 *   splash-icon.png              1024² transparent — dark disc + orb, shown on the cream splash
 *   favicon.png                  48² — web
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "assets", "images");

/* ───────────────────────────── PNG encoding ───────────────────────────── */

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** rgba: Float32Array of straight (non-premultiplied) 0..1 RGBA. */
function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 4 + 1);
    raw[row] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const o = row + 1 + x * 4;
      for (let c = 0; c < 4; c++) raw[o + c] = Math.max(0, Math.min(255, Math.round(rgba[i + c] * 255)));
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ───────────────────────────── Colour helpers ───────────────────────────── */

const hex = (h) => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
const HERO = hex("#07090C");
const HERO_2 = hex("#0B0F14");
const AMBER = hex("#FFB454");
const CORAL = hex("#FF7A6A");
const PINK = hex("#FF5FA2");
const CREAM = hex("#FFE7C8");
const CYAN = hex("#2FD2F0");
const VIOLET = hex("#BFA8FF");
const WHITE = [1, 1, 1];

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const smooth = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

/** Premultiplied "over": paints colour `c` with alpha `a` onto the accumulator `p` ([r,g,b,a] premultiplied). */
function over(p, c, a) {
  if (a <= 0) return;
  p[0] = c[0] * a + p[0] * (1 - a);
  p[1] = c[1] * a + p[1] * (1 - a);
  p[2] = c[2] * a + p[2] * (1 - a);
  p[3] = a + p[3] * (1 - a);
}

/* ───────────────────────────── The mark ───────────────────────────── */

/** Warm sphere colour at offset (dx, dy) from its centre, radius R (all in px). */
function orbColour(dx, dy, R) {
  // 135° energy gradient: amber top-left → coral → pink bottom-right.
  const t = clamp01(((dx + dy) / (2 * R)) * 0.62 + 0.5);
  let c = t < 0.55 ? mix(AMBER, CORAL, t / 0.55) : mix(CORAL, PINK, (t - 0.55) / 0.45);
  // Cream highlight up and to the left (like light catching a sphere).
  const hx = dx + 0.36 * R;
  const hy = dy + 0.4 * R;
  const h = Math.pow(1 - smooth(0, 0.95 * R, Math.hypot(hx, hy)), 1.6);
  c = mix(c, CREAM, 0.82 * h);
  // A touch of depth on the lower-right rim.
  const rim = smooth(0.72 * R, R, Math.hypot(dx, dy)) * clamp01((dx + dy) / (1.4 * R) + 0.3);
  return mix(c, mix(c, PINK, 0.5), 0.35 * rim);
}

/**
 * Paints the mark centred at (cx, cy) with orb radius R onto accumulator p for sample point (x, y).
 * opts: { halo, ring, satellite, ringR, ringW, mono }
 */
function paintMark(p, x, y, cx, cy, R, opts) {
  const dx = x - cx;
  const dy = y - cy;
  const d = Math.hypot(dx, dy);

  if (opts.halo) {
    // Coral glow fading out to ~2.7R, amber warmth closer in.
    over(p, CORAL, 0.26 * (1 - smooth(R * 0.85, R * 2.7, d)));
    over(p, AMBER, 0.15 * (1 - smooth(R * 0.95, R * 1.75, d)));
  }

  if (opts.ring) {
    const ringR = opts.ringR;
    const w = opts.ringW;
    const band = 1 - smooth(w * 0.5 - 0.5, w * 0.5 + 0.5, Math.abs(d - ringR));
    if (band > 0) {
      // Dashed orbit: 56 dashes, 60% on.
      const ang = Math.atan2(dy, dx);
      const phase = (((ang / (2 * Math.PI)) * 56) % 1 + 1) % 1;
      const dash = opts.mono ? 1 : phase < 0.6 ? 1 : 0.25;
      over(p, opts.mono ? WHITE : CYAN, (opts.mono ? 1 : 0.34) * band * dash);
    }
  }

  if (opts.satellite) {
    const a = (-38 * Math.PI) / 180;
    const sx = cx + Math.cos(a) * opts.ringR;
    const sy = cy + Math.sin(a) * opts.ringR;
    const sd = Math.hypot(x - sx, y - sy);
    const sr = opts.satR;
    if (!opts.mono) over(p, VIOLET, 0.35 * (1 - smooth(sr, sr * 3.2, sd)));
    over(p, opts.mono ? WHITE : VIOLET, 1 - smooth(sr - 0.75, sr + 0.75, sd));
  }

  // The orb (anti-aliased by supersampling + a 1px soft edge).
  const cover = 1 - smooth(R - 0.9, R + 0.9, d);
  if (cover > 0) over(p, opts.mono ? WHITE : orbColour(dx, dy, R), cover);
}

/* ───────────────────────────── Renderer ───────────────────────────── */

function render(size, paint, ss = 3) {
  const out = new Float32Array(size * size * 4);
  const p = [0, 0, 0, 0];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          p[0] = p[1] = p[2] = p[3] = 0;
          paint(p, x + (sx + 0.5) / ss, y + (sy + 0.5) / ss);
          r += p[0];
          g += p[1];
          b += p[2];
          a += p[3];
        }
      }
      const n = ss * ss;
      const i = (y * size + x) * 4;
      a /= n;
      // Un-premultiply for PNG.
      out[i] = a > 0 ? r / n / a : 0;
      out[i + 1] = a > 0 ? g / n / a : 0;
      out[i + 2] = a > 0 ? b / n / a : 0;
      out[i + 3] = a;
    }
  }
  return out;
}

/** Dark hero background with a slight vertical deepening. */
function paintHero(p, x, y, size) {
  over(p, mix(HERO, HERO_2, y / size), 1);
}

function save(name, size, pixels) {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), encodePng(size, size, pixels));
  console.log(`  ✓ ${name} (${size}×${size})`);
}

/* ───────────────────────────── Assets ───────────────────────────── */

function iosIcon(size) {
  const c = size / 2;
  const R = size * 0.2;
  return render(size, (p, x, y) => {
    paintHero(p, x, y, size);
    paintMark(p, x, y, c, c, R, { halo: true, ring: true, ringR: size * 0.355, ringW: Math.max(1.5, size * 0.0042), satellite: true, satR: size * 0.012 });
  });
}

console.log("Generating ÖRZA icons →", OUT);

save("icon.png", 1024, iosIcon(1024));
save("favicon.png", 48, render(48, (p, x, y) => {
  paintHero(p, x, y, 48);
  paintMark(p, x, y, 24, 24, 48 * 0.24, { halo: true });
}, 4));

// Adaptive icon: 108dp canvas, launcher masks show the central ~72dp, the safe zone is a 66dp circle.
{
  const S = 1024;
  const c = S / 2;
  const R = S * 0.135;
  const ring = { ringR: S * 0.25, ringW: S * 0.0045, satR: S * 0.011 };
  save("android-icon-background.png", S, render(S, (p, x, y) => {
    paintHero(p, x, y, S);
    const d = Math.hypot(x - c, y - c);
    over(p, CORAL, 0.26 * (1 - smooth(R * 0.85, R * 2.7, d)));
    over(p, AMBER, 0.15 * (1 - smooth(R * 0.95, R * 1.75, d)));
  }, 1));
  save("android-icon-foreground.png", S, render(S, (p, x, y) => {
    paintMark(p, x, y, c, c, R, { ring: true, satellite: true, ...ring });
  }, 2));
  save("android-icon-monochrome.png", S, render(S, (p, x, y) => {
    paintMark(p, x, y, c, c, R, { ring: true, satellite: true, mono: true, ...ring, ringW: S * 0.008 });
  }, 2));
}

// Splash: the web icon's look — a dark disc holding the glowing orb — on the cream splash background.
{
  const S = 1024;
  const c = S / 2;
  const discR = S * 0.48;
  const R = S * 0.2;
  save("splash-icon.png", S, render(S, (p, x, y) => {
    const d = Math.hypot(x - c, y - c);
    const disc = 1 - smooth(discR - 1, discR + 1, d);
    if (disc <= 0) return;
    const q = [0, 0, 0, 0];
    paintHero(q, x, y, S);
    paintMark(q, x, y, c, c, R, { halo: true, ring: true, ringR: S * 0.34, ringW: S * 0.004, satellite: true, satR: S * 0.012 });
    // Clip the composed disc to its circle.
    p[0] = q[0] * disc;
    p[1] = q[1] * disc;
    p[2] = q[2] * disc;
    p[3] = q[3] * disc;
  }, 2));
}

console.log("Done.");
