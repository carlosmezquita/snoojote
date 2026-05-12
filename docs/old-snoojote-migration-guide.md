# Old Snoojote Migration Guide

This guide moves the server from the old `open-ticket` based Snoojote to this Bun/TypeScript version.

Do not run the old bot and the new bot at the same time with the same Discord token. Discord will disconnect one of them, and both bots may process the same events during startup/shutdown overlap.

## 1. Back Up the Old Bot

From the old bot folder, copy these somewhere safe before changing anything:

- `config.json`
- `transcriptconfig.json`
- `.env`
- `storage/`
- any SQLite/database files
- any generated transcript folders/files
- current process manager config, for example PM2, systemd, Docker, or scheduled task settings

Keep the backup until the new bot has run cleanly for at least a few days.

## 2. Install Runtime and Dependencies

Install Bun 1.3.13 or newer, then install this repo:

```bash
bun install
```

Run the local quality gate before configuring production:

```bash
bun run check
```

## 3. Configure Discord Privileged Intents

In the Discord Developer Portal for the bot application, enable:

- Server Members Intent
- Message Content Intent
- Presence Intent

The Presence intent is needed for active-staff wait estimates. Message Content is needed for moderation, AI, economy message rewards, and streak message triggers.

## 4. Create `.env`

Copy the template:

```bash
cp .env.example .env
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Fill in the values from the old bot:

| New variable                | Old source                                                                      |
| --------------------------- | ------------------------------------------------------------------------------- |
| `TOKEN`                     | old `.env` `TOKEN`, or `config.json` `token.value` if `token.fromENV` was false |
| `DISCORD_CLIENT_ID`         | Discord Developer Portal application/client ID                                  |
| `DISCORD_GUILD_ID`          | old `config.json` `serverId`, if you want fast guild command deploys            |
| `CHANNEL_STREAKS`           | old `config.json` `channels.streaksChannel`                                     |
| `CHANNEL_BOT`               | old `config.json` `channels.botChannel`                                         |
| `CHANNEL_TICKET_CATEGORY`   | old ticket option `category` values, usually the main ticket category           |
| `CHANNEL_TRANSCRIPTS`       | old `transcriptconfig.json` `sendTranscripts.channel`                           |
| `MAX_OPEN_TICKETS_PER_USER` | old `config.json` `system.maxAmountOfTickets`                                   |
| `ROLE_SUPPORT`              | old support/admin ticket roles                                                  |
| `ROLE_MOD`                  | moderation staff role                                                           |
| `ROLE_SUSPECT`              | verification/suspect role                                                       |
| `ROLE_RPLACE`               | r/place role, if still used                                                     |

The old bot had ticket options inline in `config.json`. In this bot they live in:

- `src/features/tickets/config/options/general.ts`
- `src/features/tickets/config/options/minecraft.ts`
- `src/features/tickets/config/options/rplace.ts`
- `src/features/tickets/config/options/spam.ts`

Before production, verify that each option has the right label, channel prefix, category ID, staff roles, modal questions, ping behavior, and DM behavior.

## 5. Prepare the New Database

The new bot stores data in:

```text
data/database.sqlite
```

Create/apply the schema:

```bash
bunx drizzle-kit push
```

This is required before first production start and after pulling migrations.

## 6. Migrate Streaks

This repo includes a streak import script for JSON exports shaped like:

```json
{
    "discordUserId": {
        "streak": 12,
        "lastDate": "2026-05-12"
    }
}
```

or:

```json
{
    "discordUserId": 12
}
```

Place the export at:

```text
data/streaks.json
```

Then run:

```bash
bun src/scripts/importStreaks.ts
```

After import, keep the source JSON as a backup until you have verified `/streak` for known users.

## 7. Data That Does Not Auto-Migrate Yet

These old bot records should be treated as archived unless a dedicated importer is written:

- open ticket state
- closed ticket history
- old HTML transcript files
- old economy balances
- old shop inventory
- old moderation logs stored only by the old bot

Before cutover, close or resolve old open tickets where possible. Keep the old transcript archive read-only for staff reference.

## 8. Deploy Slash Commands

After `.env` is complete and the database schema exists:

```bash
bun run deploy
```

If `DISCORD_GUILD_ID` is set, commands deploy to that guild quickly. Without it, commands deploy globally and may take longer to appear.

## 9. Production Cutover

Use a short maintenance window:

1. Announce the bot maintenance window to staff.
2. Stop the old bot process.
3. Confirm the old process is not auto-restarting.
4. Pull the new version on the server.
5. Run `bun install`.
6. Run `bun run check`.
7. Run `bunx drizzle-kit push`.
8. Run `bun run deploy`.
9. Start the new bot with `bun run start` or your process manager.

## 10. Smoke Test After Start

Verify these before considering the migration complete:

- Bot logs in without missing-env or intent errors.
- `/ticketpanel` sends the ticket panel.
- A test ticket can be opened, claimed, closed with reason, reopened, and deleted.
- Transcript is sent to `CHANNEL_TRANSCRIPTS`.
- Verification creates and deletes its temporary text channel.
- The daily question scheduler logs startup and does not double-send for the same Spain date.
- `/daily` shows the progressive reward.
- A meaningful message over 10 characters in a configured streak channel updates `/streak`.
- Wait estimate appears on ticket panel and new tickets.

## 11. Rollback

If the new bot fails cutover:

1. Stop the new bot.
2. Keep `data/database.sqlite` for debugging.
3. Restart the old bot from the untouched backup/process manager config.
4. Do not run both bots together.

After rollback, fix the new bot in a staging branch and repeat the cutover checklist.
