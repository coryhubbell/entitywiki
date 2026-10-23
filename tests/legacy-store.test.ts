import { test } from "node:test";
import assert from "node:assert/strict";
import { testDatabase } from "./helpers/d1-database.ts";
import { createLegacyStore } from "../lib/legacy/store.ts";
import type { LegacyDescriptor, LegacyTransferRecord } from "../lib/legacy/contracts.ts";
import { canonicalLegacy, legacyTransferDigest, legacySourceKey, legacyStablePageId, legacySnapshotId } from "../lib/legacy/digest.mjs";
function records():LegacyTransferRecord[]{return [
 {kind:"page",pageId:10,namespace:0,title:"Company 100%",classification:"content_requires_entity_classification",latestCapturedRevisionId:102,observedLatestRevisionId:103,raw:{page:{pageid:10,ns:0,title:"Company 100%"},metadata:[{protection:[{type:"edit",level:"sysop",expiry:"infinity"}]}],captureBoundary:"2026-10-23T18:10:00Z",dependencies:["Template:Example"]}},
 {kind:"page",pageId:20,namespace:2,title:"User:Example",classification:"contributor_profile_private_migration_review",latestCapturedRevisionId:201,observedLatestRevisionId:201,raw:{page:{pageid:20,ns:2,title:"User:Example"},metadata:[{protection:[]}]}},
 {kind:"revision",pageId:10,revisionId:101,raw:{revid:101,parentid:0,user:"Author One",userid:8,timestamp:"2023-01-01T01:00:00Z",comment:"Original",slots:{main:{contentmodel:"wikitext",content:"== Original content =="}}}},
 {kind:"revision",pageId:10,revisionId:102,raw:{revid:102,parentid:101,user:"Author Two",userid:9,timestamp:"2024-01-01T01:00:00Z",comment:"Update",slots:{main:{contentmodel:"wikitext",content:"Original updated text",sha1:"unchanged-metadata"},other:{contentmodel:"json",content:'{"preserved":true}'}}}},
 {kind:"revision",pageId:20,revisionId:201,raw:{revid:201,parentid:0,userhidden:true,commenthidden:true,suppressed:true,slots:{main:{contenthidden:true,contentmodel:"wikitext"}}}},
 {kind:"route",pageId:10,revisionId:null,url:"https://entitywiki.org/Company_100%25",routeKind:"pretty_alias",raw:{pageId:10,url:"https://entitywiki.org/Company_100%25",kind:"pretty_alias",disposition:"retain_exact_url_or_reviewed_equivalent"}},
 {kind:"route",pageId:10,revisionId:101,url:"https://entitywiki.org/index.php?oldid=101",routeKind:"revision_id_alias",raw:{pageId:10,url:"https://entitywiki.org/index.php?oldid=101",kind:"revision_id_alias",revisionId:101}},
 {kind:"route",pageId:20,revisionId:null,url:"https://entitywiki.org/User:Example",routeKind:"pretty_alias",raw:{pageId:20,url:"https://entitywiki.org/User:Example",kind:"pretty_alias"}},
];}
async function descriptor(input=records()):Promise<LegacyDescriptor>{return {format:"entitywiki.legacy-capture/1",sourceOrigin:"https://entitywiki.org",sourceWikiId:"original_database-mw_",archiveManifestSha256:"a".repeat(64),transferDigest:await legacyTransferDigest(input),captureStartedAt:"2026-10-23T18:10:00Z",capturedAt:"2026-10-23T18:20:00Z",expected:{pages:input.filter(x=>x.kind==="page").length,revisions:input.filter(x=>x.kind==="revision").length,routes:input.filter(x=>x.kind==="route").length},namespaces:[{id:0,name:""},{id:2,name:"User",canonical:"User"}],accessPolicy:"operator_only",sourcePermissionScope:"unauthenticated_public_capture_only"};}
async function fixture(input=records()){const {db,sqlite}=testDatabase(),store=createLegacyStore(db),desc=await descriptor(input),receipt=await store.begin(desc);return {db,sqlite,store,desc,id:receipt.snapshotId,input};}

