import type { LegacyPageView, LegacyRevisionView, LegacySnapshotView } from "./contracts.ts";
import { legacyLayout, renderDiff, renderHistory, renderRevision } from "./reader.ts";
import { LegacyTitleError, normalizeLegacyTitle } from "./titles.ts";
export { normalizeLegacyTitle } from "./titles.ts";

export interface LegacyReadStore {
  latestReady(): Promise<LegacySnapshotView | null>;
  pageById(snapshotId: string, pageId: number): Promise<LegacyPageView | null>;
  pageByTitle(snapshotId: string, title: string): Promise<LegacyPageView | null>;
  revisionById(snapshotId: string, revisionId: number): Promise<LegacyRevisionView | null>;
  history(snapshotId: string, pageId: number, options?: { limit?: number; offset?: number }): Promise<LegacyRevisionView[]>;
}

class RouteError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

function positiveId(raw: string | null, label: string): number | undefined {
  if (raw === null) return undefined;
  if (!/^[1-9][0-9]*$/.test(raw)) throw new RouteError(400, `Invalid ${label}.`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) throw new RouteError(400, `Invalid ${label}.`);
  return value;
}

function protectedResponse(request: Request, status: number, body: string, page?: LegacyPageView, revision?: LegacyRevisionView): Response {
  const headers = new Headers({
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "private, no-store, max-age=0",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  });
  if (page) headers.set("X-EntityWiki-Legacy-Page", String(page.pageId));
  if (revision) headers.set("X-EntityWiki-Legacy-Revision", String(revision.revisionId));
  return new Response(request.method === "HEAD" ? null : body, { status, headers });
}

function reserved(pathname: string): boolean {
  return /^\/(?:api|admin|id|assets|_next|_vinext|cdn-cgi)(?:\/|$)/.test(pathname)
    || ["/favicon.ico", "/favicon.svg", "/robots.txt", "/sitemap.xml"].includes(pathname);
}

