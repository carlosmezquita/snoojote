import db from '../database/db.js';
import { tickets, ticketWaitEstimateSnapshots } from '../database/schema.js';
import { formatWaitObservationsCsv } from '../features/tickets/services/waitTimeExport.js';

// Include all tickets, even those without forecasts, in one consistent read transaction.
const { rows, snapshots } = db.transaction((tx) => ({
    rows: tx.select().from(tickets).all(),
    snapshots: tx.select().from(ticketWaitEstimateSnapshots).all(),
}));
process.stdout.write(formatWaitObservationsCsv(rows, snapshots, new Date()));
