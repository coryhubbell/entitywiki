CREATE TABLE `web_release_artifacts` (
	`release_id` text PRIMARY KEY NOT NULL,
	`format` text NOT NULL,
	`record_digest` text NOT NULL,
	`digest` text NOT NULL,
	`body` text NOT NULL,
	`captured_at` text NOT NULL,
	FOREIGN KEY (`release_id`) REFERENCES `web_releases`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TRIGGER `web_release_artifacts_immutable_update`
BEFORE UPDATE ON `web_release_artifacts`
BEGIN
  SELECT RAISE(ABORT, 'Public release artifacts are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `web_release_artifacts_immutable_delete`
BEFORE DELETE ON `web_release_artifacts`
BEGIN
  SELECT RAISE(ABORT, 'Public release artifacts are immutable');
END;
