import { getDb } from "../../db";
import { requireOperator } from "../operator-auth.ts";
import { errorResponse, jsonBody, jsonResponse } from "../pilot-runtime.ts";
import { createLegacyStore } from "./store.ts";
import type { LegacyDescriptor, LegacyTransferRecord } from "./contracts.ts";

function integer(value: unknown, fallback?: number, maximum=1_000_000_000):number {
  if(value===null&&fallback!==undefined)return fallback;
  if(typeof value!=="string"||!/^\d+$/.test(value)||!Number.isSafeInteger(Number(value))||Number(value)>maximum)throw new Error("A bounded numeric identifier or pagination value is required.");
  return Number(value);
}
/** Every migration endpoint is operator-only, including existence/status reads. */
export async function handleMigrationApi(request:Request,path:string[]):Promise<Response>{
  try {
    await requireOperator(request);
    const route=path.join("/"), store=createLegacyStore(getDb()), url=new URL(request.url);
    if(request.method==="GET"){
      const snapshotId=url.searchParams.get("snapshotId");
      const snapshot=snapshotId?await store.snapshot(snapshotId):await store.latestReady();
      if(route==="status")return jsonResponse({snapshot,scope:"Captured public records in private staging; original SQL/accounts/files restore pending."});
      if(!snapshot||snapshot.state!=="ready")return jsonResponse({error:{code:"not_ready",message:"No completed legacy capture is available."}},404);
      if(route==="pages"){
        const limit=integer(url.searchParams.get("limit"),50,100),offset=integer(url.searchParams.get("offset"),0,100_000);
        const search=url.searchParams.get("search")??undefined;
        if(search&&search.length>200)throw new Error("Search is limited to 200 characters.");
        const namespaceValue=url.searchParams.get("namespace");
        const namespace=namespaceValue===null?undefined:integer(namespaceValue,undefined,1_000_000);
        const pages=await store.listPages(snapshot.snapshotId,{limit,offset,search,namespace});
        return jsonResponse({snapshotId:snapshot.snapshotId,pages,limit,offset});
      }
      return jsonResponse({error:{code:"not_found",message:"Migration route not found."}},404);
    }
    if(request.method!=="POST")return jsonResponse({error:{code:"method_not_allowed",message:"Use a read request or an authenticated import operation."}},405);
    const body=await jsonBody(request);
    if(route==="begin")return jsonResponse(await store.begin(body.descriptor as LegacyDescriptor));
    if(typeof body.snapshotId!=="string"||!/^capture_[a-f0-9]{64}$/.test(body.snapshotId))throw new Error("A valid staging snapshot identifier is required.");
    if(route==="ingest")return jsonResponse(await store.ingest(body.snapshotId,body.records as LegacyTransferRecord[]));
    if(route==="finalize")return jsonResponse(await store.finalize(body.snapshotId));
    return jsonResponse({error:{code:"not_found",message:"Migration route not found."}},404);
  }catch(error){return errorResponse(error);}
}
