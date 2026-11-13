CREATE TABLE `voice_sessions` (
	`guild_id` text NOT NULL,
	`user_id` text NOT NULL,
	`channel_id` text,
	`session_id` text,
	`cursor` integer NOT NULL,
	`confirmed_at` integer NOT NULL,
	`revision` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `voice_membership` ON `voice_sessions` (`guild_id`,`user_id`);