/** Environment-independent canonical JSON: sorted object keys, unchanged array order. */
export function canonicalLegacy(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalLegacy).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a],[b])=>compare(a,b)).map(([key,item])=>`${JSON.stringify(key)}:${canonicalLegacy(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
function compare(a,b){return a<b?-1:a>b?1:0;}
export async function legacySha256(value){const hash=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));return Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,"0")).join("");}
export function legacyRecordKey(record){if(record.kind==="page")return String(record.pageId);if(record.kind==="revision")return String(record.revisionId);if(record.kind==="route")return record.url;throw new Error("Unsupported legacy record kind.");}
export async function hashLegacyRecord(record){return legacySha256(canonicalLegacy(record));}
export async function legacyTransferDigest(records){return legacyTransferDigestFromTuples(await Promise.all(records.map(async record=>[record.kind,legacyRecordKey(record),await hashLegacyRecord(record)])));}
export async function legacyTransferDigestFromTuples(tuples){return legacySha256(canonicalLegacy([...tuples].sort((a,b)=>compare(a[0],b[0])||compare(a[1],b[1]))));}
export async function legacySourceKey(descriptor){return `wiki_${await legacySha256(canonicalLegacy([descriptor.sourceOrigin,descriptor.sourceWikiId]))}`;}
export async function legacyStablePageId(sourceKey,pageId){return `wp_${await legacySha256(canonicalLegacy([sourceKey,pageId]))}`;}
export async function legacySnapshotId(descriptor){return `capture_${await legacySha256(canonicalLegacy(descriptor))}`;}
