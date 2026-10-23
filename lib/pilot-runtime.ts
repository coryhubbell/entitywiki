import { env } from "cloudflare:workers";
import { getDb } from "../db";
import { createPilotService } from "./entitywiki/service.ts";
import { boundedText } from "./entitywiki/safety.ts";
export { requireOperator as assertOperator } from "./operator-auth.ts";

export function pilotService() {
  return createPilotService(getDb(), {
    schemaBrains: { apiKey: env.SCHEMABRAINS_API_KEY, baseUrl: "https://schemabrains.com" },
    wiki: { apiUrl: "https://entitywiki.org/api.php" },
    // This replacement has no write credentials or configurable live-wiki switch.
    wikiPublicationEnabled: false,
  });
}

export async function jsonBody(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.includes("application/json")) throw Object.assign(new Error("Send application/json."), { status: 415 });
  const body = JSON.parse(await boundedText(new Response(request.body), 1_000_000));
  if (!body || Array.isArray(body) || typeof body !== "object") throw Object.assign(new Error("Expected a JSON object."), { status: 400 });
  return body;
}

export function jsonResponse(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}

export function errorResponse(error: unknown) {
  const e = error as { status?: number; message?: string; code?: string };
  const message = (e.message ?? "The operation could not be completed.").replace(/sb_live_[\w-]+/g, "[redacted]").slice(0, 500);
  return jsonResponse({ error: { code: e.code ?? "operation_failed", message } }, e.status ?? (message.includes("not configured") ? 503 : 400));
}

export function runtimeStatus() {
  return {
    schemaBrains: { configured: !!env.SCHEMABRAINS_API_KEY, status: env.SCHEMABRAINS_API_KEY ? "configured_not_verified" : "credential_required", reason: env.SCHEMABRAINS_API_KEY ? "Use connection check to verify this server credential." : "The browser-export pilot is available. Autonomous scans require a server-held SchemaBrains key with generate and results:read." },
    wiki: { configured: false, enabled: false, status: "preservation_only", reason: "The replacement has no live MediaWiki write credentials. Preserve the source and validate the URL succession before cutover." },
    google: { status: "merchant_authorization_required", places: "two_pilot_identities_verified", categories: env.GOOGLE_BUSINESS_PROFILE_ACCESS_TOKEN ? "oauth_configured_not_verified" : "merchant_authorization_required", reason: "Place IDs and proposed categories are separate from selected merchant categories." },
  };
}
