#!/usr/bin/env node
/** Public, unauthenticated read-only preservation. Never a SQL/files/accounts backup. */
import { mkdir, readFile, writeFile, rename, chmod, lstat } from 'node:fs/promises';
import { resolve, relative, dirname, join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

export const API = 'https://entitywiki.org/api.php';
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => JSON.stringify(value, Object.keys(value).sort());
const posix = value => value.replaceAll('\\', '/');
const safeTitle = title => encodeURIComponent(title.replaceAll(' ', '_')).replaceAll('%3A', ':').replaceAll('%2F', '/');

export function checkedUrl(value, api = false) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'entitywiki.org' || url.port || url.username || url.password || url.hash || (api && url.pathname !== '/api.php')) throw new Error('Only the entitywiki.org HTTPS source is allowed');
  if (api && (url.searchParams.get('action') !== 'query' || url.searchParams.has('token'))) throw new Error('Only unauthenticated action=query reads are allowed');
  return url;
}
export function verifySourceAsset(bytes, source) {
  if (source.sourceSize != null && Number(source.sourceSize) !== bytes.length) throw new Error('Asset byte size does not match source metadata');
  if (source.sourceSha1) {
    const hex = createHash('sha1').update(bytes).digest('hex');
    const expected = String(source.sourceSha1).toLowerCase();
    const actual = expected.length === 40 && /^[a-f0-9]+$/.test(expected) ? hex : BigInt('0x' + hex).toString(36);
    if (actual.replace(/^0+/, '') !== expected.replace(/^0+/, '')) throw new Error('Asset SHA-1 does not match source version metadata');
  }
}
export function classifyPage(page, content = '') {
  const ns = Number(page.ns);
  if (ns === 0 && page.pageid === 213) return 'company_pilot';
  if (ns === 0 && ['Andrew Ruditser', 'Brian Winum'].includes(page.title)) return 'person_review_required';
  if (ns === 0 && page.title === 'Main Page') return 'site_navigation';
  if (ns === 0 && /placeholder/i.test(content) && content.trim().length < 200) return 'placeholder_no_declaration';
  if (ns === 0) return 'content_requires_entity_classification';
  if (ns === 6) return 'media_requires_rights_review';
  if (ns === 10) return 'template_dependency';
  if (ns === 14) return 'category_directory_not_ontology_class';
  if (ns === 8) return 'public_system_message_not_full_configuration';
  if (ns === 2) return 'contributor_profile_private_migration_review';
  if (ns % 2 === 1) return 'discussion_and_attribution';
  return 'namespace_content_review_required';
}
export function pageUrls(page, revisions, source = {}) {
  const title = safeTitle(page.title);
  const pretty = `https://entitywiki.org/${title}`;
  const rows = [
    { url: source.fullurl || pretty, kind: 'article', disposition: 'retain_exact_url_or_reviewed_equivalent' },
    { url: pretty, kind: 'pretty_alias', disposition: 'retain_exact_url_or_reviewed_equivalent' },
    { url: `https://entitywiki.org/index.php?title=${title}`, kind: 'title_query_alias', disposition: 'retain_exact_url_or_reviewed_equivalent' },
    { url: `https://entitywiki.org/index.php?curid=${page.pageid}`, kind: 'page_id_alias', disposition: 'retain_page_identity_resolution' },
    { url: `https://entitywiki.org/index.php?title=${title}&action=history`, kind: 'history', disposition: 'retain_history_and_authorship' },
  ];
  for (const revision of revisions) {
    rows.push({ url: `https://entitywiki.org/index.php?title=${title}&oldid=${revision.revid}`, kind: 'immutable_revision', disposition: 'retain_revision_and_attribution' });
    rows.push({ url: `https://entitywiki.org/index.php?oldid=${revision.revid}`, kind: 'revision_id_alias', disposition: 'retain_revision_and_attribution' });
  }
  return [...new Map(rows.map(row => [row.url, { ...row, pageId: page.pageid, title: page.title, namespace: page.ns }])).values()];
}
export function continuation(previous, next, seen) {
  if (!next) return null;
  const key = canonical(next);
  if (key === canonical(previous ?? {}) || seen.has(key)) throw new Error('Repeated API continuation; refusing an incomplete infinite loop');
  seen.add(key);
  return next;
}
export async function verifyArchive(output) {
  const root = resolve(output);
  const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
  const errors = [];
  for (const artifact of manifest.artifacts) {
    const path = resolve(root, artifact.path);
    if (relative(root, path).startsWith('..') || isAbsolute(relative(root, path))) { errors.push(`Unsafe artifact path ${artifact.path}`); continue; }
    try {
      const st = await lstat(path);
      if (!st.isFile() || st.isSymbolicLink()) throw new Error('not a regular file');
      const bytes = await readFile(path);
      if (hash(bytes) !== artifact.sha256 || bytes.length !== artifact.bytes) errors.push(`Digest/size mismatch ${artifact.path}`);
    } catch { errors.push(`Missing/unreadable ${artifact.path}`); }
  }
  return { ok: !errors.length, artifactsChecked: manifest.artifacts.length, scope: manifest.scope, status: manifest.status, errors };
}

