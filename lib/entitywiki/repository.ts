import { and, desc, eq, inArray, lt } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as tables from "../../db/schema.ts";
import type { CompanyRecord, PublicationPlan, PublicationState, WebRelease } from "./types.ts";
import type { IdentityRequest } from "./identity.ts";
import { canonical, sha256 } from "./safety.ts";
type Database=DrizzleD1Database<typeof tables>;
export interface Run {id:string;kind:string;state:string;operationId:string|null;generationId:string|null;recordId:string|null;body:Record<string,unknown>;createdAt:string;updatedAt:string}
/** All record/evidence/claim rows are append-only. Only run and target receipts change state. */
export class EntityWikiRepository {
  readonly db:Database;
  constructor(db:Database){this.db=db;}
  async record(id:string):Promise<CompanyRecord|null>{const row=await this.db.select().from(tables.companyRecords).where(eq(tables.companyRecords.id,id)).get();return row?JSON.parse(row.body) as CompanyRecord:null;}
  async latest(slug:string):Promise<CompanyRecord|null>{const row=await this.db.select().from(tables.companyRecords).where(eq(tables.companyRecords.slug,slug)).orderBy(desc(tables.companyRecords.revision)).get();return row?JSON.parse(row.body) as CompanyRecord:null;}
  async entity(id:string){return await this.db.select().from(tables.entityRegistry).where(eq(tables.entityRegistry.id,id)).get()??null;}
  async aliases(entityId:string){return this.db.select().from(tables.identityAliases).where(eq(tables.identityAliases.entityId,entityId));}
  async assignIdentity(request:IdentityRequest):Promise<string>{
    const sourceKeys=[...new Set(request.sourceKeys.map(k=>k.trim()).filter(Boolean))];
    if(!sourceKeys.length||sourceKeys.length>12||sourceKeys.some(k=>k.length>2048)||!request.reason.trim())throw new Error("Identity assignment needs bounded source keys and an explicit reason.");
    const scoped=sourceKeys.map(value=>({key:canonical([request.kind,request.parentId??null,"source",value]),value}));
    for(let attempt=0;attempt<3;attempt++){
      const found=await this.db.select().from(tables.identityAliases).where(inArray(tables.identityAliases.key,scoped.map(k=>k.key)));
      const ids=[...new Set(found.map(a=>a.entityId))];if(ids.length>1)throw new Error("Source keys resolve to different entities; an explicit identity reconciliation is required.");
      const id=ids[0]??request.preferredId??`ew_${crypto.randomUUID().replaceAll("-","").slice(0,24)}`;
      const existing=await this.entity(id);if(existing&&existing.kind!==request.kind)throw new Error("The preferred identity has a different entity kind.");
      const createdAt=new Date().toISOString();
      const missing=scoped.filter(k=>!found.some(a=>a.key===k.key));
      const labelRows=await Promise.all([...new Set(request.labels.filter(Boolean))].slice(0,10).map(async label=>({key:`label:${id}:${await sha256(label)}`,entityId:id,aliasType:"label",value:label,reason:request.reason,createdAt})));
      try{
        await this.db.batch([
          this.db.insert(tables.entityRegistry).values({id,kind:request.kind,canonicalKey:id,createdAt}).onConflictDoNothing(),
          ...chunks(missing,12).map(group=>this.db.insert(tables.identityAliases).values(group.map(k=>({...k,entityId:id,aliasType:"source",reason:request.reason,createdAt})))),
          ...chunks(labelRows,12).map(group=>this.db.insert(tables.identityAliases).values(group).onConflictDoNothing()),
        ]);
        return id;
      }catch(error){if(attempt===2)throw error;}
    }
    throw new Error("Concurrent identity assignment did not settle.");
  }
  /** An operator can attach a renamed URL/domain key; existing identities are never reassigned implicitly. */
  async attachIdentitySourceKey(entityId:string,sourceKey:string,reason:string,parentId?:string):Promise<void>{
    const entity=await this.entity(entityId);if(!entity)throw new Error("Identity not found.");
    if(!reason.trim()||!sourceKey.trim()||sourceKey.length>2048)throw new Error("An identity alias requires a bounded source key and reason.");
    const key=canonical([entity.kind,parentId??null,"source",sourceKey]);
    const prior=await this.db.select().from(tables.identityAliases).where(eq(tables.identityAliases.key,key)).get();
    if(prior&&prior.entityId!==entityId)throw new Error("That source key is already assigned to another entity.");
    await this.db.insert(tables.identityAliases).values({key,entityId,aliasType:"approved_source",value:sourceKey,reason,createdAt:new Date().toISOString()}).onConflictDoNothing();
    const accepted=await this.db.select().from(tables.identityAliases).where(eq(tables.identityAliases.key,key)).get();if(accepted?.entityId!==entityId)throw new Error("A concurrent editor assigned that source key to a different entity.");
  }
  async currentWebRelease(entityId:string):Promise<WebRelease|null>{return await this.db.select().from(tables.webReleases).where(eq(tables.webReleases.entityId,entityId)).orderBy(desc(tables.webReleases.sequence)).get()??null;}
  async releaseForRecord(recordId:string):Promise<WebRelease|null>{return await this.db.select().from(tables.webReleases).where(eq(tables.webReleases.recordId,recordId)).orderBy(desc(tables.webReleases.sequence)).get()??null;}
  async releaseRecord(record:CompanyRecord,digest:string,input:{actor:string;reason?:string;expectedPreviousReleaseId?:string|null}):Promise<{release:WebRelease;replayed:boolean}>{
    if(!input.actor.trim())throw new Error("A web release requires an authenticated actor.");
    const previous=await this.currentWebRelease(record.entityId);
    if(previous?.recordId===record.id&&previous.digest===digest)return {release:previous,replayed:true};
    if(input.expectedPreviousReleaseId!==undefined&&input.expectedPreviousReleaseId!==(previous?.id??null))throw new Error("The public release changed; review the current release before publishing.");
    const release:WebRelease={id:`web_${(await sha256(canonical({recordId:record.id,previous:previous?.id??null,digest}))).slice(0,32)}`,entityId:record.entityId,recordId:record.id,sequence:(previous?.sequence??0)+1,previousReleaseId:previous?.id??null,actor:input.actor,reason:input.reason?.trim()||"Explicit release of the reviewed accepted company revision.",digest,releasedAt:new Date().toISOString()};
    try{await this.db.insert(tables.webReleases).values(release);}catch(error){const raced=await this.currentWebRelease(record.entityId);if(raced?.recordId===record.id&&raced.digest===digest)return {release:raced,replayed:true};throw new Error("A concurrent web release changed the public pointer; review and retry explicitly.",{cause:error});}
    return {release,replayed:false};
  }
  async saveRecord(record:CompanyRecord,options:{preserveRevision?:boolean}={}):Promise<{record:CompanyRecord;replayed:boolean}>{
    const existing=await this.record(record.id);if(existing)return {record:existing,replayed:true};
    const latest=await this.latest(record.slug);record={...record,revision:options.preserveRevision?record.revision:(latest?.revision??0)+1};
    const registry=record.entities.map(e=>({id:e.id,kind:e.kind,canonicalKey:e.id,createdAt:record.createdAt}));
    try{
      await this.db.batch([
        this.db.insert(tables.entityRegistry).values(registry.slice(0,20)).onConflictDoNothing(),
        ...chunks(registry.slice(20),20).map(group=>this.db.insert(tables.entityRegistry).values(group).onConflictDoNothing()),
        this.db.insert(tables.companyRecords).values({id:record.id,entityId:record.entityId,slug:record.slug,revision:record.revision,digest:record.provenance.importDigest,generationId:record.provenance.generationId,body:JSON.stringify(record),acceptedAt:record.acceptedAt}),
        ...chunks(record.claims,12).map(group=>this.db.insert(tables.recordClaims).values(group.map(c=>({id:`${record.id}:${c.id}`,recordId:record.id,claimId:c.id,subjectId:c.subjectId,predicate:c.predicate,state:c.state,body:JSON.stringify(c)})))),
        ...chunks(record.sources,18).map(group=>this.db.insert(tables.recordEvidence).values(group.map(s=>({id:`${record.id}:${s.id}`,recordId:record.id,sourceId:s.id,digest:s.sha256,body:JSON.stringify(s)})))),
      ]);
    }catch(error){const raced=await this.record(record.id);if(raced)return {record:raced,replayed:true};throw error;}
    return {record,replayed:false};
  }
  async putRun(run:Run):Promise<Run>{await this.db.insert(tables.workflowRuns).values({...run,body:JSON.stringify(run.body)}).onConflictDoNothing();return (await this.run(run.id))!;}
  async run(id:string):Promise<Run|null>{const row=await this.db.select().from(tables.workflowRuns).where(eq(tables.workflowRuns.id,id)).get();return row?{...row,body:JSON.parse(row.body)}:null;}
  async runByOperationId(operationId:string):Promise<Run|null>{const row=await this.db.select().from(tables.workflowRuns).where(eq(tables.workflowRuns.operationId,operationId)).get();return row?{...row,body:JSON.parse(row.body)}:null;}
  async activeGeneration():Promise<Run|null>{const row=await this.db.select().from(tables.workflowRuns).where(and(eq(tables.workflowRuns.kind,"schemabrains_generation"),inArray(tables.workflowRuns.state,["submitting","queued","running"]))).orderBy(desc(tables.workflowRuns.createdAt)).get();return row?{...row,body:JSON.parse(row.body)}:null;}
  async updateRun(id:string,patch:Partial<Pick<Run,"state"|"operationId"|"generationId"|"recordId"|"body">>):Promise<void>{const {body,...fields}=patch;await this.db.update(tables.workflowRuns).set({...fields,...(body?{body:JSON.stringify(body)}:{}),updatedAt:new Date().toISOString()}).where(eq(tables.workflowRuns.id,id));}
  async runs():Promise<Run[]>{const rows=await this.db.select().from(tables.workflowRuns).orderBy(desc(tables.workflowRuns.createdAt)).limit(30);return rows.map(r=>({...r,body:JSON.parse(r.body)}));}
  async savePlan(plan:PublicationPlan):Promise<PublicationPlan>{await this.db.insert(tables.publications).values({id:plan.planId,recordId:plan.recordId,entityId:plan.entityId,pageId:plan.pageId,title:plan.title,state:plan.status,body:JSON.stringify(plan),managedDigest:plan.managedDigest,createdAt:plan.createdAt,updatedAt:plan.createdAt}).onConflictDoNothing();return (await this.plan(plan.planId))!;}
  async plan(id:string):Promise<PublicationPlan|null>{const row=await this.db.select().from(tables.publications).where(eq(tables.publications.id,id)).get();return row?{...JSON.parse(row.body),status:row.state,newRevision:row.newRevision??undefined,error:row.error??undefined,receipt:row.receipt?JSON.parse(row.receipt):undefined} as PublicationPlan:null;}
  async transitionPlan(id:string,from:PublicationState[],state:PublicationState,extra:{newRevision?:number;error?:string;receipt?:PublicationPlan['receipt']}={}):Promise<boolean>{const {receipt,...fields}=extra;const changed=await this.db.update(tables.publications).set({state,...fields,...(receipt?{receipt:JSON.stringify(receipt)}:{}),updatedAt:new Date().toISOString()}).where(and(eq(tables.publications.id,id),inArray(tables.publications.state,from))).returning({id:tables.publications.id});return changed.length===1;}
  async latestPublished(pageId:number):Promise<PublicationPlan|null>{const row=await this.db.select().from(tables.publications).where(and(eq(tables.publications.pageId,pageId),inArray(tables.publications.state,["published","noop"]))).orderBy(desc(tables.publications.newRevision),desc(tables.publications.updatedAt),desc(tables.publications.createdAt)).get();return row?this.plan(row.id):null;}
  async publicationList():Promise<Omit<PublicationPlan,"before"|"after"|"wikitext">[]>{const rows=await this.db.select().from(tables.publications).orderBy(desc(tables.publications.createdAt)).limit(30);return rows.map(row=>{const p={...JSON.parse(row.body),status:row.state,newRevision:row.newRevision??undefined,error:row.error??undefined};delete p.before;delete p.after;delete p.wikitext;return p;});}
  async lease(pageId:number,owner:string):Promise<boolean>{const now=Date.now();const rows=await this.db.insert(tables.pageLeases).values({pageId,owner,expiresAt:now+120_000}).onConflictDoUpdate({target:tables.pageLeases.pageId,set:{owner,expiresAt:now+120_000},setWhere:lt(tables.pageLeases.expiresAt,now)}).returning({owner:tables.pageLeases.owner});return rows.length===1;}
  async release(pageId:number,owner:string):Promise<void>{await this.db.delete(tables.pageLeases).where(and(eq(tables.pageLeases.pageId,pageId),eq(tables.pageLeases.owner,owner)));}
}
export type PilotDatabase=Database;
function chunks<T>(values:T[],size:number):T[][]{return Array.from({length:Math.ceil(values.length/size)},(_,i)=>values.slice(i*size,(i+1)*size));}
