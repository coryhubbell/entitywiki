import type { LegacyPageView, LegacyRevisionView, LegacySnapshotView } from "./contracts.ts";

/** These readers never interpret wiki markup, expand templates, or fetch external resources. */
export function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]!);
}

function flag(raw: Record<string, unknown>, ...keys: string[]): boolean {
  return keys.some(key => Object.hasOwn(raw, key) && raw[key] !== false && raw[key] !== null && raw[key] !== 0);
}

export function revisionPresentation(revision: LegacyRevisionView) {
  const raw = revision.raw;
  // MediaWiki's legacy rev_deleted bitmask: text=1, comment=2, user=4, restricted=8.
  const deletion = typeof raw.deleted === "number" ? raw.deleted : 0;
  const suppressed = Boolean(deletion & 8) || (raw.deleted === true) || flag(raw, "suppressed", "restricted", "oversight");
  const userHidden = suppressed || Boolean(deletion & 4) || flag(raw, "userhidden", "user_hidden");
  const commentHidden = suppressed || Boolean(deletion & 2) || flag(raw, "commenthidden", "comment_hidden");
  const textHidden = suppressed || Boolean(deletion & 1) || flag(raw, "texthidden", "contenthidden", "sha1hidden");
  const rawSlots = raw.slots;
  const slots: { name: string; model: string; text: string | null; withheld: boolean }[] = [];
  if (rawSlots && typeof rawSlots === "object" && !Array.isArray(rawSlots)) {
    for (const [name, value] of Object.entries(rawSlots)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const slot = value as Record<string, unknown>;
      const hidden = textHidden || flag(slot, "suppressed", "restricted", "texthidden", "contenthidden", "sha1hidden", "deleted");
      const content = slot.content ?? slot["*"];
      slots.push({ name, model: typeof slot.contentmodel === "string" ? slot.contentmodel : "unknown",
        text: !hidden && typeof content === "string" ? content : null, withheld: hidden });
    }
  }
  // Old API captures may expose a single legacy content field instead of slots.
  if (!slots.length && (Object.hasOwn(raw, "*") || Object.hasOwn(raw, "content"))) {
    const content = raw.content ?? raw["*"];
    slots.push({ name: "main", model: typeof raw.contentmodel === "string" ? raw.contentmodel : "unknown",
      text: !textHidden && typeof content === "string" ? content : null, withheld: textHidden });
  }
  return {
    user: userHidden ? "[author withheld]" : typeof raw.user === "string" ? raw.user : "[author not captured]",
    comment: commentHidden ? "[comment withheld]" : typeof raw.comment === "string" ? raw.comment : "[comment not captured]",
    timestamp: typeof raw.timestamp === "string" ? raw.timestamp : "[timestamp not captured]",
    slots,
  };
}

export function legacyTitleUrl(title: string): string {
  return `/${encodeURIComponent(title.replace(/ /g, "_")).replace(/%3A/gi, ":")}`;
}

export function legacyRevisionUrl(revisionId: number): string {
  return `/index.php?oldid=${revisionId}`;
}

export function legacyHistoryUrl(pageId: number, offset = 0): string {
  return `/index.php?curid=${pageId}&action=history${offset ? `&offset=${offset}` : ""}`;
}

export function sourceViewerUrl(page: LegacyPageView, revisionId?: number): string {
  const parameters = new URLSearchParams(revisionId ? { oldid: String(revisionId) } : { curid: String(page.pageId) });
  return `https://entitywiki.org/index.php?${parameters}`;
}

