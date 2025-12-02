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

- [Node.js](https://nodejs.org/) (v16.9.0 or higher is recommended for Discord.js v14)
- npm or yarn

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

Create a `.env` file in the root directory and add your Discord Bot Token:

```env
TOKEN=your_discord_bot_token_here
```

### Bot Configuration

The bot uses a configuration file located at `src/config.ts` for guild-specific settings such as Client ID, Guild ID, Channel IDs, and Role IDs.

**Note:** You **must** update `src/config.ts` with your own server's IDs before running the bot, as the default values are hardcoded for a specific server.

```typescript
// src/config.ts
export const config = {
    clientId: "YOUR_CLIENT_ID",
    guildId: "YOUR_GUILD_ID",
    channels: {
        main: "CHANNEL_ID",
        // ... other channels
    },
    roles: {
        // ... role IDs
    },
    // ...
};
```

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
