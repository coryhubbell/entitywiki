import assert from "node:assert/strict";
import test from "node:test";
import { handleLegacyRequest, normalizeLegacyTitle, type LegacyReadStore } from "../lib/legacy/routes.ts";
import { legacyTitleUrl, revisionPresentation } from "../lib/legacy/reader.ts";
import type { LegacyDescriptor, LegacyPageView, LegacyRevisionView, LegacySnapshotView } from "../lib/legacy/contracts.ts";

const descriptor: LegacyDescriptor = {
  format: "entitywiki.legacy-capture/1", sourceOrigin: "https://entitywiki.org", sourceWikiId: "synthetic-test-wiki",
  archiveManifestSha256: "a".repeat(64), transferDigest: "b".repeat(64), capturedAt: "2026-10-23T18:00:00Z", captureStartedAt: "2026-10-23T17:00:00Z",
  expected: { pages: 3, revisions: 4, routes: 0 }, accessPolicy: "operator_only", sourcePermissionScope: "unauthenticated_public_capture_only",
  namespaces: [{ id: 0, name: "" }, { id: 2, name: "User" }, { id: 4, name: "EntityWiki", canonical: "Project", aliases: ["EW"] }, { id: 10, name: "Template" }],
};
const snapshot: LegacySnapshotView = { snapshotId: "capture-test", sourceKey: "source-test", state: "ready", descriptor };
function page(pageId: number, title: string, revisionId: number, namespace = 0): LegacyPageView {
  return { snapshotId: snapshot.snapshotId, sourceKey: snapshot.sourceKey, stablePageId: `stable-${pageId}`, pageId, namespace, title, classification: "client", latestCapturedRevisionId: revisionId, observedLatestRevisionId: revisionId, raw: {} };
}
function revision(pageId: number, revisionId: number, parentid: number, content: string): LegacyRevisionView {
  return { snapshotId: snapshot.snapshotId, pageId, revisionId, raw: { revid: revisionId, parentid, timestamp: "2026-10-23T15:00:00Z", user: "Synthetic editor", comment: "Synthetic comment", slots: { main: { contentmodel: "wikitext", content } } } };
}
const pages = [page(10, "Example Company", 102), page(20, "User:Émilie", 201, 2), page(30, "EntityWiki:Migration plan", 301, 4)];
const revisions = [revision(10, 101, 0, "Old source"), revision(10, 102, 101, "Latest source"), revision(20, 201, 0, "User source"), revision(30, 301, 0, "Project source")];
function fakeStore(overrides: Partial<LegacyReadStore> = {}): LegacyReadStore {
  return {
    latestReady: async () => snapshot,
    pageById: async (_snapshotId, pageId) => pages.find(page => page.pageId === pageId) ?? null,
    pageByTitle: async (_snapshotId, title) => pages.find(page => page.title === title) ?? null,
    revisionById: async (_snapshotId, revisionId) => revisions.find(revision => revision.revisionId === revisionId) ?? null,
    history: async (_snapshotId, pageId, options) => revisions.filter(revision => revision.pageId === pageId).sort((a, b) => b.revisionId - a.revisionId).slice(options?.offset ?? 0, (options?.offset ?? 0) + (options?.limit ?? 200)),
    ...overrides,
  };
}
const request = (path: string, method = "GET") => new Request(`https://staging.example${path}`, { method });
const read = async (path: string, store = fakeStore(), method = "GET") => {
  const response = await handleLegacyRequest(request(path, method), store, async () => true);
  assert.ok(response, `expected legacy route for ${path}`);
  return response;
};

