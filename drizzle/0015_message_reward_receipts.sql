CREATE TABLE `message_reward_receipts` (
	`message_id` text PRIMARY KEY NOT NULL,
	`guild_id` text NOT NULL,
	`user_id` text NOT NULL,
	`sent_at` integer NOT NULL,
	`reward_eligible` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `message_reward_cooldown` ON `message_reward_receipts` (`guild_id`,`user_id`,`sent_at`) WHERE "message_reward_receipts"."reward_eligible" = 1;