export async function capture({ output, resume = false, intervalMs = 400, maxRequests = 10000, maxAssetBytes = 100_000_000, fetcher = fetch, log = console.log }) {
  if (!isAbsolute(output)) throw new Error('Use an absolute archive destination outside the registry repository');
  const root = resolve(output);
  if (!relative(REPO, root).startsWith('..')) throw new Error('Private archives must not be written inside the registry repository');
  process.umask(0o077);
  let exists = false;
  try { const st = await lstat(root); exists = true; if (!st.isDirectory() || st.isSymbolicLink()) throw new Error('Archive destination must be a real directory'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (exists && !resume) throw new Error('Archive destination exists; use --resume rather than overwrite it');
  await mkdir(root, { recursive: true, mode: 0o700 }); await chmod(root, 0o700);
  for (const folder of ['responses', 'pages', 'assets']) await mkdir(join(root, folder), { recursive: true, mode: 0o700 });
  const statePath = join(root, 'state.json');
  const state = resume ? JSON.parse(await readFile(statePath, 'utf8')) : { version: 1, source: API, startedAt: new Date().toISOString(), requests: {}, assets: {} };
  if (state.source !== API || state.version !== 1) throw new Error('Archive source/version mismatch');
  const failures = [], artifacts = new Map(); let networkRequests = 0, lastRequest = 0;
  async function save(path, bytes) {
    const full = join(root, path), data = typeof bytes === 'string' ? Buffer.from(bytes) : bytes;
    await writeFile(full + '.tmp', data, { mode: 0o600 }); await rename(full + '.tmp', full); await chmod(full, 0o600);
    artifacts.set(path, { path: posix(path), bytes: data.length, sha256: hash(data) });
  }
  const saveJson = (path, data) => save(path, JSON.stringify(data, null, 2) + '\n');
  const checkpoint = () => saveJson('state.json', state);
  async function cached(path, expected) {
    try { const bytes = await readFile(join(root, path)); if (hash(bytes) !== expected) throw new Error('Digest mismatch'); artifacts.set(path, { path: posix(path), bytes: bytes.length, sha256: expected }); return bytes; } catch { throw new Error(`Cached artifact is missing or changed: ${path}. Preserve it and start a fresh capture; do not silently replace evidence.`); }
  }
  async function boundedResponse(response, maximum) {
    const reader = response.body?.getReader(); if (!reader) return Buffer.alloc(0);
    const chunks = []; let size = 0;
    try { while (true) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > maximum) throw new Error(`Response exceeds ${maximum} byte bound`); chunks.push(Buffer.from(value)); } } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    return Buffer.concat(chunks);
  }
  async function network(url, maximum, json = false) {
    checkedUrl(url, json);
    for (let attempt = 0; attempt < 3; attempt++) {
      if (networkRequests >= maxRequests) throw new Error(`Read request bound ${maxRequests} reached; resume the same archive`);
      await delay(Math.max(0, intervalMs - (Date.now() - lastRequest))); lastRequest = Date.now(); networkRequests++;
      try {
        const response = await fetcher(url, { method: 'GET', redirect: 'error', headers: { 'User-Agent': 'EntityWiki-Preservation/1.0 (+https://entitywiki.org/; public read-only archive)', Accept: json ? 'application/json' : '*/*' }, signal: AbortSignal.timeout(30_000) });
        if ([429, 500, 502, 503, 504].includes(response.status) && attempt < 2) { await response.body?.cancel(); const retry = Number(response.headers.get('retry-after')); await delay(Math.min(10_000, Math.max(1000 * (attempt + 1), Number.isFinite(retry) ? retry * 1000 : 0))); continue; }
        if (!response.ok) throw new Error(`Source HTTP ${response.status}`);
        const bytes = await boundedResponse(response, maximum);
        if (json) { const parsed = JSON.parse(bytes.toString('utf8')); if (parsed.error) { if (['maxlag', 'ratelimited', 'readonly'].includes(parsed.error.code) && attempt < 2) { await delay(1000 * (attempt + 1)); continue; } throw new Error(`Source API ${parsed.error.code}`); } }
        return { bytes, status: response.status, contentType: response.headers.get('content-type'), retrievedAt: new Date().toISOString() };
      } catch (error) { if (attempt === 2) throw error; await delay(1000 * (attempt + 1)); }
    }
    throw new Error('Bounded source read failed');
  }
  async function query(params) {
    const fields = { action: 'query', format: 'json', formatversion: '2', maxlag: '5', ...params };
    if (fields.action !== 'query') throw new Error('Write actions are not supported');
    const url = checkedUrl(API + '?' + new URLSearchParams(fields), true).href;
    const key = hash(canonical(fields)), path = `responses/${key}.json`;
    if (state.requests[key]) return JSON.parse((await cached(path, state.requests[key].sha256)).toString('utf8')).body;
    const response = await network(url, 16_000_000, true); const body = JSON.parse(response.bytes.toString('utf8'));
    await saveJson(path, { requestUrl: url, method: 'GET', retrievedAt: response.retrievedAt, httpStatus: response.status, body });
    state.requests[key] = { path, sha256: artifacts.get(path).sha256 }; await checkpoint(); return body;
  }
  async function paginate(params, accept) {
    let next = null; const seen = new Set();
    do { const data = await query({ ...params, ...(next ?? {}) }); await accept(data); next = continuation(next, data.continue, seen); } while (next);
  }
  await checkpoint();
  const site = await query({ meta: 'siteinfo', siprop: 'general|namespaces|namespacealiases|statistics|rightsinfo|extensions|fileextensions|protocols' });
  if (!site.query?.namespaces) throw new Error('Namespace inventory is unavailable');
  await saveJson('siteinfo.json', site);
  const namespaces = Object.values(site.query.namespaces).sort((a, b) => a.id - b.id);
  const namespaceInventory = [], pages = [];
  for (const ns of namespaces.filter(ns => ns.id >= 0)) {
    const found = [];
    try { await paginate({ list: 'allpages', apnamespace: String(ns.id), aplimit: 'max', apfilterredir: 'all' }, data => { found.push(...(data.query?.allpages ?? [])); }); }
    catch (error) { failures.push({ stage: 'namespace', namespace: ns.id, error: error.message }); }
    namespaceInventory.push({ id: ns.id, name: ns.name ?? ns['*'] ?? '', canonical: ns.canonical ?? '', count: found.length }); pages.push(...found);
    log(`Namespace ${ns.id}: ${found.length} exposed pages`);
  }
  const unique = [...new Map(pages.map(page => [page.pageid, page])).values()].sort((a, b) => a.pageid - b.pageid);
  await saveJson('namespace-inventory.json', { namespaces: namespaceInventory, virtualNamespaces: namespaces.filter(ns => ns.id < 0), pages: unique });
  let revisionsTotal = 0, revisionContentHidden = 0; const urls = [], assets = [], classifications = [];
  for (let index = 0; index < unique.length; index++) {
    const page = unique[index], revisions = [], metadata = [], imageinfo = [];
    try {
      await paginate({ pageids: String(page.pageid), prop: 'info|revisions', inprop: 'url|protection', rvprop: 'ids|timestamp|user|userid|comment|flags|size|sha1|contentmodel|content', rvslots: '*', rvlimit: '50', rvdir: 'newer', rvend: state.startedAt }, data => {
        const found = data.query?.pages?.find(p => p.pageid === page.pageid); if (!found || found.missing) throw new Error('Page disappeared or was inaccessible'); metadata.push({ ...found, revisions: undefined }); revisions.push(...(found.revisions ?? []));
      });
      if (!revisions.length) throw new Error('No revision was exposed at the capture-start boundary; reconcile a page created/changed during acquisition');
      revisionsTotal += revisions.length;
      for (const rev of revisions) if (rev.texthidden || rev.suppressed || !Object.values(rev.slots ?? {}).some(slot => typeof slot.content === 'string')) revisionContentHidden++;
      const linkPages = [];
      await paginate({ pageids: String(page.pageid), prop: 'categories|templates|links|extlinks|langlinks|iwlinks|redirects|pageprops', cllimit: 'max', tllimit: 'max', pllimit: 'max', ellimit: 'max', lllimit: 'max', iwlimit: 'max', rdlimit: 'max' }, data => { linkPages.push(...(data.query?.pages ?? [])); });
      if (Number(page.ns) === 6) await paginate({ pageids: String(page.pageid), prop: 'imageinfo', iiprop: 'timestamp|user|userid|url|size|sha1|mime|mediatype|metadata|commonmetadata|extmetadata|archivename|comment|canonicaltitle', iilimit: 'max', iistart: state.startedAt }, data => { imageinfo.push(...(data.query?.pages?.[0]?.imageinfo ?? [])); });
      const latest = revisions.at(-1); const text = latest?.slots?.main?.content ?? '';
      const classification = classifyPage(page, text); classifications.push({ pageId: page.pageid, namespace: page.ns, title: page.title, classification, disposition: 'review_required', exposedRevisions: revisions.length, hiddenRevisionContent: revisions.filter(r => r.texthidden || r.suppressed).length });
      urls.push(...pageUrls(page, revisions, metadata.at(-1)));
      await saveJson(`pages/${page.pageid}.json`, { page, captureBoundary: state.startedAt, metadata, revisions, linkedMetadataResponses: linkPages, imageinfo, classification, historyScope: 'All revisions exposed to unauthenticated API up to capture start; deleted/suppressed/private revisions are not promised.' });
      for (const version of imageinfo) if (version.url) assets.push({ pageId: page.pageid, title: page.title, timestamp: version.timestamp, sourceUrl: version.url, sourceSha1: version.sha1 ?? null, sourceSize: version.size ?? null, mime: version.mime ?? null });
      log(`Page ${index + 1}/${unique.length}: ${page.pageid}, ${revisions.length} revisions`);
    } catch (error) { failures.push({ stage: 'page', pageId: page.pageid, title: page.title, error: error.message }); }
  }
  const assetInventory = [];
  for (const asset of assets) {
    const entry = { ...asset };
    try {
      const url = checkedUrl(asset.sourceUrl).href; const key = hash(url), extension = new URL(url).pathname.match(/\.([A-Za-z0-9]{1,10})$/)?.[1]?.toLowerCase() ?? 'bin'; const path = `assets/${key}.${extension}`;
      if (state.assets[key]) { await cached(path, state.assets[key].sha256); Object.assign(entry, state.assets[key]); }
      else { const response = await network(url, maxAssetBytes); verifySourceAsset(response.bytes, asset); await save(path, response.bytes); Object.assign(entry, { path, sha256: artifacts.get(path).sha256, bytes: response.bytes.length, retrievedAt: response.retrievedAt, contentType: response.contentType }); state.assets[key] = { path: entry.path, sha256: entry.sha256, bytes: entry.bytes, retrievedAt: entry.retrievedAt, contentType: entry.contentType }; await checkpoint(); }
      entry.status = 'captured'; urls.push({ url: asset.sourceUrl, kind: 'file_revision_asset', pageId: asset.pageId, title: asset.title, disposition: 'retain_asset_bytes_url_and_rights' });
    } catch (error) { entry.status = 'missing'; entry.error = error.message; failures.push({ stage: 'asset', pageId: asset.pageId, sourceUrl: asset.sourceUrl, error: error.message }); }
    assetInventory.push(entry);
  }
  if (!urls.some(row => row.url === 'https://entitywiki.org/MAXPlaces_Marketing' && row.pageId === 213)) failures.push({ stage: 'acceptance', error: 'Exact MAXPlaces legacy URL/page identity missing from succession inventory' });
  await saveJson('url-succession.json', { status: 'inventory_only_not_redirect_authorization', sourceOrigin: 'https://entitywiki.org', targets: 'undecided; keep existing source URLs intact', urls: [...new Map(urls.map(row => [row.url, row])).values()] });
  await saveJson('page-classification.json', classifications);
  await saveJson('asset-inventory.json', assetInventory);
  state.lastCompletedAt = new Date().toISOString(); state.status = failures.length ? 'partial_public_archive' : 'complete_public_api_archive'; await checkpoint();
  const manifest = { version: 1, scope: 'UNAUTHENTICATED PUBLIC MEDIAWIKI API ARCHIVE — NOT A FULL SQL, FILESYSTEM, CONFIGURATION, OR ACCOUNTS BACKUP', source: API, startedAt: state.startedAt, completedAt: state.lastCompletedAt, status: state.status, consistency: 'Bounded acquisition window, not a transactional database snapshot. Revisions stop at capture start; other public metadata is observed at request time.', counts: { namespacesInventoried: namespaceInventory.length, pagesDiscovered: unique.length, pagesCaptured: classifications.length, exposedRevisions: revisionsTotal, revisionsWithUnavailableContent: revisionContentHidden, fileVersions: assetInventory.length, fileVersionsCaptured: assetInventory.filter(a => a.status === 'captured').length, uniqueAssetFiles: new Set(assetInventory.filter(a => a.path).map(a => a.path)).size, urls: new Set(urls.map(row => row.url)).size, cachedApiResponses: Object.keys(state.requests).length, newNetworkReads: networkRequests }, missingPrivateScope: ['Full source-host SQL dump of every wiki database/table', 'Source-host uploads/filesystem including unreferenced/deleted/restricted assets', 'LocalSettings.php and secrets, extensions, skins, custom code, rewrite/vhost/cron configuration', 'Accounts, password hashes, private permissions/groups, logs, deleted/suppressed/private revisions and private namespaces not exposed by API', 'Source-host backup restore rehearsal; this public archive cannot restore the complete service by itself'], failures, artifacts: [...artifacts.values()].sort((a, b) => a.path.localeCompare(b.path)) };
  await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 }); await chmod(join(root, 'manifest.json'), 0o600);
  const bytes = await readFile(join(root, 'manifest.json')); await writeFile(join(root, 'manifest.sha256'), `${hash(bytes)}  manifest.json\n`, { mode: 0o600 });
  log(JSON.stringify({ status: manifest.status, counts: manifest.counts, failures: failures.length, output: root })); return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), outputIndex = args.indexOf('--output');
  if (outputIndex < 0 || !args[outputIndex + 1]) { console.error('Usage: node scripts/mediawiki-capture.mjs --output /absolute/private/backups/archive [--resume]'); process.exitCode = 2; }
  else await capture({ output: args[outputIndex + 1], resume: args.includes('--resume') }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
