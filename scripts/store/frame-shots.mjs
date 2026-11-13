// Frames raw store screenshots (docs/store/listing.md §4): cream canvas, a Playfair Display caption at the top, the
// screenshot below with rounded corners and a soft shadow. PNG without alpha.
// App Store (both required iPhone sets, shots listed in SHOTS below, in store order):
//   node scripts/store/frame-shots.mjs <inDir> <outDir>
// Google Play phone (1080 × 1920, 9:16; each raw shot, e.g. 1080 × 2400, is scaled to fit under its caption):
//   node scripts/store/frame-shots.mjs --play <spec.json> [outDir]
//   spec.json = { "inDir": "…", "outDir": "…", "size": { "w": 1080, "h": 1920 },
//                 "shots": [{ "file": "01-today-raw.png", "name": "01-today", "caption": "Your day at a glance" }, …] }
//   (inDir defaults to the spec's folder, outDir to E:/aylo/store-shots/play/phone, size to 1080 × 1920; a caption may
//   hold "\n" line breaks). Output: <outDir>/<name>.png.
//   The Play set: node scripts/store/frame-shots.mjs --play scripts/store/play-phone.json (raw captures, emulator
//   1080 × 2400, in E:/aylo/store-shots/play/raw).
// Run from the repo root (the caption font is read from node_modules).
// sharp comes from the web worktree's node_modules (the phone app doesn't depend on it).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const sharp = createRequire('E:/aylo/orza-backend/package.json')('sharp');
const FONT = path.resolve('node_modules/@expo-google-fonts/playfair-display/600SemiBold/PlayfairDisplay_600SemiBold.ttf');

// Captions use the app's own words (listing.md §4.3; Reports uses its screen title, since the shot is the daily view).
const SHOTS = [
  { file: 'IMG_1235.JPG', name: '01-today', caption: 'Your day at a glance' },
  { file: 'IMG_1237.JPG', name: '02-snap', caption: 'Snap your plate.\nKnow your meal.' },
  { file: 'IMG_1236.JPG', name: '03-ask', caption: 'Ask in English,\nHindi or Hinglish' },
  { file: 'IMG_1239.JPG', name: '04-reports', caption: 'Your wellness,\nin numbers' },
];
// Apple's two iPhone slots (Dynamic Island large and medium).
const SIZES = [
  { dir: 'appstore-large-1290x2796', w: 1290, h: 2796 },
  { dir: 'appstore-medium-1179x2556', w: 1179, h: 2556 },
];
// Google Play phone: a caption band of PLAY_BAND × (h / 1920) px on top; the shot fills the rest down to the bottom margin.
const PLAY_SIZE = { w: 1080, h: 1920 };
const PLAY_BAND = 372;
const CANVAS = '#FBF7F1';
const INK = '#1F1A17';

const captionImage = (text, k) =>
  sharp({
    text: {
      text: `<span foreground="${INK}">${text.replace(/&/g, '&amp;').replace(/\n/g, '\n')}</span>`,
      font: `Playfair Display SemiBold ${Math.round(46 * k)}`,
      fontfile: FONT,
      width: Math.round(1100 * k),
      align: 'center',
      dpi: 150,
      rgba: true,
      spacing: Math.round(6 * k),
    },
  }).png().toBuffer();

// App Store layout: the shot is 1010 px wide at 1290 (scaled with the canvas), the caption centred in the space above.
// Play layout (size.band set): the shot's height is fixed by the band and the bottom margin, its width follows its ratio.
async function frame(shot, size, inDir, out) {
  const k = size.w / 1290;
  const src = await sharp(path.join(inDir, shot.file)).rotate().toBuffer();
  const meta = await sharp(src).metadata();
  let shotW, shotH, radius;
  if (size.band) {
    shotH = size.h - size.band - Math.round(90 * k);
    shotW = Math.round((shotH * meta.width) / meta.height);
    radius = Math.round((64 * shotW) / 1010);
  } else {
    shotW = Math.round(1010 * k);
    shotH = Math.round((shotW * meta.height) / meta.width);
    radius = Math.round(64 * k);
  }
  const mask = Buffer.from(`<svg width="${shotW}" height="${shotH}"><rect width="${shotW}" height="${shotH}" rx="${radius}" ry="${radius}"/></svg>`);
  const rounded = await sharp(src).resize(shotW, shotH).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();

  const caption = await captionImage(shot.caption, k);
  const capMeta = await sharp(caption).metadata();

  const top = size.h - shotH - Math.round(90 * k);
  const capTop = size.band
    ? Math.max(Math.round(48 * k), Math.round((top - capMeta.height) / 2))
    : Math.max(Math.round(110 * k), Math.round((top - capMeta.height) / 2));
  if (size.band && capTop + capMeta.height > top - Math.round(24 * k)) {
    throw new Error(`${shot.name}: the caption doesn't fit above the shot — shorten it or break it into lines`);
  }
  const left = Math.round((size.w - shotW) / 2);
  const shadow = await sharp(
    Buffer.from(`<svg width="${size.w}" height="${size.h}"><rect x="${left}" y="${top + Math.round(18 * k)}" width="${shotW}" height="${shotH}" rx="${radius}" fill="rgba(70,40,20,0.22)"/></svg>`),
  ).blur(Math.round(28 * k)).png().toBuffer();

  fs.mkdirSync(path.dirname(out), { recursive: true });
  const composed = await sharp({ create: { width: size.w, height: size.h, channels: 3, background: CANVAS } })
    .composite([
      { input: shadow, left: 0, top: 0 },
      { input: rounded, left, top },
      { input: caption, left: Math.round((size.w - capMeta.width) / 2), top: capTop },
    ])
    .png()
    .toBuffer();
  // A second pass: composite runs last in a pipeline, so the alpha it adds has to come off afterwards (both stores
  // refuse it).
  await sharp(composed).flatten({ background: CANVAS }).removeAlpha().png().toFile(out);
  return out;
}

const args = process.argv.slice(2);
if (args[0] === '--play') {
  const specFile = args[1];
  if (!specFile) {
    console.error('usage: node scripts/store/frame-shots.mjs --play <spec.json> [outDir]');
    process.exit(2);
  }
  const spec = JSON.parse(fs.readFileSync(specFile, 'utf8'));
  const inDir = spec.inDir ?? path.dirname(path.resolve(specFile));
  const outDir = args[2] ?? spec.outDir ?? 'E:/aylo/store-shots/play/phone';
  const { w, h } = spec.size ?? PLAY_SIZE;
  const size = { w, h, band: Math.round((PLAY_BAND * h) / 1920) };
  for (const shot of spec.shots) console.log(await frame(shot, size, inDir, path.join(outDir, `${shot.name}.png`)));
} else {
  const [inDir = 'E:/aylo/store-shots', outDir = 'E:/aylo/store-shots/framed'] = args;
  for (const size of SIZES) {
    for (const shot of SHOTS) console.log(await frame(shot, size, inDir, path.join(outDir, size.dir, `${shot.name}.png`)));
  }
}