test("all-client archive stays invisible until complete and preserves IDs, authorship, hidden metadata and protection",async()=>{
 const f=await fixture();assert.equal(await f.store.latestReady(),null);await assert.rejects(f.store.listPages(f.id),/not ready/);
 await f.store.ingest(f.id,f.input.slice(0,2));await assert.rejects(f.store.finalize(f.id),/incomplete/);assert.equal((await f.store.snapshot(f.id))?.state,"loading");
 await f.store.ingest(f.id,f.input.slice(2));await f.store.finalize(f.id);assert.equal((await f.store.latestReady())?.snapshotId,f.id);
 const page=await f.store.pageById(f.id,10);assert.ok(page);assert.equal(page.latestCapturedRevisionId,102);assert.equal(page.observedLatestRevisionId,103);assert.deepEqual(page.raw,(f.input[0] as {raw:unknown}).raw);
 const history=await f.store.history(f.id,10);assert.deepEqual(history.map(r=>r.revisionId),[102,101]);assert.equal(history[1].raw.user,"Author One");assert.equal((await f.store.revisionById(f.id,201))?.raw.suppressed,true);
 assert.equal((await f.store.listPages(f.id,{namespace:2}))[0].pageId,20);assert.equal((await f.store.listPages(f.id,{search:"100%"}))[0].pageId,10);assert.equal((await f.store.listPages(f.id,{search:"100_"})).length,0);
 assert.equal((await f.store.pageByTitle(f.id,"Company 100%"))?.stablePageId,page.stablePageId);assert.equal((await f.store.resolveRoute(f.id,"https://entitywiki.org/index.php?oldid=101"))?.revisionId,101);
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM company_records").get()!.n,0);assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM entity_registry").get()!.n,0);assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM web_releases").get()!.n,0);
});

test("replay is idempotent and every captured body and descriptor is immutable",async()=>{
 const f=await fixture();await f.store.ingest(f.id,f.input);await f.store.finalize(f.id);const before=await f.store.stats(f.id);
 assert.equal((await f.store.begin(f.desc)).replayed,true);await f.store.ingest(f.id,f.input);assert.equal((await f.store.finalize(f.id)).replayed,true);assert.deepEqual(await f.store.stats(f.id),before);
 for(const table of ["legacy_pages","legacy_revisions","legacy_routes"]){assert.throws(()=>f.sqlite.exec(`UPDATE ${table} SET body='{}'`),/immutable/);assert.throws(()=>f.sqlite.exec(`DELETE FROM ${table}`),/immutable/);}
 assert.throws(()=>f.sqlite.exec("UPDATE legacy_snapshots SET descriptor='{}'"),/immutable/);assert.throws(()=>f.sqlite.exec("DELETE FROM legacy_snapshots"),/immutable/);
 const changed=structuredClone(f.input[2]);changed.raw.comment="Tampered authorship";await assert.rejects(f.store.ingest(f.id,[changed]),/Conflicting immutable/);
 const next:LegacyTransferRecord={kind:"revision",pageId:10,revisionId:999,raw:{revid:999}};await assert.rejects(f.store.ingest(f.id,[next]),/sealed/);
});

test("a conflicting record rolls back its entire D1 batch rather than keeping earlier inserts",async()=>{
 const f=await fixture();await f.store.ingest(f.id,[f.input[2]]);const bad=structuredClone(f.input[2]);bad.raw.comment="Conflict";
 await assert.rejects(f.store.ingest(f.id,[f.input[0],bad]),/Conflicting immutable/);assert.deepEqual(await f.store.stats(f.id),{pages:0,revisions:1,routes:0});
 const crossPage=structuredClone(f.input[2]);crossPage.pageId=20;await assert.rejects(f.store.ingest(f.id,[crossPage]),/belongs to another source page|Conflicting immutable/);
 const duplicate=structuredClone(f.input[0]);duplicate.raw.metadata=[];await assert.rejects(f.store.ingest(f.id,[f.input[0],duplicate]),/Conflicting duplicate/);
});

