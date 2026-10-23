# Public preservation capture receipt — October 23, 2026

The read-only capture completed between **18:10:14 and 18:13:18 UTC** (1:10–1:13 PM America/Chicago). Its raw output remains in the private `EntityWiki/backups/public-mediawiki-20261023T-private` sibling directory, outside this registry Git repository. No raw pages, usernames, revision bodies or archive files are included here.

| Check | Result |
| --- | --- |
| Nonvirtual namespaces inventoried | 16 |
| Public pages discovered/captured | 219 / 219 |
| Main namespace | 144 pages |
| User namespace | 71 pages; retained privately for preservation/review |
| Project namespace | 2 pages |
| Template namespace | 2 pages |
| Other nonvirtual namespaces | No exposed pages found |
| Exposed revisions captured | 1,046 |
| Captured revisions with unavailable content | 0 |
| Registered File-page versions exposed | 0; no claim about filesystem/custom assets |
| URL succession inventory | 2,980 unique URLs |
| Unauthenticated read requests | 456 |
| Capture failures | 0 |
| Artifact SHA-256/size verification | 681 / 681 pass |
| Directory/file permissions | 0700 / 0600; no violations found |

MAXPlaces **page 213** includes **10 exposed revisions**, from revision **731** through **1200** at the capture boundary. The succession inventory explicitly retains `https://entitywiki.org/MAXPlaces_Marketing`, its page-ID aliases, historical revisions and history URL. Its preserved source is evidence, not permission to replace the article or treat all historical assertions as accepted facts.

Manifest SHA-256: `58fc578b00e38a2de64db343cb3ecb5ea55adb6ba3cd10f976adc1dd2b7e7fed`.

Five targeted script tests pass. They cover source/write guards, namespace semantics and exact MAXPlaces path, allpages/revision continuation, private modes, resumable cached acquisition, tamper detection, and source asset size/SHA-1 checks.

**Scope:** completed unauthenticated public API acquisition, not a full SQL, filesystem, configuration, accounts, deleted/suppressed/private-data backup, or transactional snapshot. The A2 source-host recovery backup and complete all-client staging restore remain required. No records were published, no DNS changed, and no new hosting stack was provisioned by these tools. See [migration-preservation.md](migration-preservation.md) for recovery/cutover acceptance and Cloudways isolation/version requirements.
