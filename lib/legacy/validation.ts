import type { LegacyDescriptor, LegacyPageTransfer, LegacyRouteTransfer, LegacyTransferRecord } from "./contracts.ts";
import { canonicalLegacy } from "./digest.mjs";
import { normalizeLegacyTitle } from "./titles.ts";
const bytes=(value:unknown)=>new TextEncoder().encode(canonicalLegacy(value)).byteLength;
function fail(message:string):never{throw new Error(message);}
export function integer(value:unknown,name:string,minimum=1,maximum=Number.MAX_SAFE_INTEGER):asserts value is number{if(typeof value!=="number"||!Number.isSafeInteger(value)||value<minimum||value>maximum)fail(`Invalid ${name}.`);}
function text(value:unknown,name:string,max:number,empty=false):asserts value is string{if(typeof value!=="string"||(!empty&&!value.length)||value.length>max||/[\u0000-\u001f\u007f]/.test(value))fail(`Invalid ${name}.`);}
function json(value:unknown,depth=0):void{if(depth>50)fail("Legacy JSON is too deeply nested.");if(value===null||typeof value==="boolean"||typeof value==="string")return;if(typeof value==="number"&&Number.isFinite(value))return;if(Array.isArray(value)){for(const item of value)json(item,depth+1);return;}if(value&&typeof value==="object"&&Object.getPrototypeOf(value)===Object.prototype){for(const item of Object.values(value))json(item,depth+1);return;}fail("Legacy input must contain only plain JSON values.");}
function object(value:unknown,name:string):asserts value is Record<string,unknown>{if(!value||typeof value!=="object"||Array.isArray(value))fail(`Invalid ${name}.`);}
export function validateDescriptor(value:unknown):asserts value is LegacyDescriptor{
 json(value);object(value,"legacy descriptor");if(bytes(value)>100_000)fail("Legacy descriptor exceeds its size limit.");
 if(value.format!=="entitywiki.legacy-capture/1"||value.sourceOrigin!=="https://entitywiki.org")fail("Only the fixed EntityWiki capture source is accepted.");
 text(value.sourceWikiId,"source wiki ID",255);if(!/^[\w.-]+$/.test(value.sourceWikiId))fail("Invalid source wiki ID.");
 for(const name of ["archiveManifestSha256","transferDigest"]){if(typeof value[name]!=="string"||!(/^[0-9a-f]{64}$/).test(value[name]))fail(`Invalid ${name}.`);}
 if(value.accessPolicy!=="operator_only"||value.sourcePermissionScope!=="unauthenticated_public_capture_only")fail("Captured records require operator-only access and retain incomplete source permissions.");
 for(const name of ["capturedAt","captureStartedAt"]){text(value[name],name,40);if(!/^\d{4}-\d\d-\d\dT/.test(value[name])||!Number.isFinite(Date.parse(value[name])))fail(`Invalid ${name}.`);}
 if(Date.parse(value.captureStartedAt as string)>Date.parse(value.capturedAt as string))fail("Capture start follows capture completion.");
 object(value.expected,"expected counts");integer(value.expected.pages,"expected pages",1,100_000);integer(value.expected.revisions,"expected revisions",1,5_000_000);integer(value.expected.routes,"expected routes",1,10_000_000);
 if(!Array.isArray(value.namespaces)||!value.namespaces.length||value.namespaces.length>200)fail("Invalid namespaces.");
 const seen=new Set<number>();for(const ns of value.namespaces){object(ns,"namespace");integer(ns.id,"namespace ID",-2,100_000);if(seen.has(ns.id))fail("Duplicate namespace ID.");seen.add(ns.id);text(ns.name,"namespace name",255,true);if(ns.canonical!==undefined)text(ns.canonical,"canonical namespace",255,true);if(ns.aliases!==undefined){if(!Array.isArray(ns.aliases)||ns.aliases.length>50)fail("Invalid namespace aliases.");for(const alias of ns.aliases)text(alias,"namespace alias",255,true);}}
 if(!seen.has(0))fail("The main namespace must be inventoried.");
}
export function validateSnapshotId(value:unknown):asserts value is string{if(typeof value!=="string"||!/^capture_[0-9a-f]{64}$/.test(value))fail("Invalid legacy snapshot ID.");}
export function validateRouteUrl(value:unknown):asserts value is string{
 text(value,"source route URL",8192);const url=new URL(value);if(url.origin!=="https://entitywiki.org"||url.username||url.password||url.hash||!value.startsWith("https://entitywiki.org/"))fail("Route must be an exact same-source HTTPS URL without a fragment.");
}
export function validateTransferRecord(value:unknown,descriptor:LegacyDescriptor):asserts value is LegacyTransferRecord{
 json(value);object(value,"transfer record");if(bytes(value)>600_000)fail("Legacy record exceeds its size limit.");integer(value.pageId,"page ID");object(value.raw,"raw captured record");
 if(value.kind==="page"){
  integer(value.namespace,"page namespace",-2,100_000);if(!descriptor.namespaces.some(ns=>ns.id===value.namespace))fail("Page namespace is missing from the source inventory.");text(value.title,"page title",2048);text(value.classification,"page classification",255);integer(value.latestCapturedRevisionId,"latest captured revision");if(value.observedLatestRevisionId!==null)integer(value.observedLatestRevisionId,"observed latest revision");
  if(value.raw.revisions!==undefined)fail("Page headers cannot contain revision bodies.");object(value.raw.page,"raw page identity");if(value.raw.page.pageid!==value.pageId||value.raw.page.ns!==value.namespace||value.raw.page.title!==value.title)fail("Captured page identity does not match its transfer header.");
 }else if(value.kind==="revision"){
  integer(value.revisionId,"revision ID");if(value.raw.revid!==value.revisionId)fail("Captured revision ID does not match its transfer header.");if(value.raw.parentid!==undefined)integer(value.raw.parentid,"parent revision ID",0);
 }else if(value.kind==="route"){
  if(value.revisionId!==null)integer(value.revisionId,"route revision ID");text(value.routeKind,"route kind",255);validateRouteUrl(value.url);if(value.raw.pageId!==value.pageId||value.raw.url!==value.url||value.raw.kind!==value.routeKind)fail("Captured route identity does not match its transfer header.");
  const route=new URL(value.url),oldids=route.searchParams.getAll("oldid"),pageIds=route.searchParams.getAll("curid");
  if(oldids.length>1||pageIds.length>1||(oldids.length&&(!/^[1-9]\d*$/.test(oldids[0])||Number(oldids[0])!==value.revisionId))||(!oldids.length&&value.revisionId!==null)||(pageIds.length&&(!/^[1-9]\d*$/.test(pageIds[0])||Number(pageIds[0])!==value.pageId)))fail("Legacy route URL and captured page/revision IDs differ.");
  if(value.raw.revisionId!==undefined&&value.raw.revisionId!==value.revisionId)fail("Raw route revision identity differs.");
 }else fail("Unknown legacy record kind.");
}
export function validateIngestSize(records:unknown):asserts records is LegacyTransferRecord[]{json(records);if(!Array.isArray(records)||!records.length||records.length>100||bytes(records)>750_000)fail("An ingest batch requires 1–100 records and at most 750,000 canonical JSON bytes.");}


