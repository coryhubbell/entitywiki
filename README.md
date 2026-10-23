# EntityWiki registry

Replacement registry and private operator platform for EntityWiki. Public company documents retain their existing `entitywiki.org` URLs; `entitywiki.com` is reserved for the platform and administration.

## Migration boundary

The live MediaWiki installation remains authoritative while its complete database, files, configuration, client records and history are preserved and the replacement is validated. This repository contains application code and public pilot fixtures only. Full backups, account data, credentials and raw archives stay outside Git.

MAXPlaces is the structured migration pilot. No production routing, DNS or legacy wiki writes are performed by this repository baseline.
