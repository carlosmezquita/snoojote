# new_snoojote

A robust Discord bot built with TypeScript, Node.js, and Discord.js, featuring economy, moderation, and community engagement tools.

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
- **Runtime**: Node.js
- **Framework**: Discord.js (v14)
- **Database**: SQLite (via `better-sqlite3` and `sqlite3`)
- **ORM**: Drizzle ORM
- **Other Tools**: `canvas` (for image generation), `node-cron` (for scheduled tasks), `winston` (logging).

## Prerequisites

- [Node.js](https://nodejs.org/) 20 or newer
- npm
- A Discord bot with the Server Members, Message Content, and Presence privileged intents enabled

## Installation

1.  **Clone the repository:**
    ```bash
    git clone <repository-url>
    cd new_snoojote
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Prepare the database directory:**
    Ensure a `data` directory exists in the root of the project to store the SQLite database.
    ```bash
    mkdir data
    ```

## Configuration

### Environment Variables

Copy `.env.example` to `.env` and fill in all required Discord IDs and secrets:

```env
TOKEN=your_discord_bot_token_here
GROQ_API_KEY=your_groq_api_key_here

DISCORD_CLIENT_ID=your_discord_application_client_id
DISCORD_GUILD_ID=optional_guild_id_for_fast_command_deploys

CHANNEL_MAIN=channel_id
CHANNEL_ALERTS=channel_id
CHANNEL_STREAKS=channel_id
CHANNEL_BOT=channel_id
CHANNEL_LOGS=channel_id
CHANNEL_WELCOME=channel_id
CHANNEL_VERIFIER_CATEGORY=category_id
CHANNEL_TICKET_CATEGORY=category_id
CHANNEL_STARBOARD=channel_id
CHANNEL_AI=channel_id
CHANNEL_WORD_OF_THE_DAY=channel_id

ROLE_DAILY_PING=role_id
ROLE_SUSPECT=role_id
ROLE_MOD=role_id
ROLE_SUPPORT=role_id
ROLE_RPLACE=role_id
ROLE_LINK_WHITELIST_IDS=role_id,role_id
```

The bot validates these variables at startup and exits with a non-zero status if required values are missing.

## Running the Bot

### Development

To run the bot in development mode (using `ts-node`):

```bash
npm run dev
```

### Production

1.  **Build the project:**
    ```bash
    npm run build
    ```

2.  **Start the bot:**
    ```bash
    npm start
    ```

### Deploying Commands

To register slash commands with Discord:

```bash
npm run deploy
```

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
├── dist/               # Compiled JavaScript
├── drizzle.config.ts   # Drizzle ORM configuration
├── package.json
└── tsconfig.json
```

## License

This project is licensed under the ISC License.
