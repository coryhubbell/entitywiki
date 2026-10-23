CREATE TABLE `legacy_pages` (
	`id` text PRIMARY KEY NOT NULL,
	`snapshot_id` text NOT NULL,
	`page_id` integer NOT NULL,
	`stable_page_id` text NOT NULL,
	`namespace` integer NOT NULL,
	`title` text NOT NULL,
	`classification` text NOT NULL,
	`latest_captured_revision_id` integer NOT NULL,
	`observed_latest_revision_id` integer,
	`digest` text NOT NULL,
	`body` text NOT NULL,
	FOREIGN KEY (`snapshot_id`) REFERENCES `legacy_snapshots`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `legacy_page_identity` ON `legacy_pages` (`snapshot_id`,`page_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `legacy_page_title` ON `legacy_pages` (`snapshot_id`,`title`);--> statement-breakpoint
CREATE INDEX `legacy_namespace` ON `legacy_pages` (`snapshot_id`,`namespace`);--> statement-breakpoint
CREATE TABLE `legacy_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`snapshot_id` text NOT NULL,
	`page_id` integer NOT NULL,
	`revision_id` integer NOT NULL,
	`digest` text NOT NULL,
	`body` text NOT NULL,
	FOREIGN KEY (`snapshot_id`) REFERENCES `legacy_snapshots`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `legacy_revision_identity` ON `legacy_revisions` (`snapshot_id`,`revision_id`);--> statement-breakpoint
CREATE INDEX `legacy_revision_history` ON `legacy_revisions` (`snapshot_id`,`page_id`,`revision_id`);--> statement-breakpoint
CREATE TABLE `legacy_routes` (
	`id` text PRIMARY KEY NOT NULL,
	`snapshot_id` text NOT NULL,
	`page_id` integer NOT NULL,
	`revision_id` integer,
	`url` text NOT NULL,
	`route_kind` text NOT NULL,
	`digest` text NOT NULL,
	`body` text NOT NULL,
	FOREIGN KEY (`snapshot_id`) REFERENCES `legacy_snapshots`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `legacy_route_url` ON `legacy_routes` (`snapshot_id`,`url`);--> statement-breakpoint
CREATE INDEX `legacy_route_page` ON `legacy_routes` (`snapshot_id`,`page_id`);--> statement-breakpoint
CREATE TABLE `legacy_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`source_key` text NOT NULL,
	`state` text NOT NULL,
	`descriptor` text NOT NULL,
	`created_at` text NOT NULL,
	`ready_at` text
);
--> statement-breakpoint
CREATE INDEX `legacy_snapshot_ready` ON `legacy_snapshots` (`state`,`ready_at`);
--> statement-breakpoint
CREATE TRIGGER `legacy_pages_immutable_update` BEFORE UPDATE ON `legacy_pages` BEGIN SELECT RAISE(ABORT, 'Legacy captured records are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `legacy_pages_immutable_delete` BEFORE DELETE ON `legacy_pages` BEGIN SELECT RAISE(ABORT, 'Legacy captured records are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `legacy_pages_insert_guard` BEFORE INSERT ON `legacy_pages`
BEGIN
  SELECT CASE WHEN EXISTS (SELECT 1 FROM `legacy_pages` WHERE id=NEW.id AND (digest<>NEW.digest OR body<>NEW.body)) THEN RAISE(ABORT, 'Conflicting immutable legacy record') END;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM `legacy_pages` WHERE id=NEW.id) AND (SELECT state FROM legacy_snapshots WHERE id=NEW.snapshot_id)<>'loading' THEN RAISE(ABORT, 'Legacy snapshot is sealed') END;
END;

--> statement-breakpoint
CREATE TRIGGER `legacy_revisions_immutable_update` BEFORE UPDATE ON `legacy_revisions` BEGIN SELECT RAISE(ABORT, 'Legacy captured records are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `legacy_revisions_immutable_delete` BEFORE DELETE ON `legacy_revisions` BEGIN SELECT RAISE(ABORT, 'Legacy captured records are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `legacy_revisions_insert_guard` BEFORE INSERT ON `legacy_revisions`
BEGIN
  SELECT CASE WHEN EXISTS (SELECT 1 FROM `legacy_revisions` WHERE id=NEW.id AND (digest<>NEW.digest OR body<>NEW.body)) THEN RAISE(ABORT, 'Conflicting immutable legacy record') END;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM `legacy_revisions` WHERE id=NEW.id) AND (SELECT state FROM legacy_snapshots WHERE id=NEW.snapshot_id)<>'loading' THEN RAISE(ABORT, 'Legacy snapshot is sealed') END;
END;

--> statement-breakpoint
CREATE TRIGGER `legacy_routes_immutable_update` BEFORE UPDATE ON `legacy_routes` BEGIN SELECT RAISE(ABORT, 'Legacy captured records are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `legacy_routes_immutable_delete` BEFORE DELETE ON `legacy_routes` BEGIN SELECT RAISE(ABORT, 'Legacy captured records are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `legacy_routes_insert_guard` BEFORE INSERT ON `legacy_routes`
BEGIN
  SELECT CASE WHEN EXISTS (SELECT 1 FROM `legacy_routes` WHERE id=NEW.id AND (digest<>NEW.digest OR body<>NEW.body)) THEN RAISE(ABORT, 'Conflicting immutable legacy record') END;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM `legacy_routes` WHERE id=NEW.id) AND (SELECT state FROM legacy_snapshots WHERE id=NEW.snapshot_id)<>'loading' THEN RAISE(ABORT, 'Legacy snapshot is sealed') END;
END;

--> statement-breakpoint
CREATE TRIGGER legacy_revision_source_identity BEFORE INSERT ON legacy_revisions
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM legacy_revisions r JOIN legacy_snapshots old ON old.id=r.snapshot_id JOIN legacy_snapshots incoming ON incoming.id=NEW.snapshot_id
    WHERE old.source_key=incoming.source_key AND r.revision_id=NEW.revision_id AND r.page_id<>NEW.page_id
  ) THEN RAISE(ABORT, 'Original revision ID belongs to another source page') END;
END;
--> statement-breakpoint
CREATE TRIGGER legacy_snapshot_immutable_delete BEFORE DELETE ON legacy_snapshots BEGIN SELECT RAISE(ABORT, 'Legacy snapshot records are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER legacy_snapshot_transition BEFORE UPDATE ON legacy_snapshots
BEGIN
  SELECT CASE WHEN NEW.id<>OLD.id OR NEW.source_key<>OLD.source_key OR NEW.descriptor<>OLD.descriptor OR NEW.created_at<>OLD.created_at OR OLD.state<>'loading' OR NEW.state<>'ready' OR NEW.ready_at IS NULL THEN RAISE(ABORT, 'Invalid immutable legacy snapshot transition') END;
  SELECT CASE WHEN (SELECT COUNT(*) FROM legacy_pages WHERE snapshot_id=NEW.id)<>json_extract(NEW.descriptor,'$.expected.pages') OR (SELECT COUNT(*) FROM legacy_revisions WHERE snapshot_id=NEW.id)<>json_extract(NEW.descriptor,'$.expected.revisions') OR (SELECT COUNT(*) FROM legacy_routes WHERE snapshot_id=NEW.id)<>json_extract(NEW.descriptor,'$.expected.routes') THEN RAISE(ABORT, 'Legacy snapshot record counts differ') END;
  SELECT CASE WHEN EXISTS (SELECT 1 FROM legacy_revisions r LEFT JOIN legacy_pages p ON p.snapshot_id=r.snapshot_id AND p.page_id=r.page_id WHERE r.snapshot_id=NEW.id AND p.page_id IS NULL) THEN RAISE(ABORT, 'Legacy revision has no captured page') END;
  SELECT CASE WHEN EXISTS (SELECT 1 FROM legacy_pages p WHERE p.snapshot_id=NEW.id AND p.latest_captured_revision_id<>(SELECT MAX(r.revision_id) FROM legacy_revisions r WHERE r.snapshot_id=p.snapshot_id AND r.page_id=p.page_id)) OR EXISTS (SELECT 1 FROM legacy_pages p WHERE p.snapshot_id=NEW.id AND NOT EXISTS (SELECT 1 FROM legacy_revisions r WHERE r.snapshot_id=p.snapshot_id AND r.page_id=p.page_id)) THEN RAISE(ABORT, 'Legacy latest captured revision is missing or differs') END;
  SELECT CASE WHEN EXISTS (SELECT 1 FROM legacy_routes r LEFT JOIN legacy_pages p ON p.snapshot_id=r.snapshot_id AND p.page_id=r.page_id WHERE r.snapshot_id=NEW.id AND p.page_id IS NULL) THEN RAISE(ABORT, 'Legacy route has no captured page') END;
  SELECT CASE WHEN EXISTS (SELECT 1 FROM legacy_routes u LEFT JOIN legacy_revisions r ON r.snapshot_id=u.snapshot_id AND r.revision_id=u.revision_id AND r.page_id=u.page_id WHERE u.snapshot_id=NEW.id AND u.revision_id IS NOT NULL AND r.revision_id IS NULL) THEN RAISE(ABORT, 'Legacy route revision belongs to another page or is missing') END;
END;
