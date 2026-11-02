import { mkdir, writeFile } from 'node:fs/promises';
import { buildRemindersShortcut, shortcutPlist } from './reminders-shortcut.mjs';

await mkdir('outputs', { recursive: true });
await writeFile('outputs/CookBook Groceries.unsigned.shortcut', shortcutPlist(buildRemindersShortcut()));
console.log('Created outputs/CookBook Groceries.unsigned.shortcut. Sign it with Apple’s shortcuts command before distributing.');
