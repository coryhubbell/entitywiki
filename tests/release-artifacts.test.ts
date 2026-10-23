import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { testDatabase } from "./helpers/d1-database.ts";
import { createPilotService } from "../lib/entitywiki/service.ts";
import { EntityWikiRepository } from "../lib/entitywiki/repository.ts";
import { createReleaseArtifact } from "../lib/entitywiki/release-artifacts.ts";
import { canonical, sha256 } from "../lib/entitywiki/safety.ts";
import type { CompanyRecord } from "../lib/entitywiki/types.ts";

async function fixture(privateEvidence=false){
  const {db,sqlite}=testDatabase(),repository=new EntityWikiRepository(db);
  const record=JSON.parse(readFileSync(new URL("../data/pilot/accepted-record.json",import.meta.url),"utf8")) as CompanyRecord;
  if(privateEvidence){
    record.sources.push({...record.sources[0],id:"private-evidence",excerpt:"PRIVATE_EVIDENCE_BYTES",destinations:{public:false,wiki:false,jsonld:false}});
    record.claims.push({...record.claims[0],id:"private-claim",sourceIds:["private-evidence"],value:"PRIVATE_CLAIM_BYTES"});
  }
  const service=createPilotService(db,{wiki:{apiUrl:"https://entitywiki.org/api.php"},fetch:async()=>{throw new Error("Release preservation must remain offline");}});
  await service.restoreAcceptedRecord(record,{source:"Offline release preservation test"});
  return {db,sqlite,repository,service,record};
}
async function nextRevision(f:Awaited<ReturnType<typeof fixture>>){
  const next=structuredClone(f.record);next.provenance.importDigest=await sha256("second accepted artifact test revision");next.id=`rev_${next.provenance.importDigest.slice(0,32)}`;next.revision++;
  await f.service.restoreAcceptedRecord(next,{source:"Second offline accepted revision"});return next;
}

test("a service release atomically preserves exact canonical sanitized projection bytes and accepted-record binding",async()=>{
  const f=await fixture(true),expected=await createReleaseArtifact(f.record);
  const result=await f.service.releaseRecord(f.record.id,{actor:"PRIVATE_OPERATOR_SUBJECT",reason:"PRIVATE_OPERATOR_REASON",expectedPreviousReleaseId:null});
  const archived=await f.repository.releaseArtifact(result.release.id);assert.ok(archived);
  assert.equal(archived.body,expected.body);assert.equal(archived.recordDigest,await sha256(canonical(f.record)));assert.equal(archived.digest,result.release.digest);
  assert.equal(archived.capturedAt,result.release.releasedAt);assert.equal(archived.format,"entitywiki.public-release/1");
  const exported=await f.service.exportReleaseArtifact(result.release.id);assert.equal(exported?.projectionCanonical,expected.body);assert.equal(exported?.acceptedRecordDigest,archived.recordDigest);
  for(const secret of ["PRIVATE_EVIDENCE_BYTES","PRIVATE_CLAIM_BYTES","PRIVATE_OPERATOR_SUBJECT","PRIVATE_OPERATOR_REASON"])assert.ok(!JSON.stringify(exported).includes(secret));
  assert.ok(!JSON.stringify(await f.service.getReleasedProfile()).includes("PRIVATE_OPERATOR_SUBJECT"));
  assert.equal(await f.service.exportReleaseArtifact("web_00000000000000000000000000000000"),null);
});

test("artifact rows are immutable and a repeated release preserves its original bytes and capture time",async()=>{
  const f=await fixture();const first=await f.service.releaseRecord(f.record.id,{actor:"operator",expectedPreviousReleaseId:null});
  const before=await f.repository.releaseArtifact(first.release.id);const again=await f.service.releaseRecord(f.record.id,{actor:"different-operator",expectedPreviousReleaseId:null});
  assert.equal(again.replayed,true);assert.equal(first.release.id,again.release.id);assert.deepEqual(await f.repository.releaseArtifact(first.release.id),before);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM web_release_artifacts").get()!.n,1);
  assert.throws(()=>f.sqlite.prepare("UPDATE web_release_artifacts SET body='{}' WHERE release_id=?").run(first.release.id),/immutable/);
  assert.throws(()=>f.sqlite.prepare("DELETE FROM web_release_artifacts WHERE release_id=?").run(first.release.id),/immutable/);
});

test("legacy digest-only releases cannot masquerade as captured snapshots or replay a required new service artifact",async()=>{
  const f=await fixture(),artifact=await createReleaseArtifact(f.record);
  const legacy=await f.repository.releaseRecord(f.record,artifact.digest,{actor:"historical-compiler",expectedPreviousReleaseId:null});
  assert.equal(await f.repository.releaseArtifact(legacy.release.id),null);await assert.rejects(f.service.exportReleaseArtifact(legacy.release.id),/only a digest/);
  await assert.rejects(f.service.releaseRecord(f.record.id,{actor:"operator",expectedPreviousReleaseId:null}),/public release changed/);
  const captured=await f.service.releaseRecord(f.record.id,{actor:"operator",expectedPreviousReleaseId:legacy.release.id});
  assert.equal(captured.replayed,false);assert.equal(captured.release.sequence,2);assert.notEqual(captured.release.id,legacy.release.id);
  assert.equal(await f.repository.releaseArtifact(legacy.release.id),null);assert.equal((await f.repository.releaseArtifact(captured.release.id))?.body,artifact.body);
});

