#!/usr/bin/env node
/** Read-only local runtime acceptance. Raw rows and failure URLs stay in the private prepared directory. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { localStagingOrigin, readPreparedStage } from './legacy-stage.mjs';

const args=process.argv.slice(2),options={};
for(let i=0;i<args.length;i+=2){assert(['--prepared','--origin'].includes(args[i])&&args[i+1]&&!options[args[i]],'Use --prepared PRIVATE_PATH --origin LOOPBACK_ORIGIN.');options[args[i]]=args[i+1];}
assert(options['--prepared']&&options['--origin'],'A private prepared capture and explicit loopback origin are required.');
const origin=localStagingOrigin(options['--origin']);
const stage=await readPreparedStage(options['--prepared']);
const vars=await readFile(fileURLToPath(new URL('../.dev.vars',import.meta.url)),'utf8');
const key=/^OPERATOR_LOCAL_KEY=(.+)$/m.exec(vars)?.[1]?.trim();assert(key?.length>=32,'Configure a local staging key.');
const login=await fetch(new URL('/admin/auth',origin),{method:'POST',redirect:'manual',headers:{'Content-Type':'application/x-www-form-urlencoded',Origin:origin.origin},body:new URLSearchParams({key})});
assert.equal(login.status,303);const cookie=login.headers.get('set-cookie')?.split(';')[0];assert(cookie?.startsWith('entitywiki_local_operator='),'A local operator session is required.');
const get=(path,authenticated=true,method='GET')=>fetch(new URL(path,origin),{method,redirect:'manual',headers:authenticated?{Cookie:cookie}:{},signal:AbortSignal.timeout(30_000)});
const statusResponse=await get('/api/migration/status');assert.equal(statusResponse.status,200);
const {snapshot}=await statusResponse.json();assert.equal(snapshot?.state,'ready');assert.equal(snapshot.descriptor.transferDigest,stage.descriptor.transferDigest);
assert.deepEqual(snapshot.descriptor.expected,stage.descriptor.expected);
assert.equal((await get('/api/migration/status',false)).status,403);
const pages=stage.records.filter(record=>record.kind==='page'),routes=stage.records.filter(record=>record.kind==='route'),revisions=stage.records.filter(record=>record.kind==='revision');
const namespaces=[...new Set(pages.map(page=>page.namespace))].sort((a,b)=>a-b);
for(const namespace of namespaces){
  const page=pages.find(row=>row.namespace===namespace),url=`/index.php?curid=${page.pageId}`;
  const anonymous=await get(url,false);assert.equal(anonymous.status,403);const body=await anonymous.text();assert.ok(!body.includes(page.title));
  const list=await get(`/api/migration/pages?namespace=${namespace}&limit=100`);assert.equal(list.status,200);const result=await list.json();assert.ok(result.pages.length>0&&result.pages.every(row=>row.namespace===namespace));
}
assert.equal((await get('/index.php?curid=999999999',false)).status,403);
const errors=[];let checked=0,reserved=0,cursor=0;
await Promise.all(Array.from({length:4},async()=>{
  while(cursor<routes.length){
    const record=routes[cursor++],source=new URL(record.url);
    if(source.pathname==='/MAXPlaces_Marketing'&&!source.search){reserved++;continue;}
    const response=await get(source.pathname+source.search,true,'HEAD');
    const actualPage=response.headers.get('x-entitywiki-legacy-page'),actualRevision=response.headers.get('x-entitywiki-legacy-revision');
    if(response.status!==200||actualPage!==String(record.pageId)||(record.revisionId!==null&&actualRevision!==String(record.revisionId))||!response.headers.get('cache-control')?.includes('private')||!response.headers.get('x-robots-tag')?.includes('noindex'))errors.push({url:record.url,status:response.status,expectedPageId:record.pageId,actualPage,expectedRevisionId:record.revisionId,actualRevision});
    checked++;
  }
}));
const histories=[];
for(const page of pages){
  const response=await get(`/index.php?curid=${page.pageId}&action=history`);const body=await response.text();
  const expected=revisions.filter(revision=>revision.pageId===page.pageId);
  // Captured archive currently has <=100 revisions/page. Larger captures need pagination acceptance.
  if(expected.length>100)throw new Error('Extend runtime history acceptance to follow all captured pagination pages.');
  const missing=expected.filter(revision=>!body.includes(`href="/index.php?oldid=${revision.revisionId}"`));
  if(response.status!==200||missing.length)errors.push({pageId:page.pageId,kind:'history',status:response.status,missingRevisionIds:missing.map(row=>row.revisionId)});
  histories.push({pageId:page.pageId,revisions:expected.length});
}
const pilot=await get('/MAXPlaces_Marketing',false);assert.equal(pilot.status,200);assert.ok((await pilot.text()).includes('application/ld+json'));
const errorCases=[['/index.php?oldid=999999999',404],['/index.php?curid=213&curid=214',400],['/index.php?title=MAXPlaces_Marketing&action=edit',501],['/Special:UserLogin',501],['/api.php?action=edit',501],['/rest.php/v1/page/Main_Page',501]];
for(const [path,expected]of errorCases)assert.equal((await get(path)).status,expected);
const multi=revisions.find(row=>Number(row.raw.parentid)>0&&revisions.some(parent=>parent.revisionId===row.raw.parentid&&parent.pageId===row.pageId));
assert(multi);for(const path of [`/index.php?oldid=${multi.revisionId}&diff=prev`,`/Special:PermanentLink/${multi.revisionId}`,`/Special:Redirect/page/${multi.pageId}`])assert.equal((await get(path)).status,200);
const dashboard=await get('/admin/migration');assert.equal(dashboard.status,200);assert.ok((await dashboard.text()).includes('The whole wiki,'));
const receipt={format:'entitywiki.legacy-runtime-acceptance/1',verifiedAt:new Date().toISOString(),origin:origin.origin,snapshotId:snapshot.snapshotId,transferDigest:stage.descriptor.transferDigest,counts:stage.descriptor.expected,namespaces,routeChecks:checked,reservedApprovedProfileRoutes:reserved,historyPages:histories.length,historyRevisions:histories.reduce((sum,row)=>sum+row.revisions,0),anonymousSourceReads:'denied',capturedAcl:'retained as observations; operator-only staging; source accounts not restored',sourceWrites:false,dnsChanges:false,errors};
await writeFile(join(stage.root,'runtime-verification.json'),JSON.stringify(receipt,null,2)+'\n',{mode:0o600});
assert.equal(errors.length,0,'Runtime reconciliation failures are recorded privately in runtime-verification.json.');
console.log(JSON.stringify({...receipt,errors:errors.length}));
