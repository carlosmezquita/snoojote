CREATE TABLE `shop_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`price` integer NOT NULL,
	`type` text NOT NULL,
	`value` text NOT NULL,
	`emoji` text
);
--> statement-breakpoint
CREATE TABLE `starboard_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`original_message_id` text NOT NULL,
	`original_channel_id` text NOT NULL,
	`starboard_message_id` text
);
--> statement-breakpoint
CREATE INDEX `starboard_original_message_id_idx` ON `starboard_messages` (`original_message_id`);--> statement-breakpoint
CREATE TABLE `streaks` (
	`user_id` text PRIMARY KEY NOT NULL,
	`streak` integer DEFAULT 0 NOT NULL,
	`highest_streak` integer DEFAULT 0 NOT NULL,
	`last_streak_date` text
);
--> statement-breakpoint
CREATE TABLE `tickets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`channel_id` text NOT NULL,
	`user_id` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` integer DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`first_response_at` integer
);
--> statement-breakpoint
CREATE INDEX `tickets_channel_id_idx` ON `tickets` (`channel_id`);--> statement-breakpoint
CREATE INDEX `tickets_user_status_idx` ON `tickets` (`user_id`,`status`);--> statement-breakpoint
CREATE TABLE `user_inventory` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`item_id` integer NOT NULL,
	`acquired_at` integer DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `shop_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `inventory_user_item_idx` ON `user_inventory` (`user_id`,`item_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`user_id` text PRIMARY KEY NOT NULL,
	`points` integer DEFAULT 0 NOT NULL,
	`level` integer DEFAULT 1 NOT NULL,
	`daily_quest` text,
	`last_daily` integer,
	`last_activity_date` integer
);
