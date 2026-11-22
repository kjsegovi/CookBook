import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';

// The Kotlin port of the commands is tested against these vectors. When a command
// changes, run `npm run vectors:export` and commit the regenerated files.
test('committed command vectors match the TypeScript commands', () => {
    execFileSync('node', ['scripts/export-command-vectors.mjs', '--check'], { stdio: 'pipe' });
});

test('every command type except the Reminders exchange has a vector scenario', async () => {
    const { uncoveredCommands } = await import('../scripts/command-coverage.mjs');
    const { scenarios } = await import('../scripts/vector-scenarios.mjs');
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../supabase/functions/_shared/commands.ts', import.meta.url), 'utf8');
    assert.deepEqual(uncoveredCommands(source, scenarios), []);
    const extra = source + "\n        case 'pantry.split': break;\n        case 'reminders.sync': break;";
    assert.deepEqual(uncoveredCommands(extra, scenarios), ['pantry.split']);
});

test('the vector export fails when a command has no scenario', () => {
    const result = spawnSync('node', ['--input-type=module', '-e', `
        import { assertCovered } from './scripts/command-coverage.mjs';
        assertCovered("case 'recipe.rate': case 'pantry.split':", [{ steps: [{ type: 'recipe.rate' }] }]);
    `], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /pantry\.split/);
});
