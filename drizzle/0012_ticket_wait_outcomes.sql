ALTER TABLE `tickets` ADD `wait_outcome` text;--> statement-breakpoint
ALTER TABLE `tickets` ADD `wait_ended_at` integer;--> statement-breakpoint
ALTER TABLE `tickets` ADD `requester_unavailable_at` integer;