/** All captured content is operator-only. Original source roles remain observations, never grants. */
export async function handleLegacyRequest(request: Request, store: LegacyReadStore, authorize: (request: Request) => Promise<boolean>): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname === "/" && !url.search) return null;
  if (reserved(url.pathname)) return null;
  if (url.pathname === "/MAXPlaces_Marketing" && !url.search) return null;
  // Authenticate before decoding, resolving IDs, or exposing even the existence of a title/snapshot.
  let allowed = false;
  try { allowed = await authorize(request); } catch { /* Fail closed if the operator verifier fails. */ }
  if (!allowed) return protectedResponse(request, 403, legacyLayout("Operator access required", "<h1>Operator access required</h1><p>This staging reader requires an authenticated operator.</p>"));
  try {
    if (request.method !== "GET" && request.method !== "HEAD") throw new RouteError(501, "This staging reader supports read-only GET and HEAD requests. Wiki writes are unavailable.");
    if (/^\/(?:api\.php|rest\.php|load\.php|thumb\.php|img_auth\.php)(?:\/|$)/i.test(url.pathname)) throw new RouteError(501, "This MediaWiki system endpoint is not implemented by the staging reader. Use the preserved native wiki for its original system functions.");
    const keys = [...url.searchParams.keys()];
    if (new Set(keys).size !== keys.length) throw new RouteError(400, "Duplicate query parameters are ambiguous.");
    if (keys.some(key => !["title", "curid", "oldid", "action", "diff", "offset"].includes(key))) throw new RouteError(501, "This query function is not implemented by the staging reader.");
    const snapshot = await store.latestReady();
    if (!snapshot) throw new RouteError(503, "No verified legacy capture is ready.");
    let pathTitle: string | undefined;
    try {
      if (url.pathname !== "/index.php") pathTitle = decodeURIComponent(url.pathname.slice(1));
    } catch { throw new RouteError(400, "Invalid URL encoding."); }
    let pageId = positiveId(url.searchParams.get("curid"), "page ID");
    let revisionId = positiveId(url.searchParams.get("oldid"), "revision ID");
    let queryTitle = url.searchParams.get("title");
    const specialTitle = pathTitle || queryTitle || undefined;
    const specialMatch = specialTitle?.replace(/_/g, " ").match(/^Special:(?:Redirect\/(page|revision)|PermanentLink)\/([1-9][0-9]*)$/i);
    if (specialMatch) {
      const id = positiveId(specialMatch[2], "special-page ID")!;
      if (specialMatch[1]?.toLowerCase() === "page") {
        if (pageId !== undefined && pageId !== id) throw new RouteError(400, "Conflicting page IDs.");
        pageId = id;
      } else {
        if (revisionId !== undefined && revisionId !== id) throw new RouteError(400, "Conflicting revision IDs.");
        revisionId = id;
      }
      pathTitle = undefined;
      // The special page supplies the identity. A separate title query must not be silently ignored.
      if (queryTitle !== null && queryTitle !== specialTitle) throw new RouteError(400, "Conflicting legacy titles.");
      queryTitle = null;
    } else if (/^Special:/i.test(specialTitle ?? "")) throw new RouteError(501, "This MediaWiki special page is not implemented by the staging reader.");
    const normalize = (title: string) => normalizeLegacyTitle(title, snapshot.descriptor.namespaces);
    if (pathTitle && queryTitle !== null && normalize(pathTitle) !== normalize(queryTitle)) throw new RouteError(400, "Conflicting legacy titles.");
    const title = pathTitle ? normalize(pathTitle) : queryTitle !== null ? normalize(queryTitle) : undefined;
    if (title?.startsWith("Special:")) throw new RouteError(501, "This MediaWiki special page is not implemented by the staging reader.");
    const action = url.searchParams.get("action") ?? "view";
    if (!["view", "history"].includes(action)) throw new RouteError(501, "This MediaWiki action is not implemented by the read-only staging reader.");
    const diff = url.searchParams.get("diff");
    if (diff !== null && action !== "view") throw new RouteError(400, "Diff and history actions cannot be combined.");
    if (diff !== null && !["prev", "next"].includes(diff) && !/^[1-9][0-9]*$/.test(diff)) throw new RouteError(501, "This diff mode is not implemented by the staging reader.");
    const numericDiffId = diff !== null && /^[1-9][0-9]*$/.test(diff) ? positiveId(diff, "diff revision ID") : undefined;
    let page: LegacyPageView | null = null;
    if (pageId !== undefined) page = await store.pageById(snapshot.snapshotId, pageId);
    if (pageId !== undefined && !page) throw new RouteError(404, "The requested captured page is unavailable.");
    if (title !== undefined) {
      const titled = await store.pageByTitle(snapshot.snapshotId, title);
      if (!titled) throw new RouteError(404, "The requested captured page is unavailable.");
      if (page && titled.pageId !== page.pageId) throw new RouteError(400, "Title and page ID identify different pages.");
      page = titled;
    }
    let revision: LegacyRevisionView | null = revisionId !== undefined ? await store.revisionById(snapshot.snapshotId, revisionId) : null;
    if (revisionId !== undefined && !revision) throw new RouteError(404, "The requested captured revision is unavailable; no current revision has been substituted.");
    let toRevision = numericDiffId !== undefined ? await store.revisionById(snapshot.snapshotId, numericDiffId) : null;
    if (numericDiffId !== undefined && !toRevision) throw new RouteError(404, "The requested comparison revision was not captured.");
    const identifyingRevision = revision ?? toRevision;
    if (identifyingRevision) {
      if (page && page.pageId !== identifyingRevision.pageId) throw new RouteError(400, "Page and revision IDs identify different pages.");
      page ??= await store.pageById(snapshot.snapshotId, identifyingRevision.pageId);
    }
    if (!page) throw new RouteError(404, "No captured page was identified by this URL.");
    if (toRevision && toRevision.pageId !== page.pageId) throw new RouteError(400, "Comparison revisions belong to different pages.");
    const offsetRaw = url.searchParams.get("offset");
    if (offsetRaw !== null && action !== "history") throw new RouteError(400, "History offset requires action=history.");
    const offset = offsetRaw === null ? 0 : /^\d{1,7}$/.test(offsetRaw) ? Number(offsetRaw) : NaN;
    if (!Number.isSafeInteger(offset) || offset < 0) throw new RouteError(400, "Invalid history offset.");
    if (action === "history") {
      if (revisionId !== undefined) throw new RouteError(400, "A history URL cannot also identify one revision.");
      const history = await store.history(snapshot.snapshotId, page.pageId, { limit: 101, offset });
      return protectedResponse(request, 200, renderHistory(page, history.slice(0, 100), snapshot, offset, history.length > 100), page);
    }
    revision ??= await store.revisionById(snapshot.snapshotId, page.latestCapturedRevisionId);
    if (!revision || revision.pageId !== page.pageId) throw new RouteError(404, "The captured page revision is unavailable.");
    if (diff !== null) {
      let fromRevision: LegacyRevisionView | null = revision;
      if (numericDiffId !== undefined && revisionId === undefined) fromRevision = await parentRevision(store, snapshot.snapshotId, toRevision!);
      if (diff === "prev") {
        toRevision = revision;
        fromRevision = await parentRevision(store, snapshot.snapshotId, revision);
      } else if (diff === "next") {
        toRevision = await nextRevision(store, snapshot.snapshotId, page.pageId, revision);
      }
      if (!fromRevision || !toRevision) throw new RouteError(404, "The requested adjacent revision is not available in this partial capture.");
      if (fromRevision.pageId !== page.pageId || toRevision.pageId !== page.pageId) throw new RouteError(400, "Comparison revisions belong to different pages.");
      return protectedResponse(request, 200, renderDiff(page, fromRevision, toRevision, snapshot), page, toRevision);
    }
    return protectedResponse(request, 200, renderRevision(page, revision, snapshot), page, revision);
  } catch (error) {
    if (error instanceof RouteError || error instanceof LegacyTitleError) return protectedResponse(request, error.status, legacyLayout("Legacy capture response", `<h1>Legacy capture response</h1><p>${error.message}</p>`));
    // Database details and imported source values must never appear in an error response.
    return protectedResponse(request, 500, legacyLayout("Legacy reader unavailable", "<h1>Legacy reader unavailable</h1><p>The private capture reader could not complete this request.</p>"));
  }
}

async function parentRevision(store: LegacyReadStore, snapshotId: string, revision: LegacyRevisionView): Promise<LegacyRevisionView | null> {
  const parentId = revision.raw.parentid;
  if (typeof parentId !== "number" || !Number.isSafeInteger(parentId) || parentId <= 0) return null;
  const parent = await store.revisionById(snapshotId, parentId);
  return parent?.pageId === revision.pageId ? parent : null;
}

async function nextRevision(store: LegacyReadStore, snapshotId: string, pageId: number, revision: LegacyRevisionView): Promise<LegacyRevisionView | null> {
  // A next captured row is not necessarily the true next revision. Require its original parent ID.
  for (let offset = 0; ; offset += 500) {
    const revisions = await store.history(snapshotId, pageId, { limit: 500, offset });
    const next = revisions.find(candidate => candidate.raw.parentid === revision.revisionId);
    if (next) return next;
    if (revisions.length < 500) return null;
    // Bound work even if an unexpected store fails to honor pagination.
    if (offset >= 100000) throw new RouteError(503, "This captured history requires an indexed adjacent-revision lookup.");
  }
}
