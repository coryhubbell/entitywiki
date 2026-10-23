# MediaWiki preservation and migration acceptance

The existing source is the A2-hosted EntityWiki service. A new Cloudways PHP staging application is a **restore target**, not the source of the existing database or files. Keep `https://entitywiki.org` and its URLs intact until a source-host backup has been restored and the acceptance checks below pass.

## Two different preservation products

1. **Public API archive:** run `node scripts/mediawiki-capture.mjs --output /absolute/private/backups/archive`, then `node scripts/mediawiki-verify.mjs /absolute/private/backups/archive`. Re-run the capture with the same output and `--resume` after an interruption. The output must be outside this Git repository. Directories are mode 0700 and files mode 0600. Raw content, contributor names, manifests, and file versions remain private local evidence; never commit or bundle them into the public application.
2. **Complete source-host recovery backup:** obtain the original A2 database dump(s), full site filesystem/uploads, configuration, accounts/permissions, extensions/skins/custom code, server rewrites, scheduled jobs, and backup/restore instructions. Keep secrets and user/account data in restricted backup storage. The public API archive does **not** replace this product and cannot recover the complete service.

The capture tool sends only unauthenticated HTTPS GET reads to `entitywiki.org`. API requests are restricted to `action=query`; there are no login credentials, cookies, tokens, edit calls, DNS changes, redirects, or publication calls. It enumerates every nonvirtual namespace, paginates every `allpages` listing and exposed revision history, captures all exposed revision slots/source metadata and contributor attribution, and separately captures paginated page links/templates/categories/redirects and exposed file-version metadata/asset URLs. It rejects off-host/insecure asset URLs, bounds response sizes and retries, rate-limits reads, and checkpoints response hashes for resumption. Off-host, oversized, deleted, suppressed, restricted, or otherwise unavailable items are explicit failures/limitations rather than fabricated completeness.

`manifest.json` and `manifest.sha256` inventory the captured bytes. Verify before and after copying. `complete_public_api_archive` means the enumerated unauthenticated API operations completed; it does **not** mean a transactional snapshot, all private/deleted history, all accounts, or the full database was backed up. Revisions are bounded by capture start; other metadata is observed during acquisition. Repeat/delta reconciliation is needed if the source changes during capture. Files can change between metadata and download; retain API timestamps, source checksums and capture hashes for that reconciliation.

## Migration inventory and namespace classification

The earlier 144-page inventory covers namespace 0 only. It contains company entries, people, Main Page, and placeholders; it is neither a complete all-namespace inventory nor 144 established organization identities. Use `namespace-inventory.json`, `page-classification.json`, `asset-inventory.json`, and `url-succession.json` as review inputs.

| Source item | Import rule |
| --- | --- |
| Main-namespace article | Review organization/person/place/offering/concept identity; namespace alone never establishes a company |
| Main Page/navigation | Preserve editorial/navigation role; do not mint a business |
| Placeholder | Preserve source/history; defer any entity declaration until supported |
| Template/module/style dependency | Preserve dependencies and source versions; do not mint companies |
| Category | Preserve directory/membership; category text is not automatically an ontology class |
| Talk/discussion | Preserve discussion and contributor attribution; do not turn discussion into accepted business facts |
| User/contributor pages | Preserve privately for recovery and review public reuse separately; never treat as customer company records |
| File/media | Preserve exposed versions, source metadata and rights; do not republish uncleared media |
| MediaWiki/system message | Preserve public message source; it does not represent full private configuration |
| Redirect/alias | Retain target and history; do not create a duplicate business |
| Special/virtual namespace | Inventory routes separately; `allpages` is not a virtual-page or account backup |

## Identity and URL succession contract

- Keep permanent opaque organization, branch, service/product, person and record IDs. Hosting origin, company name, city, service label and current domain must not be the identity key. Registry merges need evidence, actor, timestamp, surviving ID, aliases and reversible decisions. Two branches in one city remain distinct.
- The chosen persistent entity URI namespace is `https://entitywiki.org/id/<ID>`. Company identity (`/id/<ID>`), profile document, immutable record revision and original wiki article are separate resources. Changing the presentation domain must not silently remint entities or rewrite external ontology identifiers.
- `url-succession.json` is an inventory, not redirect authorization. It records article/pretty paths, title-query aliases, page-ID aliases, immutable revision URLs, history URLs and exposed asset URLs. Preserve or map each specifically; never send all legacy URLs to a homepage.
- The exact legacy URL `https://entitywiki.org/MAXPlaces_Marketing` must remain associated with MediaWiki page **213**. Keep its page-ID aliases, revisions, authorship and history resolvable. A replacement frontend must preserve this path or use a reviewed equivalent document mapping while the history remains accessible.
- Preserve old `oldid` semantics. A historic revision must not silently return the newest declaration. Retain relevant anchors, discussion/history links, file paths, backlinks and query variants discovered from server logs/Search Console as additional inventory; the API alone cannot enumerate every URL people have linked.
- Preserve the source's actual licenses/attribution. The public site's `rightsinfo` API currently exposes empty license text/URL, so no site-wide reuse license is inferred from that setting. Link external identifiers and use source-backed original assessment prose; record rights separately before copying descriptions or media.

## MAXPlaces pilot acceptance

