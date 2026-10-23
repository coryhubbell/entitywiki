import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { prepareLegacyStage, readLegacyArchive, readPreparedStage, legacyBatches, localStagingOrigin, importPreparedStage, main } from './legacy-stage.mjs';
import { legacyTransferDigest } from '../lib/legacy/digest.mjs';
const hash = value => createHash('sha256').update(value).digest('hex');

async function fixture(parent, mutate = () => {}) {
  const root = join(parent, 'archive'); await mkdir(root); await mkdir(join(root, 'pages'));
  const ns = { '-1': { id: -1, name: 'Special' }, 0: { id: 0, name: '', content: true }, 1: { id: 1, name: 'Talk' }, 2: { id: 2, name: 'User' }, 6: { id: 6, name: 'File' }, 10: { id: 10, name: 'Template', canonical: 'Template' }, 14: { id: 14, name: 'Category' } };
  const roles = [
    [1, 0, 'Synthetic Company', 'content_requires_entity_classification'],
    [2, 0, 'Synthetic Person', 'person_review_required'],
    [3, 10, 'Template:Synthetic', 'template_dependency'],
    [4, 2, 'User:Synthetic', 'contributor_profile_private_migration_review'],
    [5, 1, 'Talk:Synthetic Company', 'discussion_and_attribution'],
    [6, 14, 'Category:Synthetic', 'category_directory_not_ontology_class'],
  ];
  const files = {
    'siteinfo.json': { query: { general: { wikiid: 'synthetic_wiki-prefix_', server: 'https://entitywiki.org', articlepath: '/$1' }, namespaces: ns, namespacealiases: [{ id: 6, alias: 'Image' }] } },
    'namespace-inventory.json': { namespaces: Object.values(ns).filter(n => n.id >= 0), virtualNamespaces: [ns['-1']], pages: roles.map(([pageid, ns, title]) => ({ pageid, ns, title })) },
    'url-succession.json': { sourceOrigin: 'https://entitywiki.org', urls: [] },
    'response.json': { diagnostic: 'All manifest artifacts must be checked, including unused responses.' },
  };
  let revisionCount = 0;
  for (const [pageid, ns, title, classification] of roles) {
    const revisions = [{ revid: pageid * 10, parentid: 0, timestamp: '2026-01-01T00:00:00Z', user: 'Synthetic contributor', userid: 17, comment: 'Synthetic original attribution', slots: { main: { content: pageid === 1 ? 'X'.repeat(270_000) : `Synthetic content ${pageid}`, contentmodel: 'wikitext' }, secondary: { contentmodel: 'json', content: '{"synthetic":true}' } }, unknownRevisionField: ['retain', 3] }];
    if (pageid === 1) revisions.push({ revid: 11, parentid: 10, timestamp: '2026-01-02T00:00:00Z', texthidden: true, userhidden: true, commenthidden: true, suppressed: true, slots: { main: { contenthidden: true, contentmodel: 'wikitext' } } });
    revisionCount += revisions.length;
    files[`pages/${pageid}.json`] = { page: { pageid, ns, title, unknownPageField: true }, captureBoundary: '2026-01-03T00:00:00Z', metadata: [{ pageid, ns, title, lastrevid: pageid === 1 ? 12 : pageid * 10, protection: [{ type: 'edit', level: 'sysop', expiry: 'infinity' }], restrictiontypes: ['edit'], fullurl: `https://entitywiki.org/${encodeURIComponent(title.replaceAll(' ', '_'))}` }], revisions, linkedMetadataResponses: [{ pageid, templates: [{ ns: 10, title: 'Template:Synthetic' }], extlinks: [{ url: 'https://synthetic.example/' }] }], imageinfo: [], classification, historyScope: 'Synthetic scope', unknownCaptureField: { exact: [1, false, null] } };
    const titlePath = encodeURIComponent(title.replaceAll(' ', '_'));
    files['url-succession.json'].urls.push({ pageId: pageid, title, namespace: ns, url: `https://entitywiki.org/${titlePath}`, kind: 'article', disposition: 'retain_exact_url_or_reviewed_equivalent', unknownRouteField: 'retain' });
    for (const revision of revisions) files['url-succession.json'].urls.push({ pageId: pageid, title, namespace: ns, url: `https://entitywiki.org/index.php?title=${titlePath}&oldid=${revision.revid}`, kind: 'immutable_revision', disposition: 'retain_revision_and_attribution' });
  }
  mutate(files);
  const artifacts = [];
  for (const [path, value] of Object.entries(files)) {
    const data = JSON.stringify(value) + '\n'; await writeFile(join(root, path), data);
    artifacts.push({ path, bytes: Buffer.byteLength(data), sha256: hash(data) });
  }
  const manifest = { version: 1, source: 'https://entitywiki.org/api.php', status: 'complete_public_api_archive', startedAt: '2026-01-03T00:00:00Z', completedAt: '2026-01-03T00:01:00Z', scope: 'Synthetic public capture; not a full backup', failures: [], counts: { pagesDiscovered: roles.length, pagesCaptured: roles.length, exposedRevisions: revisionCount, urls: files['url-succession.json'].urls.length }, artifacts };
  await seal(root, manifest);
  return { root, files, manifest };
}
async function seal(root, manifest) {
  const data = JSON.stringify(manifest) + '\n';
  await writeFile(join(root, 'manifest.json'), data);
  await writeFile(join(root, 'manifest.sha256'), `${hash(data)}  manifest.json\n`);
}
async function temporary(run) {
  const parent = await mkdtemp(join(tmpdir(), 'entitywiki-legacy-stage-'));
  try { return await run(parent); } finally { await rm(parent, { recursive: true, force: true }); }
}

