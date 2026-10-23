import mappingEvidence from "../../data/pilot/mappings.json" with { type: "json" };
import { collectFirstParty } from "./collection.ts";
import { MediaWikiClient, WikiApiError } from "./mediawiki.ts";
import type { MediaWikiConfig } from "./mediawiki.ts";
import { MAPPING_VERSION, normalizePilot, PILOT_SLUG } from "./normalize.ts";
import { EntityWikiRepository } from "./repository.ts";
import type { PilotDatabase } from "./repository.ts";
import { managedRegion, planManagedRollback, projectGraph, projectJsonLd, publicRecord, replaceManaged, splitManaged } from "./projections.ts";
import { SchemaBrainsClient } from "./schemabrains.ts";
import { assertOfficialUrl, canonical, object, sha256 } from "./safety.ts";
import type { CollectedPage, CompanyRecord, PilotMappingSupplement, PublicationPlan, SavedGeneration, WebRelease, WikiPage } from "./types.ts";
import { branchSourceKey, entityUri, PILOT_DOCUMENT_PATH, publisherKey } from "./identity.ts";
import { validateAcceptedRecord } from "./validation.ts";
import { createReleaseArtifact, validateReleaseArtifact } from "./release-artifacts.ts";
export interface PilotConfig {schemaBrains?:{apiKey?:string;baseUrl?:string};wiki:MediaWikiConfig;wikiPublicationEnabled?:boolean;fetch?:typeof fetch;mappingSupplement?:PilotMappingSupplement;collectedPages?:CollectedPage[];publicOrigin?:string}
export interface ImportOptions {supplementFirstParty?:boolean;acquisition?:string}
function generationPayload(payload:unknown):SavedGeneration {
  const p=object(payload);const integrity=object(p.integrity);
  if(typeof p.generationId!=="string"||p.generationId.length>200||!p.generationId||!p.schema||typeof p.schema!=="object"||Array.isArray(p.schema)||typeof p.sourceUrl!=="string")throw new Error("Expected the documented immutable SchemaBrains saved-generation DTO, not an arbitrary schema or draft bundle.");
  assertOfficialUrl(p.sourceUrl);
  for(const key of ["receiptVerified","sidecarsVerified","glossaryHTMLVerified"]){if(integrity[key]!==null&&typeof integrity[key]!=="boolean")throw new Error("Saved generation integrity must explicitly preserve true, false or unknown.");}
  return {...p,integrity} as unknown as SavedGeneration;
}
export function createPilotService(db:PilotDatabase,config:PilotConfig){
  const repository=new EntityWikiRepository(db);const fetcher=config.fetch??fetch;
  const wiki=new MediaWikiClient(config.wiki,fetcher);
  const schemaBrains=()=>{if(!config.schemaBrains?.apiKey)throw new Error("SchemaBrains server credential is not configured. The real browser-export pilot remains available.");return new SchemaBrainsClient({...config.schemaBrains,apiKey:config.schemaBrains.apiKey},fetcher);};
  const collection=async()=>config.collectedPages?{pages:config.collectedPages,failures:[]}:collectFirstParty(fetcher);
  async function importSavedGenerationPayload(payload:unknown,options:ImportOptions={}){
    const generation=generationPayload(payload);const supplement=config.mappingSupplement??mappingEvidence as PilotMappingSupplement;const runId=`import_${(await sha256(MAPPING_VERSION+generation.generationId+canonical(generation.schema)+canonical(supplement))).slice(0,32)}`;const createdAt=new Date().toISOString();
    const previous=await repository.run(runId);
    if(previous?.state==="completed"&&previous.recordId){const record=await repository.record(previous.recordId);if(record)return {record:publicRecord(record),recordId:record.id,replayed:true,runId,coverage:record.coverage};}
    await repository.putRun({id:runId,kind:"saved_generation_import",state:"collecting",operationId:null,generationId:generation.generationId,recordId:null,body:{sourceUrl:generation.sourceUrl,acquisition:options.acquisition??"operator_supplied_export",scope:"four targeted official pages",mappingVersion:MAPPING_VERSION},createdAt,updatedAt:createdAt});
    try{
      const collected=await collection();
      const normalized=await normalizePilot({generation,pages:collected.pages,failures:collected.failures,acquisition:options.acquisition??"operator_supplied_export",supplement,identities:{resolve:request=>repository.assignIdentity(request)}});
      const result=await repository.saveRecord(normalized);await repository.updateRun(runId,{state:"completed",recordId:result.record.id});
      return {record:publicRecord(result.record),recordId:result.record.id,replayed:result.replayed,runId,coverage:result.record.coverage};
    }catch(error){await repository.updateRun(runId,{state:"failed"});throw error;}
  }
  async function importGeneration(generationId:string,options:ImportOptions={}){
    const client=schemaBrains();await client.capabilities();const payload=await client.getGeneration(generationId);
    if(payload.generationId!==generationId)throw new Error("SchemaBrains returned a different immutable generation ID.");
    return importSavedGenerationPayload(payload,{...options,acquisition:"authenticated_rest_saved_generation"});
  }
  async function startGeneration(updateKey?:string){
    const client=schemaBrains();await client.capabilities();
    const active=updateKey?null:await repository.activeGeneration();
    const id=updateKey??active?.id??`ew-maxplaces-${crypto.randomUUID()}`;const now=new Date().toISOString();
    const run=await repository.putRun({id,kind:"schemabrains_generation",state:"submitting",operationId:null,generationId:null,recordId:null,body:{url:"https://www.maxplaces.com/",requestIdempotencyKey:id,scope:"one homepage generation",stopReason:null},createdAt:now,updatedAt:now});
    if(run.operationId)return {runId:id,requestId:run.operationId,state:run.state,generationId:run.generationId,replayed:true};
    // SchemaBrains receives the same persisted idempotency key if submission response is lost.
    const operation=await client.createGeneration(id);await repository.updateRun(id,{state:operation.state,operationId:operation.requestId,generationId:operation.generationId});return {runId:id,...operation};
  }
  async function pollGeneration(requestId:string){
    const run=await repository.runByOperationId(requestId);if(!run)throw new Error("This generation operation is not owned by an EntityWiki run.");
    const operation=await schemaBrains().pollGeneration(requestId);await repository.updateRun(run.id,{state:operation.state,generationId:operation.generationId});
    if(operation.state==="completed"&&operation.generationId){const result=await importGeneration(operation.generationId);await repository.updateRun(run.id,{recordId:result.recordId});return {...operation,import:result};}
    return operation;
  }
  async function profileEnvelope(record:CompanyRecord,admin=false){const published=await repository.latestPublished(record.wiki.pageId);const release=await repository.currentWebRelease(record.entityId);const webRelease=release?admin?{...release,projectionCurrent:release.recordId===record.id&&await publicProjectionDigest(record)===release.digest}:{id:release.id,entityId:release.entityId,recordId:release.recordId,sequence:release.sequence,previousReleaseId:release.previousReleaseId,digest:release.digest,releasedAt:release.releasedAt}:null;return {record:admin?record:publicRecord(record),jsonld:projectJsonLd(record),graph:projectGraph(record),webRelease,publication:published?{planId:published.planId,recordId:published.recordId,status:published.recordId===record.id?published.status:"pending",newRevision:published.newRevision,receipt:published.receipt}:{status:"not_published",recordId:record.id}};}
  async function getAdminProfile(slug=PILOT_SLUG){const record=await repository.latest(slug);return record?profileEnvelope(record,true):null;}
  async function publicProjectionDigest(record:CompanyRecord){return sha256(canonical({record:publicRecord(record),jsonld:projectJsonLd(record),graph:projectGraph(record)}));}
  async function assertReleaseDigest(record:CompanyRecord,release:WebRelease){if(await publicProjectionDigest(record)!==release.digest)throw new Error("The stored public projection differs from its approved release digest. Review and explicitly release the current projection before serving it.");}
  async function getReleasedProfile(slug=PILOT_SLUG){const latest=await repository.latest(slug);if(!latest)return null;const release=await repository.currentWebRelease(latest.entityId);if(!release)return null;const record=await repository.record(release.recordId);if(!record)return null;await assertReleaseDigest(record,release);return profileEnvelope(record);}
  const getProfile=getReleasedProfile;
  async function getRecordRevision(recordId:string){const record=await repository.record(recordId);return record?profileEnvelope(record,true):null;}
  async function getReleasedRevision(recordId:string){const release=await repository.releaseForRecord(recordId);if(!release)return null;const record=await repository.record(recordId);if(!record)return null;await assertReleaseDigest(record,release);const envelope=await profileEnvelope(record);return {...envelope,webRelease:{id:release.id,entityId:release.entityId,recordId:release.recordId,sequence:release.sequence,previousReleaseId:release.previousReleaseId,digest:release.digest,releasedAt:release.releasedAt}};}
  async function releaseRecord(recordId:string,input:{actor:string;expectedPreviousReleaseId?:string|null;reason?:string}){
    const record=await repository.record(recordId);if(!record)throw new Error("Accepted revision not found.");validateAcceptedRecord(record);
    const artifact=await createReleaseArtifact(record);
    const result=await repository.releaseRecord(record,artifact.digest,{...input,artifact});return {...result,recordId:record.id,profile:await getReleasedProfile(record.slug)};
  }
  async function exportReleaseArtifact(releaseId:string){
    const release=await repository.webRelease(releaseId);if(!release)return null;
    const artifact=await repository.releaseArtifact(releaseId);if(!artifact)throw new Error("This historical release stored only a digest; exact release bytes were not captured. Review and create a new explicit release to preserve current bytes.");
    const record=await repository.record(release.recordId);if(!record)throw new Error("The archived release's accepted revision is unavailable.");
    if(artifact.releaseId!==release.id||artifact.capturedAt!==release.releasedAt)throw new Error("The archived public release artifact has an invalid release binding.");
    await validateReleaseArtifact(artifact,record,release);
    // Operator-only export intentionally excludes raw accepted records and actor/reason metadata.
    return {format:artifact.format,release:{id:release.id,entityId:release.entityId,recordId:release.recordId,sequence:release.sequence,previousReleaseId:release.previousReleaseId,digest:release.digest,releasedAt:release.releasedAt},acceptedRecordDigest:artifact.recordDigest,capturedAt:artifact.capturedAt,projectionCanonical:artifact.body};
  }
  async function registerRestoredIdentities(record:CompanyRecord){
    for(const entity of record.entities){const branch=record.locations.find(b=>b.id===entity.id);const offering=record.services.find(o=>o.id===entity.id);let sourceKeys:string[];
      if(entity.kind==="organization")sourceKeys=[`legacy-mediawiki:${record.wiki.pageId}`,`official-domain:${new URL(record.org.url).hostname.replace(/^www\./,"")}`];
      else if(branch)sourceKeys=[branchSourceKey(branch.address.addressLocality??"",branch.address.streetAddress??"",branch.address.addressRegion??"",branch.address.addressCountry??"")];
      else if(offering)sourceKeys=offering.url?[`offering-url:${publisherKey(offering.url)}`]:[`offering-label:${offering.name.toLowerCase()}`];
      else sourceKeys=[`${entity.kind}-label:${entity.name.toLowerCase()}`];
      sourceKeys.push(`legacy-id:${entity.id}`);
      const id=await repository.assignIdentity({kind:entity.kind,parentId:entity.parentId,sourceKeys,labels:[entity.name],preferredId:entity.id,adoptUnaliasedPreferred:true,reason:"Restore the existing accepted pilot entity and preserve its original opaque identifier."});if(id!==entity.id)throw new Error("A restored source key is already assigned to a different stable entity.");
    }
  }
  async function restoreAcceptedRecord(payload:unknown,input:{source:string;expectedRecordDigest?:string}){
    const record=validateAcceptedRecord(payload);const digest=await sha256(canonical(record));if(input.expectedRecordDigest&&input.expectedRecordDigest!==digest)throw new Error("The accepted record snapshot digest does not match the restoration manifest.");if(!input.source?.trim())throw new Error("A restoration source receipt is required.");
    const existing=await repository.record(record.id);if(existing&&canonical(existing)!==canonical(record))throw new Error("This immutable revision identifier already contains different record bytes.");
    await registerRestoredIdentities(record);const result=await repository.saveRecord(record,{preserveRevision:true});const now=new Date().toISOString();const runId=`restore_${digest.slice(0,32)}`;await repository.putRun({id:runId,kind:"accepted_snapshot_restore",state:"completed",operationId:null,generationId:record.provenance.generationId,recordId:record.id,body:{source:input.source,canonicalRecordSha256:digest,preservedRevision:record.revision,publication:"not_released_by_restore"},createdAt:now,updatedAt:now});return {...result,recordId:result.record.id,runId,snapshotDigest:digest};
  }
  async function resolveEntity(id:string){const entity=await repository.entity(id);if(!entity)return null;const latest=await repository.latest(PILOT_SLUG);if(!latest)return null;const release=await repository.currentWebRelease(latest.entityId);if(!release)return null;const record=await repository.record(release.recordId);if(!record||!publicRecord(record).entities.some(e=>e.id===id))return null;await assertReleaseDigest(record,release);return {id,canonicalUri:entityUri(id),profilePath:PILOT_DOCUMENT_PATH,recordId:record.id,releaseId:release.id};}
  async function previewPublication(recordId:string,options:{adoptLegacy?:boolean}={}){
    const record=await repository.record(recordId);if(!record)throw new Error("Accepted EntityWiki record not found.");
    const page=await wiki.readPage(record.wiki.pageId);if(page.missing||page.pageId!==record.wiki.pageId||page.title!==record.wiki.title)throw new Error("The MediaWiki page identity changed; manual reconciliation is required.");
    const region=managedRegion(record);const current=splitManaged(page.text,record.entityId);const prior=await repository.latestPublished(page.pageId);
    if(current&&prior&&await sha256(current.region)!==prior.managedDigest&&current.region!==region)throw new Error("A human changed the managed region; reconcile those edits before publishing.");
    if(current&&!prior&&current.region!==region)throw new Error("An unregistered managed region exists; manual adoption is required.");
    const after=replaceManaged(page.text,record.entityId,region,options.adoptLegacy??true);
    const beforeDigest=await sha256(page.text),afterDigest=await sha256(after),managedDigest=await sha256(region);
    const planId=`pub_${(await sha256(`${record.id}:${page.pageId}:${page.revision}:${beforeDigest}:${afterDigest}`)).slice(0,32)}`;
    const plan:PublicationPlan={planId,recordId,entityId:record.entityId,title:page.title,pageId:page.pageId,status:"preview",expectedRevision:page.revision,before:page.text,after,wikitext:region,beforeDigest,afterDigest,managedDigest,previousManagedDigest:current?await sha256(current.region):null,createdAt:new Date().toISOString(),diffSummary:beforeDigest===afterDigest?"Identical projection: no wiki edit will be made.":current?"Replace only the existing managed region; preserve all outside text.":"Append the new managed company template; preserve the complete existing article and history.",startTimestamp:page.currentTimestamp,baseTimestamp:page.timestamp};
    return repository.savePlan(plan);
  }
  async function checkedPlan(planId:string){const plan=await repository.plan(planId);if(!plan)throw new Error("Publication plan not found; preview the exact accepted record first.");return plan;}
  async function confirmReadback(plan:PublicationPlan,page:WikiPage,channel:"service_bot"|"supervised_browser",reconciled=false){
    const digest=await sha256(page.text);
    if(page.pageId!==plan.pageId||page.title!==plan.title||digest!==plan.afterDigest||page.revision<plan.expectedRevision)throw new Error("Live wiki readback does not match the exact reviewed publication plan.");
    const state=plan.beforeDigest===plan.afterDigest?"noop":"published";
    const receipt={channel,revision:page.revision,readbackDigest:digest,verifiedAt:new Date().toISOString(),reconciled};
    await repository.transitionPlan(plan.planId,["preview","publishing","reconcile","failed"],state,{newRevision:page.revision,receipt});return (await repository.plan(plan.planId))!;
  }
  async function recordExternalPublication(planId:string){const plan=await checkedPlan(planId);return confirmReadback(plan,await wiki.readPage(plan.pageId),"supervised_browser");}
  async function previewRollbackPublished(planId:string){const plan=await checkedPlan(planId);return planManagedRollback(await wiki.readPage(plan.pageId),plan);}
  async function publishPublication(planId:string){
    if(!config.wikiPublicationEnabled)throw new Error("Unattended wiki publication is disabled until scoped credentials and supported production runtime readiness are recorded.");
    let plan=await checkedPlan(planId);
    if(["published","noop"].includes(plan.status))return plan;
    if(plan.status==="conflict")throw new Error("This plan has a human edit conflict; create a new reviewed plan.");
    const leaseOwner=crypto.randomUUID();if(!await repository.lease(plan.pageId,leaseOwner))throw new Error("Another publication holds this page lease; reconcile or wait for completion.");
    try{
      // This also recovers the crash window after MediaWiki accepted an edit but before the receipt commit.
      const current=await wiki.readPage(plan.pageId);const digest=await sha256(current.text);
      if(digest===plan.afterDigest)return await confirmReadback(plan,current,"service_bot",plan.status!=="preview");
      if(["publishing","reconcile"].includes(plan.status)){await repository.transitionPlan(plan.planId,["publishing","reconcile"],"reconcile",{error:"Ambiguous previous edit; current content differs. Review revision history before retrying."});throw new Error("An ambiguous earlier edit needs manual revision-history reconciliation; no retry was sent.");}
      if(current.revision!==plan.expectedRevision||digest!==plan.beforeDigest){await repository.transitionPlan(plan.planId,["preview","failed"],"conflict",{error:"The article changed after preview; human edits are preserved."});throw new Error("The article changed after preview; create a new reviewed plan.");}
      if(!await repository.transitionPlan(plan.planId,["preview","failed"],"publishing"))throw new Error("Publication state changed concurrently.");
      plan={...plan,status:"publishing"};
      try{await wiki.edit(plan);}catch(error){
        if(error instanceof WikiApiError&&error.ambiguous){const readback=await wiki.readPage(plan.pageId).catch(()=>null);if(readback&&await sha256(readback.text)===plan.afterDigest)return await confirmReadback(plan,readback,"service_bot",true);await repository.transitionPlan(plan.planId,["publishing"],"reconcile",{error:"Edit response was lost; revision-history reconciliation is required."});throw error;}
        const conflict=error instanceof WikiApiError&&["editconflict","pagedeleted","articleexists"].includes(error.code);await repository.transitionPlan(plan.planId,["publishing"],conflict?"conflict":"failed",{error:error instanceof WikiApiError?error.message:"Publisher authentication or transport failed; no automatic retry was scheduled."});throw error;
      }
      const readback=await wiki.readPage(plan.pageId);if(await sha256(readback.text)!==plan.afterDigest){await repository.transitionPlan(plan.planId,["publishing"],"reconcile",{error:"Post-edit readback differs; no success receipt recorded."});throw new Error("The edit response arrived but readback differs; manual reconciliation is required.");}
      return await confirmReadback(plan,readback,"service_bot");
    }finally{await repository.release(plan.pageId,leaseOwner);}
  }
  return {importSavedGenerationPayload,importGeneration,startGeneration,pollGeneration,getProfile,getReleasedProfile,getAdminProfile,getRecordRevision,getReleasedRevision,releaseRecord,exportReleaseArtifact,restoreAcceptedRecord,resolveEntity,previewPublication,publishPublication,recordExternalPublication,previewRollbackPublished,getOperations:async()=>({runs:await repository.runs(),publications:await repository.publicationList()}),checkSchemaBrainsConnection:async()=>schemaBrains().capabilities()};
}
