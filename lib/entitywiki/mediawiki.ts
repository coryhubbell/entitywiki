import type { PublicationPlan, WikiPage } from "./types.ts";
import { boundedText, object, text } from "./safety.ts";
export interface MediaWikiConfig {apiUrl:string;username?:string;password?:string}
export class WikiApiError extends Error {readonly code:string;readonly ambiguous:boolean;constructor(code:string,ambiguous=false){super(`MediaWiki ${code}${ambiguous?"; reconciliation is required before retry":""}.`);this.code=code;this.ambiguous=ambiguous;}}
/** Request-scoped bot session. Cookies, login credentials and CSRF never enter stored records. */
export class MediaWikiClient {
  private cookies=new Map<string,string>();private csrf:string|undefined;private authenticatedUser:string|undefined;
  private readonly config:MediaWikiConfig;private readonly fetcher:typeof fetch;
  constructor(config:MediaWikiConfig,fetcher:typeof fetch=fetch){
    this.config=config;this.fetcher=fetcher;
    const u=new URL(config.apiUrl);if(u.protocol!=="https:"||u.hostname!=="entitywiki.org"||u.pathname!=="/api.php"||u.username||u.password||u.search||u.hash)throw new Error("The pilot publisher targets only the EntityWiki HTTPS API.");
  }
  private async request(params:Record<string,string>,post=false):Promise<Record<string,unknown>>{
    const values=new URLSearchParams({...params,format:"json",formatversion:"2"});
    const headers:Record<string,string>={"user-agent":"EntityWiki-Publisher/1.0 (+https://entitywiki.org/)"};if(this.cookies.size)headers.cookie=[...this.cookies].map(([k,v])=>`${k}=${v}`).join("; ");if(post)headers["content-type"]="application/x-www-form-urlencoded";
    let response:Response;
    // workerd supports manual/follow, but rejects redirect:'error' before I/O.
    // Reject 3xx ourselves: no session cookie or credential follows a redirect.
    try{response=await this.fetcher(this.config.apiUrl+(post?"":`?${values}`),{method:post?"POST":"GET",body:post?values:undefined,headers,redirect:"manual",signal:AbortSignal.timeout(20_000)});}catch{throw new WikiApiError("transport_unavailable",params.action==="edit");}
    if(response.status>=300&&response.status<400){await response.body?.cancel();throw new WikiApiError("unexpected_redirect",params.action==="edit");}
    const h=response.headers as Headers&{getSetCookie?:()=>string[]};const setCookies=h.getSetCookie?.()??h.get("set-cookie")?.split(/,(?=\s*[^;,=\s]+=[^;,]*)/)??[];
    for(const cookie of setCookies){const pair=cookie.split(";",1)[0];const pos=pair.indexOf("=");if(pos>0)this.cookies.set(pair.slice(0,pos).trim(),pair.slice(pos+1));}
    if(!response.ok)throw new WikiApiError(`http_${response.status}`,params.action==="edit"&&response.status>=500);
    let result:Record<string,unknown>;try{result=object(JSON.parse(await boundedText(response,3_000_000)));}catch{throw new WikiApiError("unreadable_response",params.action==="edit");}
    if(result.error){const code=text(object(result.error).code,80);throw new WikiApiError(/^[a-z_-]+$/.test(code)?code:"api_error");}return result;
  }
  async readPage(pageId=213):Promise<WikiPage>{
    if(pageId!==213)throw new Error("The live pilot is restricted to MediaWiki page 213.");
    const result=await this.request({action:"query",pageids:String(pageId),prop:"revisions",rvprop:"ids|timestamp|content",rvslots:"main",curtimestamp:"1"});
    const pages=object(result.query).pages;const p=object(Array.isArray(pages)?pages[0]:Object.values(object(pages))[0]);const revisions=Array.isArray(p.revisions)?p.revisions:[];const rev=object(revisions[0]);const main=object(object(rev.slots).main);
    const content=main.content??main["*"]??rev["*"];
    // Wiki preimages/readbacks are byte-sensitive. Do not trim or normalize editorial text.
    if(typeof content!=="string"||content.length>2_000_000)throw new WikiApiError("page_content_unavailable");
    return {pageId:Number(p.pageid??pageId),title:text(p.title),revision:Number(rev.revid??0),timestamp:text(rev.timestamp),currentTimestamp:text(result.curtimestamp)||new Date().toISOString(),text:content,missing:!!p.missing||Number(p.pageid)<0};
  }
  async authenticate():Promise<void>{
    if(this.csrf)return;
    if(!this.config.username||!this.config.password)throw new Error("A dedicated MediaWiki bot credential is required for unattended publication.");
    const loginToken=object(object((await this.request({action:"query",meta:"tokens",type:"login"})).query).tokens).logintoken;
    if(typeof loginToken!=="string")throw new WikiApiError("login_token_missing");
    const response=await this.request({action:"login",lgname:this.config.username,lgpassword:this.config.password,lgtoken:loginToken},true);const login=object(response.login);
    if(login.result!=="Success")throw new WikiApiError("login_failed");
    this.authenticatedUser=text(login.lgusername)||this.config.username.split("@")[0];
    const token=object(object((await this.request({action:"query",meta:"tokens",type:"csrf",assert:"user",assertuser:this.authenticatedUser})).query).tokens).csrftoken;
    if(typeof token!=="string"||token==="+\\")throw new WikiApiError("csrf_token_missing");this.csrf=token;
  }
  async edit(plan:PublicationPlan):Promise<{newRevision:number;noChange:boolean}>{
    await this.authenticate();
    const result=await this.request({action:"edit",pageid:String(plan.pageId),text:plan.after,token:this.csrf!,assert:"user",assertuser:this.authenticatedUser!,baserevid:String(plan.expectedRevision),starttimestamp:plan.startTimestamp,nocreate:"1",maxlag:"5",watchlist:"nochange",summary:`EntityWiki accepted ${plan.recordId}; projection ${plan.afterDigest.slice(0,12)}`},true);
    const edit=object(result.edit);if(edit.result!=="Success")throw new WikiApiError("edit_not_confirmed",true);
    const revision=Number(edit.newrevid??edit.oldrevid);if(!Number.isSafeInteger(revision)||revision<1)throw new WikiApiError("revision_missing",true);
    return {newRevision:revision,noChange:edit.nochange!==undefined};
  }
}
