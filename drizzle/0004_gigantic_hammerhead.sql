CREATE TABLE `economy_daily_earnings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`date_key` text NOT NULL,
	`source` text NOT NULL,
	`amount` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `economy_daily_user_date_source_idx` ON `economy_daily_earnings` (`user_id`,`date_key`,`source`);
