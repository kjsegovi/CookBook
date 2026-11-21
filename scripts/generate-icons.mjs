// Regenerate the installable-app PNG icons from the favicon artwork.
// The rasterizer is not a project dependency; install it only when icons change:
//   npm i --no-save @resvg/resvg-js && node scripts/generate-icons.mjs
import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';

const require = createRequire(process.env.RESVG_FROM ?? import.meta.url);
const { Resvg } = require('@resvg/resvg-js');

const green = '#35664b', paper = '#faf9f5';
// The open-book mark from public/favicon.svg, drawn in a 40×40 box.
const book = 'M10 11c5-2 8-1 10 1 3-2 6-3 10-1v19c-4-2-7-1-10 1-3-2-6-3-10-1zM20 12v19';

// `scale` shrinks the mark around the centre; maskable icons keep it inside the 80% safe zone.
function svg({ rounded, scale }) {
    const offset = 20 - 20 * scale;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">
<rect width="40" height="40" ${rounded ? 'rx="12"' : ''} fill="${green}"/>
<g transform="translate(${offset} ${offset}) scale(${scale})"><path d="${book}" stroke="${paper}" stroke-width="2" stroke-linejoin="round" fill="none"/></g>
</svg>`;
}

const icons = [
    { file: 'public/icons/icon-192.png', size: 192, rounded: true, scale: 1 },
    { file: 'public/icons/icon-512.png', size: 512, rounded: true, scale: 1 },
    // Full-bleed: the platform applies its own mask shape.
    { file: 'public/icons/icon-maskable-512.png', size: 512, rounded: false, scale: 0.72 },
    // iOS rounds the corners itself and shows transparency as black.
    { file: 'public/icons/apple-touch-icon.png', size: 180, rounded: false, scale: 0.82 },
];

for (const icon of icons) {
    const png = new Resvg(svg(icon), { fitTo: { mode: 'width', value: icon.size } }).render().asPng();
    await writeFile(icon.file, png);
    console.log(`${icon.file} (${icon.size}px)`);
}