The same accepted record must drive the new profile, graph, JSON-LD and any reviewed wiki projection. Preserve six accepted Product Ontology **offering types**, the two independently matched branch Place IDs, and the one unresolved NYC postal-code conflict (`10001` historical versus `10017` company-issued). Selected GBP category IDs stay unknown; proposed categories and Places types remain separate. Preserve source URLs, issuers, collection timestamps, digests, generation provenance, mapping decisions and restrictions. Company assertions, domain-control checks, independently matched identities and publication acceptance are different states.

Do not turn publisher-nominated external profile candidates into accepted company `sameAs`, ontology classes, or verified ownership. Keep LLMS Amplifier as software rather than duplicating it as a service. An availability check on a Product Ontology document never substitutes for a service-fit decision. External Wikipedia/Wikidata/Product Ontology identifiers retain their publishers' canonical forms.

## Full database restore acceptance — every client and namespace

Before a production replacement, restore the **entire source database and filesystem** into isolated staging and verify:

1. A consistent source SQL backup includes every wiki table/database, engine-specific consistency requirements, schema, triggers/routines/events where applicable, and authentication/account/group data. Coordinate the upload/file snapshot with that database boundary. A public export of 144 articles is insufficient.
2. The original uploads tree, historical/deleted/restricted files, custom assets, `LocalSettings.php`, extension/skin versions, PHP dependencies, access rules, scheduled jobs and web-server rewrites are recoverable. Secrets remain outside Git/public web roots. Staging email, webhooks and jobs stay isolated until intentionally enabled.
3. Source-versus-restore counts and associations match across **all clients**, page/revision/slot/text records, redirects, namespaces, categories, links, files and accounts/permissions. Validate database integrity and representative pages from each namespace. Record exclusions explicitly; do not silently omit another client because MAXPlaces passed.
4. Historical revisions and authorship render correctly; templates/media dependencies resolve; original file bytes/checksums match. Verify `MAXPlaces_Marketing`, page 213, current and historical revisions, plus representative other-client and person pages.
5. Password/session/permission behavior works without exposing accounts or upgrading privileges. Public declarations are read-only to anonymous users; private administration/import/scan/publication APIs require independent authenticated authorization. The old owner-private pilot boundary cannot be reused unchanged on a public host.
6. Production-like routing tests cover every inventoried URL class and existing HTTP/HTTPS/host variants. Canonical tags, robots/noindex settings, sitemap URLs and internal links agree with the chosen document destination. No DNS or redirect cutover occurs merely because staging is reachable.
7. Rehearse recovery from the complete backup, a rollback preserving newer human edits, and retained publication preimages. Confirm recovery storage is available even if either host fails. Acceptance evidence remains private where it contains credentials/accounts/contributor data.

## Domain decision and cutover

The chosen architecture keeps public dossiers at their existing `entitywiki.org` URLs and reserves `entitywiki.com` for platform and private administration. This avoids a document-domain move; content and rendering changes still need staged testing. Do not duplicate indexable dossier documents on `.com`. A later decision to move public dossier URLs to `.com` would be a separate URL migration with reviewed per-page redirects, compatible canonicals, sitemaps and monitoring. Preserve identities independently of frontend hosting. Do not combine database recovery, CMS replacement and a domain move into one cutover.

References: [MediaWiki export/history](https://www.mediawiki.org/wiki/Help:Export), [Google URL migration guidance](https://developers.google.com/search/docs/crawling-indexing/site-move-with-url-changes), [Google canonical URL guidance](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls), [W3C identity/document URI guidance](https://www.w3.org/TR/cooluris/).

## Cloudways PHP staging isolation and version plan

A user-created Cloudways PHP application can host the **MediaWiki recovery clone**; the Node/Workers registry application does not run unchanged on that PHP stack. Use Cloudways' temporary application URL first, valid TLS, and password or IP access protection. Add `noindex` as a secondary search safeguard, not as access control. Keep the original `.org` server, DNS, TLS and paths intact throughout recovery testing; no stack or DNS change is performed by these tools.

The source audit reported **MediaWiki 1.39.1, PHP 8.1.34 and MariaDB 10.5.26**. Verify current source and destination versions before selecting a restore/runtime path. Prefer the compatible MariaDB recovery path when available, but do not assume the latest PHP or MariaDB will run the old wiki unchanged. Document two explicit stages: (a) an isolated compatibility restore capable of proving the original backup, and (b) a separately tested upgrade to a supported MediaWiki/PHP/database combination, including extension/skin compatibility and rollback. This is a staging matrix and rehearsal, not authorization to upgrade production.

Change only the staging copy of `LocalSettings.php` and related configuration: distinct database host/name/credentials, temporary server/canonical URL, upload/storage paths, session/cookie scope, caches and search indexes. Isolate the staging database and files from production. Disable outgoing mail, email confirmation/reset delivery, cron/job runners, queued jobs, webhooks, automated publication and search-index jobs until each behavior is deliberately tested against staging-only endpoints. A cloned job queue must not contact customers, write to the live wiki, or index into production infrastructure. Keep a private record of original-to-staging configuration substitutions; never commit original or staging secrets.

The all-namespace public API inventory may show no registered `File:` pages while the site still uses logos, skin assets, custom paths, or unregistered filesystem uploads. The capture's asset scope is the file versions exposed by `imageinfo`; source-host filesystem preservation remains mandatory regardless of that count.
