import { SECTION_TITLES } from "./types.ts";
import type { CompanyRecord } from "./types.ts";
import { entityUri } from "./identity.ts";
import { object, safeUrl } from "./safety.ts";
import { publicRecord } from "./projections.ts";
/** Restore accepts an existing production record, never a draft example or arbitrary schema. */
export function validateAcceptedRecord(payload:unknown):CompanyRecord{
  const p=object(payload);
  if(p.contractVersion!=="entitywiki.company/1"||p.status!=="accepted"||typeof p.id!=="string"||!/^rev_[a-f0-9]{32}$/.test(p.id)||typeof p.entityId!=="string"||!Number.isSafeInteger(p.revision)||Number(p.revision)<1)throw new Error("An immutable accepted EntityWiki company record is required.");
  entityUri(p.entityId);
  const record=p as unknown as CompanyRecord;
  if(!record.slug||!record.org||record.org.id!==record.entityId||!safeUrl(record.org.url)||!record.org.name||!record.provenance||!/^[a-f0-9]{64}$/.test(record.provenance.importDigest)||record.id!==`rev_${record.provenance.importDigest.slice(0,32)}`)throw new Error("Accepted identity or record digest references are inconsistent.");
  if(!Array.isArray(record.claims)||!record.claims.length||!Array.isArray(record.sources)||!record.sources.length||!Array.isArray(record.entities)||!Array.isArray(record.locations)||!Array.isArray(record.services)||!Array.isArray(record.concepts)||!Array.isArray(record.google)||!Array.isArray(record.conflicts))throw new Error("The accepted record is missing required claim, evidence or projection arrays.");
  const sourceIds=new Set(record.sources.map(s=>s.id));const entityIds=new Set(record.entities.map(e=>e.id));const claimIds=new Set(record.claims.map(c=>c.id));
  if(sourceIds.size!==record.sources.length||entityIds.size!==record.entities.length||claimIds.size!==record.claims.length||!entityIds.has(record.entityId))throw new Error("Duplicate or missing accepted record identities.");
  for(const source of record.sources)if(!safeUrl(source.url)||!/^[a-f0-9]{64}$/.test(source.sha256)||!["public","wiki","jsonld"].every(k=>typeof object(source.destinations)[k]==="boolean"))throw new Error("A restored evidence artifact lacks a valid URL, digest or publication permissions.");
  for(const e of record.entities){entityUri(e.id);if(e.parentId&&!entityIds.has(e.parentId))throw new Error("A restored entity parent is missing.");}
  for(const c of record.claims)if(!entityIds.has(c.subjectId)||!Array.isArray(c.sourceIds)||c.sourceIds.some(id=>!sourceIds.has(id))||c.selected&&c.state!=="supported")throw new Error("A restored claim has invalid subject/evidence/state references.");
  for(const key of Object.keys(SECTION_TITLES) as (keyof typeof SECTION_TITLES)[]){const s=record.sections?.[key];if(!s||!["sourced","needs_research","conflicted","not_applicable","withheld"].includes(s.status)||!s.reason||!Array.isArray(s.claimIds)||s.claimIds.some(id=>!claimIds.has(id)))throw new Error("All fourteen sections require valid assessment and claim references.");}
  if(Object.keys(record.sections).length!==14)throw new Error("The accepted company contract requires exactly fourteen assessed sections.");
  for(const c of record.conflicts)if(c.claimIds.some(id=>!claimIds.has(id))||!entityIds.has(c.subjectId))throw new Error("A restored conflict has missing references.");
  for(const m of record.concepts)if(!entityIds.has(m.subjectId)||m.sourceIds.some(id=>!sourceIds.has(id)))throw new Error("A restored ontology mapping has missing references.");
  for(const b of record.locations)if(!entityIds.has(b.id))throw new Error("A restored branch is missing its stable entity.");
  for(const s of record.services)if(!entityIds.has(s.id))throw new Error("A restored offering is missing its stable entity.");
  publicRecord(record);return record;
}
