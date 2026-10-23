import { env } from "cloudflare:workers";
import savedPilot from "../../../data/pilot/schemabrains-generation.json";
import acceptedPilot from "../../../data/pilot/accepted-record.json";
import acceptedManifest from "../../../data/pilot/accepted-record.manifest.json";
import { pilotService, assertOperator, jsonBody, jsonResponse, errorResponse, runtimeStatus } from "../../../lib/pilot-runtime";
import { lookupGbpCategories } from "../../../lib/mappings/google";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ path: string[] }> };

export async function GET(request: Request, context: Context) {
  try {
    const { path } = await context.params;
    const route = path.join("/");
    if (route === "health") return jsonResponse({ ok: true, contract: "entitywiki.company/1", pilot: "maxplaces-marketing", databaseConfigured: !!env.DB });
    const publicRoute = route.startsWith("public/");
    if (!publicRoute) await assertOperator(request);
    const service = pilotService();
    if (path.length === 3 && path[0] === "releases" && path[2] === "artifact") {
      if (!/^web_[a-f0-9]{32}$/.test(path[1])) return jsonResponse({ error: { code: "not_found", message: "Release not found." } }, 404);
      const result = await service.exportReleaseArtifact(path[1]);
      return result ? jsonResponse(result) : jsonResponse({ error: { code: "not_found", message: "Release not found." } }, 404);
    }
    if (route === "connections") {
      return jsonResponse({ ...runtimeStatus(), operations: await service.getOperations() });
    }
    if (route === "records/maxplaces-marketing" || route === "public/records/maxplaces-marketing") {
      const result = publicRoute ? await service.getProfile("maxplaces-marketing") : await service.getAdminProfile("maxplaces-marketing");
      if (!result) return jsonResponse({ error: { code: "not_imported", message: "Import the MAXPlaces pilot to initialize the record." } }, 404);
      return jsonResponse(result);
    }
    if (route === "records/maxplaces-marketing/schema.jsonld" || route === "public/records/maxplaces-marketing/schema.jsonld") {
      const result = publicRoute ? await service.getProfile("maxplaces-marketing") : await service.getAdminProfile("maxplaces-marketing");
      if (!result) return jsonResponse({ error: { code: "not_imported", message: "The pilot record has not been imported." } }, 404);
      return new Response(JSON.stringify(result.jsonld, null, 2), { headers: { "Content-Type": "application/ld+json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
    }
    if (route.startsWith("public/revisions/")) {
      const id = path.at(-1)!;
      if (!/^rev_[a-f0-9]{20,64}$/.test(id)) return jsonResponse({ error: { code: "not_found", message: "Revision not found." } }, 404);
      const result = await service.getReleasedRevision(id);
      return result ? jsonResponse(result) : jsonResponse({ error: { code: "not_found", message: "Released revision not found." } }, 404);
    }
    return jsonResponse({ error: { code: "not_found", message: "Route not found." } }, 404);
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request, context: Context) {
  try {
    const operator = await assertOperator(request);
    const { path } = await context.params;
    const route = path.join("/");
    const body = await jsonBody(request);
    const service = pilotService();
    if (route === "releases") {
      if (typeof body.recordId !== "string" || !(body.expectedPreviousReleaseId === null || typeof body.expectedPreviousReleaseId === "string")) throw new Error("recordId and expectedPreviousReleaseId (or null) are required.");
      return jsonResponse(await service.releaseRecord(body.recordId, { actor: operator.subject, expectedPreviousReleaseId: body.expectedPreviousReleaseId, reason: typeof body.reason === "string" ? body.reason.slice(0, 1000) : undefined }));
    }
    if (route === "import") {
      if (body.mode === "restore_pilot") return jsonResponse(await service.restoreAcceptedRecord(acceptedPilot, { source: "MAXPlaces accepted pilot snapshot, legacy page 213 revision 1200", expectedRecordDigest: acceptedManifest.canonicalSha256 }));
      if (body.mode === "pilot") return jsonResponse(await service.importSavedGenerationPayload(savedPilot, { acquisition: "authenticated_browser_export", supplementFirstParty: true }));
      if (body.mode === "saved_payload") {
        if (!body.payload || typeof body.payload !== "object") throw new Error("A saved generation payload is required.");
        return jsonResponse(await service.importSavedGenerationPayload(body.payload, { acquisition: "operator_supplied_export", supplementFirstParty: true }));
      }
      if (typeof body.generationId === "string" && body.generationId) return jsonResponse(await service.importGeneration(body.generationId, { supplementFirstParty: true }));
      const idempotencyKey = request.headers.get("Idempotency-Key") ?? undefined;
      if (idempotencyKey && !/^[A-Za-z0-9_-]{10,160}$/.test(idempotencyKey)) throw new Error("Invalid operation idempotency key.");
      return jsonResponse(await service.startGeneration(idempotencyKey));
    }
    if (route === "connections/check") return jsonResponse(await service.checkSchemaBrainsConnection());
    if (route === "generation/poll") {
      if (typeof body.requestId !== "string") throw new Error("requestId is required.");
      return jsonResponse(await service.pollGeneration(body.requestId));
    }
    if (route === "publications/preview") {
      if (typeof body.recordId !== "string") throw new Error("recordId is required.");
      return jsonResponse(await service.previewPublication(body.recordId));
    }
    if (route === "publications/publish") {
      return jsonResponse({ error: { code: "legacy_source_protected", message: "Live MediaWiki writing is disabled in the replacement. Use a staging registry release." } }, 409);
    }
    if (route === "publications/readback") {
      if (typeof body.planId !== "string") throw new Error("planId is required.");
      return jsonResponse(await service.recordExternalPublication(body.planId));
    }
    if (route === "publications/rollback-preview") {
      if (typeof body.planId !== "string") throw new Error("planId is required.");
      return jsonResponse(await service.previewRollbackPublished(body.planId));
    }
    if (route === "google/categories") {
      return jsonResponse(await lookupGbpCategories({ accessToken: env.GOOGLE_BUSINESS_PROFILE_ACCESS_TOKEN, prefix: "Internet marketing", regionCode: "US", languageCode: "en" }));
    }
    return jsonResponse({ error: { code: "not_found", message: "Route not found." } }, 404);
  } catch (error) { return errorResponse(error); }
}
