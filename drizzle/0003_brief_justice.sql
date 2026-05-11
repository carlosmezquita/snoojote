ALTER TABLE `streaks` ADD `last_streak_at` integer;--> statement-breakpoint
ALTER TABLE `streaks` ADD `claimed_milestones` text DEFAULT '[]';