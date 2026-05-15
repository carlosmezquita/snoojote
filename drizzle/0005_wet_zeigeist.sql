CREATE TABLE `daily_word_cache` (
	`date_key` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`word` text,
	`definition_data` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`first_attempt_at` integer,
	`last_attempt_at` integer,
	`next_attempt_at` integer,
	`prepared_at` integer,
	`posted_at` integer,
	`last_error` text
);
