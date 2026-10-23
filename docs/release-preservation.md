# Exact public release preservation

Every new service release captures `entitywiki.public-release/1`: canonical UTF-8 JSON containing exactly the sanitized public `record`, `jsonld` and `graph` projection. SHA-256 of these bytes is the existing approved release digest. A second digest binds the artifact to the complete canonical accepted record, without copying that private record into the export.

The release ledger row and artifact insert share one D1 batch transaction. Failure to save the artifact rolls back the release pointer. Identical concurrent or repeated releases return the existing complete release after validating the archived bytes and record binding. SQLite triggers reject artifact updates and deletes. No service route replaces an artifact.

Apply the generated `0002_flowery_hemingway.sql` migration before running the new release code. It creates the artifact table and immutability triggers; it does not rewrite existing releases or records. Keep this database, source revision and migration files together in the private backup.

An authenticated operator can download `GET /api/releases/{web_release_id}/artifact`. The route uses the same operator authentication as all private APIs and returns `Cache-Control: no-store`. It returns exact captured bytes as `projectionCanonical`, the projection and accepted-record digest, capture time and non-sensitive release identifiers. It omits actor, operator reason, raw accepted record, credentials and sources excluded by publication permissions. Anonymous public APIs do not expose this export.

Before export, the service verifies canonical bytes, their SHA-256, the release and accepted-record identity binding, the accepted-record digest, format and capture-time binding. Export reads archived bytes without regenerating an old projection through the current compiler. A corrupt binding or digest stops the export. Public serving still recomputes the current projection and fails closed if it differs from the approved release digest; preservation does not bypass that existing review gate.

Older digest-only releases remain explicit historical gaps. Their exact bytes cannot be recovered from a digest, so the export reports that they were not captured. An operator may review and release the current projection as a new sequence, including when its digest matches the legacy release. The old release is never silently backfilled or reported as a captured replay.

This preserves machine-readable public projections, not historical rendered HTML, CSS, fonts or screenshots. Preserve the associated application source/build and database backup for a complete rendering reconstruction. The new migration has only been validated locally until staging deployment is separately performed; no original MediaWiki data, production configuration or DNS is changed by this feature.
