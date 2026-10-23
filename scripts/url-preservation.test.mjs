import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { buildUrlPreservationReport, classifyLegacyRoute, generateUrlPreservationReport, renderTsv } from './url-preservation.mjs';
import { pageUrls } from './mediawiki-capture.mjs';
const origin = 'https://entitywiki.org';
function fixture() {
  const pages = [
    { page: { pageid: 42, ns: 0, title: 'Example Company' }, revisions: [{ revid: 81 }, { revid: 99 }], metadata: [{ fullurl: `${origin}/Example_Company` }], linkedMetadataResponses: [{ redirects: [{ pageid: 47, title: 'Old Example', fragment: 'Products' }] }] },
    { page: { pageid: 43, ns: 2, title: 'User:Example' }, revisions: [{ revid: 101 }], metadata: [] },
    { page: { pageid: 44, ns: 10, title: 'Template:Example' }, revisions: [{ revid: 102 }], metadata: [] },
    { page: { pageid: 45, ns: 4, title: 'Project:Example' }, revisions: [{ revid: 103 }], metadata: [] },
  ];
  const urls = pages.flatMap(p => pageUrls(p.page, p.revisions, p.metadata.at(-1))).filter((v, i, arr) => arr.findIndex(x => x.url === v.url) === i);
  return { pages, inventory: { sourceOrigin: origin, urls }, manifest: { startedAt: '2026-01-01T00:00:00Z', completedAt: '2026-01-01T01:00:00Z', status: 'complete_public_api_archive', scope: 'public API, not complete backup' }, manifestSha256: 'test-hash', siteinfo: { query: { general: { articlepath: '/$1', scriptpath: '', script: '/index.php' }, namespacealiases: [{ id: 6, alias: 'Image' }] } } };
}
test('offline ledger preserves exact strings and IDs across company/user/template/project/history routes deterministically', () => {
  const input = fixture(), first = buildUrlPreservationReport(input);
  const second = buildUrlPreservationReport({ ...input, pages: [...input.pages].reverse(), inventory: { ...input.inventory, urls: [...input.inventory.urls].reverse() } });
  assert.deepEqual(first, second);
  assert.equal(first.summary.pages, 4);
  assert.equal(first.summary.capturedRevisions, 5);
  assert.equal(first.summary.issues, 0);
  assert.equal(first.summary.observedRedirectRelationships, 1);
  assert.equal(first.summary.unresolvedUrls, first.summary.exactUrls);
  assert.deepEqual(first.identities.find(p => p.sourcePageId === 42).capturedRevisionIds, [81, 99]);
  const old = first.urls.find(v => v.url === `${origin}/index.php?oldid=81`);
  assert.equal(old.sourcePageId, 42);
  assert.equal(old.sourceRevisionId, 81);
  assert.equal(old.requiredBehavior, 'retain_immutable_history_and_attribution');
  assert.equal(first.urls.find(v => v.sourceNamespace === 2).requiredBehavior, 'preserve_access_policy_and_attribution');
  assert.equal(first.urls.find(v => v.url === `${origin}/Example_Company`).evidence, 'observed_source_metadata_url');
  assert.match(first.limitations.join(' '), /fragments\/anchors/);
});
test('route classification keeps aliases, revisions, special/API/diff routes distinct and rejects unsafe identities', () => {
  for (const [path, route] of [['/Example_Company', 'article'], ['/index.php?title=Example_Company', 'title_query'], ['/index.php?curid=42', 'page_id'], ['/index.php?oldid=81', 'revision'], ['/index.php?title=Example_Company&action=history', 'history'], ['/index.php?oldid=81&diff=99', 'revision_diff'], ['/Special:Redirect/page/42', 'special_identity'], ['/Special:Search', 'special_page'], ['/api.php?action=query', 'api'], ['/rest.php/v1/page', 'rest_api'], ['/images/0/01/a.png', 'asset']]) assert.equal(classifyLegacyRoute(origin + path), route);
  for (const url of ['https://other.example/A', 'https://entitywiki.org/index.php?oldid=1&oldid=2', 'https://entitywiki.org/index.php?curid=0', 'https://user:pass@entitywiki.org/A', 'https://entitywiki.org/A#anchor']) assert.throws(() => classifyLegacyRoute(url));
});
test('reconciliation detects lost routes and original numeric identity conflicts', () => {
  const input = fixture();
  input.inventory.urls = input.inventory.urls.filter(v => v.url !== `${origin}/index.php?oldid=81`);
  input.inventory.urls.push({ ...input.inventory.urls[0], url: `${origin}/index.php?curid=999`, kind: 'page_id_alias' });
  input.pages.push({ page: { pageid: 46, ns: 0, title: 'Example Company' }, revisions: [{ revid: 81 }], metadata: [] });
  const report = buildUrlPreservationReport(input);
  assert.ok(report.issues.some(v => v.code === 'expected_route_missing_from_inventory'));
  assert.ok(report.issues.some(v => v.code === 'page_query_identity_mismatch'));
  assert.ok(report.issues.some(v => v.code === 'revision_owned_by_multiple_pages'));
  assert.ok(report.issues.some(v => v.code === 'exact_url_identity_collision'));
  assert.deepEqual(report, buildUrlPreservationReport({ ...input, pages: [...input.pages].reverse(), inventory: { ...input.inventory, urls: [...input.inventory.urls].reverse() } }));
});
test('review-only decisions cannot erase history, change page identity, change host or create silent chains', () => {
  const input = fixture();
  const current = `${origin}/Example_Company`, alias = `${origin}/index.php?title=Example_Company`, historic = `${origin}/index.php?oldid=81`;
  const base = { url: alias, sourcePageId: 42, mode: 'reviewed_redirect', targetUrl: current, reason: 'Equivalent URL', reviewedBy: 'test reviewer' };
  const valid = buildUrlPreservationReport({ ...input, decisions: [base] });
  assert.equal(valid.summary.decisionUrls, 1);
  assert.equal(valid.urls.find(v => v.url === alias).decision.targetUrl, current);
  for (const bad of [
    { ...base, targetUrl: `${origin}/User:Example` }, { ...base, targetUrl: 'https://entitywiki.com/Example' },
    { ...base, sourcePageId: 43 }, { ...base, reviewedBy: '' },
    { ...base, url: historic, sourceRevisionId: 81, targetUrl: current },
    { ...base, mode: 'preserve_exact' },
  ]) assert.throws(() => buildUrlPreservationReport({ ...input, decisions: [bad] }));
  const chain = buildUrlPreservationReport({ ...input, decisions: [base, { ...base, url: current, targetUrl: alias }] });
  assert.equal(chain.issues.filter(v => v.code === 'redirect_chain_or_cycle').length, 2);
  assert.throws(() => buildUrlPreservationReport({ ...input, decisions: [base, base] }));
});
test('asset URL rows retain file identity even when the capture omits namespace metadata on asset aliases', () => {
  const input = fixture();
  const page = { page: { pageid: 50, ns: 6, title: 'File:Example.png' }, revisions: [{ revid: 107 }], metadata: [] };
  input.pages.push(page);
  input.inventory.urls.push(...pageUrls(page.page, page.revisions));
  input.inventory.urls.push({ url: `${origin}/images/0/01/Example.png`, pageId: 50, title: page.page.title, kind: 'file_revision_asset' });
  const report = buildUrlPreservationReport(input);
  assert.equal(report.summary.issues, 0);
  assert.equal(report.urls.find(v => v.route === 'asset').requiredBehavior, 'retain_exact_asset_url_bytes_and_rights');
});
test('TSV is safe to parse without embedding raw revision content or contributors', () => {
  const input = fixture();
  input.pages[0].revisions[0].user = 'Do not include contributor';
  input.pages[0].revisions[0].slots = { main: { content: 'Do not include source content' } };
  const report = buildUrlPreservationReport(input), text = renderTsv(report);
  assert.equal(text.split('\n')[0].split('\t').length, 8);
  assert.doesNotMatch(JSON.stringify(report), /Do not include/);
});
test('CLI helper verifies archive hashes, writes only a fresh private output, and refuses tampered sources', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'entitywiki-urls-'));
  try {
    const root = join(temp, 'archive'), output = join(temp, 'report'); await mkdir(join(root, 'pages'), { recursive: true });
    const input = fixture(), files = { 'url-succession.json': input.inventory, 'siteinfo.json': input.siteinfo };
    for (const page of input.pages) files[`pages/${page.page.pageid}.json`] = page;
    const artifacts = [];
    for (const [path, value] of Object.entries(files)) { const bytes = Buffer.from(JSON.stringify(value)); await writeFile(join(root, path), bytes); artifacts.push({ path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }); }
    const manifest = Buffer.from(JSON.stringify({ ...input.manifest, artifacts }));
    await writeFile(join(root, 'manifest.json'), manifest);
    await writeFile(join(root, 'manifest.sha256'), createHash('sha256').update(manifest).digest('hex') + '  manifest.json\n');
    const result = await generateUrlPreservationReport({ archive: root, output });
    assert.equal(result.pages, 4);
    assert.equal((await stat(output)).mode & 0o777, 0o700);
    assert.equal((await stat(join(output, 'report.json'))).mode & 0o777, 0o600);
    assert.match(await readFile(join(output, 'link-succession-checklist.md'), 'utf8'), /source and DNS unchanged/);
    await assert.rejects(generateUrlPreservationReport({ archive: root, output }), /EEXIST/);
    await writeFile(join(root, 'pages/42.json'), '{}');
    await assert.rejects(generateUrlPreservationReport({ archive: root, output: join(temp, 'tampered') }), /failed verification/);
    await assert.rejects(generateUrlPreservationReport({ archive: root, output: 'relative' }));
  } finally { await rm(temp, { recursive: true, force: true }); }
});
