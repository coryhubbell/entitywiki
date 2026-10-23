# All-client captured-record rehearsal — October 23, 2026

The verified public archive was imported through the authenticated HTTP migration API into the isolated localhost D1 registry. No source request, original-host import, Cloudways data restore, production deployment or DNS change was performed. Raw captures and prepared records remain outside Git in private storage.

| Verification | Result |
| --- | --- |
| Original archive artifact hashes/sizes | 681 pass |
| Namespace definitions retained | 18, including two virtual definitions; captured pages in namespaces 0, 2, 4 and 10 |
| Source pages | 219: 144 main, 71 User, two Project, two Template |
| Exposed revisions and original IDs | 1,046 retained with raw metadata/slots and attribution |
| Exact inventoried URL variants | 2,980 retained |
| Transfer records / HTTP ingest batches | 4,245 / 56 |
| Exact database round trip | All 4,245 original transfer records and raw fields match; zero missing/different keys or bodies |
| Runtime URL acceptance | 2,979 authenticated source routes with matching original page/revision IDs; one approved MAXPlaces public dossier route verified separately |
| Runtime captured history acceptance | All 219 page histories link all 1,046 captured revisions |
| URL/history reconciliation failures | Zero |
| Access | Anonymous capture, User, history and migration API reads denied; operator-only source reader, private no-store/noindex headers |
| Schema / runtime checks | Migrations 0003 and 0004 applied to local D1; 93 tests, TypeScript, ESLint and production build pass |
| Local staging recovery copy | SQLite online backup reopened with integrity check `ok`; private original capture remains unchanged |

Canonical transfer SHA-256: `9aa328c1ad095355f13411f078cce088488c3c78ddd115c4be03b57b7a5373b6`.

Each page has a persistent source-page identity derived from the original wiki origin/identity and numeric page ID. Title and namespace changes do not remint it. A source page is not automatically a legal company or accepted declaration. The existing MAXPlaces accepted record and its separate editorial release retain their original identities and remain independent of this raw source migration.

Snapshots are append-only. Begin/ingest/finalize supports identical replay, rejects changed bytes, checks complete counts, transfer hashes and page/revision/URL associations, and seals a snapshot only when complete. Loading snapshots are unavailable to the reader and cannot reserve revision ownership against later valid recovery. SQL guards reconcile ownership atomically against completed snapshots.

The reader supports captured pretty paths, title/page-ID queries, immutable `oldid`, history, numeric/adjacent captured diffs and permanent-link aliases. Conflicting selectors fail explicitly; absent historical revisions never become current content. Namespace aliases, Unicode and original IDs are tested. Hidden/suppressed authors, comments and content are withheld even from this operator reader. All content is HTML-escaped under a restrictive content security policy. The reader shows literal captured source; it does not expand templates or execute original HTML/scripts.

**Permission preservation boundary:** ten captured pages include observed protection metadata, retained unchanged. The archive does not recover source accounts, groups, private ACLs or deleted/private content. Imported records use the separate operator-only staging boundary; no source roles are granted and no public declaration is released by import. Full SQL/files/account recovery and native permission testing still require the original A2 packs.

Native MediaWiki template rendering, extension behavior, unregistered/historical/private assets, complete system/API/REST behavior and URLs absent from the capture remain recovery/cutover requirements. Unsupported functions return explicit unavailable responses; there is no blanket homepage redirect. The approved MAXPlaces dossier remains public in the local registry while its captured source/history uses original numeric lookup routes.

Private preparation, import and runtime verification receipts live beside the prepared transfer. Follow [the staging workflow](all-client-staging.md), [whole-system assessment](ecosystem-assessment.md) and [original recovery runbook](restore-runbook.md). A successful captured-record rehearsal is not a complete original MediaWiki installation restore.
