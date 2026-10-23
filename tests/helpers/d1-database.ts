import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/d1";
import * as tables from "../../db/schema.ts";

/** Real SQLite and generated migrations behind the actual Drizzle D1 driver. */
export function testDatabase(){
  const sqlite=new DatabaseSync(":memory:");
  for(const file of readdirSync(new URL("../../drizzle/",import.meta.url)).filter(f=>f.endsWith(".sql")).sort())sqlite.exec(readFileSync(new URL(`../../drizzle/${file}`,import.meta.url),"utf8"));
  sqlite.exec("PRAGMA foreign_keys=ON");
  let pending:Promise<unknown>=Promise.resolve();
  const client={prepare(query:string){
    const values:unknown[]=[];
    const statement={bind(...args:unknown[]){if(args.length>100)throw new Error("D1 maximum bound parameters exceeded");values.splice(0,values.length,...args);return statement;},async all(){const stmt=sqlite.prepare(query);return {results:stmt.all(...values as never[]),success:true,meta:{}};},async raw(){const stmt=sqlite.prepare(query);stmt.setReturnArrays(true);return stmt.all(...values as never[]);},async run(){const result=sqlite.prepare(query).run(...values as never[]);return {results:[],success:true,meta:{changes:Number(result.changes)}};}};
    return statement;
  },batch(statements:{all:()=>Promise<unknown>}[]){
    // D1 serializes batches as transactions; queue concurrent test transports.
    const result=pending.then(async()=>{sqlite.exec("BEGIN");try{const rows=[];for(const statement of statements)rows.push(await statement.all());sqlite.exec("COMMIT");return rows;}catch(error){sqlite.exec("ROLLBACK");throw error;}});
    pending=result.catch(()=>undefined);return result;
  }};
  return {db:drizzle(client as unknown as D1Database,{schema:tables}),sqlite};
}
