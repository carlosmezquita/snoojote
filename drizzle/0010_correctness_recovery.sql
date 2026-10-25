CREATE TABLE `shop_purchases` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`guild_id` text NOT NULL,
	`item_id` integer NOT NULL,
	`price` integer NOT NULL,
	`role_id` text,
	`role_was_owned` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`last_error` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shop_purchase_pending_user_idx` ON `shop_purchases` (`user_id`) WHERE "shop_purchases"."status" = 'pending';--> statement-breakpoint
ALTER TABLE `tickets` ADD `guild_id` text;--> statement-breakpoint
ALTER TABLE `tickets` ADD `unanswered_tickets_at_creation` integer;