test("legacy namespaces, Unicode, spaces and first-letter identity resolve to source page IDs", async () => {
  assert.equal(normalizeLegacyTitle(" eW: migration_plan ", descriptor.namespaces), "EntityWiki:Migration plan");
  assert.equal(normalizeLegacyTitle("user:éMilie", descriptor.namespaces), "User:ÉMilie");
  for (const [path, pageId] of [["/example_Company", 10], ["/User:%C3%A9milie", 20], ["/Project:Migration_plan", 30], ["/index.php?title=EW:Migration_plan", 30]]) {
    const response = await read(String(path));
    assert.equal(response.status, 200, String(path));
    assert.equal(response.headers.get("X-EntityWiki-Legacy-Page"), String(pageId));
  }
  // Only the first letter is normalized: later title characters keep MediaWiki identity.
  assert.equal((await read("/Example_company")).status, 404);
});

test("curid, oldid, and special identity routes preserve exact original revisions", async () => {
  for (const path of ["/index.php?oldid=101", "/index.php?title=Example_Company&oldid=101", "/index.php?curid=10&oldid=101", "/Special:Redirect/revision/101", "/Special:PermanentLink/101", "/index.php?title=Special:PermanentLink/101", "/?title=Special:PermanentLink/101", "/?title=Special:Redirect/revision/101", "/?oldid=101"]) {
    const response = await read(path);
    assert.equal(response.status, 200, path);
    assert.equal(response.headers.get("X-EntityWiki-Legacy-Revision"), "101", path);
    const html = await response.text();
    assert.ok(html.includes("Old source"));
    assert.ok(!html.includes("Latest source"));
  }
  for (const path of ["/index.php?curid=10", "/Special:Redirect/page/10", "/?title=Special:Redirect/page/10"]) {
    const response = await read(path);
    assert.equal(response.headers.get("X-EntityWiki-Legacy-Page"), "10");
    assert.equal(response.headers.get("X-EntityWiki-Legacy-Revision"), "102");
  }
  assert.equal((await read("/index.php?oldid=999999")).status, 404);
});

