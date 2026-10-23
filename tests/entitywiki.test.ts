import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync,readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/d1";
import * as tables from "../db/schema.ts";
import { normalizePilot } from "../lib/entitywiki/normalize.ts";
import { collectFirstParty, parsePublicHtml } from "../lib/entitywiki/collection.ts";
import { managedRegion, projectGraph, projectJsonLd, projectWiki, publicRecord, replaceManaged } from "../lib/entitywiki/projections.ts";
import { createPilotService } from "../lib/entitywiki/service.ts";
import { EntityWikiRepository } from "../lib/entitywiki/repository.ts";
import { MediaWikiClient } from "../lib/entitywiki/mediawiki.ts";
import { SchemaBrainsClient } from "../lib/entitywiki/schemabrains.ts";
import { canonical, sha256, wikiText } from "../lib/entitywiki/safety.ts";
import { branchSourceKey, entityUri, legacyChildId, PILOT_ENTITY_ID, publisherKey } from "../lib/entitywiki/identity.ts";
import type { CompanyRecord } from "../lib/entitywiki/types.ts";
import type { CollectedPage, SavedGeneration } from "../lib/entitywiki/types.ts";

const company={"@type":"Organization","@id":"https://www.maxplaces.com/#organization",name:"MAXPlaces Marketing",legalName:"MAXPlaces Marketing, LLC",url:"https://www.maxplaces.com/",description:"A digital marketing agency.",foundingDate:"2014",telephone:"855-629-6584",location:[{"@type":"Place",name:"Farmingdale",address:{streetAddress:"399 Conklin Street, Suite 305",addressLocality:"Farmingdale",addressRegion:"NY",postalCode:"11735",addressCountry:"US"}},{"@type":"Place",name:"New York",address:{streetAddress:"127 West 30th Street, 9th Floor #989",addressLocality:"New York",addressRegion:"NY",postalCode:"10017",addressCountry:"US"}}],hasOfferCatalog:{"@type":"OfferCatalog",itemListElement:[{"@type":"Service",name:"Technical SEO & AI Crawl Readiness",url:"https://www.maxplaces.com/services/search-engine-optimization/"},{"@type":"Service",name:"Paid Search & PPC",url:"https://www.maxplaces.com/services/search-engine-marketing/"}]},sameAs:["https://en.wikipedia.org/wiki/Search_engine_optimization","https://www.linkedin.com/company/maxplaces-marketing-llc/"]};
const generation:SavedGeneration={generationId:"real-fixture-generation-1",sourceUrl:"https://www.maxplaces.com/",createdAt:"2026-10-23T15:00:00Z",revision:1,rootId:"root",receiptStatus:"browser-export-no-receipt",schema:{"@context":"https://schema.org","@graph":[company,{"@type":"Service",name:"Unfounded fabricated service",provider:company}]},receiptSha256:null,integrity:{receiptVerified:null,sidecarsVerified:null,glossaryHTMLVerified:null}};
async function pages():Promise<CollectedPage[]>{return [{url:"https://www.maxplaces.com/ai-info/",finalUrl:"https://www.maxplaces.com/ai-info/",title:"MAXPlaces official facts",text:"MAXPlaces Marketing provides digital marketing services.",jsonld:[{"@context":"https://schema.org","@graph":[structuredClone(company)]}],sha256:await sha256(JSON.stringify(company)),retrievedAt:"2026-10-23T16:00:00Z"}];}

