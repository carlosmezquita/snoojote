ALTER TABLE `tickets` ADD `closed_by` text;--> statement-breakpoint
ALTER TABLE `tickets` ADD `close_reason` text;--> statement-breakpoint
ALTER TABLE `tickets` ADD `deleted_at` integer;--> statement-breakpoint
ALTER TABLE `tickets` ADD `claimed_by` text;