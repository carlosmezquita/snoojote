CREATE TABLE `economy_transaction_locks` (
	`lock_key` text PRIMARY KEY NOT NULL,
	`created_at` integer DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
