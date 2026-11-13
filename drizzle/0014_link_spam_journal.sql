CREATE TABLE `link_spam_events` (
	`message_id` text PRIMARY KEY NOT NULL,
	`guild_id` text NOT NULL,
	`user_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`observed_at` integer NOT NULL,
	`window_start` integer NOT NULL,
	`count` integer NOT NULL,
	`required` integer NOT NULL,
	`claimed` integer DEFAULT 0 NOT NULL,
	`finished` integer DEFAULT 0 NOT NULL,
	`done` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `link_spam_member_window` ON `link_spam_events` (`guild_id`,`user_id`,`window_start`,`count`);--> statement-breakpoint
CREATE INDEX `link_spam_pending` ON `link_spam_events` (`done`,`observed_at`);