test('all namespaces, original fields, protection, attribution and hidden flags survive private preparation unchanged', () => temporary(async parent => {
  const { root, files } = await fixture(parent), output = join(parent, 'prepared');
  const staged = await prepareLegacyStage({ archive: root, output });
  assert.deepEqual(staged.descriptor.expected, { pages: 6, revisions: 7, routes: 13 });
  assert.equal(staged.descriptor.sourceWikiId, 'synthetic_wiki-prefix_');
  assert.equal(staged.descriptor.accessPolicy, 'operator_only');
  assert.equal(staged.descriptor.sourcePermissionScope, 'unauthenticated_public_capture_only');
  assert.equal(staged.descriptor.namespaces.find(ns => ns.id === 6).aliases[0], 'Image');
  assert.ok(staged.descriptor.namespaces.some(ns => ns.id === -1));
  for (const page of staged.records.filter(r => r.kind === 'page')) {
    const original = { ...files[`pages/${page.pageId}.json`] }; delete original.revisions;
    assert.deepEqual(page.raw, original);
    assert.equal('revisions' in page.raw, false);
  }
  assert.equal(staged.records.find(r => r.kind === 'page' && r.pageId === 1).latestCapturedRevisionId, 11);
  assert.equal(staged.records.find(r => r.kind === 'page' && r.pageId === 1).observedLatestRevisionId, 12);
  assert.deepEqual(staged.records.find(r => r.kind === 'revision' && r.revisionId === 11).raw, files['pages/1.json'].revisions[1]);
  assert.deepEqual(staged.records.find(r => r.kind === 'route').raw, files['url-succession.json'].urls[0]);
  assert.equal(staged.descriptor.transferDigest, await legacyTransferDigest(staged.records));
  assert.equal((await stat(output)).mode & 0o777, 0o700);
  for (const file of ['descriptor.json', 'records.ndjson', 'preparation.json']) assert.equal((await stat(join(output, file))).mode & 0o777, 0o600);
  assert.deepEqual((await readPreparedStage(output)).descriptor, staged.descriptor);
  await assert.rejects(prepareLegacyStage({ archive: root, output }), /EEXIST/);
  await assert.rejects(prepareLegacyStage({ archive: root, output: resolve('private-must-not-be-written') }), /outside the registry/);
  await writeFile(join(output, 'records.ndjson'), '{}\n');
  await assert.rejects(readPreparedStage(output), /checksum/);
}));