/** Real SQLite runs the generated SQL and actual Drizzle D1 driver; this adapter only models D1 transport. */
function testDatabase(){
  const sqlite=new DatabaseSync(":memory:");for(const file of readdirSync(new URL("../drizzle/",import.meta.url)).filter(f=>f.endsWith(".sql")).sort())sqlite.exec(readFileSync(new URL(`../drizzle/${file}`,import.meta.url),"utf8"));
  sqlite.exec("PRAGMA foreign_keys=ON");
  const client={prepare(query:string){
    const values:unknown[]=[];const statement={bind(...args:unknown[]){if(args.length>100)throw new Error("D1 maximum bound parameters exceeded");values.splice(0,values.length,...args);return statement;},async all(){const stmt=sqlite.prepare(query);return {results:stmt.all(...values as never[]),success:true,meta:{}};},async raw(){const stmt=sqlite.prepare(query);stmt.setReturnArrays(true);return stmt.all(...values as never[]);},async run(){const stmt=sqlite.prepare(query);const result=stmt.run(...values as never[]);return {results:[],success:true,meta:{changes:Number(result.changes)}};}};return statement;
  },async batch(statements:{all:()=>Promise<unknown>}[]){sqlite.exec("BEGIN");try{const results=[];for(const statement of statements)results.push(await statement.all());sqlite.exec("COMMIT");return results;}catch(error){sqlite.exec("ROLLBACK");throw error;}}};
  return {db:drizzle(client as unknown as D1Database,{schema:tables}),sqlite};
}
function wikiServer(mode:"normal"|"timeout_after_accept"|"timeout_before_accept"|"conflict"="normal"){
  const state={text:"Human introduction and legacy article.\n",revision:1099,edits:0,cookies:[] as string[]};
  const fetcher:typeof fetch=async(input,init={})=>{
    assert.equal(init.redirect,"manual","The Worker transport must reject redirects explicitly, not use unsupported error mode.");
    const url=new URL(String(input));assert.equal(url.hostname,"entitywiki.org");
    const params=init.method==="POST"?new URLSearchParams(init.body as URLSearchParams):url.searchParams;
    if(params.get("action")==="login"){assert.equal(params.get("lgname"),"Pilot@Bot");return Response.json({login:{result:"Success",lgusername:"Pilot"}},{headers:{"set-cookie":"session=valid; Path=/; Secure; HttpOnly"}});}
    if(params.get("meta")==="tokens")return Response.json({query:{tokens:params.get("type")==="login"?{logintoken:"login-token"}:{csrftoken:"csrf-token"}}});
    if(params.get("action")==="edit"){
      state.edits++;assert.equal(params.get("assert"),"user");assert.equal(params.get("assertuser"),"Pilot");assert.equal(params.get("nocreate"),"1");assert.match(new Headers(init.headers).get("cookie")??"",/session=valid/);assert.equal(Number(params.get("baserevid")),state.revision);
      if(mode==="timeout_before_accept")throw new TypeError("Simulated network loss");
      if(mode==="conflict")return Response.json({error:{code:"editconflict"}});
      state.text=params.get("text")!.replace(/[ \t\r\n\u0000\u000b]+$/g,"").replace(/\r\n?/g,"\n");state.revision++;
      if(mode==="timeout_after_accept")throw new TypeError("Response lost after acceptance");
      return Response.json({edit:{result:"Success",newrevid:state.revision}});
    }
    return Response.json({curtimestamp:"2026-10-23T17:00:00Z",query:{pages:[{pageid:213,title:"MAXPlaces Marketing",revisions:[{revid:state.revision,timestamp:"2026-10-23T16:00:00Z",slots:{main:{content:state.text}}}]}]}});
  };
  return {state,fetcher};
}
async function serviceFixture(mode:Parameters<typeof wikiServer>[0]="normal",enabled=true){const {db,sqlite}=testDatabase();const server=wikiServer(mode);const service=createPilotService(db,{wiki:{apiUrl:"https://entitywiki.org/api.php",username:"Pilot@Bot",password:"test-only"},fetch:server.fetcher,collectedPages:await pages(),wikiPublicationEnabled:enabled});const imported=await service.importSavedGenerationPayload(generation,{acquisition:"test_fixture"});return {service,db,sqlite,imported,...server};}

