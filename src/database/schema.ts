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
    xp: integer('xp').default(0).notNull(),
    level: integer('level').default(1).notNull(),
});

export const starboardMessages = sqliteTable('starboard_messages', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    originalMessageId: text('original_message_id').notNull(),
    originalChannelId: text('original_channel_id').notNull(),
    starboardMessageId: text('starboard_message_id'),
});
