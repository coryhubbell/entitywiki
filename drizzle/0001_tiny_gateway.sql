CREATE TABLE `identity_aliases` (
	`key` text PRIMARY KEY NOT NULL,
	`entity_id` text NOT NULL,
	`alias_type` text NOT NULL,
	`value` text NOT NULL,
	`reason` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`entity_id`) REFERENCES `entity_registry`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `identity_alias_entity` ON `identity_aliases` (`entity_id`);--> statement-breakpoint
CREATE TABLE `web_releases` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_id` text NOT NULL,
	`record_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`previous_release_id` text,
	`actor` text NOT NULL,
	`reason` text NOT NULL,
	`digest` text NOT NULL,
	`released_at` text NOT NULL,
	FOREIGN KEY (`entity_id`) REFERENCES `entity_registry`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`record_id`) REFERENCES `company_records`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `web_release_entity_sequence` ON `web_releases` (`entity_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `web_release_record` ON `web_releases` (`record_id`);