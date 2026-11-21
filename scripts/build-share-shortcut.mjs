import { mkdir, writeFile } from 'node:fs/promises';
import { shortcutPlist } from './reminders-shortcut.mjs';
import { buildShareShortcut } from './share-shortcut.mjs';

const site = process.argv[2] ?? process.env.COOKBOOK_SITE_URL;
if (!site) { console.error('Usage: npm run build:share-shortcut -- https://your-cookbook-site/'); process.exit(1); }
await mkdir('outputs', { recursive: true });
await writeFile('outputs/Save to CookBook.unsigned.shortcut', shortcutPlist(buildShareShortcut(site)));
console.log('Created outputs/Save to CookBook.unsigned.shortcut. Sign it with Apple’s shortcuts command before distributing.');
