# new_snoojote

A robust Discord bot built with TypeScript, Bun, and Discord.js, featuring economy, moderation, and community engagement tools.

## Features

- **Economy System**: Manage user balances, transfers, and leaderboards.
- **Moderation**: Tools to manage and moderate the server.
- **Streaks**: Track daily user engagement.
- **Roles**: Manage user roles and permissions.
- **Tickets**: Support ticket system for user inquiries.
- **Trivia**: Engage users with trivia games.
- **Welcome**: customized welcome messages and images for new members.

## Tech Stack

- **Language**: TypeScript
- **Runtime**: Bun
- **Framework**: Discord.js (v14)
- **Database**: SQLite (via Bun SQLite and Drizzle)
- **ORM**: Drizzle ORM
- **Other Tools**: `canvas` (for image generation), `node-cron` (for scheduled tasks), `winston` (logging).

## Prerequisites

- [Bun](https://bun.sh/) 1.3.13 or newer
- [Node.js](https://nodejs.org/) 20 or newer for TypeScript tooling compatibility
- A Discord bot with the Server Members, Message Content, and Presence privileged intents enabled

## Installation

1.  **Clone the repository:**

    ```bash
    git clone <repository-url>
    cd new_snoojote
    ```

2.  **Install dependencies:**

    ```bash
    bun install
    ```

3.  **Prepare the database directory:**
    Ensure a `data` directory exists in the root of the project to store the SQLite database.
    ```bash
    mkdir data
    ```

## Configuration

### Environment Variables

Copy `.env.example` to `.env` and fill in the secrets:

```env
TOKEN=your_discord_bot_token_here
GROQ_API_KEY=your_groq_api_key_here
```

Non-secret runtime settings live in `config/bot.config.json`. On first startup, the bot copies
`config/bot.config.example.json` to `config/bot.config.json`; edit the generated file with your
Discord IDs, AI prompt/model settings, economy rewards/caps, and shop role IDs. The generated file
is ignored by Git, while the example stays committed.

The bot validates `.env` and `config/bot.config.json` at startup and exits with a non-zero status if
required values are missing or still use placeholders.

## Running the Bot

### Development

To run the bot in development mode:

```bash
bun run dev
```

### Production

1.  **Build the project:**

    ```bash
    bun run build
    ```

2.  **Start the bot:**
    ```bash
    bun run start
    ```

### Deploying Commands

To register slash commands with Discord:

```bash
bun run deploy
```

## Quality Checks

Run the full local gate before merging or deploying:

```bash
bun run check
```

This runs TypeScript type checking, ESLint, Prettier format verification, Drizzle schema checks, and Bun unit tests.

GitHub Actions runs the same gate on every push and pull request with the pinned Bun version and
a frozen dependency lockfile. Type checking includes test files. Configure `Quality gate` as a
required branch check if merges should be blocked until it passes.

`bun test` preloads `test/setup.ts`, forces test mode, and opens an in-memory SQLite database.
It applies the real migration chain; tests never open `data/database.sqlite`. Discord calls in
workflow tests use local fakes and require no bot token.

For database upgrades and pending purchase/ticket recovery, see [MIGRATIONS.md](MIGRATIONS.md).

Useful individual commands:

```bash
bun run lint
bun run format:check
bun run typecheck
bun test
```

`bun run tickets:backtest-wait` evaluates saved forecasts issued before a ticket's first response,
grouped by model version. It reports skipped tickets without valid forecasts and measures answered
tickets only; historical staff presence and queue state are not inferred.

## Migrating From the Old Bot

Use the step-by-step guide in `docs/old-snoojote-migration-guide.md` before replacing the old `open-ticket` based Snoojote in production.

## Project Structure

```
new_snoojote/
├── src/
│   ├── core/           # Client and core handlers
│   ├── database/       # Drizzle schema and setup
│   ├── features/       # Bot features (commands, events)
│   ├── scripts/        # Utility scripts (e.g., deploy commands)
│   ├── shared/         # Shared utilities
│   ├── utils/          # Logger and other helpers
│   ├── config.ts       # Bot configuration
│   └── index.ts        # Entry point
├── data/               # SQLite database storage (create if missing)
├── drizzle.config.ts   # Drizzle ORM configuration
├── package.json
└── tsconfig.json
```

## License

This project is licensed under the ISC License.
