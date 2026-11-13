// Google Play feature graphic (1024 × 500) and the 512 × 512 store icon (docs/store/listing.md §4.2, §4.4): the app's dark
// hero with its glowing orb, the ÖRZA wordmark and one line of text, all inside the middle 80%. No alpha.
// Usage: node scripts/store/feature-graphic.mjs [outDir]
// sharp comes from the web worktree's node_modules (the phone app doesn't depend on it).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const sharp = createRequire('E:/aylo/orza-backend/package.json')('sharp');
const outDir = process.argv[2] ?? 'E:/aylo/store-shots/play';
const FONTS = 'node_modules/@expo-google-fonts';
const PLAYFAIR = path.resolve(`${FONTS}/playfair-display/600SemiBold/PlayfairDisplay_600SemiBold.ttf`);
const FIGTREE = path.resolve(`${FONTS}/figtree/500Medium/Figtree_500Medium.ttf`);
const W = 1024;
const H = 500;
const BG = '#07090C';

fs.mkdirSync(outDir, { recursive: true });

// The orb: the app's gradient (#FFB454 → #FF7A6A → #FF5FA2) with a soft glow, right of centre.
const orb = Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#FF7A6A" stop-opacity="0.55"/>
      <stop offset="1" stop-color="#FF7A6A" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="ball" cx="0.36" cy="0.32" r="0.75">
      <stop offset="0" stop-color="#FFF4E6"/>
      <stop offset="0.18" stop-color="#FFB454"/>
      <stop offset="0.6" stop-color="#FF7A6A"/>
      <stop offset="1" stop-color="#FF5FA2"/>
    </radialGradient>
  </defs>
  <circle cx="760" cy="250" r="230" fill="url(#glow)"/>
  <circle cx="760" cy="250" r="112" fill="url(#ball)"/>
</svg>`);

const text = (markup, font, fontfile, width) =>
  sharp({ text: { text: markup, font, fontfile, width, rgba: true, dpi: 150 } }).png().toBuffer();
const wordmark = await text('<span foreground="#FBF7F1">ÖRZA</span>', 'Playfair Display SemiBold 56', PLAYFAIR, 420);
const line = await text(
  '<span foreground="#D9D2C8">Meals, medicines and a coach\nthat knows Indian food</span>',
  'Figtree Medium 14',
  FIGTREE,
  460
);
const lineMeta = await sharp(line).metadata();
const markMeta = await sharp(wordmark).metadata();
const blockH = markMeta.height + 18 + lineMeta.height;
const top = Math.round((H - blockH) / 2);

const composed = await sharp({ create: { width: W, height: H, channels: 3, background: BG } })
  .composite([
    { input: orb, left: 0, top: 0 },
    { input: wordmark, left: 120, top },
    { input: line, left: 124, top: top + markMeta.height + 18 },
  ])
  .png()
  .toBuffer();
await sharp(composed).flatten({ background: BG }).removeAlpha().png().toFile(path.join(outDir, 'feature-graphic-1024x500.png'));

// The store icon: the app icon scaled down, flattened on its own background colour (Play rounds the corners itself).
await sharp(path.resolve('assets/images/icon.png'))
  .resize(512, 512)
  .flatten({ background: '#FBF7F1' })
  .removeAlpha()
  .png()
  .toFile(path.join(outDir, 'icon-512.png'));

console.log(path.join(outDir, 'feature-graphic-1024x500.png'));
console.log(path.join(outDir, 'icon-512.png'));
