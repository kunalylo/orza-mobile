// Frames raw iPhone screenshots for the App Store (docs/store/listing.md §4): cream canvas, a Playfair Display caption at
// the top, the screenshot below with rounded corners and a soft shadow. Makes both required iPhone sets.
// Usage: node scripts/store/frame-shots.mjs <inDir> <outDir>   (shots listed in SHOTS below, in store order)
// sharp comes from the web worktree's node_modules (the phone app doesn't depend on it).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const sharp = createRequire('E:/aylo/orza-backend/package.json')('sharp');
const [inDir = 'E:/aylo/store-shots', outDir = 'E:/aylo/store-shots/framed'] = process.argv.slice(2);
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
const CANVAS = '#FBF7F1';
const INK = '#1F1A17';

async function frame(shot, size) {
  const k = size.w / 1290;
  const shotW = Math.round(1010 * k);
  const src = await sharp(path.join(inDir, shot.file)).rotate().toBuffer();
  const meta = await sharp(src).metadata();
  const shotH = Math.round((shotW * meta.height) / meta.width);
  const radius = Math.round(64 * k);
  const mask = Buffer.from(`<svg width="${shotW}" height="${shotH}"><rect width="${shotW}" height="${shotH}" rx="${radius}" ry="${radius}"/></svg>`);
  const rounded = await sharp(src).resize(shotW, shotH).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();

  const caption = await sharp({
    text: {
      text: `<span foreground="${INK}">${shot.caption.replace(/&/g, '&amp;').replace(/\n/g, '\n')}</span>`,
      font: `Playfair Display SemiBold ${Math.round(46 * k)}`,
      fontfile: FONT,
      width: Math.round(1100 * k),
      align: 'center',
      dpi: 150,
      rgba: true,
      spacing: Math.round(6 * k),
    },
  }).png().toBuffer();
  const capMeta = await sharp(caption).metadata();

  const top = size.h - shotH - Math.round(90 * k);
  const capTop = Math.max(Math.round(110 * k), Math.round((top - capMeta.height) / 2));
  const left = Math.round((size.w - shotW) / 2);
  const shadow = await sharp(
    Buffer.from(`<svg width="${size.w}" height="${size.h}"><rect x="${left}" y="${top + Math.round(18 * k)}" width="${shotW}" height="${shotH}" rx="${radius}" fill="rgba(70,40,20,0.22)"/></svg>`),
  ).blur(Math.round(28 * k)).png().toBuffer();

  const out = path.join(outDir, size.dir, `${shot.name}.png`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const composed = await sharp({ create: { width: size.w, height: size.h, channels: 3, background: CANVAS } })
    .composite([
      { input: shadow, left: 0, top: 0 },
      { input: rounded, left, top },
      { input: caption, left: Math.round((size.w - capMeta.width) / 2), top: capTop },
    ])
    .png()
    .toBuffer();
  // A second pass: composite runs last in a pipeline, so the alpha it adds has to come off afterwards (Apple refuses it).
  await sharp(composed).flatten({ background: CANVAS }).removeAlpha().png().toFile(out);
  return out;
}

for (const size of SIZES) for (const shot of SHOTS) console.log(await frame(shot, size));
