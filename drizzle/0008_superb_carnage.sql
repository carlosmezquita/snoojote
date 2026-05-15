PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_tickets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`channel_id` text NOT NULL,
	`user_id` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`first_response_at` integer,
	`closed_at` integer,
	`closed_by` text,
	`close_reason` text,
	`deleted_at` integer,
	`claimed_by` text,
	`staff_online_at_creation` integer,
	`open_tickets_at_creation` integer
);
--> statement-breakpoint
INSERT INTO `__new_tickets`("id", "channel_id", "user_id", "status", "created_at", "first_response_at", "closed_at", "closed_by", "close_reason", "deleted_at", "claimed_by", "staff_online_at_creation", "open_tickets_at_creation") SELECT "id", "channel_id", "user_id", "status", CASE WHEN typeof("created_at") = 'text' THEN unixepoch("created_at") ELSE "created_at" END, CASE WHEN typeof("first_response_at") = 'text' THEN unixepoch("first_response_at") ELSE "first_response_at" END, CASE WHEN typeof("closed_at") = 'text' THEN unixepoch("closed_at") ELSE "closed_at" END, "closed_by", "close_reason", CASE WHEN typeof("deleted_at") = 'text' THEN unixepoch("deleted_at") ELSE "deleted_at" END, "claimed_by", "staff_online_at_creation", "open_tickets_at_creation" FROM `tickets`;--> statement-breakpoint
DROP TABLE `tickets`;--> statement-breakpoint
ALTER TABLE `__new_tickets` RENAME TO `tickets`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `tickets_channel_id_idx` ON `tickets` (`channel_id`);--> statement-breakpoint
CREATE INDEX `tickets_user_status_idx` ON `tickets` (`user_id`,`status`);