test("namespace-qualified page titles retain the full 255-byte payload limit", async () => {
  const payload = `${"é".repeat(127)}x`;
  const title = `Template:É${"é".repeat(126)}x`;
  assert.equal(new TextEncoder().encode(payload).length, 255);
  assert.equal(normalizeLegacyTitle(`Template:${payload}`, descriptor.namespaces), title);
  assert.throws(() => normalizeLegacyTitle(`Template:${payload}x`, descriptor.namespaces), /Invalid legacy title/);
  // An unrecognized prefix is part of page_title and therefore counts toward its byte limit.
  assert.throws(() => normalizeLegacyTitle(`Unknown:${payload}`, descriptor.namespaces), /Invalid legacy title/);
  const longPage = page(40, title, 401, 10);
  const longRevision = revision(40, 401, 0, "Boundary source");
  const response = await read(`/${encodeURIComponent(`Template:${payload}`)}`, fakeStore({
    pageByTitle: async (_snapshotId, requested) => requested === title ? longPage : null,
    revisionById: async (_snapshotId, id) => id === 401 ? longRevision : null,
  }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("X-EntityWiki-Legacy-Page"), "40");
});

test("captured-page navigation stays on original page identity when a public dossier reserves its pretty URL", async () => {
  const maxPage = page(213, "MAXPlaces Marketing", 1200);
  const maxRevision = revision(213, 1200, 0, "Captured source");
  const response = await read("/index.php?oldid=1200", fakeStore({
    pageById: async (_snapshotId, id) => id === 213 ? maxPage : null,
    revisionById: async (_snapshotId, id) => id === 1200 ? maxRevision : null,
  }));
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.ok(html.includes('href="/index.php?curid=213">Captured page</a>'));
  assert.ok(!html.includes('href="/MAXPlaces_Marketing">Captured page</a>'));
});

test("legacy conflicting IDs, duplicate parameters and malformed selectors fail explicitly", async () => {
  for (const path of ["/index.php?title=Example_Company&curid=20", "/index.php?curid=10&oldid=201", "/User:%C3%89milie?oldid=101", "/index.php?oldid=101&oldid=102", "/index.php?curid=0", "/index.php?curid=1e1", "/Example_Company?title=User:%C3%89milie", "/Special:Redirect/page/10?curid=20", "/index.php?oldid=101&diff=201", "/index.php?title=Example_Company&action=history&oldid=101"]) {
    assert.equal((await read(path)).status, 400, path);
  }
  assert.equal((await read("/index.php?curid=999")).status, 404);
  assert.equal((await read("/index.php?title=No_such_page")).status, 404);
});

test("authentication occurs before all source lookups and never leaks metadata", async () => {
  let lookups = 0;
  const store = fakeStore({ latestReady: async () => { lookups += 1; throw new Error("secret SQL details"); } });
  for (const path of ["/Example_Company", "/index.php?oldid=101", "/index.php?oldid=xyz", "/Special:ListUsers", "/api.php?action=query", "/rest.php/v1/page/Example_Company"]) {
    const response = await handleLegacyRequest(request(path), store, async () => false);
    assert.equal(response?.status, 403);
    assert.equal(response?.headers.get("X-EntityWiki-Legacy-Page"), null);
    const html = await response!.text();
    assert.ok(!html.includes("Example Company"));
    assert.ok(!html.includes("Synthetic editor"));
    assert.ok(!html.includes("secret SQL details"));
  }
  assert.equal(lookups, 0);
  assert.equal((await handleLegacyRequest(request("/Example_Company"), store, async () => { throw new Error("auth failure"); }))?.status, 403);
});

test("reserved registry routes remain available and unsupported wiki functions return safe 501", async () => {
  for (const path of ["/", "/MAXPlaces_Marketing", "/admin/migration", "/api/legacy/import", "/id/ew_example", "/assets/test.css", "/_next/static/test.js"]) {
    assert.equal(await handleLegacyRequest(request(path), fakeStore(), async () => { throw new Error("must not authenticate reserved route"); }), null, path);
  }
  for (const path of ["/api.php?action=query", "/rest.php/v1/page/Example_Company", "/Special:ListUsers", "/index.php?title=Special:RecentChanges", "/index.php?title=Example_Company&action=edit", "/index.php?title=Example_Company&action=delete", "/index.php?title=Example_Company&diff=cur", "/Example_Company?unknown=1"]) {
    const response = await read(path);
    assert.equal(response.status, 501, path);
    assert.equal(response.headers.get("Location"), null);
  }
  assert.equal((await read("/index.php?curid=10", fakeStore(), "POST")).status, 501);
  assert.notEqual(await handleLegacyRequest(request("/MAXPlaces_Marketing?oldid=101"), fakeStore(), async () => true), null);
});

test("history is original-ID linked, paginated and explicitly partial", async () => {
  const largeHistory = Array.from({ length: 102 }, (_, index) => revision(10, 1000 + index, 999 + index, `Source ${index}`));
  const store = fakeStore({ history: async (_snapshotId, _pageId, options) => largeHistory.slice(options?.offset ?? 0, (options?.offset ?? 0) + (options?.limit ?? 200)) });
  const response = await read("/index.php?curid=10&action=history", store);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("X-EntityWiki-Legacy-Page"), "10");
  const html = await response.text();
  assert.ok(html.includes("oldid=1000"));
  assert.ok(html.includes("offset=100"));
  assert.ok(!html.includes("oldid=1101"));
  assert.ok(html.includes("deleted, private, suppressed, or uncaptured history"));
  const second = await (await read("/index.php?curid=10&action=history&offset=100", store)).text();
  assert.ok(second.includes("oldid=1101"));
});

