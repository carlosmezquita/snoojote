# Snoojote

[![Quality](https://github.com/carlosmezquita/snoojote/actions/workflows/quality.yml/badge.svg)](https://github.com/carlosmezquita/snoojote/actions/workflows/quality.yml)

Community operations bot built for the r/Spain Discord community of over 3,000 members.
Snoojote brings support tickets, moderation, participation rewards, and scheduled community
activities into one TypeScript application.

## Features

- **Support:** private tickets, staff claiming, member access, closure/reopening, transcripts,
  optional screenshots in spam reports, and response-time estimates with recorded prediction factors.
- **Moderation:** link-spam enforcement and session-bound CAPTCHA verification.
- **Economy:** balances, transfers, daily quests, capped activity rewards, a role shop, and inventory.
- **Engagement:** configurable streak check-ins, milestone bonuses, streak freezes, and starboard.
- **Scheduled content:** daily community questions and dictionary word-of-the-day posts.
- **Optional AI chat:** reply-chain context through Groq, with request deadlines, concurrency
  limits, per-user cooldowns, and bounded context.

## Architecture

Snoojote is a single-process, single-guild application using Bun, discord.js 14, SQLite,
Drizzle ORM, Zod, Winston, and node-cron.

```text
src/
  core/          Typed command contracts, dynamic registration, and error/permission boundaries
  features/      Feature-specific commands, gateway events, and services
  database/      Shared SQLite connection and Drizzle schema
  shared/        Bounded queues, cooldowns, HTTP utilities, and notification services
  scripts/       Command deployment, data imports, forecast evaluation, and benchmarks
```

- SQLite transactions contain synchronous database work. Discord/HTTP calls happen outside them;
  external purchase delivery has a persisted journal and compensation/recovery path.
- WAL mode and full synchronous durability support local operation. Conditional updates and database
  constraints protect currency balances. Multiple bot replicas sharing a database are unsupported.
- Staff membership is bootstrapped once per guild. Estimates use cached gateway presence and bounded
  response history; overlapping refreshes share work. Presence is a proxy for availability.
- Private/NSFW content cannot be copied into an inappropriate starboard destination. Public DM
  fallbacks omit private content and files by default. Mentions require explicit opt-in.

## Setup

Use **Bun 1.4.4** (pinned in `package.json`) and **Node.js 22** for tooling.

```bash
git clone https://github.com/carlosmezquita/snoojote.git
cd snoojote
bun install --frozen-lockfile
cp .env.example .env
mkdir -p data
```

Set `TOKEN` in `.env`. `GROQ_API_KEY` enables AI chat; the other features can start without it.
Copy `config/bot.config.example.json` to `config/bot.config.json` and replace the placeholder
application, **guild**, channel, and role IDs. The runtime file and secrets are ignored by Git.
Startup also creates the runtime config from the example if it is missing, then rejects placeholders.
Catalog names must be unique; role ranks must be consecutive from 1. Privileged staff roles cannot
be sold through the shop.

Enable **Server Members**, **Message Content**, and **Presence** intents in the Discord developer
portal. Assign the bot the permissions required by enabled features and place its role above roles
it manages; administrative bot permission is not required.

For a **new database**, create the schema with:

```bash
bunx drizzle-kit migrate
```

For an existing database, follow [MIGRATIONS.md](MIGRATIONS.md). Databases previously created with
`drizzle-kit push` require a different upgrade path. That file also describes backups and recovery
of pending purchases and incomplete tickets.

The optional daily-question bank lives in `data/questions-dataset.json`:

```json
{
    "current_id": 0,
    "unread_questions": ["¿Qué has aprendido esta semana?"],
    "read_questions": []
}
```

## Run

```bash
bun run deploy  # Register slash commands after configuring the application and guild
bun run dev     # Development with file watching
bun run start   # Run under your production process supervisor
```

Stop the previous bot before starting a replacement process. Graceful shutdown closes the gateway,
schedulers, and database. After schema/configuration changes, verify permissions and feature flows
in a staging guild before production.

## Verification

```bash
bun run check          # Types (including tests), lint, format, migrations, and regression tests
bun run audit          # Fail on high/critical dependency advisories
bun run bench:runtime  # Synthetic 3,000-account economy workload; in-memory DB, no Discord calls
```

GitHub Actions runs the same checks on pushes and pull requests. Actions are pinned to commit SHAs.
The lockfile includes explicit security overrides for transitive dependencies; re-audit and test
before changing them. Configure `Quality gate` as a required check to enforce it before merging.

`bun test` preloads test mode and applies the committed migrations to an in-memory database.
It never opens `data/database.sqlite`. Tests exercise failure recovery, authorization, privacy,
concurrent rewards/ticket operations, and a synthetic 3,000-member guild. Synthetic results do not
measure production gateway latency or uptime.

`bun run tickets:backtest-wait` reports initial-wait outcomes separately from forecast errors,
grouped by model version. Errors measure the wait remaining from forecast issuance for answered
initial waits only. Pending tickets are observed up to the export cutoff; requester closures,
staff closures, deletion without a reply, and observed requester unavailability are competing
outcomes, not response samples. `per-staff-capacity-v3` corrects response eligibility and counts
other pending ticket creations in the unanswered queue. It retains the v2 heuristic, which is not
a validated service-level promise or a calibrated prediction interval.

`bun run tickets:export-wait > wait-observations.csv` exports raw UTC timestamps, correctly scaled
millisecond durations, outcome provenance, and all saved forecasts, including tickets without a
forecast. Keep this operational export private. Legacy outcomes use available timestamps only;
a deleted status or unknown user does not establish when or why someone left. New outcome fields
are immutable for the initial wait, so reopening or returning cannot relabel a cancellation as a
successful initial response. Follow-up waits in reopened tickets need separate episode tracking.
Known legacy closure boundaries are retained before reopening or deletion; earlier lost episodes
cannot be reconstructed from the current ticket row.
Gateway member removals mean leave/kick/ban and are recorded at observation time. Events missed
while the bot is offline are not reconstructed. Apply migration `0012` before starting this version.

## Operations

- `/ticket wait` is the private, admin-only forecast for a **new** ticket's first staff response.
  Use `details:true` for presence, sample counts and model factors. It replaces both
  `/admin ticket-availability` and `/ticket waitdebug`; after updating the bot, run `bun run deploy`
  to replace the registered subcommands. Old registered commands redirect during the transition.
  Presence is a proxy, and missing history/roles or incomplete membership are reported explicitly.
  The displayed queue and staff snapshot are the ones used for that forecast. Running the command
  does not create a ticket or record a forecast for historical evaluation.
- Spam forms accept up to three optional PNG/JPEG/WebP/GIF screenshots (8 MiB combined). The bot
  validates image signatures and posts uploads in a separate message after the private opening
  embed; source modal URLs expire.
  Reports can still be submitted without images, with further evidence attached in the ticket.
  At most two file-transfer jobs run at once; excess submissions receive a retry message.
- Ticket closure/deletion requires a successful transcript archive in a different channel in the
  same guild that denies `ViewChannel` to `@everyone`. Restrict other role access to staff too.
  Archives include embeds (opening form answers and the announced estimate), message/author IDs,
  and actual attachment files copied to archive messages. The transcript maps each original file
  to its archive message, so retrieval does not depend on an expired CDN link. Older
  text-only archives cannot recover omitted embeds after channel deletion. Exports stop at 8 MiB or
  10,000 messages, with at most 20 attachments, 8 MiB per file and 32 MiB of files per archive.
  Oversized tickets or failed file copies remain available for retry/manual export. A failed archive
  may leave partial copies in the archive channel; the final transcript marks a completed export.
  Discord deletion failures preserve a retryable record. Discord retention is not an external backup.
- Voice sessions and verification challenges live in memory. Restarts begin voice accounting anew;
  abandoned verification channels are cleaned up. Voice rewards are split by Madrid calendar date.
- Streaks use configured channels and meaningful messages of at least ten characters. Daily quest
  rollover uses Madrid dates; claiming retains a rolling 24-hour cooldown.
- Scheduled sends use a local in-flight guard and Discord nonces to reduce duplicate retries.
  Discord delivery and local persistence do not form one atomic transaction; inspect channel history
  after ambiguous delivery failures before manually replaying a post.
- SQLite uses the version bundled by the pinned Bun runtime. Keep it patched; on macOS, check
  the actual SQLite version because Bun may use the system library.
- User IDs, balances, ticket metadata, and scheduled-post state persist in SQLite. Restrict transcript
  channel access and set a retention policy. AI requests send the selected reply-chain context to Groq.
- Logs rotate by size. Control verbosity and retention with `LOG_LEVEL`, `LOG_MAX_FILE_SIZE_BYTES`,
  and `LOG_MAX_FILES`. Bot/API secrets are redacted from formatted logs.

For replacement of the legacy bot, see [the cutover guide](docs/old-snoojote-migration-guide.md).

## License

[ISC](LICENSE).
