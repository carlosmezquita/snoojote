import { sqliteTable, integer, text, index, uniqueIndex, real } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const tickets = sqliteTable(
    'tickets',
    {
        id: integer('id').primaryKey({ autoIncrement: true }),
        channelId: text('channel_id').notNull(),
        userId: text('user_id').notNull(),
        optionId: text('option_id'),
        status: text('status').default('open').notNull(),
        createdAt: integer('created_at', { mode: 'timestamp' })
            .default(sql`(unixepoch())`)
            .notNull(),
        firstResponseAt: integer('first_response_at', { mode: 'timestamp' }),
        firstResponseBy: text('first_response_by'),
        closedAt: integer('closed_at', { mode: 'timestamp' }),
        closedBy: text('closed_by'),
        closeReason: text('close_reason'),
        deletedAt: integer('deleted_at', { mode: 'timestamp' }),
        claimedBy: text('claimed_by'),
        staffOnlineAtCreation: integer('staff_online_at_creation'),
        staffCapacityAtCreation: real('staff_capacity_at_creation'),
        openTicketsAtCreation: integer('open_tickets_at_creation'),
    },
    (table) => ({
        // Optimizes ticket closure and lookup by channel
        channelIdIdx: index('tickets_channel_id_idx').on(table.channelId),
        // Optimizes finding open tickets for a user
        userStatusIdx: index('tickets_user_status_idx').on(table.userId, table.status),
    }),
);

export const ticketStaffActivity = sqliteTable(
    'ticket_staff_activity',
    {
        id: integer('id').primaryKey({ autoIncrement: true }),
        ticketId: integer('ticket_id')
            .references(() => tickets.id, { onDelete: 'cascade' })
            .notNull(),
        staffId: text('staff_id').notNull(),
        action: text('action').notNull(),
        messageId: text('message_id'),
        occurredAt: integer('occurred_at', { mode: 'timestamp' })
            .default(sql`(unixepoch())`)
            .notNull(),
        responseTimeMs: integer('response_time_ms'),
    },
    (table) => ({
        ticketOccurredAtIdx: index('ticket_staff_activity_ticket_occurred_at_idx').on(
            table.ticketId,
            table.occurredAt,
        ),
        staffOccurredAtIdx: index('ticket_staff_activity_staff_occurred_at_idx').on(
            table.staffId,
            table.occurredAt,
        ),
    }),
);

export const ticketWaitEstimateSnapshots = sqliteTable(
    'ticket_wait_estimate_snapshots',
    {
        id: integer('id').primaryKey({ autoIncrement: true }),
        ticketId: integer('ticket_id')
            .references(() => tickets.id, { onDelete: 'cascade' })
            .notNull(),
        modelVersion: text('model_version').notNull(),
        estimatedMs: integer('estimated_ms').notNull(),
        factorDetails: text('factor_details', { mode: 'json' }).notNull(),
        createdAt: integer('created_at', { mode: 'timestamp' })
            .default(sql`(unixepoch())`)
            .notNull(),
    },
    (table) => ({
        ticketCreatedAtIdx: index('ticket_wait_estimate_snapshots_ticket_created_at_idx').on(
            table.ticketId,
            table.createdAt,
        ),
    }),
);

export const streaks = sqliteTable('streaks', {
    userId: text('user_id').primaryKey(),
    streak: integer('streak').default(0).notNull(),
    highestStreak: integer('highest_streak').default(0).notNull(),
    lastStreakDate: text('last_streak_date'),
    lastStreakAt: integer('last_streak_at', { mode: 'timestamp' }),
    claimedMilestones: text('claimed_milestones', { mode: 'json' }).default(sql`'[]'`),
});

export const users = sqliteTable('users', {
    userId: text('user_id').primaryKey(),
    points: integer('points').default(0).notNull(),
    level: integer('level').default(1).notNull(),
    dailyQuest: text('daily_quest', { mode: 'json' }), // Stores QuestData
    lastDaily: integer('last_daily', { mode: 'timestamp' }),
    lastActivityDate: integer('last_activity_date', { mode: 'timestamp' }),
});

export const economyDailyEarnings = sqliteTable(
    'economy_daily_earnings',
    {
        id: integer('id').primaryKey({ autoIncrement: true }),
        userId: text('user_id').notNull(),
        dateKey: text('date_key').notNull(),
        source: text('source').notNull(),
        amount: integer('amount').default(0).notNull(),
    },
    (table) => ({
        userDateSourceIdx: uniqueIndex('economy_daily_user_date_source_idx').on(
            table.userId,
            table.dateKey,
            table.source,
        ),
    }),
);

export const dailyWordCache = sqliteTable('daily_word_cache', {
    dateKey: text('date_key').primaryKey(),
    status: text('status').default('pending').notNull(),
    word: text('word'),
    definitionData: text('definition_data', { mode: 'json' }),
    attempts: integer('attempts').default(0).notNull(),
    firstAttemptAt: integer('first_attempt_at', { mode: 'timestamp' }),
    lastAttemptAt: integer('last_attempt_at', { mode: 'timestamp' }),
    nextAttemptAt: integer('next_attempt_at', { mode: 'timestamp' }),
    preparedAt: integer('prepared_at', { mode: 'timestamp' }),
    postedAt: integer('posted_at', { mode: 'timestamp' }),
    lastError: text('last_error'),
});

export const starboardMessages = sqliteTable(
    'starboard_messages',
    {
        id: integer('id').primaryKey({ autoIncrement: true }),
        originalMessageId: text('original_message_id').notNull(),
        originalChannelId: text('original_channel_id').notNull(),
        starboardMessageId: text('starboard_message_id'),
    },
    (table) => ({
        // Optimizes checking if a message is already on the starboard
        originalMessageIdIdx: index('starboard_original_message_id_idx').on(
            table.originalMessageId,
        ),
    }),
);

export const shopItems = sqliteTable('shop_items', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    description: text('description').notNull(),
    price: integer('price').notNull(),
    type: text('type').notNull(), // 'ROLE' or 'COLLECTIBLE'
    value: text('value').notNull(), // Role ID or Image URL
    emoji: text('emoji'), // Display Emoji
});

export const userInventory = sqliteTable(
    'user_inventory',
    {
        id: integer('id').primaryKey({ autoIncrement: true }),
        userId: text('user_id').notNull(),
        itemId: integer('item_id')
            .references(() => shopItems.id, { onDelete: 'cascade' })
            .notNull(),
        acquiredAt: integer('acquired_at', { mode: 'timestamp' })
            .default(sql`(CURRENT_TIMESTAMP)`)
            .notNull(),
    },
    (table) => ({
        // Optimizes checking if a user owns a specific item
        userItemIdx: index('inventory_user_item_idx').on(table.userId, table.itemId),
    }),
);

export const shopPurchaseLocks = sqliteTable('shop_purchase_locks', {
    lockKey: text('lock_key').primaryKey(),
    userId: text('user_id').notNull(),
    itemId: integer('item_id').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' })
        .default(sql`(unixepoch())`)
        .notNull(),
});

export const economyTransactionLocks = sqliteTable('economy_transaction_locks', {
    lockKey: text('lock_key').primaryKey(),
    createdAt: integer('created_at', { mode: 'timestamp' })
        .default(sql`(unixepoch())`)
        .notNull(),
});
