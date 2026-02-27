PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_user_inventory` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`item_id` integer NOT NULL,
	`acquired_at` integer DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `shop_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_user_inventory`("id", "user_id", "item_id", "acquired_at") SELECT "id", "user_id", "item_id", "acquired_at" FROM `user_inventory`;--> statement-breakpoint
DROP TABLE `user_inventory`;--> statement-breakpoint
ALTER TABLE `__new_user_inventory` RENAME TO `user_inventory`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `inventory_user_item_idx` ON `user_inventory` (`user_id`,`item_id`);--> statement-breakpoint
ALTER TABLE `tickets` ADD `closed_at` integer;--> statement-breakpoint
ALTER TABLE `tickets` ADD `staff_online_at_creation` integer;--> statement-breakpoint
ALTER TABLE `tickets` ADD `open_tickets_at_creation` integer;