export function legacyLayout(title: string, content: string, snapshot?: LegacySnapshotView): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${escapeHtml(title)} · EntityWiki staging</title><style>body{max-width:1100px;margin:2rem auto;padding:0 1.25rem;background:#101820;color:#e4edf3;font:16px/1.6 system-ui,sans-serif}a{color:#9bd8ff}nav{display:flex;gap:1rem;flex-wrap:wrap}header,section{margin:1.5rem 0;padding:1rem;border:1px solid #41515c;border-radius:.5rem}h1,h2{line-height:1.2}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#17232d;padding:1rem}table{border-collapse:collapse;width:100%;table-layout:fixed}th,td{text-align:left;vertical-align:top;border-bottom:1px solid #41515c;padding:.5rem;overflow-wrap:anywhere}.notice{background:#243124}.muted{color:#bdcbd4}.added{background:#183e2e}.removed{background:#4a292d}code{overflow-wrap:anywhere}</style></head><body><nav><a href="/admin/migration">Migration dashboard</a></nav><header class="notice"><strong>Private, read-only capture preview</strong><p>This is a partial unauthenticated public archive. It is not a full MediaWiki parser, database restore, account migration, or restoration of source permissions. All imported records require the current staging operator permission. Original IDs, captured history, and observed restrictions are retained without granting source roles.</p>${snapshot ? `<p class="muted">Capture ${escapeHtml(snapshot.descriptor.capturedAt)} · Snapshot ${escapeHtml(snapshot.snapshotId)}</p>` : ""}</header><main>${content}</main></body></html>`;
}

export function pageNavigation(page: LegacyPageView, revisionId?: number): string {
  return `<nav><a href="/index.php?curid=${page.pageId}">Captured page</a><a href="${escapeHtml(legacyHistoryUrl(page.pageId))}">Captured history</a><a rel="noreferrer noopener" href="${escapeHtml(sourceViewerUrl(page, revisionId))}">View original source site</a></nav>`;
}

function renderProtectionObservations(page: LegacyPageView): string {
  const metadata = Array.isArray(page.raw.metadata) ? page.raw.metadata : [];
  const observations: string[] = [];
  for (const value of metadata) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const protection = (value as Record<string, unknown>).protection;
    if (!Array.isArray(protection)) continue;
    for (const entry of protection) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const rule = entry as Record<string, unknown>;
      observations.push(`${typeof rule.type === "string" ? rule.type : "unknown restriction"}: ${typeof rule.level === "string" ? rule.level : "unknown level"}; expiry ${typeof rule.expiry === "string" ? rule.expiry : "not captured"}`);
    }
  }
  return `<section><h2>Captured protection observations</h2>${observations.length ? `<ul>${observations.map(observation => `<li>${escapeHtml(observation)}</li>`).join("")}</ul>` : "<p>No page protection entries were exposed in this public capture.</p>"}<p>These are source observations, not restored ACLs. The staging operator restriction applies to every imported page; source groups and permissions require the complete database backup.</p></section>`;
}

export function renderRevision(page: LegacyPageView, revision: LegacyRevisionView, snapshot: LegacySnapshotView): string {
  const presented = revisionPresentation(revision);
  const slots = presented.slots.length ? presented.slots.map(slot => `<section><h2>Slot: ${escapeHtml(slot.name)}</h2><p>Content model: ${escapeHtml(slot.model)}. Source is shown literally; wiki templates and HTML are not executed.</p>${slot.text === null ? `<p>${slot.withheld ? "Content withheld by source visibility flags." : "Content was not captured."}</p>` : `<pre>${escapeHtml(slot.text)}</pre>`}</section>`).join("") : "<section><p>No captured content slots are available.</p></section>";
  return legacyLayout(`${page.title} · Revision ${revision.revisionId}`, `<h1>${escapeHtml(page.title)}</h1>${pageNavigation(page, revision.revisionId)}<p>Original page ID <strong>${page.pageId}</strong> · Original revision ID <strong>${revision.revisionId}</strong> · Namespace ${page.namespace}</p><p>Stable page identity: <code>${escapeHtml(page.stablePageId)}</code></p><p>Author: ${escapeHtml(presented.user)} · ${escapeHtml(presented.timestamp)}</p><p>Comment: ${escapeHtml(presented.comment)}</p>${page.observedLatestRevisionId !== page.latestCapturedRevisionId ? "<p class=\"notice\">The source reported a different latest revision; this preview uses only the captured revision, never a substituted source fetch.</p>" : ""}${renderProtectionObservations(page)}${slots}`, snapshot);
}

