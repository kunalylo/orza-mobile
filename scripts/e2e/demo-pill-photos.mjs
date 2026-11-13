// Draws two plain medicine product photos for the store-screenshot sample account (docs/store/listing.md §4.1): a blister
// strip of small white tablets and a white tablet bottle with a blank label. No brand names, no text, no people.
// Usage: node scripts/e2e/demo-pill-photos.mjs [outDir]   → <outDir>/strip.jpg, <outDir>/bottle.jpg (900×900 JPEG)
// sharp comes from the web worktree's node_modules (the phone app doesn't depend on it).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const sharp = createRequire('E:/aylo/orza-backend/package.json')('sharp');
const outDir = process.argv[2] || 'store-demo-photos';
fs.mkdirSync(outDir, { recursive: true });
const S = 900;

// A soft table-top backdrop shared by both photos.
const backdrop = (tint) => `
  <defs>
    <radialGradient id="bg" cx="50%" cy="38%" r="75%">
      <stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="${tint}"/>
    </radialGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="150%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="14"/><feOffset dy="16"/>
      <feComponentTransfer><feFuncA type="linear" slope="0.28"/></feComponentTransfer>
      <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <rect width="${S}" height="${S}" fill="url(#bg)"/>`;

function strip() {
  // A 2 × 5 blister strip, tilted a little, on a pale blue-grey surface.
  const w = 640, h = 300, x0 = (S - w) / 2, y0 = (S - h) / 2;
  let pockets = '';
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 5; c++) {
      const cx = x0 + 78 + c * 121, cy = y0 + 82 + r * 136;
      pockets += `
        <circle cx="${cx}" cy="${cy}" r="47" fill="url(#pocket)" stroke="#b9c2cc" stroke-width="2"/>
        <circle cx="${cx}" cy="${cy}" r="36" fill="url(#pill)"/>
        <line x1="${cx - 22}" y1="${cy}" x2="${cx + 22}" y2="${cy}" stroke="#d9dde2" stroke-width="3" stroke-linecap="round"/>`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}">
    ${backdrop('#dfe5ec')}
    <defs>
      <linearGradient id="foil" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#f4f6f8"/><stop offset="0.45" stop-color="#c9d0d8"/>
        <stop offset="0.7" stop-color="#eef1f4"/><stop offset="1" stop-color="#b4bcc6"/>
      </linearGradient>
      <radialGradient id="pocket" cx="40%" cy="35%" r="70%">
        <stop offset="0" stop-color="#ffffff" stop-opacity="0.95"/><stop offset="1" stop-color="#dfe6ee" stop-opacity="0.9"/>
      </radialGradient>
      <radialGradient id="pill" cx="38%" cy="32%" r="75%">
        <stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#e9ecef"/>
      </radialGradient>
    </defs>
    <g transform="rotate(-8 ${S / 2} ${S / 2})" filter="url(#shadow)">
      <rect x="${x0}" y="${y0}" width="${w}" height="${h}" rx="22" fill="url(#foil)" stroke="#aab3bd" stroke-width="2"/>
      <line x1="${x0 + 18}" y1="${y0 + h / 2}" x2="${x0 + w - 18}" y2="${y0 + h / 2}" stroke="#a7b0ba" stroke-width="2" stroke-dasharray="6 7"/>
      ${pockets}
    </g>
  </svg>`;
}

function bottle() {
  // A white tablet bottle with a plain teal label band and three large oval tablets in front, on a warm surface.
  const bx = 300, by = 190, bw = 300, bh = 470;
  const tablet = (cx, cy, rot) => `
    <g transform="rotate(${rot} ${cx} ${cy})" filter="url(#shadow)">
      <ellipse cx="${cx}" cy="${cy}" rx="62" ry="30" fill="url(#cal)"/>
      <line x1="${cx - 34}" y1="${cy}" x2="${cx + 34}" y2="${cy}" stroke="#e3ddd2" stroke-width="3" stroke-linecap="round"/>
    </g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}">
    ${backdrop('#efe7da')}
    <defs>
      <linearGradient id="body" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#e6e8ea"/><stop offset="0.25" stop-color="#ffffff"/>
        <stop offset="0.7" stop-color="#f6f7f8"/><stop offset="1" stop-color="#d5d9dd"/>
      </linearGradient>
      <linearGradient id="cap" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#d9dde1"/><stop offset="0.3" stop-color="#fbfbfc"/><stop offset="1" stop-color="#c7ccd2"/>
      </linearGradient>
      <linearGradient id="label" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#2f8f87"/><stop offset="0.3" stop-color="#3fb0a5"/><stop offset="1" stop-color="#267a73"/>
      </linearGradient>
      <radialGradient id="cal" cx="40%" cy="30%" r="80%">
        <stop offset="0" stop-color="#fffdf8"/><stop offset="1" stop-color="#ece5d8"/>
      </radialGradient>
    </defs>
    <g filter="url(#shadow)">
      <rect x="${bx + 30}" y="${by - 10}" width="${bw - 60}" height="40" rx="10" fill="#e9ecef"/>
      <rect x="${bx + 18}" y="${by - 95}" width="${bw - 36}" height="105" rx="18" fill="url(#cap)"/>
      ${Array.from({ length: 13 }, (_, i) => `<line x1="${bx + 36 + i * 18.5}" y1="${by - 88}" x2="${bx + 36 + i * 18.5}" y2="${by + 2}" stroke="#c2c8ce" stroke-width="3"/>`).join('')}
      <rect x="${bx}" y="${by + 22}" width="${bw}" height="${bh}" rx="46" fill="url(#body)"/>
      <rect x="${bx}" y="${by + 150}" width="${bw}" height="210" fill="url(#label)"/>
      <rect x="${bx}" y="${by + 168}" width="${bw}" height="10" fill="#ffffff" opacity="0.55"/>
      <rect x="${bx}" y="${by + 332}" width="${bw}" height="10" fill="#ffffff" opacity="0.55"/>
      <circle cx="${bx + bw / 2}" cy="${by + 255}" r="44" fill="#ffffff" opacity="0.9"/>
      <rect x="${bx + bw / 2 - 8}" y="${by + 229}" width="16" height="52" rx="4" fill="#3fb0a5"/>
      <rect x="${bx + bw / 2 - 26}" y="${by + 247}" width="52" height="16" rx="4" fill="#3fb0a5"/>
    </g>
    ${tablet(250, 735, -18)}${tablet(420, 770, 8)}${tablet(640, 742, 24)}
  </svg>`;
}

for (const [name, svg] of [['strip', strip()], ['bottle', bottle()]]) {
  const out = path.join(outDir, `${name}.jpg`);
  await sharp(Buffer.from(svg)).flatten({ background: '#ffffff' }).jpeg({ quality: 88 }).toFile(out);
  console.log(out, fs.statSync(out).size);
}
