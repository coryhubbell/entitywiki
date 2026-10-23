import type { Metadata } from "next";
import { getDb } from "../../../db";
import { getOperatorSession } from "../../../lib/operator-auth";
import { createLegacyStore } from "../../../lib/legacy/store";
import { RegistryFooter, RegistryHeader } from "../../components/registry-frame";

export const dynamic="force-dynamic";
export const metadata:Metadata={title:"All-client migration — EntityWiki",robots:{index:false,follow:false}};
type Query={search?:string;namespace?:string;offset?:string};
const titleUrl=(title:string)=>`/index.php?title=${encodeURIComponent(title.replaceAll(" ","_"))}`;
export default async function MigrationWorkspace({searchParams}:{searchParams:Promise<Query>}){
  const session=await getOperatorSession();
  if(!session)return <><RegistryHeader workspace/><main className="registry-main migration-main"><p className="overline">PRIVATE MIGRATION WORKSPACE</p><h1>Authorized access.</h1><p>Sign in to review captured records and their preserved history.</p><a className="button" href="/admin">Sign in to the workspace ↗</a></main><RegistryFooter/></>;
  const store=createLegacyStore(getDb()),snapshot=await store.latestReady();
  if(!snapshot)return <><RegistryHeader workspace/><main className="registry-main migration-main"><p className="overline">ALL-CLIENT MIGRATION</p><h1>Awaiting a verified capture.</h1><p>No completed archive import is available. Partial imports remain unavailable to the reader.</p><a href="/admin">Return to the workspace</a></main><RegistryFooter/></>;
  const query=await searchParams;
  const search=typeof query.search==="string"?query.search.slice(0,200):"";
  const namespaceCandidate=typeof query.namespace==="string"&&/^\d{1,6}$/.test(query.namespace)?Number(query.namespace):undefined;
  const namespace=namespaceCandidate!==undefined&&Number.isSafeInteger(namespaceCandidate)&&namespaceCandidate<=100_000?namespaceCandidate:undefined;
  const offset=typeof query.offset==="string"&&/^\d+$/.test(query.offset)?Math.min(Number(query.offset),100_000):0;
  const pages=await store.listPages(snapshot.snapshotId,{search,namespace,limit:50,offset});
  const counts=await store.stats(snapshot.snapshotId);
  const href=(next:number)=>`/admin/migration?${new URLSearchParams({search,...namespace!==undefined?{namespace:String(namespace)}:{},offset:String(next)})}`;
  return <><RegistryHeader workspace/><main className="registry-main migration-main" id="main">
    <p className="overline">PRIVATE · ALL-CLIENT MIGRATION · CAPTURED SOURCE</p>
    <h1>The whole wiki,<br/><em>with its history.</em></h1>
    <p className="migration-intro">Browse every captured namespace before mapping source pages into reviewed entities. Original page and revision IDs stay intact. Every imported record is restricted to authenticated operators.</p>
    <div className="migration-stats" aria-label="Verified captured records"><p><strong>{counts.pages}</strong> pages</p><p><strong>{counts.revisions}</strong> revisions</p><p><strong>{counts.routes}</strong> URL variants</p></div>
    <aside className="migration-boundary"><strong>Preservation scope</strong><p>This capture contains publicly exposed content and protection observations. The full A2 database, accounts, private/deleted history and server files remain pending. Original permission behavior has not been restored. Captured pages have not been automatically published or accepted as company declarations.</p></aside>
    <form method="get" className="migration-filter"><label>Find a source page<input name="search" defaultValue={search} maxLength={200} placeholder="Search captured titles"/></label><label>Namespace<select name="namespace" defaultValue={namespace===undefined?"":String(namespace)}><option value="">All namespaces</option>{snapshot.descriptor.namespaces.filter(ns=>ns.id>=0).map(ns=><option key={ns.id} value={ns.id}>{ns.id} · {ns.name||"Main"}</option>)}</select></label><button className="button" type="submit">Filter records ↗</button></form>
    <div className="migration-table-wrap"><table className="migration-table"><caption>Captured source records · {offset+1}–{offset+pages.length}</caption><thead><tr><th>Source page</th><th>Namespace / role</th><th>Original IDs</th><th>History</th></tr></thead><tbody>{pages.map(page=><tr key={page.stablePageId}><td><a href={titleUrl(page.title)}>{page.title}</a><small>{page.stablePageId}</small></td><td>{page.namespace}<small>{page.classification.replaceAll("_"," ")}</small></td><td>Page {page.pageId}<small>Captured revision {page.latestCapturedRevisionId}</small></td><td><a href={`${titleUrl(page.title)}&action=history`}>View history ↗</a></td></tr>)}</tbody></table>{!pages.length&&<p className="migration-empty">No captured page matches these filters.</p>}</div>
    <nav className="migration-paging" aria-label="Source page pagination">{offset>0?<a className="button secondary" href={href(Math.max(0,offset-50))}>← Previous</a>:<span/>}{pages.length===50&&<a className="button secondary" href={href(offset+50)}>Next →</a>}</nav>
    <details className="migration-receipt"><summary>Capture and verification receipt</summary><dl><dt>Snapshot</dt><dd>{snapshot.snapshotId}</dd><dt>Capture boundary</dt><dd>{snapshot.descriptor.captureStartedAt}</dd><dt>Archive SHA-256</dt><dd>{snapshot.descriptor.archiveManifestSha256}</dd><dt>Transfer SHA-256</dt><dd>{snapshot.descriptor.transferDigest}</dd><dt>Reader access</dt><dd>Operator only · no public release or live routing change</dd></dl></details>
    <a href="/admin">Return to the editorial workspace ↗</a>
  </main><RegistryFooter/></>;
}