export function renderHistory(page: LegacyPageView, revisions: LegacyRevisionView[], snapshot: LegacySnapshotView, offset: number, hasMore: boolean): string {
  const rows = revisions.map(revision => {
    const presented = revisionPresentation(revision);
    return `<tr><td><a href="${escapeHtml(legacyRevisionUrl(revision.revisionId))}">${revision.revisionId}</a><br><a href="/index.php?oldid=${revision.revisionId}&amp;diff=prev">Previous diff</a></td><td>${escapeHtml(presented.timestamp)}</td><td>${escapeHtml(presented.user)}</td><td>${escapeHtml(presented.comment)}</td></tr>`;
  }).join("");
  return legacyLayout(`${page.title} · Captured history`, `<h1>${escapeHtml(page.title)}: captured history</h1>${pageNavigation(page)}<p>Original page ID ${page.pageId}. Only revisions exposed in this capture are available; deleted, private, suppressed, or uncaptured history requires the full source backup.</p><table><thead><tr><th>Revision</th><th>Timestamp</th><th>Author</th><th>Comment</th></tr></thead><tbody>${rows}</tbody></table><nav>${offset ? `<a href="${escapeHtml(legacyHistoryUrl(page.pageId, Math.max(0, offset - 100)))}">Newer captured revisions</a>` : ""}${hasMore ? `<a href="${escapeHtml(legacyHistoryUrl(page.pageId, offset + 100))}">Older captured revisions</a>` : ""}</nav>`, snapshot);
}

/** Bounded line comparison. Long sources still remain available via their immutable revision links. */
export function renderDiff(page: LegacyPageView, before: LegacyRevisionView, after: LegacyRevisionView, snapshot: LegacySnapshotView): string {
  const from = revisionPresentation(before), to = revisionPresentation(after);
  const names = [...new Set([...from.slots.map(slot => slot.name), ...to.slots.map(slot => slot.name)])];
  const diff = names.map(name => {
    const left = from.slots.find(slot => slot.name === name), right = to.slots.find(slot => slot.name === name);
    if (!left || !right || left.text === null || right.text === null) return `<section><h2>Slot: ${escapeHtml(name)}</h2><p>Comparison withheld: one or both captured slots are missing or hidden.</p></section>`;
    const oldLines = left.text.split("\n"), newLines = right.text.split("\n");
    if (oldLines.length + newLines.length > 10000 || left.text.length + right.text.length > 1000000) return `<section><h2>Slot: ${escapeHtml(name)}</h2><p>Source exceeds the safe inline comparison size. Open each immutable revision to inspect its captured source.</p></section>`;
    // Equal line numbers are deliberately compared directly. This is a literal side-by-side comparison,
    // not an assertion of MediaWiki's context-sensitive parser or its exact diff algorithm.
    const lines = Array.from({ length: Math.max(oldLines.length, newLines.length) }, (_, index) => {
      const same = oldLines[index] === newLines[index];
      return `<tr><td>${index + 1}</td><td${same ? "" : " class=\"removed\""}><pre>${escapeHtml(oldLines[index] ?? "")}</pre></td><td${same ? "" : " class=\"added\""}><pre>${escapeHtml(newLines[index] ?? "")}</pre></td></tr>`;
    }).join("");
    return `<section><h2>Slot: ${escapeHtml(name)}</h2><table><thead><tr><th style="width:3rem">Line</th><th>Revision ${before.revisionId}</th><th>Revision ${after.revisionId}</th></tr></thead><tbody>${lines}</tbody></table></section>`;
  }).join("");
  return legacyLayout(`${page.title} · Revision comparison`, `<h1>${escapeHtml(page.title)}: literal source comparison</h1>${pageNavigation(page)}<p>Original page ID ${page.pageId}. Comparing <a href="${escapeHtml(legacyRevisionUrl(before.revisionId))}">${before.revisionId}</a> (${escapeHtml(from.timestamp)}) to <a href="${escapeHtml(legacyRevisionUrl(after.revisionId))}">${after.revisionId}</a> (${escapeHtml(to.timestamp)}). Rows compare corresponding source line numbers.</p>${diff || "<p>No captured slots are available to compare.</p>"}`, snapshot);
}
