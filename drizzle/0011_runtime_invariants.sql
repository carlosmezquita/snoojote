DROP TABLE `economy_transaction_locks`;--> statement-breakpoint
DROP TABLE `shop_purchase_locks`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_user_inventory` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`item_id` integer NOT NULL,
	`acquired_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `shop_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_user_inventory`("id", "user_id", "item_id", "acquired_at") SELECT "id", "user_id", "item_id", CASE WHEN typeof("acquired_at") = 'text' THEN coalesce(unixepoch("acquired_at"), unixepoch()) ELSE "acquired_at" END FROM `user_inventory`;--> statement-breakpoint
DROP TABLE `user_inventory`;--> statement-breakpoint
ALTER TABLE `__new_user_inventory` RENAME TO `user_inventory`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `inventory_user_item_idx` ON `user_inventory` (`user_id`,`item_id`);--> statement-breakpoint
CREATE INDEX `tickets_answered_created_idx` ON `tickets` (`created_at`) WHERE "tickets"."first_response_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `tickets_first_response_idx` ON `tickets` (`first_response_at`);--> statement-breakpoint
CREATE TABLE `__new_users` (
	`user_id` text PRIMARY KEY NOT NULL,
	`points` integer DEFAULT 0 NOT NULL,
	`level` integer DEFAULT 1 NOT NULL,
	`daily_quest` text,
	`last_daily` integer,
	`last_activity_date` integer,
	CONSTRAINT "users_points_safe_integer" CHECK(typeof("__new_users"."points") = 'integer' AND "__new_users"."points" BETWEEN 0 AND 9007199254740991)
);
--> statement-breakpoint
INSERT INTO `__new_users`("user_id", "points", "level", "daily_quest", "last_daily", "last_activity_date") SELECT "user_id", "points", "level", "daily_quest", "last_daily", "last_activity_date" FROM `users`;--> statement-breakpoint
DROP TABLE `users`;--> statement-breakpoint
ALTER TABLE `__new_users` RENAME TO `users`;