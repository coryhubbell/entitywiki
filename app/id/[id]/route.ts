import { pilotService, errorResponse } from "../../../lib/pilot-runtime";

export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!/^ew_[a-f0-9]{20,64}$/.test(id)) return new Response("Entity not found.", { status: 404 });
    const service = pilotService();
    const entity = await service.resolveEntity(id);
    if (!entity) return new Response("Released entity not found.", { status: 404 });
    if (request.headers.get("accept")?.includes("application/ld+json")) {
      const profile = await service.getReleasedRevision(entity.recordId);
      const graph = (profile?.jsonld as { "@graph"?: Record<string, unknown>[] } | undefined)?.["@graph"] ?? [];
      const node = graph.find(item => item["@id"] === entity.canonicalUri);
      if (!node) return new Response("Released entity projection not found.", { status: 404 });
      return Response.json({ "@context": "https://schema.org", ...node }, { headers: { "Content-Type": "application/ld+json; charset=utf-8", "Cache-Control": "no-store", Link: `<${entity.canonicalUri}>; rel="canonical"` } });
    }
    // An entity identifier resolves to its released document; it is not a document alias.
    return new Response(null, { status: 303, headers: { Location: entity.profilePath, "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
