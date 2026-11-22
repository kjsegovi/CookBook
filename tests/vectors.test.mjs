import test from 'node:test';
import { execFileSync } from 'node:child_process';

// The Kotlin port of the commands is tested against these vectors. When a command
// changes, run `npm run vectors:export` and commit the regenerated files.
test('committed command vectors match the TypeScript commands', () => {
    execFileSync('node', ['scripts/export-command-vectors.mjs', '--check'], { stdio: 'pipe' });
});
