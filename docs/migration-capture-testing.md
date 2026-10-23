# Preservation tool verification

Run `node --test scripts/mediawiki-capture.test.mjs`. Tests use an isolated temporary private archive and a fake unauthenticated MediaWiki transport. They cover host/write rejection, namespace semantics, the exact MAXPlaces legacy path, revision continuation, private modes, response-cache resume, and detection of changed archive bytes.

Run a real capture outside the repository:

```sh
node scripts/mediawiki-capture.mjs --output '/absolute/private/backups/public-mediawiki-YYYYMMDD'
node scripts/mediawiki-verify.mjs '/absolute/private/backups/public-mediawiki-YYYYMMDD'
```

An interrupted capture resumes with the same command plus `--resume`. It retains the original revision-time boundary and validates cached response hashes rather than silently replacing old evidence. A damaged cached artifact requires retaining the damaged archive for diagnosis and starting a new destination. The tool has three bounded read attempts, a 400 ms minimum request interval, 30-second request deadlines, a 16 MB API-response bound, 100 MB per-asset bound, and 10,000 network-read bound per invocation. Reaching a bound is an explicit partial result, not permission to call the archive complete.

The verification command checks the manifest checksum and every listed file's size/SHA-256. This proves captured bytes remained unchanged; it does not prove source factual accuracy, content licensing, API disclosure completeness, transactional consistency or a recoverable SQL/files/accounts backup. Capture outputs, contributor data and any source-host backup must stay out of the public Git repository.
