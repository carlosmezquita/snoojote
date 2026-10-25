import db from '../database/db.js';
import { tickets, ticketWaitEstimateSnapshots } from '../database/schema.js';
import { evaluateWaitEstimates } from '../features/tickets/services/waitTimeEvaluation.js';
import { computeMedian } from '../features/tickets/services/waitTimeEstimator.js';

const rows = await db.select().from(tickets).all();
const snapshots = await db.select().from(ticketWaitEstimateSnapshots).all();
const results = evaluateWaitEstimates(rows, snapshots);
console.log(`Evaluated saved forecasts: ${results.length}`);
console.log(
    `Skipped tickets without a valid response and an on-time forecast: ${rows.length - results.length}`,
);
console.log(
    'No historical staff presence or unanswered queue is inferred. Results describe answered tickets only.',
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
