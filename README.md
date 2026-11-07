# Snoojote

Snoojote is a Discord bot built for the r/Spain community. Members open private support tickets and get an estimated wait for the first staff reply. Moderators triage reports, verify new members and archive closed tickets with their evidence. The bot also runs community rewards, including a shop that delivers Discord roles.

Built with TypeScript, Bun, discord.js and SQLite via Drizzle. It runs on a Linux VPS under systemd.

## Engineering decisions

### A purchase crosses two systems

SQLite can commit a debit, but granting a Discord role is a separate request. If Discord grants the role and the connection drops before the reply, a blind refund can leave the member with both the role and the currency. Snoojote records the debit and pending purchase in one SQLite transaction. Recovery checks the role and completes the purchase or refunds it when the outcome is clear. A purchase with an ambiguous outcome stays pending for another check.

[Purchase service](src/features/economy/services/purchaseService.ts) · [Recovery tests](test/purchaseService.test.ts)

### Two listeners can receive the same event

During a planned restart, a standby Discord connection can accept new interactions while the primary finishes work it already accepted. Both use the same SQLite database to claim interaction IDs and prevent duplicate handling. If a process dies during an external call and the result is unknown, the bot avoids blindly replaying it. A member may need to retry an interrupted command. Both listeners share one VPS and database.

[Dispatch code](src/core/restartDispatch.ts) · [Handoff tests](test/restartDispatch.test.ts) · [Operations notes](docs/OPERATIONS.md#commands-and-community-events-across-restarts)

### A closed ticket is different from an answered one

The estimate combines past first-response times with the current queue and available staff. Sparse staff history falls back to a community-wide baseline. The evaluator compares the estimate actually shown with the first reply and counts cancellations, closures without a reply and member departures separately. The backtest reports error on answered tickets with a recorded estimate.

[Estimator](src/features/tickets/services/waitTimeEstimator.ts) · [Evaluation tests](test/waitTimeEvaluation.test.ts)

## Run the checks

Use the Bun version pinned in [package.json](package.json) and Node.js 22 for tooling. The checks run without a Discord token or a live guild.

```bash
git clone https://github.com/carlosmezquita/snoojote.git
cd snoojote
bun install --frozen-lockfile
bun run check
```

`bun run check` runs type checking, linting, formatting, migration checks and tests. Tests cover cases such as a role grant followed by a network error, duplicate interaction delivery and tickets reopened after the initial wait ended.

To run the bot, copy [`.env.example`](.env.example) and the [example bot configuration](config/bot.config.example.json), then set up a test guild using the [configuration and startup instructions](docs/OPERATIONS.md#production-vps-and-systemd-setup). See the [migration guide](docs/OPERATIONS.md#applying-schema-changes) before using an existing database.

[Architecture](docs/ARCHITECTURE.md) · [Operations](docs/OPERATIONS.md) · [ISC license](LICENSE)
