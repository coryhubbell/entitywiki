import type { GenerationOperation, SavedGeneration } from "./types.ts";
import { boundedText, object } from "./safety.ts";
export interface SchemaBrainsConfig {apiKey:string;baseUrl?:string}
export class SchemaBrainsClient {
  private readonly origin:string;
  private readonly config:SchemaBrainsConfig;private readonly fetcher:typeof fetch;
  constructor(config:SchemaBrainsConfig,fetcher:typeof fetch=fetch){
    this.config=config;this.fetcher=fetcher;
    const u=new URL(config.baseUrl??"https://schemabrains.com");
    if(u.protocol!=="https:"||u.username||u.password||u.pathname!=="/"||u.search||u.hash)throw new Error("SchemaBrains requires an HTTPS service origin.");this.origin=u.origin;
    if(!config.apiKey||/[\r\n]/.test(config.apiKey))throw new Error("SchemaBrains server credential is not configured.");
  }
  private async request<T>(path:string,init:RequestInit={}):Promise<T>{
    let response:Response;
    try{response=await this.fetcher(this.origin+path,{...init,redirect:"manual",signal:AbortSignal.timeout(25_000),headers:{"x-api-key":this.config.apiKey,"content-type":"application/json","user-agent":"EntityWiki-Pilot/1.0",...init.headers}});}catch{throw new Error("SchemaBrains transport is unavailable; recover the persisted operation without starting another generation.");}
    if(response.status>=300&&response.status<400){await response.body?.cancel();throw new Error("SchemaBrains returned a redirect; service credentials were not forwarded. Recover the persisted operation without starting another generation.");}
    const body=await boundedText(response,5_000_000);let parsed:unknown;try{parsed=JSON.parse(body);}catch{throw new Error(`SchemaBrains returned an unreadable response (HTTP ${response.status}).`);}
    if(!response.ok){const raw=object(object(parsed).error).code;const code=typeof raw==="string"&&/^[a-z_]{1,80}$/.test(raw)?raw:"http_error";throw new Error(`SchemaBrains ${code} (HTTP ${response.status}); no automatic generation retry was started.`);}
    return parsed as T;
  }
  capabilities(){return this.request<Record<string,unknown>>("/api/v1/capabilities");}
  getGeneration(generationId:string){return this.request<SavedGeneration>(`/api/v1/generations/${encodeURIComponent(validId(generationId))}`);}
  listGenerations(){return this.request<{generations:{generationId:string;sourceUrl:string|null;createdAt:string}[]}>("/api/v1/generations?limit=20");}
  createGeneration(idempotencyKey:string){
    if(!/^[A-Za-z0-9._:-]{1,128}$/.test(idempotencyKey))throw new Error("Invalid generation idempotency key.");
    return this.request<GenerationOperation>("/api/v1/generation-requests",{method:"POST",headers:{"Idempotency-Key":idempotencyKey},body:JSON.stringify({url:"https://www.maxplaces.com/",options:{includeVoice:false,includeGeoShape:false,generateHTML:false,glossaryQuality:"strict",audience:"declared",aiDiscoveryKit:false,geographicIdentityPolicy:"strict"}})});
  }
  pollGeneration(requestId:string){return this.request<GenerationOperation>(`/api/v1/generation-requests/${encodeURIComponent(validId(requestId))}`);}
}
function validId(value:string):string{if(typeof value!=="string"||!value||value.length>200||/[\u0000-\u001f]/.test(value))throw new Error("Invalid operation or generation ID.");return value;}
