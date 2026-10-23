import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { capture, checkedUrl, classifyPage, continuation, pageUrls, verifyArchive, verifySourceAsset } from './mediawiki-capture.mjs';

test('source guard rejects write actions, alternate hosts and insecure asset URLs', () => {
  assert.throws(() => checkedUrl('https://evil.example/api.php?action=query', true));
  assert.throws(() => checkedUrl('https://entitywiki.org/api.php?action=edit', true));
  assert.throws(() => checkedUrl('https://entitywiki.org/api.php?action=query&token=secret', true));
  assert.throws(() => checkedUrl('http://entitywiki.org/images/x.png'));
  assert.throws(() => checkedUrl('https://entitywiki.org:444/images/x.png'));
  assert.equal(checkedUrl('https://entitywiki.org/api.php?action=query', true).hostname, 'entitywiki.org');
});
test('namespace zero and directories are never automatically converted into organizations or ontology classes', () => {
  assert.equal(classifyPage({ pageid: 213, ns: 0, title: 'MAXPlaces Marketing' }), 'company_pilot');
  assert.equal(classifyPage({ pageid: 1, ns: 0, title: 'Main Page' }), 'site_navigation');
  assert.equal(classifyPage({ pageid: 2, ns: 0, title: 'Unknown' }), 'content_requires_entity_classification');
  assert.equal(classifyPage({ pageid: 3, ns: 14, title: 'Category:SEO' }), 'category_directory_not_ontology_class');
  assert.equal(classifyPage({ pageid: 4, ns: 0, title: 'Business' }, 'placeholder for now'), 'placeholder_no_declaration');
});
test('URL succession includes exact MAXPlaces path, page identity, immutable revision and history', () => {
  const urls = pageUrls({ pageid: 213, ns: 0, title: 'MAXPlaces Marketing' }, [{ revid: 1099 }]);
  assert.ok(urls.some(row => row.url === 'https://entitywiki.org/MAXPlaces_Marketing'));
  assert.ok(urls.some(row => row.kind === 'history'));
  assert.ok(urls.some(row => row.url.endsWith('curid=213')));
  assert.ok(urls.some(row => row.url.endsWith('oldid=1099')));
  assert.throws(() => continuation({ apcontinue: 'x' }, { apcontinue: 'x' }, new Set()));
});
test('all namespaces and revision continuation are captured privately, resume does not refetch, checksum damage fails', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'entitywiki-public-archive-test-')), output = join(parent, 'archive');
  const reads = [];
  const fetcher = async (input, init) => {
    assert.equal(init.method, 'GET'); assert.equal(init.redirect, 'error');
    const u = new URL(input); reads.push(u.href); assert.equal(u.hostname, 'entitywiki.org');
    if (u.pathname === '/images/test.png') return new Response(Buffer.from([1, 2, 3]), { headers: { 'content-type': 'image/png' } });
    const p = u.searchParams;
    if (p.get('meta') === 'siteinfo') return Response.json({ query: { namespaces: { 0: { id: 0, name: '' }, 6: { id: 6, name: 'File' }, 10: { id: 10, name: 'Template' }, '-1': { id: -1, name: 'Special' } } } });
    if (p.get('list') === 'allpages') {
      if (p.get('apnamespace') === '0') return Response.json(p.get('apcontinue') ? { query: { allpages: [{ pageid: 401, ns: 0, title: 'Another client' }] } } : { continue: { apcontinue: 'next-main', continue: '-||' }, query: { allpages: [{ pageid: 213, ns: 0, title: 'MAXPlaces Marketing' }] } });
      if (p.get('apnamespace') === '6') return Response.json({ query: { allpages: [{ pageid: 400, ns: 6, title: 'File:Test.png' }] } });
      if (p.get('apnamespace') === '10') return Response.json({ query: { allpages: [{ pageid: 300, ns: 10, title: 'Template:Company' }] } });
      return Response.json({ query: { allpages: [] } });
    }
    const pageid = Number(p.get('pageids'));
    if (p.get('prop') === 'imageinfo') return Response.json({ query: { pages: [{ pageid, imageinfo: [{ url: 'https://entitywiki.org/images/test.png', timestamp: '2026-01-01T00:00:00Z', size: 3 }] }] } });
    if (p.get('prop') === 'info|revisions') {
      const revision = p.get('rvcontinue') ? 1099 : 1;
      return Response.json({ ...(pageid === 213 && !p.get('rvcontinue') ? { continue: { rvcontinue: 'next', continue: '||' } } : {}), query: { pages: [{ pageid, ns: pageid === 213 ? 0 : 10, title: pageid === 213 ? 'MAXPlaces Marketing' : 'Template:Company', revisions: [{ revid: revision, timestamp: '2026-01-01T00:00:00Z', user: 'Public contributor', slots: { main: { content: 'Public wikitext' } } }] }] } });
    }
    return Response.json({ query: { pages: [{ pageid, links: [] }] } });
  };
  try {
    const manifest = await capture({ output, fetcher, intervalMs: 0, log: () => {} });
    assert.equal(manifest.counts.pagesCaptured, 4); assert.equal(manifest.counts.exposedRevisions, 5); assert.equal(manifest.counts.fileVersionsCaptured, 1);
    assert.equal(manifest.counts.namespacesInventoried, 3); assert.equal(manifest.status, 'complete_public_api_archive');
    assert.match(manifest.scope, /NOT A FULL SQL/); assert.equal((await stat(output)).mode & 0o777, 0o700);
    assert.equal((await stat(join(output, 'pages/213.json'))).mode & 0o777, 0o600);
    assert.equal((await verifyArchive(output)).ok, true);
    const before = reads.length;
    await capture({ output, resume: true, fetcher, intervalMs: 0, log: () => {} });
    assert.equal(reads.length, before);
    const page = JSON.parse(await readFile(join(output, 'pages/213.json'), 'utf8')); assert.equal(page.revisions.length, 2);
    await writeFile(join(output, 'pages/213.json'), '{}');
    assert.equal((await verifyArchive(output)).ok, false);
    await assert.rejects(capture({ output: join(process.cwd(), 'raw-do-not-write'), fetcher }), /inside the registry/);
  } finally { await rm(parent, { recursive: true, force: true }); }
});

test('source file size and MediaWiki base36 SHA-1 must match captured bytes', async () => {
  const { createHash } = await import('node:crypto');
  const bytes = Buffer.from('source file bytes');
  const sha1 = createHash('sha1').update(bytes).digest('hex');
  assert.doesNotThrow(() => verifySourceAsset(bytes, { sourceSize: bytes.length, sourceSha1: BigInt('0x' + sha1).toString(36).padStart(31, '0') }));
  assert.throws(() => verifySourceAsset(bytes, { sourceSize: 1 }), /size/);
  assert.throws(() => verifySourceAsset(bytes, { sourceSha1: 'wrong' }), /SHA-1/);
});