test('manifest and every artifact are verified, and symlink/path traversal cannot bypass the archive boundary', () => temporary(async parent => {
  const { root, manifest } = await fixture(parent);
  await writeFile(join(root, 'response.json'), '{}\n');
  await assert.rejects(readLegacyArchive(root), /verification failed/);
  manifest.artifacts.push({ path: '../outside.json', bytes: 0, sha256: hash('') }); await seal(root, manifest);
  await assert.rejects(readLegacyArchive(root), /Unsafe or duplicate/);
  manifest.artifacts.pop(); manifest.artifacts.push(manifest.artifacts[0]); await seal(root, manifest);
  await assert.rejects(readLegacyArchive(root), /Unsafe or duplicate/);
  manifest.artifacts.pop(); await seal(root, manifest);
  await rm(join(root, 'pages/1.json')); await symlink(join(root, 'response.json'), join(root, 'pages/1.json'));
  await assert.rejects(readLegacyArchive(root), /symlinks/);
  await writeFile(join(root, 'manifest.json'), '{}');
  await assert.rejects(readLegacyArchive(root), /checksum mismatch/);
}));

test('duplicate identities, namespace loss, mismatched oldids and partial source scope are rejected', async () => {
  const mutations = [
    [files => { files['namespace-inventory.json'].pages.push(files['namespace-inventory.json'].pages[0]); }, /duplicate page/],
    [files => { files['pages/2.json'].revisions[0].revid = 10; }, /duplicate revision/],
    [files => { files['namespace-inventory.json'].pages[0].ns = 999; }, /page identity/],
    [files => { files['url-succession.json'].urls[1].url = 'https://entitywiki.org/index.php?oldid=20'; }, /different page revision/],
    [files => { files['url-succession.json'].urls[0].url = 'https://evil.example/client'; }, /exact source origin/],
    [files => { delete files['siteinfo.json'].query.general.wikiid; }, /source wiki identity/],
  ];
  for (const [mutate, pattern] of mutations) await temporary(async parent => { const { root } = await fixture(parent, mutate); await assert.rejects(readLegacyArchive(root), pattern); });
  await temporary(async parent => { const { root, manifest } = await fixture(parent); manifest.status = 'partial_public_archive'; await seal(root, manifest); await assert.rejects(readLegacyArchive(root), /completed/); });
});

test('literal loopback guard and exact request byte bounds exclude external and oversized transfers', () => {
  for (const url of ['https://entitywiki.org/', 'https://127.0.0.1.evil.example/', 'http://localhost/x', 'file:///tmp/x', 'http://u:p@127.0.0.1/', 'http://localhost/?x=1']) assert.throws(() => localStagingOrigin(url), /loopback/);
  for (const url of ['http://127.0.0.1:8876', 'http://localhost:8876/', 'http://[::1]:8876/']) assert.equal(localStagingOrigin(url).pathname, '/');
  const records = Array.from({ length: 205 }, (_, index) => ({ kind: 'revision', pageId: 1, revisionId: index + 1, raw: { content: 'é'.repeat(index < 5 ? 135_000 : 10) } }));
  const batches = legacyBatches(records, 'capture_synthetic');
  assert.deepEqual(batches.flat(), records);
  assert.ok(batches.every(records => records.length <= 100 && Buffer.byteLength(JSON.stringify({ snapshotId: 'capture_synthetic', records })) < 750_000));
  assert.ok(batches.length > 3);
  assert.throws(() => legacyBatches([{ raw: { content: 'X'.repeat(600_000) } }], 'capture_synthetic'), /record exceeds/);
});

