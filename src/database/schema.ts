import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const tickets = sqliteTable('tickets', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    channelId: text('channel_id').notNull(),
    userId: text('user_id').notNull(),
    status: text('status').default('open').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(CURRENT_TIMESTAMP)`).notNull(),
    firstResponseAt: integer('first_response_at', { mode: 'timestamp' }),
});

export const streaks = sqliteTable('streaks', {
    userId: text('user_id').primaryKey(),
    streak: integer('streak').default(0).notNull(),
    highestStreak: integer('highest_streak').default(0).notNull(),
    lastStreakDate: text('last_streak_date'),
});

export const users = sqliteTable('users', {
    userId: text('user_id').primaryKey(),
    points: integer('points').default(0).notNull(),
    level: integer('level').default(1).notNull(),
    dailyQuest: text('daily_quest', { mode: 'json' }), // Stores QuestData
    lastDaily: integer('last_daily', { mode: 'timestamp' }),
    lastActivityDate: integer('last_activity_date', { mode: 'timestamp' }),
});

export const starboardMessages = sqliteTable('starboard_messages', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    originalMessageId: text('original_message_id').notNull(),
    originalChannelId: text('original_channel_id').notNull(),
    starboardMessageId: text('starboard_message_id'),
});

export const shopItems = sqliteTable('shop_items', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    description: text('description').notNull(),
    price: integer('price').notNull(),
    type: text('type').notNull(), // 'ROLE' or 'COLLECTIBLE'
    value: text('value').notNull(), // Role ID or Image URL
});

export const userInventory = sqliteTable('user_inventory', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: text('user_id').notNull(),
    itemId: integer('item_id').references(() => shopItems.id).notNull(),
    acquiredAt: integer('acquired_at', { mode: 'timestamp' }).default(sql`(CURRENT_TIMESTAMP)`).notNull(),
});
