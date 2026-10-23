# EntityWiki registry

Rebuild public company dossiers at their existing **entitywiki.org** URLs. Use **entitywiki.com** for the platform and private administration. The live MediaWiki installation stays intact until the replacement, full backup restore and URL succession have been validated.

This is an isolated implementation foundation, not a production cutover. The original owner-private Sites pilot has not been changed. No DNS, source-server routing or live wiki writing is performed by this application.

## What works

- Public directory and read-only dossier at `/MAXPlaces_Marketing`, with graph, evidence, six reviewed Product Ontology offering types, two Google Place matches and JSON-LD.
- Private `/admin` workspace. Production authorization verifies Cloudflare Access signatures, issuer, audience, expiry and an operator allowlist at the origin. No default access, preview-header trust or localhost bypass.
- Explicit localhost-only development login using an encrypted, HttpOnly, one-hour session. Server secrets stay out of browser storage and Git.
- Persistent opaque entity IDs, source/label aliases, distinct offices in the same city and canonical identities at `https://entitywiki.org/id/{id}`. The company document remains separate from its identity.
- Exact restoration of the accepted MAXPlaces record: revision 2, all 23 entity IDs, 244 claims, provenance, mappings and the unresolved NYC postal conflict. Restoration does not publish it.
- Explicit web releases with optimistic concurrency, a release ledger and approved projection digests. New collection results do not replace the public revision. Operator identity and editorial notes are omitted from the public release receipt.
- SchemaBrains REST import/generation/poll adapters. The isolated replacement has no live SchemaBrains credential yet; its migration rehearsal restores the real accepted pilot snapshot without new scans or wiki calls.
- Read-only all-namespace MediaWiki preservation tooling. The private public-content archive contains 219 pages, 1,046 exposed revisions and 2,980 URL inventory entries. See the [sanitized capture receipt](docs/migration-capture-receipt.md).

Selected Google Business Profile categories remain unknown until merchant-authorized access supplies them. Product Ontology class URIs use `/id/`; `/doc/` identifies documentation. Candidate external profiles are excluded from accepted company `sameAs`.

## Run locally

Use Node.js 24 or newer (minimum runtime 22.13). Nothing in these commands contacts a remote database or deploys an application.

```sh
npm run install:ci
npm run build
npm run db:migrate:local
```

Copy the names from `.env.example` into a private `.dev.vars` file. For the localhost-only rehearsal, set `OPERATOR_AUTH_MODE=local` and a randomly generated `OPERATOR_LOCAL_KEY` of at least 32 characters; restrict the file to mode 0600. Do not reuse a production password. `npm start` copies that ignored file next to the generated local Worker config, binds only to 127.0.0.1 and removes its generated copy on normal shutdown.

```sh
npm start
# Separate terminal: restores and releases the exact fixture into local staging.
npm run verify:local
```

Open `http://127.0.0.1:8876/MAXPlaces_Marketing` and `http://127.0.0.1:8876/admin`. The local admin form uses the staging key in `.dev.vars`. Every response is noindex until cutover; noindex does not replace access control. The `.com` platform links reserve the intended destination; its old redirect has not been changed.

```sh
npm test
npm run typecheck
npm run lint
npm run build
```

The tests use real SQLite and the actual Drizzle D1 driver, with synthetic external transports. The MAXPlaces snapshot migration and local runtime rehearsal require no live SchemaBrains, Google or MediaWiki writes.

## Cloudways and complete migration

A separate Cloudways **Custom PHP** application is a suitable destination for the MediaWiki recovery clone. Use its temporary URL, TLS and password/IP protection. Match the original database family and test the old runtime compatibility before performing a supported upgrade in staging. The new registry is a Node/Workers application using D1; it does not run unchanged on a PHP-only container. Its production runtime/database ownership and operator SSO still need configuration.

The full source-host SQL database, filesystem, uploaded/custom assets, configuration, users/permissions and private/deleted history have **not** been obtained from the source host. The local public API archive is not that backup. Obtain the complete source backup, verify its checksums, restore it into Cloudways, reconcile every client and namespace, then rehearse recovery and URL handling. Keep both the source and restored account data outside this public repository.

The rollout order is preservation → full isolated restore → typed/client-by-client mapping → MAXPlaces parity → historical URL validation → controlled frontend replacement at existing `.org` URLs. Existing pages and history must have deliberate destinations; there is no blanket homepage redirect. Preserving URLs avoids a domain move but does not guarantee unchanged rankings. The migration covers the entire installation; namespace zero does not mean every page is a company.

See [migration acceptance and staging isolation](docs/migration-preservation.md) and [capture verification](docs/migration-capture-testing.md). The public API capture is not transactional; reconcile source changes before cutover. Legacy `index.php`, `oldid`, history, file and query-route compatibility is inventoried, not yet implemented in the new reader. Full-catalog classification, recovery and URL compatibility remain cutover gates.

Release history currently stores approved projection digests rather than all compiled projection bytes. A compiler change that alters a released projection fails closed and requires an explicit reviewed release; prior compiler artifacts must be archived before production migration. There are no production deployment credentials or live-wiki write credentials in this checkout. The D1 UUID in Vite configuration is a local placeholder; provision a separate real database before external deployment.

## Preservation boundary

Commit application code, migrations and public pilot fixtures only. Full SQL/files backups, raw wiki archives, accounts, credentials and `.dev.vars` stay outside Git. The original working pilot's Git bundle and accepted publication evidence have also been preserved in private sibling backup storage. Product Ontology fixtures retain their source attribution and license annotations.