test('local encrypted-session import is bounded, resumes idempotently, and never follows redirects or forwards credentials externally', () => temporary(async parent => {
  const { root } = await fixture(parent), output = join(parent, 'prepared');
  const staged = await prepareLegacyStage({ archive: root, output });
  const varsPath = join(parent, '.dev.vars'); await writeFile(varsPath, 'OPERATOR_AUTH_MODE=local\nOPERATOR_LOCAL_KEY=synthetic-local-staging-key-at-least-32-characters\n');
  const calls = [], ingested = []; let ready = false;
  const fetcher = async (url, init) => {
    calls.push(String(url)); assert.equal(url.origin, 'http://127.0.0.1:8876'); assert.equal(init.redirect, 'manual'); assert.equal(init.headers.Origin, url.origin);
    if (url.pathname === '/admin/auth') { assert.equal('Cookie' in init.headers, false); return new Response(null, { status: 303, headers: { Location: '/admin', 'Set-Cookie': 'entitywiki_local_operator=synthetic-encrypted-session; HttpOnly' } }); }
    assert.equal(init.headers.Cookie, 'entitywiki_local_operator=synthetic-encrypted-session');
    assert.ok(Buffer.byteLength(init.body) < 750_000);
    const body = JSON.parse(init.body);
    if (url.pathname === '/api/migration/begin') { assert.deepEqual(body.descriptor, staged.descriptor); return Response.json({ snapshotId: 'capture_synthetic', state: ready ? 'ready' : 'loading', counts: ready ? staged.descriptor.expected : { pages: 0, revisions: 0, routes: 0 }, replayed: ready }); }
    if (url.pathname === '/api/migration/ingest') { assert.equal(body.snapshotId, 'capture_synthetic'); assert.ok(body.records.length <= 100); ingested.push(...body.records); return Response.json({ snapshotId: 'capture_synthetic', state: 'loading', counts: {} }); }
    assert.equal(url.pathname, '/api/migration/finalize'); assert.deepEqual(ingested, staged.records); ready = true;
    return Response.json({ snapshotId: 'capture_synthetic', state: 'ready', counts: staged.descriptor.expected });
  };
  const receipt = await importPreparedStage({ prepared: output, origin: 'http://127.0.0.1:8876', varsPath, fetcher });
  assert.equal(receipt.state, 'ready'); assert.equal(receipt.publication, 'none');
  assert.equal((await stat(join(output, 'import-receipt.json'))).mode & 0o777, 0o600);
  const receiptText = await readFile(join(output, 'import-receipt.json'), 'utf8');
  assert.ok(!receiptText.includes('synthetic-local-staging-key') && !receiptText.includes('Synthetic contributor') && !receiptText.includes('Synthetic Company'));
  const before = calls.length;
  assert.equal((await importPreparedStage({ prepared: output, origin: 'http://127.0.0.1:8876', varsPath, fetcher })).replayed, true);
  assert.equal(calls.length - before, 2);
  const redirects = [];
  const redirecting = async (url, init) => { redirects.push(String(url)); if (url.pathname === '/admin/auth') return fetcher(url, init); return new Response(null, { status: 307, headers: { Location: 'https://evil.example/' } }); };
  await assert.rejects(importPreparedStage({ prepared: output, origin: 'http://127.0.0.1:8876', varsPath, fetcher: redirecting }), /HTTP 307/);
  assert.equal(redirects.length, 2);
  await assert.rejects(importPreparedStage({ prepared: output, origin: 'https://entitywiki.org', varsPath, fetcher }), /loopback/);
  await assert.rejects(main(['--archive', root, '--output', join(parent, 'no-output'), '--origin', 'https://entitywiki.org']), /loopback/);
  await assert.rejects(main(['--prepared', output]), /Choose fresh/);
}));
