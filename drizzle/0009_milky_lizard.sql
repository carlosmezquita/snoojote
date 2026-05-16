CREATE TABLE `ticket_staff_activity` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ticket_id` integer NOT NULL,
	`staff_id` text NOT NULL,
	`action` text NOT NULL,
	`message_id` text,
	`occurred_at` integer DEFAULT (unixepoch()) NOT NULL,
	`response_time_ms` integer,
	FOREIGN KEY (`ticket_id`) REFERENCES `tickets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ticket_staff_activity_ticket_occurred_at_idx` ON `ticket_staff_activity` (`ticket_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `ticket_staff_activity_staff_occurred_at_idx` ON `ticket_staff_activity` (`staff_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `ticket_wait_estimate_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ticket_id` integer NOT NULL,
	`model_version` text NOT NULL,
	`estimated_ms` integer NOT NULL,
	`factor_details` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`ticket_id`) REFERENCES `tickets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ticket_wait_estimate_snapshots_ticket_created_at_idx` ON `ticket_wait_estimate_snapshots` (`ticket_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `tickets` ADD `option_id` text;--> statement-breakpoint
ALTER TABLE `tickets` ADD `first_response_by` text;--> statement-breakpoint
ALTER TABLE `tickets` ADD `staff_capacity_at_creation` real;