/** Bind the inventory URL to its original page, never merely to a plausible numeric ID. */
export function validateRoutePageBinding(route:LegacyRouteTransfer,page:Pick<LegacyPageTransfer,"pageId"|"namespace"|"title">,descriptor:LegacyDescriptor):void{
 if(route.pageId!==page.pageId)fail("Legacy route has no matching captured page.");
 const normalize=(value:string)=>{try{return normalizeLegacyTitle(value,descriptor.namespaces);}catch{fail("Legacy route contains an invalid captured title.");}};
 const expected=normalize(page.title),colon=expected.indexOf(":"),prefix=colon<0?"":expected.slice(0,colon);
 const namespace=colon<0?0:descriptor.namespaces.find(ns=>[ns.name,ns.canonical,...(ns.aliases??[])].some(name=>typeof name==="string"&&name.toLocaleLowerCase("en-US")===prefix.toLocaleLowerCase("en-US")))?.id??0;
 if(namespace!==page.namespace)fail("Legacy page title and namespace identity differ.");
 const url=new URL(route.url),titles=url.searchParams.getAll("title");if(titles.length>1)fail("Legacy route contains ambiguous captured titles.");
 if(titles.length&&normalize(titles[0])!==expected)fail("Legacy route title does not identify its captured page.");
 // Direct files do not have article titles in their path. Their explicit query
 // identities, if any, are still checked above and in transfer validation.
 const assetKinds=new Set(["asset","file_asset","original_file","archived_file","upload","thumbnail"]);
 if(url.pathname!=="/index.php"&&!assetKinds.has(route.routeKind)){
  let pathTitle:string;try{pathTitle=decodeURIComponent(url.pathname.slice(1));}catch{fail("Legacy route path has invalid title encoding.");}
  if(normalize(pathTitle)!==expected)fail("Legacy route path does not identify its captured page.");
 }
 if(url.pathname==="/index.php"&&!titles.length&&!url.searchParams.has("curid")&&!url.searchParams.has("oldid"))fail("Legacy route has no captured page identity.");
}
