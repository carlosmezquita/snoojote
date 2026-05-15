CREATE TABLE `shop_purchase_locks` (
	`lock_key` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`item_id` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