test("numeric and adjacent diffs require page context and captured parent identity", async () => {
  for (const path of ["/index.php?oldid=101&diff=102", "/index.php?oldid=102&diff=prev", "/index.php?oldid=101&diff=next", "/index.php?diff=102"]) {
    const response = await read(path);
    assert.equal(response.status, 200, path);
    const html = await response.text();
    assert.ok(html.includes("Old source"));
    assert.ok(html.includes("Latest source"));
    assert.ok(html.includes("literal source comparison"));
  }
  assert.equal((await read("/index.php?oldid=102&diff=next")).status, 404);
  assert.equal((await read("/index.php?oldid=101&diff=prev")).status, 404);
  const store = fakeStore({ revisionById: async (_snapshotId, id) => id === 102 ? { ...revisions[1], raw: { ...revisions[1].raw, parentid: 999 } } : revisions.find(revision => revision.revisionId === id) ?? null });
  assert.equal((await read("/index.php?oldid=102&diff=prev", store)).status, 404);
});

test("hidden authors, comments, content and suppressed slots never appear in readers or diffs", async () => {
  const hidden = revision(10, 102, 101, "DO_NOT_LEAK_CONTENT");
  hidden.raw = { ...hidden.raw, user: "DO_NOT_LEAK_AUTHOR", comment: "DO_NOT_LEAK_COMMENT", userhidden: true, commenthidden: true,
    slots: { main: { contentmodel: "wikitext", content: "DO_NOT_LEAK_CONTENT", texthidden: true }, private: { content: "DO_NOT_LEAK_PRIVATE", suppressed: true } } };
  const store = fakeStore({ revisionById: async (_snapshotId, id) => id === 102 ? hidden : revisions.find(revision => revision.revisionId === id) ?? null,
    history: async () => [hidden, revisions[0]] });
  for (const path of ["/index.php?oldid=102", "/index.php?curid=10&action=history", "/index.php?oldid=101&diff=102"]) {
    const html = await (await read(path, store)).text();
    assert.ok(!html.includes("DO_NOT_LEAK"), path);
  }
  const suppressed = revisionPresentation({ ...hidden, raw: { ...hidden.raw, userhidden: false, commenthidden: false, deleted: 8 } });
  assert.equal(suppressed.user, "[author withheld]");
  assert.equal(suppressed.comment, "[comment withheld]");
  assert.equal(suppressed.slots[0].text, null);
  const flags = revisionPresentation({ ...revisions[1], raw: { ...revisions[1].raw, deleted: 6 } });
  assert.equal(flags.user, "[author withheld]");
  assert.equal(flags.comment, "[comment withheld]");
  assert.equal(flags.slots[0].text, "Latest source");
});

test("source HTML and metadata are escaped, hrefs local, headers private, HEAD body empty", async () => {
  const xss = revision(10, 102, 101, '<script>fetch("https://evil.test")</script>[[javascript:evil]] {{Template}}');
  xss.raw.user = '<img src=x onerror="alert(1)">';
  xss.raw.comment = '<iframe src="https://evil.test"></iframe>';
  const store = fakeStore({ revisionById: async () => xss });
  const response = await read("/index.php?oldid=102", store);
  const html = await response.text();
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes("&lt;img"));
  assert.ok(!html.includes("<script>"));
  assert.ok(!html.includes("<iframe"));
  assert.ok(!html.includes("<img"));
  assert.ok(response.headers.get("Content-Security-Policy")?.includes("default-src 'none'"));
  assert.ok(response.headers.get("Cache-Control")?.includes("no-store"));
  assert.ok(response.headers.get("X-Robots-Tag")?.includes("noindex"));
  const safe = legacyTitleUrl("//evil.test/a");
  assert.ok(safe.startsWith("/%2F%2F"));
  assert.equal(new URL(safe, "https://staging.example").origin, "https://staging.example");
  const head = await read("/index.php?oldid=102", store, "HEAD");
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
});

test("store errors and unready captures produce safe status without database traces", async () => {
  const failed = await read("/Example_Company", fakeStore({ latestReady: async () => { throw new Error("secret database password"); } }));
  assert.equal(failed.status, 500);
  assert.ok(!(await failed.text()).includes("secret database password"));
  assert.equal((await read("/Example_Company", fakeStore({ latestReady: async () => null }))).status, 503);
});
