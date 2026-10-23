import type { Claim, CompanyRecord, Evidence, Graph, PublicationPlan, SectionKey, WikiPage } from "./types.ts";
import { SECTION_TITLES } from "./types.ts";
import { canonical, safeUrl, sha256, wikiLink, wikiText } from "./safety.ts";
import { entityUri, PILOT_DOCUMENT_PATH } from "./identity.ts";
import { buildGoogleMapsUrl } from "../mappings/google.ts";
export type Destination = "public" | "wiki" | "jsonld";
export function allowedClaim(record:CompanyRecord,claim:Claim,destination:Destination):boolean {
  return claim.selected&&claim.state==="supported"&&claim.sourceIds.some(id=>record.sources.some(s=>s.id===id&&s.destinations[destination]));
}
/** Source destination controls apply before every public representation is serialized. */
export function publicRecord(record:CompanyRecord,destination:Destination="public"):CompanyRecord {
  const copy=structuredClone(record);const allowedIds=new Set(record.sources.filter(s=>s.destinations[destination]).map(s=>s.id));
  copy.sources=copy.sources.filter(s=>allowedIds.has(s.id));
  copy.claims=copy.claims.filter(c=>c.sourceIds.some(id=>allowedIds.has(id))).map(c=>({...c,sourceIds:c.sourceIds.filter(id=>allowedIds.has(id))}));
  const supported=(subject:string,predicate:string)=>record.claims.filter(c=>c.subjectId===subject&&c.predicate===predicate&&allowedClaim(record,c,destination));
  const selectedString=(subject:string,predicate:string):string|undefined=>{const value=supported(subject,predicate)[0]?.value;return typeof value==="string"?value:undefined;};
  if(!supported(record.entityId,"name").length||!supported(record.entityId,"url").length)throw new Error("A publishable supported name and official website are required.");
  // Derive each scalar from the actual permitted claim. An unrelated allowed
  // claim for a predicate must never authorize an aggregate's restricted value.
  copy.org.name=selectedString(record.entityId,"name")!;
  copy.org.url=selectedString(record.entityId,"url")!;
  copy.org.description=selectedString(record.entityId,"description");
  copy.org.legalName=selectedString(record.entityId,"legalName");
  copy.services=copy.services.filter(s=>supported(s.id,"name").length).map(s=>({...s,name:selectedString(s.id,"name")!,sourceIds:s.sourceIds.filter(id=>allowedIds.has(id)),url:selectedString(s.id,"url"),description:undefined,additionalType:[]}));
  copy.locations=copy.locations.map(b=>({...b,name:`MAXPlaces — ${selectedString(b.id,"addressLocality")??"location"}`,address:Object.fromEntries(["streetAddress","addressLocality","addressRegion","postalCode","addressCountry"].flatMap(key=>{const value=selectedString(b.id,key);return value?[[key,value]]:[];})),sourceIds:b.sourceIds.filter(id=>allowedIds.has(id)),telephone:selectedString(b.id,"telephone")})).filter(b=>Object.keys(b.address).length>0);
  copy.entities=copy.entities.filter(e=>e.id===copy.entityId||copy.services.some(s=>s.id===e.id)||copy.locations.some(b=>b.id===e.id)||e.kind==="person"&&supported(e.id,"name").length>0).map(e=>({...e,name:copy.locations.find(b=>b.id===e.id)?.name??selectedString(e.id,"name")??"Unresolved entity",sourceIds:e.sourceIds.filter(id=>allowedIds.has(id))}));
  copy.concepts=copy.concepts.filter(m=>m.sourceIds.length>0&&m.sourceIds.every(id=>allowedIds.has(id))).map(m=>({...m,sourceIds:m.sourceIds.filter(id=>allowedIds.has(id))}));
  for(const service of copy.services)service.additionalType=copy.concepts.filter(m=>m.subjectId===service.id&&m.state==="accepted"&&m.authority==="product_ontology"&&m.relation==="offering_type"&&/^http:\/\/www\.productontology\.org\/id\/[A-Za-z0-9_%().,-]+$/.test(m.uri)).map(m=>m.uri);
  copy.google=copy.google.filter(g=>copy.locations.some(b=>b.id===g.branchId)).map(g=>{
    const permitted=supported(g.branchId,"googlePlaceId").filter(c=>c.value===g.placeId);
    const placeId=g.state==="verified"&&permitted.length&&/^ChI[A-Za-z0-9_-]{15,100}$/.test(g.placeId??"")?g.placeId:null;
    const allSourcesPermitted=g.sourceIds.length>0&&g.sourceIds.every(id=>allowedIds.has(id));
    // A Place ID claim grants no permission for merchant resources, categories,
    // private match notes or aggregate fields with separate evidence.
    return {branchId:g.branchId,name:copy.locations.find(b=>b.id===g.branchId)!.name,state:placeId?"verified" as const:"unresolved" as const,placeId,
      gbpLocationResource:null,mapsCid:null,knowledgeGraphMid:null,primaryCategoryId:null,additionalCategoryIds:[],placesTypes:[],
      mapsUrl:placeId?buildGoogleMapsUrl(placeId,copy.org.name):undefined,
      sourceIds:placeId?[...new Set(permitted.flatMap(c=>c.sourceIds).filter(id=>allowedIds.has(id)))]:[],
      proposedCategories:allSourcesPermitted?g.proposedCategories.map(c=>({label:c.label,state:"proposed" as const,reason:"Editorial proposal; selected merchant categories have not been published."})):[],
      reason:placeId?"An independently matched Place ID is permitted for this destination. Selected merchant categories have not been published.":"Google listing identifiers are unresolved or unavailable for this destination."};
  });
  const claimIds=new Set(copy.claims.map(c=>c.id));
  copy.conflicts=copy.conflicts.map(c=>{const ids=c.claimIds.filter(id=>claimIds.has(id));return {...c,claimIds:ids,values:copy.claims.filter(claim=>ids.includes(claim.id)).map(claim=>claim.value)};}).filter(c=>c.claimIds.length>0);
  for(const [key,section]of Object.entries(copy.sections) as [SectionKey,CompanyRecord['sections'][SectionKey]][]){
    section.claimIds=section.claimIds.filter(id=>claimIds.has(id));
    const permitted=copy.claims.filter(c=>c.section===key&&allowedClaim(copy,c,destination));
    if(record.claims.some(c=>c.section===key&&c.selected)&&!permitted.length){section.content="Source material is withheld for this publication destination.";section.status="withheld";section.reason="Source destination restrictions exclude the supported claims.";}
    else if(key!=="overview"&&key!=="company_identity"&&key!=="locations"&&key!=="services"&&key!=="products"&&key!=="ontology"&&key!=="sources"&&permitted.length)section.content=permitted.map(c=>`${c.predicate}: ${typeof c.value==='string'?c.value:canonical(c.value)}`).filter((v,i,a)=>a.indexOf(v)===i).join("\n");
  }
  copy.sections.overview.content=copy.org.description?`The company describes itself as follows: ${copy.org.description}`:"Description is withheld or not collected.";
  copy.sections.company_identity.content=[copy.org.name,copy.org.legalName,copy.org.url].filter(Boolean).join("\n");
  copy.sections.locations.content=copy.locations.map(b=>`${b.name}: ${Object.values(b.address).join(", ")}${b.unresolvedFields.length?". Postal code withheld pending resolution.":""}`).join("\n");
  copy.sections.services.content=copy.services.filter(s=>s.kind==="Service").map(s=>s.name).join("\n");
  copy.sections.products.content=copy.services.filter(s=>s.kind!=="Service").map(s=>s.name).join("\n");
  copy.sections.ontology.content=copy.concepts.filter(m=>m.state==="accepted"&&m.authority!=="publisher").map(m=>`${m.label}: ${m.uri} (${m.relation})`).join("\n");
  copy.sections.sources.content=`Record ${copy.id}; ${copy.sources.length} permitted sources. ${copy.provenance.generationId?`SchemaBrains generation ${copy.provenance.generationId}.`:"SchemaBrains import pending."}`;
  return copy;
}
export function projectJsonLd(record:CompanyRecord):Record<string,unknown> {
  const r=publicRecord(record,"jsonld");const iri=entityUri;
  const org:Record<string,unknown>={"@type":"Organization","@id":iri(r.entityId),name:r.org.name,url:r.org.url};
  if(r.org.legalName)org.legalName=r.org.legalName;if(r.org.description)org.description=r.org.description;
  for(const key of ["telephone","email","foundingDate"]){const c=r.claims.find(c=>c.subjectId===r.entityId&&c.predicate===key&&allowedClaim(r,c,"jsonld"));if(c)org[key]=c.value;}
  const sameAs=r.concepts.filter(m=>m.subjectId===r.entityId&&m.state==="accepted"&&m.relation==="exact_identity").map(m=>m.uri).filter(safeUrl);if(sameAs.length)org.sameAs=sameAs;
  const nodes:Record<string,unknown>[]=[org];
  if(r.locations.length)org.location=r.locations.map(b=>({"@id":iri(b.id)}));
  for(const branch of r.locations){
    const n:Record<string,unknown>={"@type":"Place","@id":iri(branch.id),name:branch.name,address:{"@type":"PostalAddress",...branch.address}};
    if(branch.telephone)n.telephone=branch.telephone;
    const g=r.google.find(g=>g.branchId===branch.id&&g.state==="verified");if(g?.placeId)n.identifier={"@type":"PropertyValue",propertyID:"Google Place ID",value:g.placeId};if(g?.mapsUrl)n.hasMap=g.mapsUrl;
    nodes.push(n);
  }
  for(const service of r.services){const n:Record<string,unknown>={"@type":service.kind,"@id":iri(service.id),name:service.name,provider:{"@id":iri(r.entityId)}};if(service.url)n.url=service.url;if(service.additionalType.length)n.additionalType=service.additionalType;nodes.push(n);}
  if(r.services.length)org.hasOfferCatalog={"@type":"OfferCatalog",name:`${r.org.name} offerings`,itemListElement:r.services.map(s=>({"@type":"Offer",itemOffered:{"@id":iri(s.id)}}))};
  const areas=r.claims.filter(c=>c.subjectId===r.entityId&&c.predicate==="areaServed"&&allowedClaim(r,c,"jsonld")).map(c=>c.value);if(areas.length)org.areaServed=[...new Set(areas)];
  const webpage:Record<string,unknown>={"@type":"ProfilePage","@id":`https://entitywiki.org${PILOT_DOCUMENT_PATH}#profile`,url:`https://entitywiki.org${PILOT_DOCUMENT_PATH}`,mainEntity:{"@id":iri(r.entityId)},dateModified:r.acceptedAt,version:r.id};
  const topics=r.concepts.filter(m=>m.relation==="topic"&&m.state==="accepted").map(m=>({"@id":m.uri,name:m.label}));if(topics.length)webpage.about=topics;nodes.push(webpage);
  return {"@context":"https://schema.org","@graph":nodes};
}
export function projectGraph(record:CompanyRecord):Graph {
  const r=publicRecord(record);const nodes:Graph["nodes"]=r.entities.map(e=>({id:e.id,label:e.name,type:e.kind,sourceIds:e.sourceIds}));const edges:Graph["edges"]=[];
  for(const e of r.entities.filter(e=>e.parentId)){edges.push({id:`edge_${e.id}`,source:e.parentId!,target:e.id,label:e.kind==="branch"?"has location":e.kind==="person"?"has team member":"offers",type:e.kind,claimIds:r.claims.filter(c=>c.subjectId===e.id&&allowedClaim(r,c,"public")).map(c=>c.id)});}
  for(const m of r.concepts.filter(m=>m.authority!=="publisher")){if(!nodes.some(n=>n.id===m.id))nodes.push({id:m.id,label:m.label,type:"concept",sourceIds:m.sourceIds});edges.push({id:`edge_${m.id}`,source:m.subjectId,target:m.id,label:`${m.relation} · ${m.state}`,type:m.relation,claimIds:[]});}
  return {nodes,edges};
}
function sourceLink(s:Evidence,index:number):string { return wikiLink(s.kind==="schemabrains"?s.finalUrl:s.url,`[${index+1}] ${s.title}`); }
export function projectWiki(record:CompanyRecord):string {
  const r=publicRecord(record,"wiki");
  const lines=["{{EntityWiki Company v1",`|record_status=Accepted partial record — ${r.coverage.assessedSections}/14 sections assessed; source assertions are not independent verification`,`|entity_id=${wikiText(r.entityId)}`,`|official_website=${wikiLink(r.org.url,r.org.url)}`,"|schema_type=Organization",`|last_reviewed=${wikiText(r.acceptedAt.slice(0,10))}`];
  for(const key of Object.keys(SECTION_TITLES) as SectionKey[]){const s=r.sections[key];let content=`Status: ${s.status}. ${s.reason}\n${s.content||"No supported public value is available."}`;if(s.nextAction)content+=`\nNext research: ${s.nextAction}`;let encoded=wikiText(content);const ids=new Set(r.claims.filter(c=>s.claimIds.includes(c.id)).flatMap(c=>c.sourceIds));const citations=r.sources.map((source,index)=>({source,index})).filter(({source})=>ids.has(source.id)).map(({source,index})=>sourceLink(source,index));if(citations.length)encoded+=`\nSources: ${citations.join("; ")}`;if(key==="sources")encoded+=`\n${r.sources.map(sourceLink).join("\n")}\n${wikiText(`Accepted record ${r.id}; mapping ${r.provenance.mappingVersion}; generation ${r.provenance.generationId??"pending"}.`)}\n${r.provenance.limitations.map(wikiText).join("\n")}`;lines.push(`|${key}=${encoded}`);}
  lines.push("}}");return lines.join("\n");
}
export function managedRegion(record:CompanyRecord):string {
  return `<!-- ENTITYWIKI:BEGIN ${record.entityId} -->\n<!-- Accepted revision ${record.id}; generated from the EntityWiki record, edit through the review workflow. -->\n${projectWiki(record)}\n<!-- ENTITYWIKI:END ${record.entityId} -->`;
}
export function splitManaged(text:string,entityId:string):{before:string;region:string;after:string}|null {
  const begin=`<!-- ENTITYWIKI:BEGIN ${entityId} -->`;const end=`<!-- ENTITYWIKI:END ${entityId} -->`;
  const start=text.indexOf(begin),finish=text.indexOf(end);
  if(start<0&&finish<0)return null;
  if(start<0||finish<start||text.indexOf(begin,start+1)>=0||text.indexOf(end,finish+1)>=0)throw new Error("Malformed or duplicate managed-region markers; manual reconciliation is required.");
  return {before:text.slice(0,start),region:text.slice(start,finish+end.length),after:text.slice(finish+end.length)};
}
export function replaceManaged(current:string,entityId:string,region:string,adoptLegacy=false):string {
  const split=splitManaged(current,entityId);
  if(split)return split.before+region+split.after;
  if(!adoptLegacy)throw new Error("The first managed-region insertion requires reviewed adoption of the existing page.");
  // MediaWiki PST strips terminal whitespace. Do not add a terminal LF that
  // would change our outgoing digest at save time; keep all preimage bytes.
  return `${current}${current.endsWith("\n")?"":"\n"}\n${region}`;
}
export interface ManagedRollbackPlan {pageId:number;title:string;expectedRevision:number;before:string;after:string;beforeDigest:string;afterDigest:string;rollbackOf:string;restoredManagedDigest:string|null;reason:string}
/** Pure recovery planner: undo only our exact managed bytes, retaining newer editorial text. */
export async function planManagedRollback(current:WikiPage,published:PublicationPlan):Promise<ManagedRollbackPlan>{
  if(!["published","noop"].includes(published.status)||!published.newRevision)throw new Error("A verified publication receipt is required before planning rollback.");
  if(current.pageId!==published.pageId||current.title!==published.title||current.revision<published.newRevision)throw new Error("Rollback page identity or revision is inconsistent with the publication receipt.");
  const owned=splitManaged(current.text,published.entityId);
  if(!owned||await sha256(owned.region)!==published.managedDigest)throw new Error("The managed region changed after publication; rollback requires manual reconciliation.");
  const prior=splitManaged(published.before,published.entityId);const after=owned.before+(prior?.region??"")+owned.after;
  return {pageId:current.pageId,title:current.title,expectedRevision:current.revision,before:current.text,after,beforeDigest:await sha256(current.text),afterDigest:await sha256(after),rollbackOf:published.planId,restoredManagedDigest:prior?await sha256(prior.region):null,reason:"Restore only the previous managed-region preimage using the current revision assertion; retain every newer outside-region human edit."};
}
