// Runs every scenario in vector-scenarios.mjs through the TypeScript commands and
// records each step's result as a golden vector for the Kotlin port.
//
//   node scripts/export-command-vectors.mjs          writes the vector files
//   node scripts/export-command-vectors.mjs --check  fails if committed files differ
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyCommand } from '../supabase/functions/_shared/commands.ts';
import { DomainError, initialState } from '../supabase/functions/_shared/domain.ts';
import { statePatch } from '../supabase/functions/_shared/state-patch.ts';
import { scenarios } from './vector-scenarios.mjs';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'native', 'shared', 'src', 'commonTest', 'resources', 'vectors');
const check = process.argv.includes('--check');

// Scenario payloads must give every record an id, so a run never depends on chance.
let current = '';
globalThis.crypto.randomUUID = () => { throw new Error('Non-deterministic id in vector scenario: ' + current); };

const sortKeys = value => Array.isArray(value) ? value.map(sortKeys)
    : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sortKeys(value[key])]))
    : value;
const plain = value => JSON.parse(JSON.stringify(value));

function run(scenario) {
    current = scenario.name;
    const initial = plain(scenario.initial ?? initialState());
    let state = initial;
    const steps = scenario.steps.map((step, index) => {
        const label = `${scenario.name} step ${index + 1} (${step.type})`;
        // A payload may be computed from the state the step starts from.
        const payload = plain(typeof step.payload === 'function' ? step.payload(state) : step.payload);
        const record = { type: step.type, payload, operationId: step.operationId, clock: step.clock };
        try {
            const after = plain(applyCommand(plain(state), step.type, plain(payload), step.operationId, step.clock));
            if (step.expect && step.expect !== 'ok') throw new Error(`${label} should fail with "${step.expect}" but succeeded`);
            const patch = plain(statePatch(state, after));
            state = after;
            return { ...record, after, patch, error: null };
        }
        catch (error) {
            if (!(error instanceof DomainError)) throw error;
            if (step.expect === undefined || step.expect === 'ok') throw new Error(`${label} should succeed but failed: ${error.message}`);
            if (!error.message.includes(step.expect)) throw new Error(`${label} failed with "${error.message}", expected "${step.expect}"`);
            return { ...record, after: null, patch: null, error: { message: error.message, status: error.status } };
        }
    });
    return { name: scenario.name, initial, steps };
}

const files = new Map();
for (const scenario of scenarios) {
    if (files.has(scenario.name + '.json')) throw new Error('Duplicate scenario name: ' + scenario.name);
    files.set(scenario.name + '.json', JSON.stringify(sortKeys(run(scenario)), null, 2) + '\n');
}

if (check) {
    const differing = [];
    for (const [file, text] of files) {
        const path = join(outDir, file);
        if (!existsSync(path) || readFileSync(path, 'utf8') !== text) differing.push(file);
    }
    const existing = existsSync(outDir) ? readdirSync(outDir).filter(f => f.endsWith('.json')) : [];
    for (const file of existing) if (!files.has(file)) differing.push(file + ' (no longer a scenario)');
    if (differing.length) {
        console.error('Command vectors are out of date: ' + differing.join(', ') + '\nRun `npm run vectors:export` and commit the result.');
        process.exit(1);
    }
    console.log(`${files.size} command vector files are up to date.`);
}
else {
    mkdirSync(outDir, { recursive: true });
    for (const file of readdirSync(outDir)) if (file.endsWith('.json') && !files.has(file)) unlinkSync(join(outDir, file));
    for (const [file, text] of files) writeFileSync(join(outDir, file), text);
    console.log(`Wrote ${files.size} command vector files to ${outDir}`);
}