test("artifact insertion failure rolls the release pointer back instead of accepting a digest-only success",async()=>{
  const f=await fixture();const first=await f.service.releaseRecord(f.record.id,{actor:"operator",expectedPreviousReleaseId:null}),next=await nextRevision(f);
  f.sqlite.exec("CREATE TRIGGER force_artifact_failure BEFORE INSERT ON web_release_artifacts BEGIN SELECT RAISE(ABORT, 'simulated artifact storage failure'); END;");
  await assert.rejects(f.service.releaseRecord(next.id,{actor:"operator",expectedPreviousReleaseId:first.release.id}),/required artifact were not committed/);
  assert.equal((await f.repository.currentWebRelease(f.record.entityId))?.id,first.release.id);assert.equal((await f.service.getReleasedProfile())?.record.id,f.record.id);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM web_release_artifacts").get()!.n,1);assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM web_releases").get()!.n,1);
  f.sqlite.exec("DROP TRIGGER force_artifact_failure");
  assert.equal((await f.service.releaseRecord(next.id,{actor:"operator",expectedPreviousReleaseId:first.release.id})).release.sequence,2);
});

test("concurrent identical releases yield one complete artifact and one durable release",async()=>{
  const f=await fixture();
  const [one,two]=await Promise.all([f.service.releaseRecord(f.record.id,{actor:"one",expectedPreviousReleaseId:null}),f.service.releaseRecord(f.record.id,{actor:"two",expectedPreviousReleaseId:null})]);
  assert.equal(one.release.id,two.release.id);assert.equal([one,two].filter(r=>r.replayed).length,1);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM web_releases").get()!.n,1);assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM web_release_artifacts").get()!.n,1);
  assert.ok(await f.service.exportReleaseArtifact(one.release.id));
});

test("competing releases cannot attach an artifact to a losing public pointer",async()=>{
  const f=await fixture(),next=await nextRevision(f);
  const results=await Promise.allSettled([f.service.releaseRecord(f.record.id,{actor:"one",expectedPreviousReleaseId:null}),f.service.releaseRecord(next.id,{actor:"two",expectedPreviousReleaseId:null})]);
  assert.equal(results.filter(r=>r.status==="fulfilled").length,1);assert.equal(results.filter(r=>r.status==="rejected").length,1);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM web_releases").get()!.n,1);assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM web_release_artifacts").get()!.n,1);
  const current=await f.repository.currentWebRelease(f.record.entityId);assert.ok(current);assert.ok(await f.service.exportReleaseArtifact(current.id));assert.equal((await f.service.getReleasedProfile())?.record.id,current.recordId);
});

test("operator export rejects accepted-record or stored artifact binding corruption without recompiling history",async()=>{
  const f=await fixture();const first=await f.service.releaseRecord(f.record.id,{actor:"operator",expectedPreviousReleaseId:null});
  const expected=await f.service.exportReleaseArtifact(first.release.id);
  const changed=structuredClone(f.record);changed.sections.sources.reason="Simulated later compiler or data drift";
  f.sqlite.prepare("UPDATE company_records SET body=? WHERE id=?").run(JSON.stringify(changed),f.record.id);
  await assert.rejects(f.service.exportReleaseArtifact(first.release.id),/accepted record binding/);await assert.rejects(f.service.getReleasedProfile(),/approved release digest/);
  f.sqlite.prepare("UPDATE company_records SET body=? WHERE id=?").run(JSON.stringify(f.record),f.record.id);
  assert.deepEqual(await f.service.exportReleaseArtifact(first.release.id),expected);
  f.sqlite.exec("DROP TRIGGER web_release_artifacts_immutable_update");
  f.sqlite.prepare("UPDATE web_release_artifacts SET body='{}' WHERE release_id=?").run(first.release.id);
  await assert.rejects(f.service.exportReleaseArtifact(first.release.id),/approved release digest/);
});

test("disjoint publisher source keys cannot merge through a reused name-derived preferred identity",async()=>{
  const {db}=testDatabase(),repository=new EntityWikiRepository(db),preferredId=`ew_${"a".repeat(24)}`;
  const [first,second]=await Promise.all([repository.assignIdentity({kind:"service",sourceKeys:["publisher:/first"],labels:["SEO"],preferredId,reason:"First source"}),repository.assignIdentity({kind:"service",sourceKeys:["publisher:/second"],labels:["SEO"],preferredId,reason:"Different source"})]);
  assert.notEqual(first,second);assert.ok([first,second].includes(preferredId));
  assert.equal(await repository.assignIdentity({kind:"service",sourceKeys:["publisher:/first"],labels:["Renamed SEO"],preferredId,reason:"Same first source"}),first);
});

test("explicit restoration can bootstrap source aliases for existing historical IDs that have no aliases",async()=>{
  const {db}=testDatabase(),repository=new EntityWikiRepository(db);
  const record=JSON.parse(readFileSync(new URL("../data/pilot/accepted-record.json",import.meta.url),"utf8")) as CompanyRecord;
  await repository.saveRecord(record,{preserveRevision:true});assert.equal((await repository.aliases(record.entityId)).length,0);
  const service=createPilotService(db,{wiki:{apiUrl:"https://entitywiki.org/api.php"},fetch:async()=>{throw new Error("Restoration must remain offline");}});
  const restored=await service.restoreAcceptedRecord(record,{source:"Historical pre-alias registry snapshot"});
  assert.equal(restored.replayed,true);assert.deepEqual(restored.record.entities.map(e=>e.id),record.entities.map(e=>e.id));
  for(const entity of record.entities)assert.ok((await repository.aliases(entity.id)).some(a=>a.aliasType==="source"));
  assert.equal(await service.getReleasedProfile(),null);
});
