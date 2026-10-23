CREATE TABLE `company_records` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_id` text NOT NULL,
	`slug` text NOT NULL,
	`revision` integer NOT NULL,
	`digest` text NOT NULL,
	`generation_id` text,
	`body` text NOT NULL,
	`accepted_at` text NOT NULL,
	FOREIGN KEY (`entity_id`) REFERENCES `entity_registry`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `company_record_digest` ON `company_records` (`digest`);--> statement-breakpoint
CREATE UNIQUE INDEX `company_record_revision` ON `company_records` (`entity_id`,`revision`);--> statement-breakpoint
CREATE INDEX `company_slug` ON `company_records` (`slug`,`revision`);--> statement-breakpoint
CREATE TABLE `entity_registry` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`canonical_key` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `entity_canonical_key` ON `entity_registry` (`canonical_key`);--> statement-breakpoint
CREATE TABLE `page_leases` (
	`page_id` integer PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `publications` (
	`id` text PRIMARY KEY NOT NULL,
	`record_id` text NOT NULL,
	`entity_id` text NOT NULL,
	`page_id` integer NOT NULL,
	`title` text NOT NULL,
	`state` text NOT NULL,
	`body` text NOT NULL,
	`managed_digest` text NOT NULL,
	`new_revision` integer,
	`error` text,
	`receipt` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`record_id`) REFERENCES `company_records`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `publication_page` ON `publications` (`page_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `record_claims` (
	`id` text PRIMARY KEY NOT NULL,
	`record_id` text NOT NULL,
	`claim_id` text NOT NULL,
	`subject_id` text NOT NULL,
	`predicate` text NOT NULL,
	`state` text NOT NULL,
	`body` text NOT NULL,
	FOREIGN KEY (`record_id`) REFERENCES `company_records`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `claims_record` ON `record_claims` (`record_id`);--> statement-breakpoint
CREATE TABLE `record_evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`record_id` text NOT NULL,
	`source_id` text NOT NULL,
	`digest` text NOT NULL,
	`body` text NOT NULL,
	FOREIGN KEY (`record_id`) REFERENCES `company_records`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `evidence_record` ON `record_evidence` (`record_id`);--> statement-breakpoint
CREATE TABLE `workflow_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`state` text NOT NULL,
	`operation_id` text,
	`generation_id` text,
	`record_id` text,
	`body` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
