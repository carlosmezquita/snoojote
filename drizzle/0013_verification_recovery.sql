CREATE TABLE `verification_checkpoint` (
	`guild_id` text PRIMARY KEY NOT NULL,
	`observed_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `verification_journal` (
	`membership` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`challenge` text
);
