#!/usr/bin/env node
/** Offline report only. Never installs redirects, changes DNS, or contacts a server. */
import { readFile, writeFile, mkdir, chmod, lstat, realpath } from 'node:fs/promises';
import { resolve, relative, isAbsolute, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { verifyArchive, pageUrls } from './mediawiki-capture.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = 'https://entitywiki.org';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const modes = new Set(['preserve_exact', 'retain_legacy_handler', 'reviewed_redirect', 'private_access_review']);
const historical = new Set(['immutable_revision', 'revision_id_alias', 'history']);
const knownKinds = new Set(['article', 'pretty_alias', 'title_query_alias', 'page_id_alias', 'history', 'immutable_revision', 'revision_id_alias', 'file_revision_asset']);

function checkedSourceUrl(value) {
  if (typeof value !== 'string') throw new Error('URL must be a string');
  const url = new URL(value);
  if (url.origin !== SOURCE || url.username || url.password || url.hash) throw new Error('Inventory must contain same-origin HTTPS source URLs without credentials/fragments');
  return url;
}
function numberId(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Invalid ${label}`);
  return value;
}
function queryId(url, name) {
  const values = url.searchParams.getAll(name);
  if (!values.length) return null;
  if (values.length !== 1 || !/^[1-9][0-9]*$/.test(values[0])) throw new Error(`Ambiguous or invalid ${name} query identity`);
  return numberId(Number(values[0]), name);
}
export function classifyLegacyRoute(value) {
  const url = checkedSourceUrl(value);
  const oldid = queryId(url, 'oldid'), curid = queryId(url, 'curid');
  const action = url.searchParams.get('action');
  if (url.pathname === '/index.php') {
    if (oldid && curid) return 'ambiguous_query';
    if (url.searchParams.has('diff')) return 'revision_diff';
    if (oldid) return 'revision';
    if (action === 'history') return 'history';
    if (curid) return 'page_id';
    if (url.searchParams.has('title') && (!action || action === 'view')) return 'title_query';
    return 'legacy_script';
  }
  if (url.pathname === '/api.php') return 'api';
  if (url.pathname === '/rest.php' || url.pathname.startsWith('/rest.php/')) return 'rest_api';
  if (/^\/Special:(?:Redirect\/(?:page|revision)|PermanentLink)\//i.test(url.pathname)) return 'special_identity';
  if (/^\/Special:/i.test(url.pathname)) return 'special_page';
  if (/^\/(?:images|uploads)\//.test(url.pathname)) return 'asset';
  return url.search ? 'article_query' : 'article';
}
function requiredBehavior(route, namespace) {
  if (namespace === 2 || namespace === 3) return 'preserve_access_policy_and_attribution';
  if (['revision', 'history'].includes(route)) return 'retain_immutable_history_and_attribution';
  if (route === 'page_id' || route === 'special_identity') return 'retain_original_numeric_identity_resolution';
  if (route === 'asset') return 'retain_exact_asset_url_bytes_and_rights';
  return 'serve_existing_url_with_equivalent_content';
}

/** Inputs contain no credentials; output excludes contributor names and revision content. */
export function buildUrlPreservationReport({ manifest, manifestSha256, inventory, pages, siteinfo, decisions = [] }) {
  if (inventory.sourceOrigin !== SOURCE || !Array.isArray(inventory.urls) || !Array.isArray(pages) || !Array.isArray(decisions)) throw new Error('Unsupported archive/inventory/decision shape');
  const issues = [], pageMap = new Map(), revisionOwners = new Map(), urlOwners = new Map(), rows = new Map();
  const issue = (code, detail) => issues.push({ code, ...detail });
  for (const captured of pages) {
    const page = captured.page;
    numberId(page?.pageid, 'page ID');
    if (pageMap.has(page.pageid)) throw new Error('Duplicate captured page ID');
    const revisions = captured.revisions ?? [];
    const ids = revisions.map(r => numberId(r.revid, 'revision ID'));
    if (ids.length !== new Set(ids).size) issue('duplicate_revision_in_page', { pageId: page.pageid });
    for (const id of ids) {
      const owners = revisionOwners.get(id) ?? new Set(); owners.add(page.pageid); revisionOwners.set(id, owners);
    }
    pageMap.set(page.pageid, { captured, page, ids });
  }
  for (const [revisionId, owners] of revisionOwners) if (owners.size > 1) issue('revision_owned_by_multiple_pages', { revisionId, pageIds: [...owners].sort((a, b) => a - b) });
  const expected = [];
  for (const { captured, page } of pageMap.values()) {
    expected.push(...pageUrls(page, captured.revisions, captured.metadata?.at(-1) ?? {}));
  }
  for (const entry of [...expected, ...inventory.urls]) {
    const owners = urlOwners.get(entry.url) ?? new Set(); owners.add(entry.pageId); urlOwners.set(entry.url, owners);
  }
  for (const [url, owners] of urlOwners) if (owners.size > 1) issue('exact_url_identity_collision', { url, pageIds: [...owners].sort((a, b) => a - b) });
  for (const entry of [...inventory.urls].sort((a, b) => compare(a.url, b.url) || a.pageId - b.pageId || compare(a.kind, b.kind))) {
    const url = checkedSourceUrl(entry.url), pageId = numberId(entry.pageId, 'inventory page ID');
    if (!knownKinds.has(entry.kind)) throw new Error(`Unsupported inventory URL kind: ${entry.kind}`);
    const found = pageMap.get(pageId);
    if (!found) { issue('inventory_page_not_captured', { url: entry.url, pageId }); continue; }
    if (entry.title !== found.page.title || (entry.kind !== 'file_revision_asset' && Number(entry.namespace) !== Number(found.page.ns))) issue('inventory_page_metadata_mismatch', { url: entry.url, pageId });
    const oldid = queryId(url, 'oldid'), curid = queryId(url, 'curid');
    const route = classifyLegacyRoute(entry.url);
    if (oldid && (revisionOwners.get(oldid)?.size !== 1 || !revisionOwners.get(oldid)?.has(pageId))) issue('revision_identity_mismatch', { url: entry.url, pageId, revisionId: oldid });
    if (curid && curid !== pageId) issue('page_query_identity_mismatch', { url: entry.url, pageId, queryPageId: curid });
    if (route === 'ambiguous_query') issue('ambiguous_query_identity', { url: entry.url, pageId });
    if ((historical.has(entry.kind) && !['revision', 'history'].includes(route)) || (entry.kind === 'page_id_alias' && route !== 'page_id')) issue('declared_route_kind_mismatch', { url: entry.url, kind: entry.kind, route });
    const prior = rows.get(entry.url);
    if (prior) { prior.inventoryKinds = [...new Set([...prior.inventoryKinds, entry.kind])].sort(compare); continue; }
    rows.set(entry.url, {
      url: entry.url, sourcePageId: pageId, sourceRevisionId: oldid, sourceNamespace: found.page.ns,
      sourceTitle: found.page.title, inventoryKinds: [entry.kind], route,
      evidence: (found.captured.metadata ?? []).some(m => m.fullurl === entry.url || m.canonicalurl === entry.url) ? 'observed_source_metadata_url' : 'derived_alias_not_http_verified',
      requiredBehavior: entry.kind === 'file_revision_asset' ? 'retain_exact_asset_url_bytes_and_rights' : requiredBehavior(route, Number(found.page.ns)), decision: null,
    });
  }
  for (const entry of expected) if (!rows.has(entry.url)) issue('expected_route_missing_from_inventory', { url: entry.url, pageId: entry.pageId, kind: entry.kind });
  const seenDecisions = new Set();
  for (const decision of decisions) {
    if (!decision || typeof decision !== 'object' || !modes.has(decision.mode)) throw new Error('Unknown succession decision mode');
    checkedSourceUrl(decision.url);
    if (seenDecisions.has(decision.url)) throw new Error('Duplicate succession decision URL');
    seenDecisions.add(decision.url);
    const row = rows.get(decision.url);
    if (!row) throw new Error('Succession decision URL absent from source inventory');
    if (decision.sourcePageId !== row.sourcePageId || (decision.sourceRevisionId ?? null) !== row.sourceRevisionId) throw new Error('Succession decision must explicitly match source page/revision IDs');
    const target = decision.targetUrl ?? decision.url;
    checkedSourceUrl(target);
    if (decision.mode !== 'reviewed_redirect' && target !== decision.url) throw new Error('Only a reviewed redirect decision may change the target URL');
    if (decision.mode === 'reviewed_redirect') {
      if (target === decision.url) throw new Error('A redirect cannot target itself');
      if (!decision.reason?.trim() || !decision.reviewedBy?.trim()) throw new Error('Redirect decisions require a reason and reviewer');
      const targetRow = rows.get(target);
      if (!targetRow || targetRow.sourcePageId !== row.sourcePageId) throw new Error('Redirect target must be an inventoried URL for the same source page; manual review is required for any other move');
      if (row.sourceRevisionId && targetRow.sourceRevisionId !== row.sourceRevisionId) throw new Error('Historical URLs cannot be redirected to a different revision/current page');
      if (row.route === 'history' && targetRow.route !== 'history') throw new Error('History URLs must retain history semantics');
    }
    row.decision = { mode: decision.mode, targetUrl: target, reason: decision.reason ?? '', reviewedBy: decision.reviewedBy ?? '' };
  }
  // A reviewed redirect chain/loop is a review failure, never a deployable rule.
  for (const row of rows.values()) if (row.decision?.mode === 'reviewed_redirect') {
    const target = rows.get(row.decision.targetUrl);
    if (target?.decision?.mode === 'reviewed_redirect') issue('redirect_chain_or_cycle', { url: row.url, targetUrl: target.url });
  }
  if (manifest.counts?.pagesCaptured != null && manifest.counts.pagesCaptured !== pageMap.size) issue('manifest_page_count_mismatch', { expected: manifest.counts.pagesCaptured, actual: pageMap.size });
  if (manifest.counts?.exposedRevisions != null && manifest.counts.exposedRevisions !== revisionOwners.size) issue('manifest_revision_count_mismatch', { expected: manifest.counts.exposedRevisions, actual: revisionOwners.size });
  if (manifest.counts?.urls != null && manifest.counts.urls !== rows.size) issue('manifest_url_count_mismatch', { expected: manifest.counts.urls, actual: rows.size });
  const ledger = [...rows.values()].sort((a, b) => compare(a.url, b.url));
  const routeCounts = {}, namespaceCounts = {};
  for (const row of ledger) { routeCounts[row.route] = (routeCounts[row.route] ?? 0) + 1; namespaceCounts[row.sourceNamespace] = (namespaceCounts[row.sourceNamespace] ?? 0) + 1; }
  const linkedRedirects = [];
  for (const { captured, page } of pageMap.values()) for (const linked of captured.linkedMetadataResponses ?? []) for (const redirect of linked.redirects ?? []) linkedRedirects.push({ targetPageId: page.pageid, redirectPageId: redirect.pageid ?? null, redirectTitle: redirect.title, fragment: redirect.fragment ?? null });
  const identities = [...pageMap.values()].map(({ page, ids }) => ({ sourcePageId: page.pageid, sourceTitle: page.title, sourceNamespace: page.ns, capturedRevisionIds: ids.sort((a, b) => a - b), exactUrls: ledger.filter(row => row.sourcePageId === page.pageid).map(row => row.url) })).sort((a, b) => a.sourcePageId - b.sourcePageId);
  return {
    version: 1, status: 'offline_inventory_only_not_redirect_authorization', sourceOrigin: SOURCE,
    capture: { startedAt: manifest.startedAt, completedAt: manifest.completedAt, status: manifest.status, manifestSha256, scope: manifest.scope },
    legacyRouting: { articlePath: siteinfo?.query?.general?.articlepath ?? null, scriptPath: siteinfo?.query?.general?.scriptpath ?? null, script: siteinfo?.query?.general?.script ?? null, namespaceAliases: siteinfo?.query?.namespacealiases ?? [] },
    summary: { pages: pageMap.size, capturedRevisions: revisionOwners.size, exactUrls: ledger.length, routeCounts, namespaceUrlCounts: namespaceCounts, decisionUrls: ledger.filter(row => row.decision).length, unresolvedUrls: ledger.filter(row => !row.decision || row.decision.mode === 'private_access_review').length, issues: issues.length, observedRedirectRelationships: linkedRedirects.length },
    limitations: ['Public API capture is not a full SQL/files/accounts backup or a transactional snapshot.', 'Derived aliases are route candidates; no HTTP behavior, indexability, status, canonical, redirect or fragment checks have run.', 'Server logs, backlinks, Search Console, sitemaps, deleted/moved/private records and filesystem assets can reveal additional URLs.',
      'Virtual/special routes, namespace aliases, API/rest endpoints, diff/oldid combinations, fragments/anchors and arbitrary query variants are not comprehensively captured or validated.', 'No blanket namespace publication: preserve original access policy, authorship, and user privacy.', 'Numeric MediaWiki page/revision IDs retain their original meaning; new entity IDs are separate identity aliases.', 'No DNS, canonical, redirect, robots, sitemap, runtime or live-site configuration is generated or changed.'],
    discoveryGaps: ['Full source-host rewrite/vhost rules and redirects', 'Virtual/special pages including search, login, contributions, permanent links and redirect helpers', 'diff query combinations and oldid fragments/section anchors', 'API and REST endpoint consumers and query variants', 'Filesystem uploads, deleted assets and unreferenced files', 'Deleted, moved, suppressed and private database records', 'Access logs, sitemaps, inbound links and Search Console exports'],
    issues: issues.sort((a, b) => compare(JSON.stringify(a), JSON.stringify(b))), linkedRedirects: linkedRedirects.sort((a, b) => a.targetPageId - b.targetPageId || compare(a.redirectTitle, b.redirectTitle)), identities, urls: ledger,
  };
}

export function renderChecklist(report) {
  return `# Private legacy URL preservation review\n\nOffline inventory only; no redirect or cutover authorization.\n\nSource archive: ${report.capture.manifestSha256}\n\n${report.summary.pages} pages, ${report.summary.capturedRevisions} exposed revisions, ${report.summary.exactUrls} exact URL strings; ${report.summary.unresolvedUrls} URL decisions unresolved; ${report.summary.issues} integrity/reconciliation issues.\n\n- [ ] Obtain and verify the complete source SQL, filesystem, configuration and external storage backup.\n- [ ] Reconcile this bounded public capture with full database pages, revisions, redirects, deleted records and source server logs.\n- [ ] Review all namespace and account access policies before exposing restored content.\n- [ ] Preserve exact article URLs and original page/revision numeric identities; add stable entity IDs separately.\n- [ ] Preserve history/authorship, oldid and curid query routes, files, namespace aliases, special links and fragment targets.\n- [ ] Audit legacy redirects and every proposed redirect target; no chains, homepage fallbacks or cross-entity merges.\n- [ ] Probe the private staging host with the original request path/query; compare content, access, canonical, status and history behavior.\n- [ ] Compare source sitemaps, backlinks and Search Console exports; investigate URLs absent from this API archive.\n- [ ] Keep staging authenticated and noindex, outbound mail/jobs/publishing disabled, source and DNS unchanged.\n- [ ] Reconcile the source delta and retain a tested rollback before any separately approved release.\n\n${report.limitations.map(item => `- ${item}`).join('\n')}\n`;
}
function tsvCell(value) {
  const cell = String(value ?? '').replaceAll('\t', ' ').replaceAll('\r', ' ').replaceAll('\n', ' ');
  return /^[=+@-]/.test(cell) ? "'" + cell : cell;
}
export function renderTsv(report) {
  const keys = ['url', 'sourcePageId', 'sourceRevisionId', 'sourceNamespace', 'sourceTitle', 'route', 'evidence', 'requiredBehavior'];
  return [keys.join('\t'), ...report.urls.map(row => keys.map(key => tsvCell(row[key])).join('\t'))].join('\n') + '\n';
}
async function privateDirectory(value, label) {
  if (!isAbsolute(value)) throw new Error(`${label} must be an absolute private path outside the repository`);
  const path = resolve(value), rel = relative(await realpath(REPO), path);
  if (!rel.startsWith('..' + '/') && rel !== '..') throw new Error(`${label} cannot be inside the repository`);
  return path;
}
export async function generateUrlPreservationReport({ archive, output, decisionsPath }) {
  const root = await privateDirectory(archive, 'Archive');
  const st = await lstat(root);
  if (!st.isDirectory() || st.isSymbolicLink()) throw new Error('Archive must be a real directory');
  const bytes = await readFile(join(root, 'manifest.json'));
  const manifestSha256 = digest(bytes), recorded = (await readFile(join(root, 'manifest.sha256'), 'utf8')).split(/\s/)[0];
  if (manifestSha256 !== recorded) throw new Error('Manifest checksum mismatch');
  const metadata = JSON.parse(bytes);
  for (const name of ['url-succession.json', 'siteinfo.json']) if (!metadata.artifacts?.some(item => item.path === name)) throw new Error(`Required artifact is not checksum-covered: ${name}`);
  const verification = await verifyArchive(root);
  if (!verification.ok) throw new Error(`Archive artifacts failed verification (${verification.errors.length})`);
  const manifest = JSON.parse(bytes), readJson = async name => JSON.parse(await readFile(join(root, name), 'utf8'));
  const pagePaths = manifest.artifacts.filter(item => /^pages\/[1-9][0-9]*\.json$/.test(item.path)).map(item => item.path).sort(compare);
  const report = buildUrlPreservationReport({ manifest, manifestSha256, inventory: await readJson('url-succession.json'), siteinfo: await readJson('siteinfo.json'), pages: await Promise.all(pagePaths.map(readJson)), decisions: decisionsPath ? JSON.parse(await readFile(decisionsPath, 'utf8')) : [] });
  const dest = await privateDirectory(output, 'Output');
  const parent = await realpath(dirname(dest));
  await privateDirectory(join(parent, dest.split('/').at(-1)), 'Resolved output');
  if (!relative(root, dest).startsWith('..')) throw new Error('Output cannot modify the source archive');
  process.umask(0o077);
  await mkdir(dest, { mode: 0o700 }); // Existing output is never overwritten.
  await chmod(dest, 0o700);
  for (const [name, body] of [['report.json', JSON.stringify(report, null, 2) + '\n'], ['routes.tsv', renderTsv(report)], ['link-succession-checklist.md', renderChecklist(report)]]) {
    await writeFile(join(dest, name), body, { mode: 0o600, flag: 'wx' });
  }
  return { status: report.status, ...report.summary, output: dest };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), options = {};
  try {
    for (let i = 0; i < args.length; i += 2) {
      if (!['--archive', '--output', '--decisions'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Usage: node scripts/url-preservation.mjs --archive /private/archive --output /private/new-report [--decisions /private/decisions.json]');
      const key = { '--archive': 'archive', '--output': 'output', '--decisions': 'decisionsPath' }[args[i]];
      if (options[key]) throw new Error('Duplicate option'); options[key] = args[i + 1];
    }
    if (!options.archive || !options.output) throw new Error('Required: --archive and --output');
    console.log(JSON.stringify(await generateUrlPreservationReport(options), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
