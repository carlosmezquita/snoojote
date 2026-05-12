# Economy and Runtime Config Migration Guide

This guide migrates the bot from env-heavy configuration and uncapped passive rewards to the runtime JSON config and capped economy model.

## 1. Update the branch and install

```bash
git switch codex/economy-config-balance
bun install
```

## 2. Keep `.env` for secrets only

`.env` should contain:

```env
TOKEN=your_discord_bot_token_here
GROQ_API_KEY=your_groq_api_key_here
```

Move Discord IDs, the AI prompt, economy settings, and shop role IDs out of `.env`.

## 3. Generate and edit runtime config

Start the bot once, or copy the example manually:

```bash
Copy-Item config/bot.config.example.json config/bot.config.json
```

Edit `config/bot.config.json`. This file is ignored by Git.

Required production values:

- `discord.clientId`
- all required `channels.*` IDs
- required `roles.*` IDs
- `economy.shopCatalog[*].value` for every role item
- `ai.systemPrompt` if you want a production-specific prompt

Optional but useful:

- `discord.guildId` for fast guild command deployment
- `channels.transcripts`; defaults to `channels.logs` if omitted
- `economy.questExcludedChannelIds` for channels that must not count for daily tasks

## 4. Configure daily-task exclusions

Add channel IDs to:

```json
"questExcludedChannelIds": [
    "CHANNEL_ID_TO_EXCLUDE"
]
```

Excluded channels are not selected for message quests, and voice minutes in excluded voice channels do not count.

## 5. Apply database migration

Deploy the new Drizzle migration before running the updated bot in production:

```bash
bunx drizzle-kit migrate
```

The migration adds `economy_daily_earnings`, which tracks per-user daily passive earning totals for message and voice caps. It does not change existing balances.

## 6. Deploy commands and restart

```bash
bun run deploy
bun run start
```

Startup will fail if `config/bot.config.json` still contains required placeholder values.

## 7. Smoke test

- `/daily` shows progress, guidelines, and excluded channels.
- Message quests only progress in allowed channels.
- Voice quests progress after full minutes when users leave, switch voice channels, or run `/daily` while still connected.
- Users receive a non-sensitive completion notification when a voice daily quest completes; if their DMs are closed, the bot posts it in the bot channel.
- `/tienda` shows configured prices and `/comprar` enforces rank order.
