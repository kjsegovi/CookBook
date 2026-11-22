// Every command the server runs must be exercised by a vector scenario, or the Kotlin port could drift unnoticed.
// The Reminders exchange runs only on the server (the apps never queue it), so it has no scenario.
const SERVER_ONLY = new Set(['reminders.sync', 'reminders.ack']);

/** Command types in `case '…'` labels of commands.ts that no scenario step uses, in source order. */
export function uncoveredCommands(source, scenarios) {
    const covered = new Set(scenarios.flatMap(scenario => scenario.steps.map(step => step.type)));
    const types = [...new Set([...source.matchAll(/case '([^']+)'/g)].map(match => match[1]))];
    return types.filter(type => !SERVER_ONLY.has(type) && !covered.has(type));
}

/** Exits with status 1 and names the commands when any has no scenario. */
export function assertCovered(source, scenarios) {
    const missing = uncoveredCommands(source, scenarios);
    if (missing.length) {
        console.error('These commands in supabase/functions/_shared/commands.ts have no vector scenario: ' + missing.join(', ')
            + '\nAdd a scenario step for each in scripts/vector-scenarios.mjs, then run `npm run vectors:export`.');
        process.exit(1);
    }
}
