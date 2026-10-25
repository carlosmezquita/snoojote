# Database Migrations and Recovery

The `drizzle/` folder contains SQL migrations and `meta/` contains Drizzle's schema snapshots
and migration journal. The application database is `data/database.sqlite`.

## Applying Schema Changes

Stop the bot and back up the database before changing its schema. Run one bot process per
database; the Discord workflows and recovery workers assume that deployment model.

```bash
bun install --frozen-lockfile
bun run check
```

Choose the upgrade command that matches the existing database:

| Database setup                                               | Command                                              |
| ------------------------------------------------------------ | ---------------------------------------------------- |
| Created using `drizzle-kit push` (the previous instructions) | `bunx drizzle-kit push`; review the proposed changes |
| Already tracked by Drizzle's migration journal               | `bunx drizzle-kit migrate`                           |
| New database                                                 | `bunx drizzle-kit migrate`                           |

Do not replay the full SQL migration history over an existing unjournaled schema.
After upgrading, smoke-test purchases, verification, voice rewards, and ticket creation/closure
in a staging guild before production. Local tests fake Discord and do not verify live permissions.

## Correctness and Recovery Update

Migration `0010_correctness_recovery.sql` adds the purchase journal, a unique index limiting each
user to one pending purchase, and nullable ticket context fields. Existing balances, inventory,
and tickets are preserved.

### Pending Purchases

A balance debit and its pending purchase record commit together. Inventory and completed status,
and refunds and refunded status, also commit together. Failed delivery removes a newly granted
role before refunding; roles owned before the purchase are retained.

Unconfirmed compensation stays pending and blocks another purchase for that user. Recovery runs
at startup and every minute: it completes inventory when the role is present, refunds when it
is absent, and completes inventory for non-role purchases. Unresolved records retain `last_error`
and produce logs with their purchase ID.

Restore the missing permissions or database access and let recovery retry. Do not manually refund
while leaving a purchase pending, or manually change roles involved in a pending purchase.

### Incomplete Tickets and Verification

A creating ticket reserves capacity before Discord channel creation. Its channel topic contains
`snoojote-ticket:<record ID>` so recovery can locate the channel if the create response is lost.
Failed cleanup retains `creation_failed` state and capacity until deletion is confirmed. Recovery
runs at startup and every five minutes. Preserve the topic marker while creation is pending.

Transcripts fetch the full history and fail explicitly if a page cannot be fetched; attachment
size remains subject to Discord's limits. Verification sessions are held in memory, so they do
not survive a restart. Existing stale-channel cleanup handles abandoned verification channels.
