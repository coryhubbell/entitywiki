# EntityWiki original-backup restoration runbook

**Destination:** separate Cloudways application **6746716**, server **1682612**, temporary hostname, PHP **8.2**, MariaDB **10.11** (verify actual versions before execution). **Original source:** MediaWiki **1.39.1**, PHP **8.1.34**, MariaDB **10.5.26**. Keep original hosting, `.org` DNS, article URLs and live source data unchanged. No original SQL/files backup has yet been verified by this document.

## 1. Obtain and preserve the original recovery set

Preserve a private immutable copy of the complete original wiki SQL dump, full application/filesystem tree, uploads including archived/deleted/private media, custom assets, `LocalSettings.php` and included configuration, extensions/skins/vendor dependencies, web-server rewrite/access rules, scheduled jobs and external storage dependencies. Capture source versions, database/table prefix, table engines, encoding/collations, dump timestamp and acquisition method. Hash the SQL and file archive bytes; validate decompression/archive listing before import. Store originals, credentials/account data and manifests outside Git and public web roots.

Use a consistent transactional dump for transactional tables without changing the live wiki. A live SQL count taken later is not the dump's snapshot baseline. If nontransactional tables, shared databases, ExternalStore or changing file trees prevent a consistent backup, record that gap and obtain a suitable host snapshot/delta rather than claiming completeness or silently putting production into read-only mode. Do not re-encode or edit the original dump. Preserve MediaWiki accounts and password hashes; map the destination's database connection credentials separately. Do not import the source host's MySQL system users/grants into a managed shared Cloudways server.

The existing public archive (219 exposed pages/1,046 exposed revisions at its earlier boundary) is a supplementary comparison. It cannot replace SQL, deleted/private history, accounts or filesystem recovery, and its historical counts are not hard-coded requirements for a newer SQL snapshot.

## 2. Inspect before running restored PHP

Keep the temporary URL HTTPS/password- or IP-protected with `noindex`. Verify the app's web PHP and app-specific CLI interpreter, enabled extensions, SQL `VERSION()`/family, SQL modes, charset/collation, database user grants, available storage and upload/file permissions. Do not change shared server PHP/database packages or sibling apps.

Inspect the original dump for database selection statements, definers/routines/events, table engines, unsupported collation/options and unexpected schema dependencies. Import only into the isolated destination database with the verified original table prefix. Never run a fresh MediaWiki installer or XML-only import as a substitute: preserving IDs, revision/slot/content/text associations and wiki accounts requires the original database. A failed import is not a successful restore; retain its complete private error log and verify whether the destination is partial before retrying.

## 3. Prepare a staging-only configuration copy

Before the first PHP request or maintenance command, review the copied `LocalSettings.php` **offline**. Preserve the original as backup evidence; modify only the staging copy. A reviewed staging-only override include at the end of that copy is useful, but inspect earlier includes and extension bootstrap code first: an end-of-file override cannot undo a side effect already executed. The staging environment should fail closed if its expected configuration/credentials are absent.

Override and verify:

- Destination database host/name/user/password; retain the original wiki table prefix. Inspect any shared DB/user-table configuration and disconnect production references. If original accounts depend on another authorized database, preserve that dependency in the backup/restoration plan rather than dropping it silently.
- Temporary `$wgServer`/canonical server, script/article/upload paths and local storage roots. Preserve stored article text and original identity IDs; do not globally replace source-domain strings in the database. In staging, retain `/MAXPlaces_Marketing` routing using the cloned rewrite configuration and its destination-specific adjustments.
- Distinct cookie domain/path/prefix, sessions, local cache/Redis/Memcached/search index namespaces, upload/deleted/tmp/cache directories and logs. No cache, session, index or file write may target production or another client app. Review session secret isolation separately from any password-pepper dependency; do not rotate password-related secrets blindly and invalidate recovered accounts.
- Core mail and user-to-user mail disabled. Remove/disable source SMTP/webhook/publication credentials in the staging configuration; review extension/custom-code outbound behavior. No job runner/cron/timer/queue consumer or search-index worker runs until its targets and side effects are verified as staging-only.
- App/web-server `X-Robots-Tag: noindex, nofollow` and access protection; neither robots.txt nor a noindex tag is an authentication boundary. Keep source server/DNS untouched.

Core staging settings supported by MediaWiki include:

```php
$wgEnableEmail = false;
$wgEnableUserEmail = false;
$wgJobRunRate = 0;
$wgReadOnly = 'Private restoration validation';
```

These do not neutralize external cron, extension-owned queues, SMTP libraries or custom publisher code. Disable those separately before loading the clone. Do not run old queued jobs merely to follow a generic upgrade checklist. If a specific job must be tested later, isolate it and record its effect on the staging snapshot.

## 4. Restore first; separate compatibility from upgrade

Restore the complete database and files and retain a pre-execution destination checkpoint. Prefer an unchanged 1.39.1 compatibility rehearsal if its actual extensions/vendor code run on the available app-specific runtime. PHP 8.2 is **not** assumed equivalent to the source's PHP 8.1; inspect fatal errors, deprecations, missing PHP extensions and extension/skin compatibility before changing code. If necessary, use an available app-specific PHP 8.1 compatibility environment, or plan a controlled staging upgrade after the untouched backup baseline is secured. Do not change the shared server runtime.

