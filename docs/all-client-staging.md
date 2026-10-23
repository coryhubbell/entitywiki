# All-client captured-record staging

This rehearsal imports every page, namespace, exposed revision and inventoried URL from the verified public capture into an **operator-only local staging snapshot**. It preserves original source IDs, raw captured fields, revision slots, attribution, dependency observations, protection observations and hidden/suppressed flags. A snapshot becomes readable only after its record counts, relationships and canonical transfer digest pass finalization. This does not publish declarations or alter the live wiki, DNS, Cloudways, or the original archive.

The capture is not a complete MediaWiki installation backup. Public contributor pages are not recovered accounts; observed page protection is not a recovered permission system. Source accounts/passwords, actual groups and private permissions, deleted/private/suppressed data absent from the capture, full filesystem/configuration and external storage still require the A2 SQL-and-files backup and native restoration tests. All captured source material stays behind operator authentication, including publicly captured User pages and history. Importing this material does not approve it as public business schema.

## Prepare privately, offline

Use Node 22 or later from the registry checkout. Both input and output must be absolute paths. The output directory must be fresh, have an existing parent, and remain outside every Git repository. Do not put captured data in fixtures, `public/`, a build directory, an issue or a pull request.

```sh
node scripts/legacy-stage.mjs \
  --archive /private/entitywiki/captures/source-archive \
  --output /private/entitywiki/staging/fresh-capture-transfer
```

Preparation performs no network requests. It validates `manifest.sha256`, the completed capture status, all manifest artifact hashes and sizes, safe artifact paths, and original source wiki identity before loading captured pages. It rejects duplicate page/revision/route identities, lost namespace identities, missing histories, invalid cross-page `oldid` links, and counts that disagree with the capture manifest. Every listed artifact is checked, including API response evidence not otherwise used by the transfer. Records retain the complete original page artifact except the separately transported revisions; each revision and inventory URL row is retained as raw original data.

The output directory has mode `0700`; `descriptor.json`, `records.ndjson` and `preparation.json` have mode `0600`. The descriptor includes source origin plus original `general.wikiid`, capture times and manifest digest, every namespace and alias, actual derived counts, and the canonical transfer digest shared with the staging backend. It declares `accessPolicy: operator_only` and `sourcePermissionScope: unauthenticated_public_capture_only`. The preparation receipt records file checksums. Source records, titles, usernames, text and credentials are not printed to the console.

## Import only to the local rehearsal

Start the registry locally with its ignored `.dev.vars` containing the existing `OPERATOR_AUTH_MODE=local` and `OPERATOR_LOCAL_KEY` of at least 32 characters. Never commit or paste that key. The tool signs in through the existing encrypted-cookie flow, then sends the exact local Origin and operator session on the begin/ingest/finalize requests.

```sh
node scripts/legacy-stage.mjs \
  --prepared /private/entitywiki/staging/fresh-capture-transfer \
  --origin http://127.0.0.1:8876
```

Alternatively add `--origin` to the fresh preparation command to import immediately after verification. Only loopback origins `127.0.0.1`, `localhost` and `::1` are accepted. Redirects are never followed, including authentication redirects; a redirect from an API call is an error and credentials are never forwarded to its target. Each request contains at most 100 records and is strictly below 750,000 UTF-8 bytes including the request envelope. Revisions are not split or truncated. A record larger than 600,000 bytes is rejected for a deliberate transport review.

The import re-verifies the private prepared-file hashes and the full transfer digest. `begin` identifies the exact source/capture descriptor, ingest records are idempotent, and `finalize` verifies counts and all page/revision/URL relationships before marking the snapshot ready. Re-running the prepared import resumes interrupted loading or returns the same ready snapshot. Partial snapshots remain invisible to readers. `import-receipt.json` records the local origin, snapshot ID, digests and verified counts without copied source content or credentials; it explicitly records that publication did not occur.

## Acceptance and remaining work

Run `node --test scripts/legacy-stage.test.mjs` for synthetic all-namespace, multi-client, person, template, User-page, protection, attribution, hidden-content, integrity, duplicate-ID, route and authentication/redirect tests. The fixtures are synthetic and contain no real client data. Keep actual capture import receipts outside Git.

On the actual captured-data rehearsal, check that all derived counts match the immutable archive manifest, every namespace/classification is represented, original page/revision IDs and raw records round-trip, title/page-ID/history/oldid variants resolve consistently, and anonymous requests cannot see any captured page, user, history or snapshot. Retain exact query semantics and canonical `.org` links; do not convert unknown system routes into homepage redirects. The public accepted MAXPlaces release remains separate from this raw migration rehearsal.

After A2 access arrives, preserve and restore the entire original SQL/files/configuration set according to [the restore runbook](restore-runbook.md). Compare the actual full-database roster, private/deleted records, permissions, all custom tables and files against that source baseline. Preserve native MediaWiki history, diffs, discussion, templates/categories, media and system/API behavior until equivalent replacement behavior is validated. The captured archive is a staging test corpus and URL inventory, never a substitute for that complete restoration.

## Running reader and complete runtime reconciliation

After applying migrations 0003 and 0004, building and importing locally, open `/admin/migration` with an operator session to browse/filter every captured namespace. Legacy pretty paths and `index.php` title, curid, oldid, history and captured diff routes use the protected source reader; permanent-link/page aliases retain numeric identities. The approved MAXPlaces public dossier remains separate. Unsupported MediaWiki API, REST, special or write actions return an explicit unavailable response instead of a misleading current page or homepage. Captured source is escaped literally, with no template, HTML, image or script execution.

Run the private, loopback-only acceptance tool:

```sh
node scripts/verify-legacy-local.mjs \
  --prepared /private/entitywiki/staging/fresh-capture-transfer \
  --origin http://127.0.0.1:8876
```

It checks each captured URL against the running HTTP reader, original page/revision response identities, all captured histories, representative special/diff/error routes, anonymous denial, private headers and the existing released dossier. Its receipt and any failing URLs stay in `runtime-verification.json` beside the private prepared transfer. The current corpus has at most 78 revisions per page; the verifier explicitly requires extension to follow multiple history pages for larger future corpora, while the reader itself supports history pagination. See [actual rehearsal receipt](all-client-staging-receipt.md).

For the original host handoff, forward [the partner extraction request](partner-extraction-request.txt). It requests complete recovery packs without any production or DNS change.