test("finalization rejects digest tampering, missing pages, revision association mismatch and wrong latest pointers",async()=>{
 const f=await fixture();const badDesc={...f.desc,transferDigest:"b".repeat(64)};const badId=(await f.store.begin(badDesc)).snapshotId;await f.store.ingest(badId,f.input);await assert.rejects(f.store.finalize(badId),/transfer digest/);assert.equal(await f.store.latestReady(),null);
 for(const variant of ["missing-page","route-revision","latest"]){const input=structuredClone(records());if(variant==="missing-page")input[2].pageId=999;if(variant==="route-revision")input[6].pageId=20;if(variant==="route-revision")input[6].raw.pageId=20;if(variant==="latest"&&input[0].kind==="page")input[0].latestCapturedRevisionId=101;
  const g=await fixture(input);await g.store.ingest(g.id,input);await assert.rejects(g.store.finalize(g.id),/no captured page|belongs to another page|latest captured revision/);assert.equal((await g.store.snapshot(g.id))?.state,"loading");
 }
});

test("source stable IDs survive titles, namespaces and capture changes; distinct pages never merge",async()=>{
 const first=await fixture();await first.store.ingest(first.id,first.input);await first.store.finalize(first.id);const page=await first.store.pageById(first.id,10);
 const input=records();if(input[0].kind!=="page")throw new Error();input[0].title="User:Company renamed";input[0].namespace=2;input[0].raw.page={pageid:10,ns:2,title:input[0].title};if(input[5].kind!=="route")throw new Error();input[5].url="https://entitywiki.org/User:Company_renamed";input[5].raw.url=input[5].url;const desc=await descriptor(input),next=(await first.store.begin(desc)).snapshotId;await first.store.ingest(next,input);await first.store.finalize(next);
 assert.equal((await first.store.pageById(next,10))?.stablePageId,page?.stablePageId);assert.notEqual((await first.store.pageById(next,20))?.stablePageId,page?.stablePageId);
 assert.equal(page?.sourceKey,await legacySourceKey(first.desc));assert.equal(page?.stablePageId,await legacyStablePageId(page!.sourceKey,10));assert.equal(first.id,await legacySnapshotId(first.desc));
 const conflict=records();conflict[2].pageId=20;const conflicting=(await first.store.begin(await descriptor(conflict))).snapshotId;await assert.rejects(first.store.ingest(conflicting,conflict),/belongs to another source page/);assert.deepEqual(await first.store.stats(conflicting),{pages:0,revisions:0,routes:0});
});

test("descriptor, source scope, input identity and bounded JSON validation fail closed",async()=>{
 const f=await fixture();for(const patch of [{sourceOrigin:"https://evil.example"},{accessPolicy:"public"},{sourcePermissionScope:"full_acl"},{namespaces:[{id:0,name:""},{id:0,name:"duplicate"}]},{expected:{pages:0,revisions:3,routes:3}},{sourceWikiId:"x/../../secret"}])await assert.rejects(f.store.begin({...f.desc,...patch} as LegacyDescriptor));
 await assert.rejects(f.store.ingest(f.id,[]));await assert.rejects(f.store.ingest(f.id,Array(101).fill(f.input[0])));const huge=structuredClone(f.input[2]);huge.raw.padding="x".repeat(600_000);await assert.rejects(f.store.ingest(f.id,[huge]),/size limit/);
 const mismatched=structuredClone(f.input[0]);mismatched.pageId=900;await assert.rejects(f.store.ingest(f.id,[mismatched]),/identity/);const rawRevision=structuredClone(f.input[2]);rawRevision.raw.revid=900;await assert.rejects(f.store.ingest(f.id,[rawRevision]),/revision ID/);
 const route=structuredClone(f.input[5]);if(route.kind!=="route")throw new Error();route.url="https://evil.example/x";await assert.rejects(f.store.ingest(f.id,[route]),/same-source/);
 const wrongOldid=structuredClone(f.input[6]);if(wrongOldid.kind!=="route")throw new Error();wrongOldid.revisionId=102;wrongOldid.raw.revisionId=102;await assert.rejects(f.store.ingest(f.id,[wrongOldid]),/IDs differ/);
 assert.equal((await f.store.snapshot(f.id))?.descriptor.accessPolicy,"operator_only");assert.equal(canonicalLegacy({z:2,a:1}),'{"a":1,"z":2}');assert.equal(await legacyTransferDigest(f.input),await legacyTransferDigest([...f.input].reverse()));
});

