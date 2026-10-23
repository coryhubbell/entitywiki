import type { Entity } from "./types.ts";
import { safeUrl, sha256, text } from "./safety.ts";
export const PILOT_ENTITY_ID="ew_a3d1e72a720be01b2e5834cb";
export const ENTITY_NAMESPACE="https://entitywiki.org/id/";
export const PILOT_DOCUMENT_PATH="/MAXPlaces_Marketing";
export interface IdentityRequest {kind:Entity['kind'];parentId?:string;sourceKeys:string[];labels:string[];preferredId?:string;reason:string}
export interface IdentityResolver {resolve(request:IdentityRequest):Promise<string>}
export function entityUri(id:string):string{if(!/^ew_[a-f0-9]{24,32}$/.test(id))throw new Error("Invalid opaque entity identifier.");return ENTITY_NAMESPACE+id;}
/** Publisher paths are scoped to the already assigned parent, so domain changes do not mint new children. */
export function publisherKey(value:unknown):string|undefined{const safe=safeUrl(value);if(!safe)return;const u=new URL(safe);return `publisher:${u.pathname.replace(/\/$/,"")||"/"}${u.hash}`;}
export function normalizedStreet(value:unknown):string{return text(value).toLowerCase().replace(/\bst\b/g,"street").replace(/\bste\b/g,"suite").replace(/\bfl\b/g,"floor").replace(/[^a-z0-9]/g,"");}
export function branchSourceKey(city:string,street:string,region:string,country:string):string{return `address:${[city.toLowerCase().trim(),normalizedStreet(street),region.toLowerCase().trim(),country.toLowerCase().trim()].join(":")}`;}
export async function legacyChildId(kind:string,key:string):Promise<string>{return `ew_${(await sha256(`${PILOT_ENTITY_ID}:${kind}:${key.toLowerCase()}`)).slice(0,24)}`;}
/** Preserve the two proven pilot branch IDs; locality alone is never a branch match. */
export async function legacyBranchId(city:string,street:string):Promise<string|undefined>{
  const normalized=normalizedStreet(street);
  if(city.toLowerCase()==="farmingdale"&&normalized===normalizedStreet("399 Conklin Street, Suite 305"))return legacyChildId("branch","Farmingdale");
  if(city.toLowerCase()==="new york"&&normalized===normalizedStreet("127 West 30th Street, 9th Floor #989"))return legacyChildId("branch","New York");
}
