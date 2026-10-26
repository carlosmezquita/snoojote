import db from '../database/db.js';
import { tickets, ticketWaitEstimateSnapshots } from '../database/schema.js';
import {
    evaluateWaitEstimates,
    observeInitialWait,
} from '../features/tickets/services/waitTimeEvaluation.js';
import { computeMedian } from '../features/tickets/services/waitTimeEstimator.js';

const rows = await db.select().from(tickets).all();
const snapshots = await db.select().from(ticketWaitEstimateSnapshots).all();
const asOf = new Date();
const results = evaluateWaitEstimates(rows, snapshots, asOf);
const outcomes = new Map<string, number>();
for (const row of rows) {
    const outcome = observeInitialWait(row, asOf).outcome;
    outcomes.set(outcome, (outcomes.get(outcome) ?? 0) + 1);
}
console.log(
    `Initial wait outcomes as of ${asOf.toISOString()}: ${JSON.stringify(Object.fromEntries(outcomes))}`,
);
console.log(`Evaluated saved forecasts: ${results.length}`);
console.log(
    `Skipped tickets without a valid response and an on-time forecast: ${rows.length - results.length}`,
);
console.log(
    'Errors describe answered initial waits only, measured from forecast issuance. Pending waits and competing non-response outcomes are reported separately; no historical presence or departure date is inferred.',
);

for (const version of new Set(results.map((result) => result.modelVersion))) {
    const samples = results.filter((result) => result.modelVersion === version);
    const errors = samples.map((result) => Math.abs(result.errorMs));
    const mean = errors.reduce((sum, value) => sum + value, 0) / errors.length;
    console.log(
        [
            `Model: ${version} (${samples.length} tickets)`,
            `Median absolute error: ${(computeMedian(errors) / 60_000).toFixed(1)} minutes`,
            `Mean absolute error: ${(mean / 60_000).toFixed(1)} minutes`,
            `Over-estimate rate: ${((100 * samples.filter((result) => result.errorMs > 0).length) / samples.length).toFixed(1)}%`,
            `Under-estimate rate: ${((100 * samples.filter((result) => result.errorMs < 0).length) / samples.length).toFixed(1)}%`,
        ].join('\n'),
    );
}