test("all fourteen sections assessed, field-level postal conflict withheld, identities remain scoped",async()=>{
  const record=await normalizePilot({generation,pages:await pages()});assert.equal(Object.keys(record.sections).length,14);assert.equal(record.coverage.assessedSections,14);assert.equal(record.sections.history.status,"needs_research");assert.equal(record.sections.team.status,"needs_research");assert.equal(record.sections.products.status,"needs_research");assert.equal(record.sections.gallery.status,"withheld");assert.equal(record.locations.length,2);
  const nyc=record.locations.find(b=>b.address.addressLocality==="New York")!;assert.equal(nyc.address.postalCode,undefined);assert.ok(nyc.address.streetAddress);assert.equal(record.conflicts.length,1);assert.ok(record.claims.filter(c=>c.subjectId===nyc.id&&c.predicate==="postalCode").every(c=>!c.selected));assert.ok(!record.services.some(s=>s.name.includes("Unfounded")));
  const schema=JSON.stringify(projectJsonLd(record));assert.ok(!schema.includes('"sameAs"'));assert.ok(!schema.includes('"postalCode":"10017"'));assert.ok(!schema.includes('"GeoCircle"'));assert.ok(!schema.includes('"primaryCategoryId"'));assert.equal(record.google.every(g=>g.placeId===null),true);
});
test("source-specific destination restrictions cover profile, graph, wiki and JSON-LD",async()=>{
  const record=await normalizePilot({pages:await pages()});const source=record.sources.find(s=>s.kind==="first_party")!;
  const service=record.services[0];record.sources.push({...source,id:"restricted",excerpt:"private evidence",destinations:{public:false,wiki:false,jsonld:false}});record.claims.push({id:"restricted-claim",subjectId:service.id,predicate:"description",value:"Never publish this secret",section:"services",sourceIds:["restricted"],state:"supported",selected:true,reason:"private"});record.sections.services.content+="\nNever publish this secret";
  for(const exported of [publicRecord(record),projectJsonLd(record),projectGraph(record),projectWiki(record)])assert.ok(!JSON.stringify(exported).includes("Never publish this secret"));
  const conflicted=record.claims.find(c=>c.state==="conflicted")!;conflicted.value="Private conflicting value";conflicted.sourceIds=["restricted"];record.conflicts[0].values.push("Private conflicting value");assert.ok(!JSON.stringify(publicRecord(record)).includes("Private conflicting value"));
});
test("an allowed predicate never authorizes a different restricted aggregate value",async()=>{
  const record=await normalizePilot({pages:await pages()});const source=record.sources.find(s=>s.kind==="first_party")!;
  record.sources.push({...source,id:"restricted",destinations:{public:false,wiki:false,jsonld:false}});
  for(const predicate of ["description","legalName","name","url"]){const claim=record.claims.find(c=>c.subjectId===record.entityId&&c.predicate===predicate)!;record.claims.push({...claim,id:`private-${predicate}`,value:`RESTRICTED_${predicate}`,sourceIds:["restricted"]});}
  record.org.description="RESTRICTED_description";record.org.legalName="RESTRICTED_legalName";record.org.name="RESTRICTED_name";record.org.url="https://restricted.example/";record.entities[0].name="RESTRICTED_name";
  const service=record.services[0];service.name="RESTRICTED_service_name";service.url="https://restricted.example/service";
  const branch=record.locations[0];branch.name="RESTRICTED_branch_name";branch.address.streetAddress="RESTRICTED_street";
  for(const exported of [publicRecord(record),projectJsonLd(record),projectGraph(record),projectWiki(record)]){assert.ok(!JSON.stringify(exported).includes("RESTRICTED_"));assert.ok(!JSON.stringify(exported).includes("restricted.example"));}
  assert.equal(publicRecord(record).org.description,"A digital marketing agency.");
});
test("template and script injection remains inert and managed-region replacement preserves outside text",async()=>{
  const record=await normalizePilot({pages:await pages()});record.org.description="{{Template|admin=1}}<script>alert(1)</script>\n== Injected ==";const c=record.claims.find(c=>c.predicate==="description")!;c.value=record.org.description;
  const wiki=projectWiki(record);assert.ok(!wiki.includes("{{Template|admin"));assert.ok(!wiki.includes("<script>"));assert.match(wiki,/&#123;/);
  const region=managedRegion(record);const old=`Human above\n${region}\nHuman below`;assert.equal(replaceManaged(old,record.entityId,region),old);assert.throws(()=>replaceManaged("legacy",record.entityId,region),/reviewed adoption/);assert.throws(()=>replaceManaged(`${region}\n${region}`,record.entityId,region),/duplicate/);assert.equal(replaceManaged("legacy",record.entityId,region,true).endsWith("\n"),false);
  const parsed=parsePublicHtml('<script>alert("bad")</script><h1>Company facts</h1><script type="application/ld+json">{"@type":"Organization"}</script>');assert.equal(parsed.text,"Company facts");assert.equal(parsed.jsonld.length,1);
});
test("first-party acquisition blocks outside-domain redirects without following them",async()=>{
  const requested:string[]=[];const fetched=await collectFirstParty(async(input)=>{requested.push(String(input));return new Response(null,{status:302,headers:{location:"http://127.0.0.1/private"}});});assert.equal(fetched.pages.length,0);assert.equal(fetched.failures.length,4);assert.equal(requested.length,4);assert.ok(requested.every(url=>url.startsWith("https://www.maxplaces.com/")));
});
test("identical imports and publications are durable no-ops and actual D1 SQL respects parameter limits",async()=>{
  const f=await serviceFixture();const repeat=await f.service.importSavedGenerationPayload(generation);assert.equal(repeat.recordId,f.imported.recordId);assert.equal(repeat.replayed,true);assert.equal(f.sqlite.prepare("select count(*) as count from company_records").get()!.count,1);
  const plan=await f.service.previewPublication(f.imported.recordId);assert.ok(plan.after.startsWith("Human introduction and legacy article.\n"));const receipt=await f.service.publishPublication(plan.planId);assert.equal(receipt.status,"published");assert.equal(receipt.newRevision,1100);assert.equal(receipt.receipt?.channel,"service_bot");await f.service.publishPublication(plan.planId);assert.equal(f.state.edits,1);
  const next=await f.service.previewPublication(f.imported.recordId);assert.equal(next.before,next.after);assert.equal((await f.service.publishPublication(next.planId)).status,"noop");assert.equal(f.state.edits,1);
  const profile=await f.service.getAdminProfile();assert.equal(profile?.record.id,f.imported.recordId);assert.equal(profile?.publication.recordId,f.imported.recordId);assert.ok(JSON.stringify(profile?.jsonld).includes(f.imported.recordId));
});
test("lost edit response after server acceptance reconciles to one receipt and one edit",async()=>{
  const f=await serviceFixture("timeout_after_accept");const plan=await f.service.previewPublication(f.imported.recordId);const receipt=await f.service.publishPublication(plan.planId);assert.equal(receipt.status,"published");assert.equal(receipt.receipt?.reconciled,true);await f.service.publishPublication(plan.planId);assert.equal(f.state.edits,1);
});
test("ambiguous response without a matching readback never blindly retries",async()=>{
  const f=await serviceFixture("timeout_before_accept");const plan=await f.service.previewPublication(f.imported.recordId);await assert.rejects(f.service.publishPublication(plan.planId),/reconciliation/);await assert.rejects(f.service.publishPublication(plan.planId),/manual revision-history/);assert.equal(f.state.edits,1);assert.equal((await new EntityWikiRepository(f.db).plan(plan.planId))?.status,"reconcile");
});
test("human edit after preview and human edit inside managed region are preserved",async()=>{
  const f=await serviceFixture();const plan=await f.service.previewPublication(f.imported.recordId);f.state.text+="Human new sentence";f.state.revision++;await assert.rejects(f.service.publishPublication(plan.planId),/changed after preview/);assert.equal(f.state.edits,0);assert.ok(f.state.text.endsWith("Human new sentence"));
  const clean=await serviceFixture();const p=await clean.service.previewPublication(clean.imported.recordId);await clean.service.publishPublication(p.planId);clean.state.text=clean.state.text.replace("Organization","Human protected Organization");clean.state.revision++;await assert.rejects(clean.service.previewPublication(clean.imported.recordId),/human changed the managed region/);assert.equal(clean.state.edits,1);
});
test("server-reported edit conflict stops without writing a success receipt",async()=>{
  const f=await serviceFixture("conflict");const plan=await f.service.previewPublication(f.imported.recordId);await assert.rejects(f.service.publishPublication(plan.planId),/editconflict/);assert.equal((await new EntityWikiRepository(f.db).plan(plan.planId))?.status,"conflict");assert.equal(f.state.revision,1099);
});
test("supervised readback needs exact live content; unattended writing stays gated",async()=>{
  const f=await serviceFixture("normal",false);const plan=await f.service.previewPublication(f.imported.recordId);await assert.rejects(f.service.publishPublication(plan.planId),/disabled/);await assert.rejects(f.service.recordExternalPublication(plan.planId),/does not match/);f.state.text=plan.after;f.state.revision++;const receipt=await f.service.recordExternalPublication(plan.planId);assert.equal(receipt.receipt?.channel,"supervised_browser");assert.equal(receipt.status,"published");assert.equal(f.state.edits,0);
});
test("canonical ontology classes and verified branch Place IDs are exported without fabricated merchant categories",async()=>{
  const f=await serviceFixture();const p=(await f.service.getAdminProfile())!;assert.equal(p.record.coverage.verifiedGoogleLocations,2);assert.equal(p.record.google.every(g=>g.primaryCategoryId===null),true);assert.equal(p.record.google.every(g=>g.proposedCategories.every(c=>c.state==="proposed")),true);assert.equal(p.record.coverage.acceptedOntologyMappings,2);
  const json=JSON.stringify(p.jsonld);assert.match(json,/http:\/\/www.productontology.org\/id\/Search_engine_optimization/);assert.ok(!json.includes("productontology.org/doc/"));assert.ok(!json.includes('"sameAs"'));assert.ok(json.includes("Google Place ID"));
});
test("failed receipt integrity, wrong company source and design-only bundles cannot be imported",async()=>{
  await assert.rejects(normalizePilot({generation:{...generation,integrity:{...generation.integrity,receiptVerified:false}},pages:await pages()}),/integrity failed/);await assert.rejects(normalizePilot({generation:{...generation,sourceUrl:"https://unrelated.example/"},pages:await pages()}),/official MAXPlaces/);
  const f=await serviceFixture();await assert.rejects(f.service.importSavedGenerationPayload({publicationAllowed:false,schema:company}),/documented immutable/);
});
test("lost SchemaBrains submission response recovers the same durable idempotency key",async()=>{
  const {db}=testDatabase();const submitted:string[]=[];const upstreamJobs=new Map<string,string>();let drop=true;
  const fetcher:typeof fetch=async(input,init={})=>{
    assert.equal(init.redirect,"manual");
    assert.equal(new Headers(init.headers).get("x-api-key"),"test-only-service-key");const url=new URL(String(input));
    if(url.pathname.endsWith("capabilities"))return Response.json({operations:["generate","results:read"]});
    const key=new Headers(init.headers).get("Idempotency-Key")!;submitted.push(key);if(!upstreamJobs.has(key))upstreamJobs.set(key,"operation-1");
    if(drop){drop=false;throw new TypeError("Lost response");}
    return Response.json({requestId:upstreamJobs.get(key),generationId:null,state:"running"});
  };
  const service=createPilotService(db,{schemaBrains:{apiKey:"test-only-service-key"},wiki:{apiUrl:"https://entitywiki.org/api.php"},fetch:fetcher});
  await assert.rejects(service.startGeneration(),/persisted operation/);const recovered=await service.startGeneration();assert.equal(recovered.requestId,"operation-1");assert.equal(submitted.length,2);assert.equal(submitted[0],submitted[1]);assert.equal(upstreamJobs.size,1);await service.startGeneration();assert.equal(submitted.length,2);
  assert.ok(!JSON.stringify(await service.getOperations()).includes("test-only-service-key"));
});
test("managed rollback uses the latest revision and preserves newer outside human edits",async()=>{
  const f=await serviceFixture();const first=await f.service.previewPublication(f.imported.recordId);await f.service.publishPublication(first.planId);
  const secondImport=await f.service.importSavedGenerationPayload({...generation,generationId:"real-fixture-generation-2"});const second=await f.service.previewPublication(secondImport.recordId);await f.service.publishPublication(second.planId);
  f.state.text=`Newer human introduction\n${f.state.text}\nNewer human afterword`;f.state.revision++;
  const rollback=await f.service.previewRollbackPublished(second.planId);assert.equal(rollback.expectedRevision,f.state.revision);assert.ok(rollback.after.startsWith("Newer human introduction\n"));assert.ok(rollback.after.endsWith("Newer human afterword"));assert.ok(rollback.after.includes(f.imported.recordId));assert.ok(!rollback.after.includes(secondImport.recordId));
  f.state.text=f.state.text.replace("Organization","Human inside region");f.state.revision++;await assert.rejects(f.service.previewRollbackPublished(second.planId),/managed region changed/);
});
test("outgoing wikitext survives MediaWiki trailing-whitespace and signature pre-save transforms",async()=>{
  const f=await serviceFixture();const plan=await f.service.previewPublication(f.imported.recordId);
  assert.equal(plan.after.endsWith("\n"),false);assert.equal(plan.after.replace(/[ \t\r\n\u0000\u000b]+$/g,""),plan.after);
  assert.equal(wikiText("Published statement\r\n~~~~"),"Published statement\n&#126;&#126;&#126;&#126;");
  // The mock server performs real MediaWiki's whitespace/line-ending transforms.
  const receipt=await f.service.publishPublication(plan.planId);assert.equal(receipt.receipt?.readbackDigest,plan.afterDigest);
});
test("server credentials never follow a redirect in either Worker client",async()=>{
  const requested:string[]=[];const redirected:typeof fetch=async(input,init)=>{assert.equal(init?.redirect,"manual");requested.push(String(input));return new Response(null,{status:302,headers:{location:"https://attacker.example/collect"}});};
  const wiki=new MediaWikiClient({apiUrl:"https://entitywiki.org/api.php"},redirected);await assert.rejects(wiki.readPage(),/unexpected_redirect/);
  const brains=new SchemaBrainsClient({apiKey:"test-only-service-key"},redirected);await assert.rejects(brains.capabilities(),/credentials were not forwarded/);
  assert.equal(requested.length,2);assert.ok(requested.every(url=>!url.includes("attacker.example")));
});
test("persistent identities retain pilot IDs, renamed source aliases and domain changes without city collisions",async()=>{
  const {db}=testDatabase();const repo=new EntityWikiRepository(db);
  const org=await repo.assignIdentity({kind:"organization",sourceKeys:["official-domain:maxplaces.com"],labels:["MAXPlaces Marketing"],preferredId:PILOT_ENTITY_ID,reason:"Preserve pilot identity"});assert.equal(org,PILOT_ENTITY_ID);
  const sourceKey=publisherKey("https://www.maxplaces.com/services/search-engine-optimization/")!;const preferred=await legacyChildId("Service","Technical SEO & AI Crawl Readiness");
  const original=await repo.assignIdentity({kind:"service",parentId:org,sourceKeys:[sourceKey],labels:["Technical SEO & AI Crawl Readiness"],preferredId:preferred,reason:"Initial source assignment"});
  const renamed=await repo.assignIdentity({kind:"service",parentId:org,sourceKeys:[publisherKey("https://new-company-domain.example/services/search-engine-optimization/")!],labels:["Renamed SEO service"],reason:"Same publisher offering identity after rename"});assert.equal(original,preferred);assert.equal(renamed,original);assert.ok((await repo.aliases(original)).some(a=>a.value==="Renamed SEO service"));
  await repo.attachIdentitySourceKey(org,"official-domain:new-company-domain.example","Owner-approved company domain migration");const moved=await repo.assignIdentity({kind:"organization",sourceKeys:["official-domain:new-company-domain.example"],labels:["New display name"],reason:"Read approved domain alias"});assert.equal(moved,org);
  const first=await repo.assignIdentity({kind:"branch",parentId:org,sourceKeys:[branchSourceKey("New York","1 Main Street","NY","US")],labels:["New York"],reason:"One street address"});const second=await repo.assignIdentity({kind:"branch",parentId:org,sourceKeys:[branchSourceKey("New York","2 Main Street","NY","US")],labels:["New York"],reason:"Another street address"});assert.notEqual(first,second);
  await assert.rejects(repo.assignIdentity({kind:"branch",parentId:org,sourceKeys:[branchSourceKey("New York","1 Main Street","NY","US"),branchSourceKey("New York","2 Main Street","NY","US")],labels:[],reason:"Ambiguous source collision"}),/different entities/);
});
test("normalizer creates distinct offices in the same city while preserving both pilot office IDs",async()=>{
  const collected=await pages();const payload=collected[0].jsonld[0] as {"@graph":typeof company[]};payload["@graph"][0].location.push({"@type":"Place",name:"Another Farmingdale office",address:{streetAddress:"400 Main Street",addressLocality:"Farmingdale",addressRegion:"NY",postalCode:"11735",addressCountry:"US"}});
  const record=await normalizePilot({pages:collected});assert.equal(record.locations.length,3);assert.equal(new Set(record.locations.map(b=>b.id)).size,3);assert.equal(record.locations.find(b=>b.address.streetAddress?.startsWith("399"))!.id,await legacyChildId("branch","Farmingdale"));assert.equal(record.locations.find(b=>b.address.addressLocality==="New York")!.id,await legacyChildId("branch","New York"));
});
test("web releases are explicit, independent from MediaWiki, revision-addressable and protected against stale updates",async()=>{
  const f=await serviceFixture();assert.equal(await f.service.getReleasedProfile(),null);assert.equal(await f.service.resolveEntity(PILOT_ENTITY_ID),null);
  const first=await f.service.releaseRecord(f.imported.recordId,{actor:"owner-test-subject",expectedPreviousReleaseId:null});assert.equal(first.release.recordId,f.imported.recordId);assert.equal(f.state.edits,0);const publicFirst=(await f.service.getReleasedProfile())!;assert.equal(publicFirst.record.id,f.imported.recordId);assert.ok(!JSON.stringify(publicFirst.webRelease).includes("owner-test-subject"));
  const graph=publicFirst.jsonld["@graph"] as Record<string,unknown>[];assert.equal(graph[0]["@id"],entityUri(PILOT_ENTITY_ID));assert.equal(graph.find(n=>n["@type"]==="ProfilePage")!.url,"https://entitywiki.org/MAXPlaces_Marketing");assert.ok(!JSON.stringify(publicFirst.jsonld).includes("chatgpt.site"));
  const newer=await f.service.importSavedGenerationPayload({...generation,generationId:"new-unreleased-generation"});assert.notEqual(newer.recordId,f.imported.recordId);assert.equal((await f.service.getAdminProfile())!.record.id,newer.recordId);assert.equal((await f.service.getReleasedProfile())!.record.id,f.imported.recordId);assert.equal(await f.service.getReleasedRevision(newer.recordId),null);assert.equal((await f.service.getReleasedRevision(f.imported.recordId))!.record.id,f.imported.recordId);
  await assert.rejects(f.service.releaseRecord(newer.recordId,{actor:"owner-test-subject",expectedPreviousReleaseId:null}),/public release changed/);const second=await f.service.releaseRecord(newer.recordId,{actor:"owner-test-subject",expectedPreviousReleaseId:first.release.id});assert.equal(second.release.sequence,2);assert.equal((await f.service.getReleasedProfile())!.record.id,newer.recordId);const replay=await f.service.releaseRecord(newer.recordId,{actor:"owner-test-subject",expectedPreviousReleaseId:first.release.id});assert.equal(replay.replayed,true);assert.equal(replay.release.id,second.release.id);assert.equal(f.state.edits,0);
});
test("accepted snapshot restoration preserves immutable bytes, revision numbers and child identities without releasing",async()=>{
  const {db}=testDatabase();const service=createPilotService(db,{wiki:{apiUrl:"https://entitywiki.org/api.php"},fetch:async()=>{throw new Error("Restore must not contact external services");}});
  const record=await normalizePilot({pages:await pages()});record.revision=2;const digest=await sha256(canonical(record));const restored=await service.restoreAcceptedRecord(record,{source:"fixture snapshot",expectedRecordDigest:digest});assert.equal(restored.record.id,record.id);assert.equal(restored.record.revision,2);assert.equal(canonical(restored.record),canonical(record));assert.equal(await service.getReleasedProfile(),null);
  assert.equal((await service.restoreAcceptedRecord(record,{source:"fixture replay",expectedRecordDigest:digest})).replayed,true);await assert.rejects(service.restoreAcceptedRecord({...record,org:{...record.org,name:"Changed bytes"}},{source:"mutated snapshot",expectedRecordDigest:digest}),/snapshot digest/);assert.equal((await service.getRecordRevision(record.id))!.record.revision,2);
});
test("the real MAXPlaces accepted snapshot migrates intact and can release without live wiki or acquisition calls",async()=>{
  const original=JSON.parse(readFileSync(new URL("../data/pilot/accepted-record.json",import.meta.url),"utf8")) as CompanyRecord;
  const {db}=testDatabase();let networkCalls=0;const service=createPilotService(db,{wiki:{apiUrl:"https://entitywiki.org/api.php"},fetch:async()=>{networkCalls++;throw new Error("Migration must be offline");},collectedPages:await pages()});
  const restored=await service.restoreAcceptedRecord(original,{source:"Sanitized accepted production pilot snapshot",expectedRecordDigest:await sha256(canonical(original))});
  assert.equal(restored.recordId,"rev_1457a83ebaa25934ec7241c23ee2b226");assert.equal(restored.record.revision,2);assert.equal(restored.record.entityId,PILOT_ENTITY_ID);assert.equal(canonical(restored.record),canonical(original));assert.deepEqual(restored.record.entities.map(e=>e.id),original.entities.map(e=>e.id));assert.equal(restored.record.coverage.acceptedOntologyMappings,6);assert.equal(restored.record.coverage.verifiedGoogleLocations,2);assert.equal(restored.record.conflicts.length,1);assert.equal(await service.getReleasedProfile(),null);
  const released=await service.releaseRecord(original.id,{actor:"migration-test-operator",expectedPreviousReleaseId:null});assert.equal(released.release.recordId,original.id);assert.equal((await service.resolveEntity(original.entityId))!.canonicalUri,`https://entitywiki.org/id/${original.entityId}`);assert.equal((await service.getReleasedRevision(original.id))!.record.id,original.id);
  const imported=await service.importSavedGenerationPayload({...generation,generationId:"fresh-generation-after-restoration"});assert.equal(imported.record.revision,3);for(const offering of imported.record.services){const previous=original.services.find(s=>s.name===offering.name);if(previous)assert.equal(offering.id,previous.id);}for(const branch of imported.record.locations){const previous=original.locations.find(b=>b.address.addressLocality===branch.address.addressLocality);if(previous)assert.equal(branch.id,previous.id);}
  assert.equal((await service.getReleasedProfile())!.record.id,original.id);assert.equal(networkCalls,0);
});
test("public reads fail closed on projection digest drift and an explicit same-record release can approve a new projection",async()=>{
  const f=await serviceFixture();const first=await f.service.releaseRecord(f.imported.recordId,{actor:"test-owner",expectedPreviousReleaseId:null});const original=(await new EntityWikiRepository(f.db).record(f.imported.recordId))!;
  const tampered=structuredClone(original);tampered.sections.sources.reason="Changed outside the immutable record workflow";f.sqlite.prepare("UPDATE company_records SET body=? WHERE id=?").run(JSON.stringify(tampered),original.id);
  await assert.rejects(f.service.getReleasedProfile(),/approved release digest/);await assert.rejects(f.service.getReleasedRevision(original.id),/approved release digest/);await assert.rejects(f.service.resolveEntity(original.entityId),/approved release digest/);assert.equal((await f.service.getAdminProfile())!.record.sections.sources.reason,tampered.sections.sources.reason);
  f.sqlite.prepare("UPDATE company_records SET body=? WHERE id=?").run(JSON.stringify(original),original.id);
  const repo=new EntityWikiRepository(f.db);const oldCompiler=await repo.releaseRecord(original,"0".repeat(64),{actor:"previous-compiler-fixture",expectedPreviousReleaseId:first.release.id});await assert.rejects(f.service.getReleasedProfile(),/approved release digest/);
  assert.equal(((await f.service.getAdminProfile())!.webRelease as unknown as {projectionCurrent:boolean}).projectionCurrent,false);
  const reviewed=await f.service.releaseRecord(original.id,{actor:"test-owner",expectedPreviousReleaseId:oldCompiler.release.id,reason:"Reviewed the current projection compiler output"});assert.equal(reviewed.replayed,false);assert.equal(reviewed.release.sequence,3);assert.equal(reviewed.release.recordId,original.id);assert.equal((await f.service.getReleasedProfile())!.record.id,original.id);
});
test("different publisher offerings with the same label keep distinct identities and replay their own source keys",async()=>{
  const collected=await pages();const payload=collected[0].jsonld[0] as {"@graph":typeof company[]};
  payload["@graph"][0].hasOfferCatalog.itemListElement=[
    {"@type":"Service",name:"Same name service",url:"https://www.maxplaces.com/services/first-offering/"},
    {"@type":"Service",name:"Same name service",url:"https://www.maxplaces.com/services/second-offering/"},
  ];
  const offline=await normalizePilot({pages:collected});assert.equal(offline.services.length,2);assert.notEqual(offline.services[0].id,offline.services[1].id);
  const {db}=testDatabase();const repo=new EntityWikiRepository(db);const identities={resolve:repo.assignIdentity.bind(repo)};
  const first=await normalizePilot({pages:collected,identities});assert.equal(first.services.length,2);assert.notEqual(first.services[0].id,first.services[1].id);
  payload["@graph"][0].hasOfferCatalog.itemListElement.reverse();const repeated=await normalizePilot({pages:collected,identities});
  for(const service of first.services)assert.equal(repeated.services.find(s=>s.url===service.url)!.id,service.id);
});
test("an existing preferred name ID cannot merge unrelated publisher sources",async()=>{
  const {db}=testDatabase();const repo=new EntityWikiRepository(db);const preferredId=await legacyChildId("Service","Same name");
  const first=await repo.assignIdentity({kind:"service",sourceKeys:["publisher:/one"],labels:["Same name"],preferredId,reason:"First publisher source"});
  const second=await repo.assignIdentity({kind:"service",sourceKeys:["publisher:/two"],labels:["Same name"],preferredId,reason:"Independent publisher source"});
  assert.equal(first,preferredId);assert.notEqual(second,first);assert.equal((await repo.aliases(first)).some(a=>a.value==="publisher:/two"),false);
});
test("pilot Google matches and historical postal conflicts bind to exact branch identities, never locality order",async()=>{
  const collected=await pages();const payload=collected[0].jsonld[0] as {"@graph":typeof company[]};
  payload["@graph"][0].location.unshift(
    {"@type":"Place",name:"Another Farmingdale office",address:{streetAddress:"400 Main Street",addressLocality:"Farmingdale",addressRegion:"NY",postalCode:"11735",addressCountry:"US"}},
    {"@type":"Place",name:"Another New York office",address:{streetAddress:"2 Broadway",addressLocality:"New York",addressRegion:"NY",postalCode:"10004",addressCountry:"US"}},
  );
  const supplement=JSON.parse(readFileSync(new URL("../data/pilot/mappings.json",import.meta.url),"utf8"));
  const record=await normalizePilot({pages:collected,supplement});
  const otherFarmingdale=record.locations.find(b=>b.address.streetAddress==="400 Main Street")!;
  const otherNyc=record.locations.find(b=>b.address.streetAddress==="2 Broadway")!;
  assert.equal(record.google.find(g=>g.branchId===otherFarmingdale.id)!.placeId,null);
  assert.equal(record.google.find(g=>g.branchId===otherNyc.id)!.placeId,null);
  assert.equal(otherNyc.address.postalCode,"10004");assert.equal(otherNyc.unresolvedFields.length,0);
  assert.equal(record.google.filter(g=>g.state==="verified").length,2);
  assert.equal(record.conflicts.length,1);assert.equal(record.conflicts[0].subjectId,await legacyChildId("branch","New York"));
  for(const mapping of supplement.google)assert.equal(record.google.find(g=>g.branchId===mapping.branchId)!.placeId,mapping.placeId);
});
test("a permitted Place ID cannot expose private Google notes, merchant identifiers or categories",()=>{
  const record=JSON.parse(readFileSync(new URL("../data/pilot/accepted-record.json",import.meta.url),"utf8")) as CompanyRecord;
  record.sources.push({...record.sources[0],id:"restricted-google-proof",excerpt:"PRIVATE_PROOF",destinations:{public:false,wiki:false,jsonld:false}});
  Object.assign(record.google[0],{name:"PRIVATE_BRANCH_LABEL",gbpLocationResource:"accounts/PRIVATE_ACCOUNT/locations/PRIVATE_LOCATION",primaryCategoryId:"PRIVATE_CATEGORY",mapsCid:"PRIVATE_CID",knowledgeGraphMid:"PRIVATE_KG",mapsUrl:"https://private.example/PRIVATE_MAP",reason:"PRIVATE_MAPPING_NOTE",sourceIds:[...record.google[0].sourceIds,"restricted-google-proof"],proposedCategories:[{label:"PRIVATE_PROPOSAL",state:"proposed",reason:"PRIVATE_NOTE"}]});
  for(const destination of ["public","wiki","jsonld"] as const){
    const exported=publicRecord(record,destination);const mapping=exported.google[0];assert.equal(mapping.placeId,record.google[0].placeId);assert.equal(mapping.primaryCategoryId,null);assert.equal(mapping.gbpLocationResource,null);assert.equal(mapping.sourceIds.includes("restricted-google-proof"),false);assert.equal(mapping.proposedCategories.length,0);
    assert.equal(JSON.stringify(exported).includes("PRIVATE_"),false);assert.equal(JSON.stringify(exported).includes("private.example"),false);
  }
  assert.equal(JSON.stringify(projectJsonLd(record)).includes("PRIVATE_"),false);
  assert.equal(projectWiki(record).includes("PRIVATE_"),false);
});
