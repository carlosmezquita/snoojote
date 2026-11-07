CREATE TABLE `gateway_drain` (
	`owner` text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE `gateway_work` (
	`key` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`resource` text,
	`started` integer NOT NULL,
	`finished` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `gateway_work_drain` ON `gateway_work` (`owner`,`finished`);--> statement-breakpoint
CREATE TABLE `invite_baselines` (
	`guild_id` text PRIMARY KEY NOT NULL,
	`uses` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `shop_confirmations` (
	`id` text PRIMARY KEY NOT NULL,
	`guild_id` text NOT NULL,
	`user_id` text NOT NULL,
	`item_name` text NOT NULL,
	`price` integer NOT NULL,
	`expires` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `starboard_refresh` (
	`message_id` text PRIMARY KEY NOT NULL,
	`channel_id` text NOT NULL,
	`revision` integer NOT NULL,
	`due` integer NOT NULL
);