test("full-archive batches exceed 100 total values without exceeding D1 per-statement binds and retain literal legacy URLs",async()=>{
 const input=records();for(let revisionId=300;revisionId<380;revisionId++)input.push({kind:"revision",pageId:10,revisionId,raw:{revid:revisionId,parentid:revisionId===300?102:revisionId-1,slots:{main:{content:`Historical revision ${revisionId}`}}}});
 if(input[0].kind!=="page"||input[5].kind!=="route")throw new Error();input[0].latestCapturedRevisionId=379;
 const literal="https://entitywiki.org/index.php?title=Client's_Company";input[5].url=literal;input[5].raw.url=literal;input[0].title="Client's Company";(input[0].raw.page as Record<string,unknown>).title=input[0].title;
 const f=await fixture(input);await f.store.ingest(f.id,input);await f.store.finalize(f.id);assert.equal((await f.store.stats(f.id)).revisions,83);assert.equal((await f.store.resolveRoute(f.id,literal))?.url,literal);
 assert.equal((await f.store.history(f.id,10,{limit:10,offset:70})).length,10);assert.notEqual(new URL(literal).href,literal);
});


test("abandoned loading imports cannot reserve source revision ownership; finalization reconciles ready snapshots atomically",async()=>{
 const bad=records();bad[2].pageId=20;bad[6].pageId=20;bad[6].raw.pageId=20;
 const f=await fixture(bad);await f.store.ingest(f.id,bad);assert.equal((await f.store.snapshot(f.id))?.state,"loading");
 const good=records(),goodId=(await f.store.begin(await descriptor(good))).snapshotId;await f.store.ingest(goodId,good);await f.store.finalize(goodId);
 assert.equal((await f.store.revisionById(goodId,101))?.pageId,10);await assert.rejects(f.store.finalize(f.id),/belongs to another source page/);assert.equal((await f.store.snapshot(f.id))?.state,"loading");
 assert.equal((await f.store.latestReady())?.snapshotId,goodId);
});


test("well-hashed URL inventories cannot finalize titles or pretty paths bound to the wrong page",async()=>{
 for(const variant of ["pretty-path","query-title","namespace","both-identities"]){
  const input=records();if(input[5].kind!=="route"||input[0].kind!=="page")throw new Error();
  if(variant==="pretty-path")input[5].url="https://entitywiki.org/Unrelated_Company";
  if(variant==="query-title")input[5].url="https://entitywiki.org/index.php?curid=10&title=Unrelated_Company";
  if(variant==="both-identities")input[5].url="https://entitywiki.org/Unrelated_Company?title=Company_100%25&curid=10";
  if(variant==="namespace"){input[0].namespace=2;(input[0].raw.page as Record<string,unknown>).ns=2;}
  input[5].raw.url=input[5].url;
  const f=await fixture(input);await f.store.ingest(f.id,input);await assert.rejects(f.store.finalize(f.id),/route path|route title|namespace identity/);assert.equal((await f.store.snapshot(f.id))?.state,"loading");assert.equal(await f.store.latestReady(),null);
 }
});

test("direct asset routes keep original file paths while explicit titles still bind to the declared page",async()=>{
 const input=records();if(input[5].kind!=="route")throw new Error();input[5].url="https://entitywiki.org/images/a/ab/original-company-logo.png";input[5].routeKind="asset";input[5].raw.url=input[5].url;input[5].raw.kind="asset";
 const f=await fixture(input);await f.store.ingest(f.id,input);await f.store.finalize(f.id);assert.equal((await f.store.resolveRoute(f.id,input[5].url))?.url,input[5].url);
 const bad=structuredClone(input);if(bad[5].kind!=="route")throw new Error();bad[5].url+="?title=Unrelated_Company";bad[5].raw.url=bad[5].url;const g=await fixture(bad);await g.store.ingest(g.id,bad);await assert.rejects(g.store.finalize(g.id),/route title/);
});
