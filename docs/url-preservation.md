# Legacy URL preservation before a replacement

Keep the existing EntityWiki URLs and numeric MediaWiki identities during the replacement. A new stable entity identifier is an additional mapping; it must not replace the meaning of `pageid`, `curid` or `oldid`.

`scripts/url-preservation.mjs` produces a private, deterministic ledger from an already captured public MediaWiki API archive. It makes no network requests and creates no runtime redirects, DNS changes, canonicals or deployment configuration. It verifies the archive's manifest and artifact hashes before reading the inventory.

```sh
node scripts/url-preservation.mjs \
  --archive /absolute/private/mediawiki-archive \
  --output /absolute/private/new-url-report
```

Both paths must be outside this public repository. The output directory must be new and its parent must exist. The directory uses mode `0700` and files use `0600`. Do not commit reports or original client/contributor/history data. The console prints counts, not individual client rows.

The report includes all captured namespaces, including company articles, contributor pages, project pages and templates. It preserves each exact inventoried URL string, title, namespace, source page ID and explicit revision ID. It records every captured revision ID per page, captured redirect relationships and fragment metadata, and the original article/script paths and namespace aliases. Observed `fullurl`/`canonicalurl` metadata is distinguished from derived aliases whose HTTP behavior has not been tested.

Files written:

- `report.json`: authoritative exact URL ledger, identities, reconciliation issues and discovery gaps; no contributor names or revision text.
- `routes.tsv`: a readable route table. Tabs/newlines in titles are flattened and formula-like cells escaped for safer spreadsheet opening; use JSON for exact titles.
- `link-succession-checklist.md`: backup, staging validation, discovery and cutover review steps.

The ledger detects missing expected aliases, conflicting page/revision ownership and ambiguous numeric query identities. An issue-free ledger means its captured inputs reconcile; it does **not** mean the installation or complete URL ecosystem has been backed up or restored.

## Review proposed succession without deploying it

An optional private JSON decision array can annotate individual inventoried URLs:

```json
[
  {
    "url": "https://entitywiki.org/index.php?curid=42",
    "sourcePageId": 42,
    "sourceRevisionId": null,
    "mode": "retain_legacy_handler",
    "targetUrl": "https://entitywiki.org/index.php?curid=42",
    "reason": "Retain the original numeric page lookup",
    "reviewedBy": "Operator"
  }
]
```

Pass `--decisions /absolute/private/decisions.json` and a fresh output directory. Modes are `preserve_exact`, `retain_legacy_handler`, `private_access_review`, and `reviewed_redirect`. A private access review remains unresolved. These annotations are review inputs, never redirect authorization.

A reviewed redirect requires a reason, reviewer and an inventoried target for the same original page. Historical URLs must keep the same revision; history views must remain history views. Cross-domain targets, silent cross-entity merges, self redirects and unrecognized source URLs are rejected. Redirect chains or cycles are reported as issues. Moves outside this constrained model need a separate explicit review; they are not inferred automatically.

## What remains outside this archive

A public API capture does not cover the complete SQL database, accounts, deleted or private records, host configuration or filesystem. It also does not comprehensively establish:

- Virtual/special pages, contributions/search/login routes, namespace aliases and permalink/redirect helpers.
- API and REST endpoint consumers, arbitrary query variants and `diff`/`oldid` combinations.
- Fragment and section anchors; URL fragments do not reach the web server and need browser/content validation.
- Original redirect status codes, canonical and robots headers, query handling, HTTP/HTTPS and host alias behavior.
- Uploads, deleted or unreferenced assets and URLs found only in logs, old sitemaps, backlinks or Search Console.
- Moves and revisions after the bounded acquisition window.

Once hosting access is available, reconcile the complete database and filesystem with this ledger, collect legacy rewrite/redirect rules, and add the URLs found in access logs and Search Console exports. Preserve the old service until private staging validates original paths, query semantics, permissions, assets, authorship and immutable history. Keep staging authenticated and `noindex`, isolate jobs/mail/integrations, and retain a tested rollback before a separately approved cutover. No user or private namespace is published merely because it appears in this inventory.
