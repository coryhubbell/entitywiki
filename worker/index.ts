import handler from "vinext/server/fetch-handler";
import { getDb } from "../db";
import { requireOperator } from "../lib/operator-auth.ts";
import { createLegacyStore } from "../lib/legacy/store.ts";
import { handleLegacyRequest } from "../lib/legacy/routes.ts";
import type { LegacyStore } from "../lib/legacy/contracts.ts";

const registryWorker = {
  async fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext) {
    let migrationStore:LegacyStore|undefined;
    const store=()=>migrationStore??=createLegacyStore(getDb());
    const legacy = await handleLegacyRequest(request, {
      latestReady:()=>store().latestReady(),
      pageById:(...args)=>store().pageById(...args),
      pageByTitle:(...args)=>store().pageByTitle(...args),
      revisionById:(...args)=>store().revisionById(...args),
      history:(...args)=>store().history(...args),
    }, async incoming => {
      try { await requireOperator(incoming); return true; } catch { return false; }
    });
    const response = legacy ?? await handler.fetch(request, env, ctx);
    // Every replacement response stays unindexed until the production URL audit passes.
    const headers = new Headers(response.headers);
    if (!headers.has("X-Robots-Tag")) headers.set("X-Robots-Tag", "noindex, nofollow");
    headers.set("X-Content-Type-Options", "nosniff");
    if (!headers.has("Referrer-Policy")) headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    if (new URL(request.url).pathname.startsWith("/admin")) headers.set("Cache-Control", "private, no-store");
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  },
};
export default registryWorker;
