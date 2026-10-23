import { projectGraph, projectJsonLd, publicRecord } from "./projections.ts";
import { canonical, object, sha256 } from "./safety.ts";
import type { CompanyRecord, WebRelease, WebReleaseArtifactInput } from "./types.ts";

/** Capture once before the release transaction; future compilers must not rewrite it. */
export async function createReleaseArtifact(record:CompanyRecord):Promise<WebReleaseArtifactInput>{
  const body=canonical({record:publicRecord(record),jsonld:projectJsonLd(record),graph:projectGraph(record)});
  return {format:"entitywiki.public-release/1",recordDigest:await sha256(canonical(record)),digest:await sha256(body),body};
}

/** Validate stored bytes and their immutable accepted-record/release binding, without recompilation. */
export async function validateReleaseArtifact(artifact:WebReleaseArtifactInput,record:CompanyRecord,release:Pick<WebRelease,"entityId"|"recordId"|"digest">):Promise<void>{
  if(artifact.format!=="entitywiki.public-release/1"||!/^([a-f0-9]{64})$/.test(artifact.recordDigest)||!/^([a-f0-9]{64})$/.test(artifact.digest))throw new Error("The archived public release artifact has an unsupported format or invalid digest.");
  if(record.id!==release.recordId||record.entityId!==release.entityId||artifact.recordDigest!==await sha256(canonical(record)))throw new Error("The archived public release artifact differs from its accepted record binding.");
  if(artifact.digest!==release.digest||await sha256(artifact.body)!==artifact.digest)throw new Error("The archived public release artifact differs from its approved release digest.");
  let parsed:unknown;try{parsed=JSON.parse(artifact.body);}catch{throw new Error("The archived public release artifact is not valid JSON.");}
  const projection=object(parsed),archivedRecord=object(projection.record),graph=object(projection.graph);
  if(canonical(parsed)!==artifact.body||Object.keys(projection).sort().join(",")!=="graph,jsonld,record"||archivedRecord.id!==record.id||archivedRecord.entityId!==record.entityId||archivedRecord.contractVersion!==record.contractVersion||!Array.isArray(graph.nodes)||!Array.isArray(graph.edges)||!object(projection.jsonld)["@context"])throw new Error("The archived public release artifact has invalid canonical bytes or projection identity.");
}
