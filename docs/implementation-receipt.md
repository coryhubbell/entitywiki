# Isolated registry implementation receipt — October 23, 2026

This implementation keeps public dossiers at the existing `.org` paths and reserves `.com` for the platform/admin. It has not changed production DNS, routing, the original Sites pilot or MediaWiki content. The current `.com` redirect remains untouched.

## Validated locally

- 40 tests pass; TypeScript, ESLint and production build pass.
- Both SQL migrations applied to a fresh isolated local D1 database.
- The real accepted MAXPlaces snapshot restored without acquiring sources or calling the live wiki: record `rev_1457a83ebaa25934ec7241c23ee2b226`, numeric revision 2, all 23 entity IDs and 244 claims preserved.
- An explicit staging web release serves the profile, graph, JSON-LD and revision endpoint from the same accepted record. Restoration alone leaves public endpoints unavailable. Subsequent accepted imports remain private until explicitly released.
- Six Product Ontology mappings and two branch Google Place IDs remain accepted. One NYC postal conflict remains unresolved; selected GBP categories remain unknown.
- Anonymous private API requests return 403. Local UI sign-in and sign-out were verified. Production Access JWT tests reject invalid signatures, issuer, audience, expiry and non-allowlisted operators. Production SSO itself is not provisioned.
- The `/id/ew_a3d1e72a720be01b2e5834cb` route returns 303 to `/MAXPlaces_Marketing`; JSON-LD uses the permanent `https://entitywiki.org/id/` namespace without the preview origin.
- Browser checks passed for the public reader, ontology/Google mapping view, private release workspace and registry-to-dossier navigation. An upstream Vinext client navigation/prefetch defect was avoided using ordinary full-document links. Final navigation produced no new console errors. Public pages have no mutation controls; staging remains noindex. The operator UI was left signed out.
- The isolated registry database was captured privately with SQLite's online backup operation and reopened successfully: integrity check `ok`, one accepted record, 244 claim rows and one web release. This is a registry rehearsal backup, not the source MediaWiki database backup.

![Public reader](screenshots/maxplaces-reader.png)

![Private admin](screenshots/private-admin.png)

## Preservation and remaining gates

The private public-content archive contains 219 pages, 1,046 exposed revisions and 2,980 inventoried URLs, with 681 artifact checks passing. Original pilot source history and accepted evidence are also preserved privately. Raw archives and account data are excluded from Git.

A complete original-host SQL/files/configuration backup is still required. Cloudways is the proposed recovery destination; its application has not been provisioned or assessed by this implementation. Restore and reconcile every client, namespace, account/permission and historical record before cutover. Historical/query/file-route compatibility is inventoried rather than implemented in the new reader.

The new isolated runtime has no live SchemaBrains credential, Google merchant credential, production database or configured production identity provider. The original owner-private pilot's earlier live SchemaBrains generation is preserved in the migrated record; this rehearsal does not claim a fresh external scan. Configure the intended server secrets and production ownership separately. No live-wiki write credential or enabling switch is exposed by the replacement.

Compiled release history currently keeps digests rather than complete projection snapshots; archive compiler artifacts before production. A changed projection fails closed until a newly reviewed web release. See [migration acceptance](migration-preservation.md) for the complete cutover requirements.
