#!/usr/bin/env node
/** Offline, operator-only rehearsal. This does not reconstruct accounts, private data, or a full wiki. */
import { readFile, writeFile, mkdir, chmod, lstat, realpath, rename } from 'node:fs/promises';
import { resolve, relative, dirname, basename, join, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { verifyArchive } from './mediawiki-capture.mjs';
import { canonicalLegacy, legacyTransferDigest } from '../lib/legacy/digest.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = 'https://entitywiki.org';
const MAX_PAYLOAD = 750_000;
const MAX_RECORD = 600_000;
const sha256 = value => createHash('sha256').update(value).digest('hex');
const bytes = value => Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value));
const validId = value => Number.isSafeInteger(value) && value > 0;
const inside = (root, path) => { const rel = relative(root, path); return !rel || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel)); };
function assert(condition, message) { if (!condition) throw new Error(message); }

export function localStagingOrigin(value) {
  const url = new URL(value);
  assert(['http:', 'https:'].includes(url.protocol) && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash, 'Only a literal loopback staging origin is allowed.');
  return url;
}
async function regularFile(path, root) {
  const rel = relative(root, path);
  assert(inside(root, path) && rel, 'Unsafe archive artifact path.');
  let current = root;
  for (const part of rel.split(sep)) {
    current = join(current, part);
    const st = await lstat(current);
    assert(!st.isSymbolicLink(), 'Archive symlinks are not allowed.');
  }
  assert((await lstat(path)).isFile(), 'Archive artifact must be a regular file.');
  return readFile(path);
}
async function privateDestination(value) {
  assert(isAbsolute(value), 'Use an absolute private output path.');
  const requested = resolve(value);
  const parent = await realpath(dirname(requested));
  const output = join(parent, basename(requested));
  assert(!inside(REPO, output), 'Private staging data must remain outside the registry repository.');
  for (let dir = parent; ; dir = dirname(dir)) {
    try { await lstat(join(dir, '.git')); throw new Error('Private staging data must remain outside Git repositories.'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (dirname(dir) === dir) break;
  }
  return output;
}

/** Verify the checksum-protected complete artifact set before parsing any captured page. */
export async function readLegacyArchive(archive) {
  assert(isAbsolute(archive), 'Use an absolute archive path.');
  const root = resolve(archive);
  const st = await lstat(root);
  assert(st.isDirectory() && !st.isSymbolicLink(), 'Archive must be a real directory.');
  const manifestBytes = await regularFile(join(root, 'manifest.json'), root);
  const checksum = (await regularFile(join(root, 'manifest.sha256'), root)).toString('utf8');
  assert(/^[a-f0-9]{64}  manifest\.json\n?$/.test(checksum), 'Invalid archive manifest checksum file.');
  const archiveManifestSha256 = checksum.slice(0, 64);
  assert(sha256(manifestBytes) === archiveManifestSha256, 'Archive manifest checksum mismatch.');
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  assert(manifest.version === 1 && manifest.source === `${SOURCE}/api.php` && manifest.status === 'complete_public_api_archive' && Array.isArray(manifest.failures) && !manifest.failures.length, 'A completed, verified public EntityWiki archive is required.');
  assert(Array.isArray(manifest.artifacts), 'Archive artifact inventory is required.');
  const artifactPaths = new Set();
  for (const artifact of manifest.artifacts) {
    assert(typeof artifact.path === 'string' && artifact.path && !artifact.path.includes('\\') && !isAbsolute(artifact.path) && !artifact.path.split('/').some(p => !p || p === '.' || p === '..') && !artifactPaths.has(artifact.path), 'Unsafe or duplicate archive artifact path.');
    assert(/^[a-f0-9]{64}$/.test(artifact.sha256) && Number.isSafeInteger(artifact.bytes) && artifact.bytes >= 0, 'Invalid archive artifact digest or size.');
    artifactPaths.add(artifact.path);
    // Reject symlinked parent directories too; the existing verifier validates byte hashes/sizes.
    await regularFile(join(root, artifact.path), root);
  }
  const verified = await verifyArchive(root);
  assert(verified.ok, 'Archive artifact verification failed.');
  async function json(path) {
    assert(artifactPaths.has(path), 'Required archive artifact is not in the verified manifest.');
    const data = await regularFile(join(root, path), root);
    const artifact = manifest.artifacts.find(item => item.path === path);
    assert(sha256(data) === artifact.sha256 && data.length === artifact.bytes, 'Archive artifact changed during preparation.');
    return JSON.parse(data.toString('utf8'));
  }
  const site = await json('siteinfo.json');
  const inventory = await json('namespace-inventory.json');
  const succession = await json('url-succession.json');
  assert(site.query?.general?.server === SOURCE && typeof site.query.general.wikiid === 'string' && site.query.general.wikiid.trim(), 'The original source wiki identity is required.');
  assert(Array.isArray(inventory.pages) && Array.isArray(succession.urls) && succession.sourceOrigin === SOURCE, 'Invalid page or URL inventory.');
  const namespaces = Object.values(site.query.namespaces ?? {}).map(ns => ({ id: ns.id, name: ns.name ?? ns['*'] ?? '', ...(typeof ns.canonical === 'string' ? { canonical: ns.canonical } : {}), aliases: (site.query.namespacealiases ?? []).filter(a => a.id === ns.id).map(a => a.alias ?? a['*']) }));
  assert(namespaces.length && namespaces.every(ns => Number.isInteger(ns.id) && typeof ns.name === 'string' && ns.aliases.every(a => typeof a === 'string')) && new Set(namespaces.map(ns => ns.id)).size === namespaces.length, 'Invalid namespace inventory.');
  namespaces.sort((a, b) => a.id - b.id);
  const nsIds = new Set(namespaces.map(ns => ns.id));
  const pages = new Map(), revisionOwners = new Map(), records = [];
  for (const row of inventory.pages) {
    assert(validId(row.pageid) && !pages.has(row.pageid) && Number.isInteger(row.ns) && nsIds.has(row.ns) && typeof row.title === 'string', 'Invalid or duplicate page identity.');
    const capture = await json(`pages/${row.pageid}.json`);
    assert(capture.page?.pageid === row.pageid && capture.page.ns === row.ns && capture.page.title === row.title && Array.isArray(capture.revisions) && capture.revisions.length, 'Captured page identity or history does not match the inventory.');
    const { revisions, ...raw } = capture;
    const ids = [];
    for (const revision of revisions) {
      assert(validId(revision.revid) && !revisionOwners.has(revision.revid), 'Invalid or duplicate revision identity.');
      revisionOwners.set(revision.revid, row.pageid); ids.push(revision.revid);
      records.push({ kind: 'revision', pageId: row.pageid, revisionId: revision.revid, raw: revision });
    }
    const observed = capture.metadata?.at(-1)?.lastrevid ?? null;
    assert(observed === null || validId(observed), 'Invalid observed latest revision identity.');
    assert(typeof capture.classification === 'string' && capture.classification, 'Captured classification is required.');
    records.push({ kind: 'page', pageId: row.pageid, namespace: row.ns, title: row.title, classification: capture.classification, latestCapturedRevisionId: Math.max(...ids), observedLatestRevisionId: observed, raw });
    pages.set(row.pageid, row);
  }
  const pageArtifacts = [...artifactPaths].filter(path => /^pages\/[^/]+\.json$/.test(path));
  assert(pageArtifacts.length === pages.size, 'Unaccounted captured page artifacts.');
  const routeUrls = new Set();
  for (const raw of succession.urls) {
    assert(validId(raw.pageId) && pages.has(raw.pageId) && typeof raw.url === 'string' && typeof raw.kind === 'string' && raw.kind && !routeUrls.has(raw.url), 'Invalid or duplicate legacy route.');
    const url = new URL(raw.url);
    assert(url.origin === SOURCE && !url.username && !url.password && !url.hash, 'Legacy routes must retain the exact source origin.');
    const oldids = url.searchParams.getAll('oldid');
    assert(oldids.length < 2 && (!oldids.length || /^[1-9]\d*$/.test(oldids[0])), 'Invalid legacy revision route.');
    const revisionId = oldids.length ? Number(oldids[0]) : null;
    assert(revisionId === null || (validId(revisionId) && revisionOwners.get(revisionId) === raw.pageId), 'Legacy route references a missing or different page revision.');
    records.push({ kind: 'route', pageId: raw.pageId, revisionId, url: raw.url, routeKind: raw.kind, raw });
    routeUrls.add(raw.url);
  }
  const expected = { pages: pages.size, revisions: revisionOwners.size, routes: routeUrls.size };
  assert(expected.pages === manifest.counts.pagesCaptured && expected.pages === manifest.counts.pagesDiscovered && expected.revisions === manifest.counts.exposedRevisions && expected.routes === manifest.counts.urls, 'Actual records do not match archive manifest counts.');
  for (const record of records) assert(bytes(record) <= MAX_RECORD, 'A captured record exceeds the staging transport limit.');
  assert(!Number.isNaN(Date.parse(manifest.completedAt)) && !Number.isNaN(Date.parse(manifest.startedAt)), 'Capture timestamps are required.');
  records.sort((a, b) => a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0); // Pages before revision/route dependencies.
  const descriptor = { format: 'entitywiki.legacy-capture/1', sourceOrigin: SOURCE, sourceWikiId: site.query.general.wikiid, archiveManifestSha256, transferDigest: await legacyTransferDigest(records), capturedAt: manifest.completedAt, captureStartedAt: manifest.startedAt, expected, namespaces, accessPolicy: 'operator_only', sourcePermissionScope: 'unauthenticated_public_capture_only' };
  return { descriptor, records, artifactsChecked: verified.artifactsChecked };
}

export async function prepareLegacyStage({ archive, output }) {
  const prepared = await readLegacyArchive(archive);
  const root = await privateDestination(output);
  process.umask(0o077);
  await mkdir(root, { mode: 0o700 }); // Fresh output only: never overwrite an earlier capture/receipt.
  await chmod(root, 0o700);
  const descriptor = canonicalLegacy(prepared.descriptor) + '\n';
  const records = prepared.records.map(record => canonicalLegacy(record)).join('\n') + '\n';
  const files = { 'descriptor.json': descriptor, 'records.ndjson': records };
  for (const [name, data] of Object.entries(files)) await writeFile(join(root, name), data, { mode: 0o600, flag: 'wx' });
  const receipt = { format: 'entitywiki.legacy-stage/1', preparedAt: new Date().toISOString(), scope: 'Operator-only public capture rehearsal; not a complete SQL/files/accounts restoration.', artifactsChecked: prepared.artifactsChecked, counts: prepared.descriptor.expected, archiveManifestSha256: prepared.descriptor.archiveManifestSha256, transferDigest: prepared.descriptor.transferDigest, files: Object.entries(files).map(([path, data]) => ({ path, bytes: bytes(data), sha256: sha256(data) })) };
  await writeFile(join(root, 'preparation.json'), JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  return { root, ...prepared, receipt };
}

export async function readPreparedStage(value) {
  const root = await privateDestination(value);
  assert((await lstat(root)).isDirectory(), 'Prepared staging directory is required.');
  const receipt = JSON.parse((await regularFile(join(root, 'preparation.json'), root)).toString('utf8'));
  assert(receipt.format === 'entitywiki.legacy-stage/1' && Array.isArray(receipt.files) && receipt.files.length === 2, 'Invalid preparation receipt.');
  const loaded = {};
  for (const name of ['descriptor.json', 'records.ndjson']) {
    const file = receipt.files.find(file => file.path === name);
    assert(file && receipt.files.filter(file => file.path === name).length === 1, 'Missing or duplicate prepared artifact.');
    const data = await regularFile(join(root, name), root);
    assert(data.length === file.bytes && sha256(data) === file.sha256, 'Prepared artifact checksum mismatch.');
    loaded[name] = data.toString('utf8');
  }
  const descriptor = JSON.parse(loaded['descriptor.json']);
  const records = loaded['records.ndjson'].trimEnd().split('\n').map(line => JSON.parse(line));
  assert(descriptor.format === 'entitywiki.legacy-capture/1' && descriptor.sourceOrigin === SOURCE && descriptor.accessPolicy === 'operator_only' && descriptor.sourcePermissionScope === 'unauthenticated_public_capture_only', 'Prepared descriptor scope is invalid.');
  const keys = new Set();
  for (const record of records) {
    assert(['page', 'revision', 'route'].includes(record.kind) && bytes(record) <= MAX_RECORD, 'Invalid prepared record.');
    const key = `${record.kind}:${record.kind === 'page' ? record.pageId : record.kind === 'revision' ? record.revisionId : record.url}`;
    assert(!keys.has(key), 'Duplicate prepared record identity.'); keys.add(key);
  }
  const counts = { pages: records.filter(r => r.kind === 'page').length, revisions: records.filter(r => r.kind === 'revision').length, routes: records.filter(r => r.kind === 'route').length };
  assert(canonicalLegacy(counts) === canonicalLegacy(descriptor.expected) && canonicalLegacy(counts) === canonicalLegacy(receipt.counts), 'Prepared record counts mismatch.');
  assert(await legacyTransferDigest(records) === descriptor.transferDigest && descriptor.transferDigest === receipt.transferDigest && descriptor.archiveManifestSha256 === receipt.archiveManifestSha256, 'Prepared transfer digest mismatch.');
  return { root, descriptor, records };
}

/** Bound the actual request envelope, not just its record array; never split one revision. */
export function legacyBatches(records, snapshotId, maximum = MAX_PAYLOAD) {
  assert(typeof snapshotId === 'string' && snapshotId.length > 0 && snapshotId.length <= 256, 'Invalid snapshot identity.');
  const batches = []; let current = [];
  for (const record of records) {
    assert(bytes(record) <= MAX_RECORD, 'A captured record exceeds the staging transport limit.');
    if (current.length && (current.length >= 100 || bytes({ snapshotId, records: [...current, record] }) >= maximum)) { batches.push(current); current = []; }
    assert(bytes({ snapshotId, records: [...current, record] }) < maximum, 'One record exceeds the staging request limit.');
    current.push(record);
  }
  if (current.length) batches.push(current);
  return batches;
}

export async function importPreparedStage({ prepared, origin, varsPath = join(REPO, '.dev.vars'), fetcher = fetch }) {
  const target = localStagingOrigin(origin);
  const loaded = await readPreparedStage(prepared);
  const vars = await readFile(varsPath, 'utf8');
  const key = /^OPERATOR_LOCAL_KEY=(.+)$/m.exec(vars)?.[1]?.trim();
  assert(/^OPERATOR_AUTH_MODE=local\s*$/m.test(vars) && key && key.length >= 32, 'Configure the ignored .dev.vars local operator mode and key.');
  const login = await fetcher(new URL('/admin/auth', target), { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: target.origin }, body: new URLSearchParams({ key }), signal: AbortSignal.timeout(30_000) });
  const location = login.headers.get('location');
  assert(login.status === 303 && location && new URL(location, target).origin === target.origin, 'Local staging sign-in failed. No redirects were followed.');
  const cookie = login.headers.get('set-cookie')?.split(';')[0];
  assert(cookie?.startsWith('entitywiki_local_operator=') && cookie.length > 'entitywiki_local_operator='.length, 'The local encrypted operator session is required.');
  async function post(path, body) {
    const payload = JSON.stringify(body);
    assert(bytes(payload) < MAX_PAYLOAD, 'Staging request exceeds the transport limit.');
    const response = await fetcher(new URL(path, target), { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/json', Origin: target.origin, Cookie: cookie }, body: payload, signal: AbortSignal.timeout(60_000) });
    assert(response.status === 200, `Local staging request failed (HTTP ${response.status}); the source archive is unchanged.`);
    return response.json();
  }
  let result = await post('/api/migration/begin', { descriptor: loaded.descriptor });
  assert(typeof result.snapshotId === 'string' && ['loading', 'ready'].includes(result.state), 'Invalid migration receipt.');
  const snapshotId = result.snapshotId;
  const batches = legacyBatches(loaded.records, snapshotId);
  if (result.state !== 'ready') {
    for (const records of batches) {
      result = await post('/api/migration/ingest', { snapshotId, records });
      assert(result.snapshotId === snapshotId && result.state === 'loading', 'Unexpected staging import state.');
    }
    result = await post('/api/migration/finalize', { snapshotId });
  }
  assert(result.snapshotId === snapshotId && result.state === 'ready' && canonicalLegacy(result.counts) === canonicalLegacy(loaded.descriptor.expected), 'Staging final counts/state mismatch.');
  const receipt = { format: 'entitywiki.legacy-stage-import/1', importedAt: new Date().toISOString(), origin: target.origin, snapshotId, state: result.state, counts: result.counts, transferDigest: loaded.descriptor.transferDigest, archiveManifestSha256: loaded.descriptor.archiveManifestSha256, replayed: result.replayed ?? false, batches: batches.length, publication: 'none', scope: 'Operator-only captured public data; original permissions/accounts are not restored.' };
  await writeFile(join(loaded.root, 'import-receipt.json.tmp'), JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
  await chmod(join(loaded.root, 'import-receipt.json.tmp'), 0o600);
  await rename(join(loaded.root, 'import-receipt.json.tmp'), join(loaded.root, 'import-receipt.json'));
  return receipt;
}

export async function main(args = process.argv.slice(2)) {
  const known = new Set(['--archive', '--output', '--prepared', '--origin']);
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    assert(known.has(args[i]) && args[i + 1] && !args[i + 1].startsWith('--') && !(args[i] in options), 'Usage: legacy-stage.mjs --archive /private/archive --output /private/fresh-output [--origin http://127.0.0.1:8876] OR --prepared /private/output --origin http://127.0.0.1:8876');
    options[args[i]] = args[i + 1];
  }
  assert(options['--prepared'] ? !options['--archive'] && !options['--output'] && options['--origin'] : options['--archive'] && options['--output'], 'Choose fresh archive preparation or explicit prepared import.');
  if (options['--origin']) localStagingOrigin(options['--origin']);
  const staged = options['--prepared'] ? null : await prepareLegacyStage({ archive: options['--archive'], output: options['--output'] });
  if (options['--origin']) {
    const receipt = await importPreparedStage({ prepared: options['--prepared'] ?? staged.root, origin: options['--origin'] });
    console.log(JSON.stringify(receipt));
  } else console.log(JSON.stringify({ prepared: true, ...staged.receipt }));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(() => { console.error('Legacy staging failed. Inspect private inputs and staging status; no source requests or live changes were made.'); process.exitCode = 1; });
