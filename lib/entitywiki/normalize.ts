import { SECTION_TITLES } from "./types.ts";
import type { Branch, Claim, CollectedPage, CompanyRecord, Conflict, Entity, Evidence, JsonValue, Offering, OntologyMapping, PilotMappingSupplement, SavedGeneration, Section, SectionKey } from "./types.ts";
import { array, assertOfficialUrl, canonical, object, safeUrl, sha256, text } from "./safety.ts";
import { branchSourceKey, legacyBranchId, legacyChildId, PILOT_ENTITY_ID, publisherKey } from "./identity.ts";
import type { IdentityResolver } from "./identity.ts";

export const MAPPING_VERSION = "maxplaces-registry/2.0.0";
export const PILOT_SLUG = "maxplaces-marketing";
const LEGACY_URL = "https://entitywiki.org/index.php?title=MAXPlaces_Marketing&oldid=1099";
export function jsonldNodes(value: unknown): { node: Record<string, unknown>; path: string }[] {
  const found: { node: Record<string, unknown>; path: string }[] = [];
  const visit = (v: unknown, path: string, depth: number) => {
    if (depth > 35 || found.length >= 4000) return;
    if (Array.isArray(v)) { v.forEach((child, i) => visit(child, `${path}/${i}`, depth + 1)); return; }
    const n = object(v); if (n["@type"]) found.push({ node: n, path });
    for (const [key, child] of Object.entries(n)) if (key !== "@context") visit(child, `${path}/${key}`, depth + 1);
  };
  visit(value, "", 0); return found;
}
function types(n: Record<string, unknown>): string[] { return array(n["@type"]).map(v => text(v).replace(/^https?:\/\/schema.org\//,"")); }
function owns(n: Record<string, unknown>): boolean {
  const name = text(n.name); const url = safeUrl(n.url) ?? safeUrl(n["@id"]);
  return /maxplaces/i.test(name) && !/^maxburst/i.test(name) && (!url || ["maxplaces.com","www.maxplaces.com"].includes(new URL(url).hostname));
}
function propertyString(value: unknown): string { return text(value) || text(object(value).name); }
export interface NormalizeInput { generation?: SavedGeneration; pages: CollectedPage[]; failures?: string[]; acquisition?: string; mappings?: OntologyMapping[]; supplement?: PilotMappingSupplement;identities?:IdentityResolver }

/** Normalizes only documented saved-result schema + explicit first-party observations. */
export async function normalizePilot(input: NormalizeInput): Promise<CompanyRecord> {
  const { generation } = input;
  if (generation) {
    assertOfficialUrl(generation.sourceUrl ?? "");
    if (!generation.generationId || !generation.schema || typeof generation.schema !== "object") throw new Error("An immutable saved SchemaBrains result is required.");
    if (generation.integrity?.receiptVerified === false || generation.integrity?.sidecarsVerified === false) throw new Error("SchemaBrains saved artifact integrity failed; import rejected.");
  }
  for (const page of input.pages) { assertOfficialUrl(page.url); assertOfficialUrl(page.finalUrl); }
  const inputDigest = await sha256(canonical({ mappingVersion: MAPPING_VERSION, generation: generation ?? null, pages: input.pages.map(p => ({ url:p.url, sha256:p.sha256 })).sort((a,b)=>a.url.localeCompare(b.url)), mappings:input.mappings ?? [],supplement:input.supplement??null }));
  const now = new Date().toISOString();
  const entityId = input.identities?await input.identities.resolve({kind:"organization",sourceKeys:["legacy-mediawiki:213","official-domain:maxplaces.com"],labels:["MAXPlaces Marketing"],preferredId:PILOT_ENTITY_ID,reason:"Preserve the accepted MAXPlaces organization identity while assigning persistent source aliases."}):PILOT_ENTITY_ID;
  const sources: Evidence[] = []; const claims: Claim[] = []; const entities: Entity[] = [];
  const services: Offering[] = []; const locations: Branch[] = []; const concepts: OntologyMapping[] = [...input.mappings ?? []]; const conflicts: Conflict[] = [];
  const sourceNodes: { source: Evidence; nodes: ReturnType<typeof jsonldNodes>; text: string }[] = [];
  // Prefer the explicit company-facts page, while retaining all alternative observations.
  const pages = [...input.pages].sort((a,b) => Number(b.url.includes("ai-info")) - Number(a.url.includes("ai-info")));
  for (const p of pages) {
    const source: Evidence = { id: `src_${(await sha256(p.url + p.sha256)).slice(0,24)}`, url:p.url,finalUrl:p.finalUrl,title:p.title,kind:"first_party",retrievedAt:p.retrievedAt,sha256:p.sha256,excerpt:p.text.slice(0,1000),destinations:{public:true,wiki:true,jsonld:true},attribution:"Company-published assertion; not independent verification." };
    sources.push(source); sourceNodes.push({source,nodes:jsonldNodes(p.jsonld),text:p.text});
  }
  if (generation) {
    const source: Evidence = {id:`src_${(await sha256(generation.generationId + canonical(generation.schema))).slice(0,24)}`,url:`https://schemabrains.com/api/v1/generations/${encodeURIComponent(generation.generationId)}`,finalUrl:generation.sourceUrl!,title:`SchemaBrains saved generation ${generation.generationId}`,kind:"schemabrains",retrievedAt:now,sha256:await sha256(canonical(generation.schema)),excerpt:"Derived saved schema. Source facts are checked against the separately collected company pages where available.",destinations:{public:true,wiki:true,jsonld:true},attribution:"SchemaBrains saved generation; receipt integrity does not verify facts."};
    sources.push(source); sourceNodes.push({source,nodes:jsonldNodes(generation.schema),text:""});
  }
  const legacyExcerpt = "127 West 30th Street, 9th Floor #989, New York, NY 10001";
  const legacy: Evidence = {id:"src_legacy_maxplaces_revision_1099",url:LEGACY_URL,finalUrl:LEGACY_URL,title:"MAXPlaces Marketing — immutable wiki revision 1099",kind:"legacy_wiki",retrievedAt:"2026-10-23T00:00:00.000Z",sha256:await sha256(legacyExcerpt),excerpt:legacyExcerpt,locator:"Legacy New York office address; digest covers this excerpt only.",destinations:{public:true,wiki:true,jsonld:false},attribution:"Historical wiki claim, not a current address verification."};
  sources.push(legacy);
  const idFor = async (kind:string,key:string) => `ew_${(await sha256(`${entityId}:${kind}:${key.toLowerCase()}`)).slice(0,24)}`;
  const add = async (subjectId:string,predicate:string,value:JsonValue,section:SectionKey,source:Evidence,locator:string,state:Claim["state"]="supported",reason="Attributed source assertion; not independently verified.") => {
    const id = `cl_${(await sha256(canonical({subjectId,predicate,value,sourceId:source.id}))).slice(0,24)}`;
    const old = claims.find(c=>c.id===id); if (old) return old;
    if(source.kind==="schemabrains"){state="candidate";reason="Derived generation observation retained for comparison; first-party evidence determines selected pilot facts.";}
    const claim:Claim = {id,subjectId,predicate,value,section,sourceIds:[source.id],state,selected:state==="supported",reason,locator}; claims.push(claim); return claim;
  };
  const orgs = sourceNodes.flatMap(s=>s.nodes.filter(({node})=>owns(node) && types(node).some(t=>["Organization","ProfessionalService","LocalBusiness","Corporation"].includes(t))).map(n=>({...n,source:s.source})));
  if (!orgs.some(o=>o.source.kind==="first_party")) throw new Error("No first-party MAXPlaces organization identity was collected; import not accepted.");
  let name = "MAXPlaces Marketing"; let legalName:string|undefined; let description:string|undefined; let website = "https://www.maxplaces.com/";
  const selectedOrgFields = new Set<string>();
  for (const {node,path,source} of orgs) {
    for (const [property,section] of [["name","company_identity"],["legalName","company_identity"],["url","company_identity"],["description","overview"],["telephone","company_identity"],["email","company_identity"],["foundingDate","history"]] as [string,SectionKey][]) {
      const v = property === "url" ? safeUrl(node[property]) : text(node[property]); if (!v) continue;
      if (property === "url") assertOfficialUrl(v);
      const prior = selectedOrgFields.has(property); const c = await add(entityId,property,v,section,source,`${path}/${property}`,prior?"candidate":"supported",prior?"Alternative source wording retained; the selected first-party claim is unchanged.":undefined);
      if (prior) c.selected=false; else { selectedOrgFields.add(property); if(property==="name") name=/,?\s*LLC/i.test(v)?v.replace(/,?\s*LLC/i,""):v; if(property==="legalName")legalName=v; if(property==="description")description=v; if(property==="url")website=v; }
    }
    for (const alias of array(node.alternateName).map(v=>text(v)).filter(Boolean)) await add(entityId,"alternateName",alias,"company_identity",source,`${path}/alternateName`);
    for (const area of array(node.areaServed)) { const areaName=propertyString(area); if(areaName)await add(entityId,"areaServed",areaName,"service_areas",source,`${path}/areaServed`); }
    for (const linked of array(node.sameAs)) {
      const uri=safeUrl(linked); if(!uri)continue;
      const id=await idFor("mapping",uri);
      if(!concepts.some(m=>m.id===id))concepts.push({id,subjectId:entityId,label:new URL(uri).hostname,authority:"publisher",uri,relation:"exact_identity",state:"candidate",sourceIds:[source.id],reason:"Publisher-nominated link. Destination identity has not been independently matched; excluded from sameAs exports."});
      await add(entityId,"publisherDeclaredProfile",uri,"external_links",source,`${path}/sameAs`,"candidate","Publisher-nominated external profile; destination identity check pending.");
    }
    const allLocations = [...array(node.location),...array(node.address).map(address=>({address}))];
    for (const loc of allLocations) {
      const l=object(loc); const a=object(l.address); const city=text(a.addressLocality); if(!city||!text(a.streetAddress))continue;
      const street=text(a.streetAddress);const addressKey=branchSourceKey(city,street,text(a.addressRegion),propertyString(a.addressCountry));
      const preferred=await legacyBranchId(city,street);const publisher=publisherKey(l["@id"]);
      const branchId=input.identities?await input.identities.resolve({kind:"branch",parentId:entityId,sourceKeys:[addressKey,...publisher?[publisher]:[]],labels:[text(l.name)||city],preferredId:preferred,reason:"Branch identity uses its publisher location key or full street/locality scope, never city alone."}):preferred??await idFor("branch",addressKey);let branch=locations.find(b=>b.id===branchId);
      if(!branch&&source.kind==="schemabrains")continue;
      if(!branch){branch={id:branchId,name:`MAXPlaces — ${city}`,address:{},sourceIds:[],unresolvedFields:[]};locations.push(branch);entities.push({id:branchId,kind:"branch",name:branch.name,parentId:entityId,sourceIds:branch.sourceIds});}
      if(!branch.sourceIds.includes(source.id))branch.sourceIds.push(source.id);
      for(const field of ["streetAddress","addressLocality","addressRegion","postalCode","addressCountry"] as const){
        const value=propertyString(a[field]);if(!value)continue;
        const claim=await add(branchId,field,value,"locations",source,`${path}/location/address/${field}`);
        const existing=branch.address[field];
        if(!existing){branch.address[field]=value;}else if(existing!==value){
          // Common abbreviations are alternative wordings; a postcode disagreement is substantive.
          if(field!=="postalCode"){claim.state="candidate";claim.selected=false;claim.reason="Alternative source wording retained without replacing the selected branch field.";}
        }
      }
      const phone=text(l.telephone);if(phone&&!branch.telephone){branch.telephone=phone;await add(branchId,"telephone",phone,"locations",source,`${path}/location/telephone`);}
    }
    const linkedPeople=[...array(node.employee),...array(node.founder)];
    for(const person of linkedPeople){const p=object(person);const personName=text(p.name);if(!personName)continue;const publisher=publisherKey(p["@id"]);const id=input.identities?await input.identities.resolve({kind:"person",parentId:entityId,sourceKeys:[publisher??`person-label:${personName.toLowerCase()}`],labels:[personName],preferredId:await legacyChildId("person",personName),reason:"Publisher person identity scoped to this company; public aliases are retained separately."}):await idFor("person",personName);if(!entities.some(e=>e.id===id))entities.push({id,kind:"person",name:personName,parentId:entityId,sourceIds:[source.id]});await add(id,"name",personName,"team",source,`${path}/employee/name`);if(text(p.jobTitle))await add(id,"jobTitle",text(p.jobTitle),"team",source,`${path}/employee/jobTitle`);}
  }
  // Offer catalogs only from the matched company, plus first-party explicitly branded service nodes.
  for(const s of sourceNodes){
    const catalogNodes=s.nodes.filter(({node})=>types(node).some(t=>["Service","Product","SoftwareApplication"].includes(t)));
    const companyCatalogs=orgs.filter(o=>o.source.id===s.source.id).flatMap(o=>jsonldNodes(o.node.hasOfferCatalog));
    for(const {node,path} of [...companyCatalogs,...catalogNodes]){
      const nt=types(node);const kind=nt.includes("Service")?"Service":nt.includes("SoftwareApplication")?"SoftwareApplication":nt.includes("Product")?"Product":null;
      const offeringName=text(node.name,180); if(!kind||!offeringName)continue;
      const owner=object(node.provider);const brand=object(node.brand);const publisherNode=object(node.publisher);
      const isCatalog=companyCatalogs.some(c=>c.node===node);const explicit=owns(owner)||owns(brand)||owns(publisherNode)||/maxplaces/i.test(offeringName);
      if(!isCatalog&&!explicit)continue;
      const ownUrl=safeUrl(node.url);if(ownUrl&&!['maxplaces.com','www.maxplaces.com'].includes(new URL(ownUrl).hostname))continue;
      const publisher=publisherKey(node["@id"]);const urlKey=publisherKey(ownUrl);const labelKey=`offering-label:${offeringName.toLowerCase()}`;
      const id=input.identities?await input.identities.resolve({kind:kind==="Service"?"service":"product",parentId:entityId,sourceKeys:[...publisher?[publisher]:[],...urlKey?[`offering-url:${urlKey}`]:[],...!publisher&&!urlKey?[labelKey]:[]],labels:[offeringName],preferredId:await legacyChildId(kind,offeringName),reason:"Publisher offering keys retain identity across display-name and domain changes; the pilot ID is preserved at bootstrap."}):await idFor(kind,offeringName);let offering=services.find(o=>o.id===id);
      if(!offering&&s.source.kind==="schemabrains")continue;
      if(!offering){offering={id,name:offeringName,kind,url:ownUrl,description:text(node.description)||undefined,sourceIds:[],additionalType:[]};services.push(offering);entities.push({id,kind:kind==="Service"?"service":"product",name:offeringName,parentId:entityId,sourceIds:offering.sourceIds});}
      if(!offering.sourceIds.includes(s.source.id))offering.sourceIds.push(s.source.id);
      await add(id,"name",offeringName,kind==="Service"?"services":"products",s.source,`${path}/name`);
      if(ownUrl)await add(id,"url",ownUrl,kind==="Service"?"services":"products",s.source,`${path}/url`);
      // Imported generated additionalType remains a candidate until authority and semantic validation.
      for(const uri of array(node.additionalType).map(safeUrl).filter(Boolean) as string[]){if(!concepts.some(m=>m.subjectId===id&&m.uri===uri))concepts.push({id:await idFor("concept",`${id}:${uri}`),subjectId:id,label:offeringName,authority:uri.includes("productontology.org")?"product_ontology":"wikidata",uri,relation:"offering_type",state:"candidate",sourceIds:[s.source.id],reason:"Imported mapping candidate; independent authority and offering-fit validation required."});}
    }
    // Extract a named methodology only from typed source entities, never page instructions.
    for(const {node,path} of s.nodes){const n=text(node.name);if(/S\.?T\.?A\.?R\.?/i.test(n)&&/framework|methodology|S\.T\.A\.R\./i.test(n)){await add(entityId,"framework",n,"framework",s.source,`${path}/name`);if(text(node.description))await add(entityId,"frameworkDescription",text(node.description),"framework",s.source,`${path}/description`);}}
  }
  const nyc=locations.find(b=>/^new york$/i.test(b.address.addressLocality??""));
  if(nyc){
    await add(nyc.id,"postalCode","10001","locations",legacy,"Legacy New York office postalCode","conflicted","Legacy postal assertion retained for comparison.");
    const candidates=claims.filter(c=>c.subjectId===nyc.id&&c.predicate==="postalCode");const values=[...new Set(candidates.map(c=>String(c.value)))];
    if(values.length>1){for(const c of candidates){c.state="conflicted";c.selected=false;c.reason="Legacy 10001 versus current first-party 10017 remains unresolved; neither is selected.";}delete nyc.address.postalCode;nyc.unresolvedFields.push("postalCode");conflicts.push({id:await idFor("conflict","nyc-postalCode"),subjectId:nyc.id,predicate:"postalCode",claimIds:candidates.map(c=>c.id),values,state:"open",reason:"The historical wiki and current owner pages disagree. Postal code is withheld while other supported address fields remain usable."});}
  }
  const supplement=input.supplement;
  if(supplement){
    if(supplement.version!=="maxplaces-evidence-mappings/1.0.0"||!/^[a-f0-9]{64}$/.test(supplement.sourceManifestSha256))throw new Error("Unsupported pilot mapping evidence manifest.");
    for(const m of supplement.ontology){
      const offering=services.find(s=>s.name===m.offeringName);if(!offering)continue;
      assertOfficialUrl(m.sourceUrl);
      if(!m.authorityClassDeclared||m.uri!==`http://www.productontology.org/id/${m.wikipediaTitle}`||!/^https?:\/\/www\.productontology\.org\/doc\/[A-Za-z0-9_%().,-]+\.ttl$/.test(m.authorityUrl)||!/^[a-f0-9]{64}$/.test(m.authoritySha256)||!/^[a-f0-9]{64}$/.test(m.firstPartySha256))throw new Error("An ontology mapping lacks canonical class and evidence checks.");
      const source:Evidence={id:await idFor("authority",m.uri),url:m.authorityUrl,finalUrl:m.authorityUrl,title:`Product Ontology — ${m.wikipediaTitle}`,kind:"authority",retrievedAt:m.checkedAt,sha256:m.authoritySha256,excerpt:m.excerpt,destinations:{public:true,wiki:true,jsonld:true},attribution:"Exact class availability and contextual mapping were assessed separately."};
      if(!sources.some(s=>s.id===source.id))sources.push(source);
      const firstParty:Evidence={id:await idFor("mapping-source",m.sourceUrl+m.firstPartySha256),url:m.sourceUrl,finalUrl:m.sourceUrl,title:`MAXPlaces offering definition — ${m.offeringName}`,kind:"first_party",retrievedAt:m.checkedAt,sha256:m.firstPartySha256,excerpt:m.excerpt,destinations:{public:true,wiki:true,jsonld:true},attribution:"Company offering source; original pilot mapping assessment is identified in the excerpt."};
      if(!sources.some(s=>s.id===firstParty.id))sources.push(firstParty);
      const mapping:OntologyMapping={id:await idFor("accepted-mapping",offering.id+m.uri),subjectId:offering.id,label:m.wikipediaTitle.replaceAll("_"," "),authority:"product_ontology",uri:m.uri,relation:"offering_type",state:"accepted",sourceIds:[source.id,firstParty.id],reason:m.reason,checkedAt:m.checkedAt,wikipediaTitle:m.wikipediaTitle};
      concepts.push(mapping);await add(offering.id,"additionalType",m.uri,"ontology",source,"RDF owl:Class declaration");
    }
  }
  for(const mapping of concepts.filter(m=>m.state==="accepted"&&m.relation==="offering_type"&&m.authority==="product_ontology")){
    const offering=services.find(o=>o.id===mapping.subjectId);if(offering)offering.additionalType.push(mapping.uri);
  }
  entities.unshift({id:entityId,kind:"organization",name,parentId:undefined,sourceIds:orgs.map(o=>o.source.id).filter((id,i,a)=>a.indexOf(id)===i)});
  const sections={} as Record<SectionKey,Section>;
  for(const [key,title]of Object.entries(SECTION_TITLES) as [SectionKey,string][]){
    const sectionClaims=claims.filter(c=>c.section===key);const supported=sectionClaims.filter(c=>c.selected&&c.state==="supported");
    const status=sectionClaims.some(c=>c.state==="conflicted")?"conflicted":supported.length?"sourced":"needs_research";
    sections[key]={key,title,status,reason:status==="sourced"?"Attributed source claims are recorded; factual verification is separate.":status==="conflicted"?"Conflicting values are retained and withheld individually.":"No supported publishable claim was collected for this section.",content:supported.map(c=>`${c.predicate}: ${typeof c.value==='string'?c.value:canonical(c.value)}`).filter((v,i,a)=>a.indexOf(v)===i).join("\n"),claimIds:sectionClaims.map(c=>c.id),...(status!=="sourced"?{nextAction:"Collect a permitted authoritative or company-owned source for the missing claim."}:{})};
  }
  sections.overview.content=description?`The company describes itself as follows: ${description}`:sections.overview.content;
  sections.company_identity.content=[name,legalName,website].filter(Boolean).join("\n");
  sections.locations.content=locations.map(b=>`${b.name}: ${Object.values(b.address).join(", ")}${b.unresolvedFields.length?". Postal code withheld: source conflict.":""}`).join("\n");
  sections.services.content=services.filter(s=>s.kind==="Service").map(s=>s.name).join("\n");
  sections.products.content=services.filter(s=>s.kind!=="Service").map(s=>s.name).join("\n");
  sections.gallery={...sections.gallery,status:"withheld",reason:"Source imagery has not been cleared for republication.",content:"Media remains withheld pending rights and caption review.",nextAction:"Obtain publication permission for specific assets."};
  sections.history={...sections.history,status:"needs_research",reason:"A publisher-declared founding date does not constitute a researched company history.",nextAction:"Collect dated company-history or registry evidence."};
  sections.google_business_profile={...sections.google_business_profile,status:"needs_research",reason:"No authenticated merchant listing/category read or independently matched Place ID is available.",content:"Branches are mapped separately. Marketing agency is a proposed category label; no category identifier or listing match is asserted.",nextAction:"Read authorized GBP locations/categories and match name, domain, phone and address per branch."};
  const acceptedConcepts=concepts.filter(m=>m.state==="accepted"&&m.authority!=="publisher");
  sections.ontology={...sections.ontology,status:acceptedConcepts.length?"sourced":"needs_research",reason:acceptedConcepts.length?"Offering-class mappings passed canonical authority and contextual-fit checks; company identity remains distinct.":"Ontology candidates await authority and contextual-fit validation.",content:acceptedConcepts.map(m=>`${m.label}: ${m.uri} (${m.relation})`).join("\n")};
  sections.external_links.reason="Publisher-nominated profiles are retained as candidates and are excluded from company sameAs until identity matching.";
  sections.external_links.content=`${concepts.filter(m=>m.authority==="publisher").length} publisher-nominated external profiles await independent destination matching.`;
  sections.sources={...sections.sources,status:"sourced",reason:"Immutable import provenance and collection limitations are recorded.",content:`${sources.length} source artifacts. ${generation?`SchemaBrains saved generation: ${generation.generationId}.`:"A SchemaBrains saved generation has not been imported."} Original wiki revision: 1099.`};
  const google:CompanyRecord['google']=locations.map(b=>({branchId:b.id,state:"unresolved",name:b.name,placeId:null,gbpLocationResource:null,mapsCid:null,knowledgeGraphMid:null,primaryCategoryId:null,additionalCategoryIds:[],placesTypes:[],proposedCategories:[{label:"Marketing agency",state:"proposed",reason:"Service-catalogue-based suggestion only; not the selected GBP category."}],sourceIds:b.sourceIds,reason:"Branch identity exists; Google listing and category identifiers need authorized independent reconciliation."}));
  for(const m of supplement?.google??[]){const branch=locations.find(b=>b.address.addressLocality===m.branchLocality);const target=google.find(g=>g.branchId===branch?.id);if(!branch||!target)continue;assertOfficialUrl(m.sourceUrl);if(!/^ChI[A-Za-z0-9_-]{15,100}$/.test(m.placeId))throw new Error("Invalid Google Place ID evidence.");const map=safeUrl(m.mapsUrl);if(!map||new URL(map).hostname!=="www.google.com"||new URL(map).searchParams.get("query_place_id")!==m.placeId)throw new Error("Google map link does not bind the independently matched Place ID.");const source:Evidence={id:await idFor("google-decision",m.placeId),url:m.sourceUrl,finalUrl:m.sourceUrl,title:`Branch identity comparison — ${m.branchLocality}`,kind:"google_observation",retrievedAt:m.checkedAt,sha256:await sha256(canonical({placeId:m.placeId,reason:m.reason})),excerpt:m.excerpt,destinations:{public:true,wiki:true,jsonld:true},attribution:"Only the durable Place ID and comparison decision were retained. Address and contacts originate from company sources."};sources.push(source);Object.assign(target,{state:"verified",placeId:m.placeId,mapsUrl:map,reason:m.reason,sourceIds:[...branch.sourceIds,source.id],proposedCategories:(m.proposedCategories??[]).map(c=>({label:c.label,state:"proposed",reason:c.rationale}))});const claim=await add(branch.id,"googlePlaceId",m.placeId,"google_business_profile",source,"Independently matched branch Place ID");sections.google_business_profile.claimIds.push(claim.id);}
  if(google.some(g=>g.state==="verified")){sections.google_business_profile.status="sourced";sections.google_business_profile.reason="Branch Place IDs are independently matched. Selected GBP categories remain unobserved and proposals remain separate.";sections.google_business_profile.content=google.map(g=>`${g.name}: ${g.placeId??"unresolved"}; selected category ID: not observed.`).join("\n");}
  const limitations=["14/14 assessed is section coverage, not 100% factual verification.","Only four targeted first-party pages are collected; this is not a whole-site crawl.","No GBP API content, reviews, ratings or merchant writes are imported.","Coordinates and conflicted New York postal code are withheld.","Company source assertions and SchemaBrains output are distinct from independent verification.",...input.failures??[],...generation?.limitations??[]];
  if(!generation)limitations.push("SchemaBrains saved-generation import is pending; current record is a first-party evidence bootstrap.");
  if(generation&&generation.integrity.receiptVerified!==true)limitations.push("Saved generation receipt integrity is not established by the transport DTO.");
  return {contractVersion:"entitywiki.company/1",id:`rev_${inputDigest.slice(0,32)}`,entityId,slug:PILOT_SLUG,revision:1,createdAt:now,acceptedAt:now,status:"accepted",org:{id:entityId,name,legalName,url:website,description},sections,entities,claims,sources,services,locations,concepts,google,conflicts,coverage:{assessedSections:14,sourcedSections:Object.values(sections).filter(s=>s.status==="sourced").length,supportedClaims:claims.filter(c=>c.selected&&c.state==="supported").length,unresolvedConflicts:conflicts.length,verifiedGoogleLocations:google.filter(g=>g.state==="verified").length,acceptedOntologyMappings:acceptedConcepts.length},provenance:{generationId:generation?.generationId??null,sourceUrl:generation?.sourceUrl??website,receiptSha256:generation?.receiptSha256??null,integrity:generation?.integrity??{},limitations,importDigest:inputDigest,mappingVersion:MAPPING_VERSION,acquisition:input.acquisition??"first_party_collection"},wiki:{pageId:213,title:"MAXPlaces Marketing",startingRevision:1099}};
}
