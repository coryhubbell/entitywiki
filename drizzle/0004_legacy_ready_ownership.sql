-- Loading captures are untrusted provisional data. Only sealed captures establish
-- cross-capture revision ownership; the atomic ready transition resolves races.
DROP TRIGGER legacy_revision_source_identity;
--> statement-breakpoint
CREATE TRIGGER legacy_revision_source_identity BEFORE INSERT ON legacy_revisions
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM legacy_revisions r JOIN legacy_snapshots old ON old.id=r.snapshot_id JOIN legacy_snapshots incoming ON incoming.id=NEW.snapshot_id
    WHERE old.state='ready' AND old.source_key=incoming.source_key AND r.revision_id=NEW.revision_id AND r.page_id<>NEW.page_id
  ) THEN RAISE(ABORT, 'Original revision ID belongs to another source page') END;
END;
--> statement-breakpoint
CREATE TRIGGER legacy_snapshot_ready_revision_identity BEFORE UPDATE OF state ON legacy_snapshots
WHEN NEW.state='ready'
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM legacy_revisions incoming JOIN legacy_revisions prior ON prior.revision_id=incoming.revision_id AND prior.page_id<>incoming.page_id JOIN legacy_snapshots accepted ON accepted.id=prior.snapshot_id
    WHERE incoming.snapshot_id=NEW.id AND accepted.id<>NEW.id AND accepted.state='ready' AND accepted.source_key=NEW.source_key
  ) THEN RAISE(ABORT, 'Original revision ID belongs to another source page') END;
END;
