# Correctness update: deployment and recovery

## Database upgrade

Stop the bot and back up `data/database.sqlite` before changing its schema. Use one bot process
per database; the Discord workflows and recovery workers are designed for that deployment model.

Migration `0010_correctness_recovery.sql` adds `shop_purchases`, a partial unique index limiting
each user to one pending purchase, and two nullable ticket context fields. Existing balances,
inventory, and tickets are preserved.

- If the database already uses Drizzle's migration journal, apply pending migrations with
  `bunx drizzle-kit migrate`.
- If it was created using `drizzle-kit push` as described in `MIGRATIONS.md`, continue with
  `bunx drizzle-kit push` and review the proposed additive changes. Do not replay the full
  SQL migration history over an existing unjournaled schema.
- For a new database, `bunx drizzle-kit migrate` applies the full history.

Run `bun install --frozen-lockfile` and `bun run check` before starting the updated bot.
Smoke-test a role purchase, a verification challenge, voice rewards, and opening/closing a ticket
in a staging guild. Local tests fake Discord; they do not replace the live permissions check.

## Purchases

The balance debit and a `pending` purchase record commit in the same SQLite transaction.
Inventory and `completed` status also commit together. A failed delivery removes a newly granted
role before refunding; roles owned before the purchase are never removed as compensation.
The refund and `refunded` status are atomic, so retries cannot refund twice.

When Discord or SQLite cannot confirm compensation, the purchase stays pending and blocks a
second purchase for that user. The user receives a pending-review message rather than a promise
of a refund. The bot retries on startup and once per minute. Recovery completes inventory when
the role is present, or refunds when it is absent; non-role purchases complete inventory.
Unresolved records retain `last_error` and produce logs with their purchase ID. Restore the
missing permissions/database access and let recovery retry; do not manually refund while leaving
a purchase pending. Staff should avoid manually changing roles involved in a pending purchase.

## Tickets and verification

A `creating` ticket reserves capacity before Discord channel creation. Its channel topic contains
`snoojote-ticket:<record ID>` so recovery can find a channel even if the create response was lost.
Failed cleanup retains `creation_failed` state and capacity until deletion is confirmed. Startup
and five-minute recovery sweeps retry cleanup. Preserve that topic marker while creation is pending.
Transcripts paginate through the full message history and fail explicitly if a page cannot be fetched.

CAPTCHA answers remain in server memory, bound to guild, user, channel, challenge ID, and expiry.
Component IDs expose only a random identifier. Retries invalidate the old challenge; successful
submissions cannot be replayed. Existing stale-channel cleanup still handles restarts; verification
sessions themselves are not persisted.

## Wait-time evaluation

`bun run tickets:backtest-wait` evaluates forecasts saved before the ticket received its first
response, grouped by model version. It skips tickets lacking a valid on-time snapshot and reports
the skip count. It does not reconstruct historical presence, substitute all open tickets for an
unanswered queue, or use later responses to build earlier forecasts. These metrics describe answered
tickets only; they do not measure the experience of tickets that never received a response.

## Quality gate

The `Quality gate` Actions job runs `bun run check` on pushes and pull requests. It does not deploy
the bot or change branch protection. Set it as a required check in repository settings if desired.
The test database is always in memory and is migrated from the committed SQL files. Tests cover
purchase compensation/recovery, competing ticket operations, full transcripts, verification binding
and replay, gateway intents, forecast evaluation, and database isolation/schema upgrades.