MariaDB 10.5→10.11 stays in the same database family but does not prove import compatibility. Check SQL modes, binary/character encodings, collation behavior, engine options, privileges and definers. Preserve original dumps; make any necessary reviewed compatibility adjustments in a separately hashed working copy with a recorded diff.

A supported MediaWiki target such as the currently supported 1.43 LTS line can be evaluated on PHP 8.2 with matching extension/skin branches. Reconfirm the exact available supported patch at execution time. Back up staging before schema updates, use the app-specific CLI PHP binary and run updates only against the staging DB. Upgrading may legitimately change schema/cache/derived table counts; record those changes separately from baseline restore equivalence. Never restore a newer schema into older MediaWiki code. No production upgrade is implied.

## 5. Read-only SQL baseline and comparison

`scripts/restore-counts.mjs` only **prints SELECT statements**. It does not connect, accept passwords or execute SQL. Use a SELECT-only connection and independently verify the selected database before running emitted queries.

```sh
node scripts/restore-counts.mjs --prefix ORIGINAL_PREFIX --fingerprints > /private/recovery-validation.sql
```

Use the actual prefix, including an empty prefix when appropriate. Default checks cover the essential 1.39 tables, namespace counts, page/revision/archive/slot/content/text IDs and associations, account/group fingerprints, file-version metadata, and MAXPlaces page 213. Full restoration acceptance **requires** the actual complete inventory passed with `--table-list`; the default core subset alone is insufficient. To count **every** table including extension/custom tables, export a private newline-separated list from this SELECT against the intended schema:

```sql
SELECT TABLE_NAME FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME;
```

Exclude any column header from the table-name list (for example, use the SQL client's `--skip-column-names` option). Pass that list with `--table-list /private/table-names.txt`. An incomplete required-table list or unsafe identifier is rejected. The generator has three local unit tests and has not been executed against the unavailable original database. Actual database acceptance remains pending. Output remains private; even one-way account fingerprints and metadata are recovery evidence. Compare against the untouched backup-baseline restore, not a source that has since accepted more edits.

Acceptance requires matching all restored tables, primary IDs, namespace classifications, live and archived history, slot→content→text mappings, actors/comments, wiki accounts/groups/preferences/permissions, redirects, files and extension-owned data. Investigate any missing required columns rather than suppressing errors. External content storage requires its own preserved backing data. Orphan checks should be zero or match explicitly recorded preexisting source conditions; no new orphan is accepted. Ordered row fingerprints and counts supplement original SQL/files checksums; they are not a replacement for complete backup validation.

## 6. URL, behavior and all-client acceptance

- `/MAXPlaces_Marketing` resolves in staging to page **213**. Its history and historical `oldid` URLs retain original content/authorship; they must not return the newest declaration. Validate title-query and page-ID aliases as well.
- Validate every namespace and every client, people, navigation, templates, discussion/contributor history, redirects, categories and files. Do not declare the entire database restored solely because MAXPlaces renders. The prior public archive contained 144 main, 71 User, two Project and two Template pages; SQL may additionally expose deleted/private records absent from that archive.
- Compare full current/archived/deleted file inventories and actual bytes/checksums. Zero public `File:` pages does not mean zero filesystem/custom assets. Confirm no public access to private/deleted uploads, original configs, dumps or credentials.
- Test protected staging login with recovered account permissions without resetting source passwords or copying production sessions. Confirm no outbound mail, unexpected cron/queue execution, production DB/cache/search connection, live publishing or source write occurred.
- Verify rendering, rewritten paths, templates/skins, API read identity, redirects, page-ID/oldid/history semantics and exact accepted-record projection rules. Retain six MAXPlaces offering PTO mappings, two matched Places IDs, unknown selected GBP categories and the unresolved postal-code conflict if structured projections are subsequently connected.
- Record backup hashes, restore commands/exit status, schema/runtime versions, comparison results, staging-only substitutions, known source defects and rollback checkpoint. Only then mark restoration verified. DNS, source replacement and production upgrade remain separate actions.

Primary references: [MediaWiki backup](https://www.mediawiki.org/wiki/Manual:Backing_up_a_wiki), [restore](https://www.mediawiki.org/wiki/Manual:Restoring_a_wiki_from_backup), [upgrade](https://www.mediawiki.org/wiki/Manual:Upgrading), [1.39 schema](https://raw.githubusercontent.com/wikimedia/mediawiki/REL1_39/maintenance/tables-generated.sql), [LocalSettings](https://www.mediawiki.org/wiki/Manual:LocalSettings.php), [email](https://www.mediawiki.org/wiki/Manual:$wgEnableEmail), [job execution](https://www.mediawiki.org/wiki/Manual:$wgJobRunRate), [PHP support matrix](https://www.mediawiki.org/wiki/Support_policy_for_PHP/Tables).
