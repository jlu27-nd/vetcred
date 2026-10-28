import 'server-only';
import { Pool, type PoolClient } from 'pg';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

export class AppError extends Error { constructor(message:string, public status=400) {super(message);} }
export function env(name:string) { const value=process.env[name]; if(!value) throw new AppError(`Live service is not configured: ${name}.`,503); return value; }
let pool:Pool|undefined;
export function database() { if(!pool){const url=new URL(env('POSTGRES_URL'));url.searchParams.delete('sslmode');pool=new Pool({connectionString:url.toString(),ssl:{ca:readFileSync(path.join(process.cwd(),'supabase/certs/prod-ca-2021.crt'),'utf8'),rejectUnauthorized:true},max:4,idleTimeoutMillis:10_000,connectionTimeoutMillis:15_000});}return pool; }
export async function transaction<T>(fn:(db:PoolClient)=>Promise<T>, userId?:string) {
 const db=await database().connect();
 try { await db.query('begin'); await db.query("set local statement_timeout='20s'");
 if(userId){await db.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:userId,role:'authenticated'})]);await db.query('set local role authenticated');}
 const result=await fn(db);await db.query('commit');return result;
 } catch(error) {await db.query('rollback');throw error;} finally {db.release();}
}
export async function authClient(){const jar=await cookies();return createServerClient(env('NEXT_PUBLIC_SUPABASE_URL'),env('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'),{cookies:{getAll:()=>jar.getAll(),setAll:(values)=>{values.forEach(({name,value,options})=>jar.set(name,value,options));}}});}
export function storageAdmin(){return createClient(env('NEXT_PUBLIC_SUPABASE_URL'),process.env.SUPABASE_SECRET_KEY||env('SUPABASE_SERVICE_ROLE_KEY'),{auth:{autoRefreshToken:false,persistSession:false}});}
export async function requireUser(){const auth=await authClient();const {data,error}=await auth.auth.getUser();if(error||!data.user)throw new AppError('Sign in to continue.',401);return data.user;}
export function assertOrigin(request:Request){const origin=request.headers.get('origin');if(origin&&new URL(origin).host!==request.headers.get('host'))throw new AppError('This request must come from VetCred.',403);}
export async function body(request:Request){assertOrigin(request);if(Number(request.headers.get('content-length')||0)>250_000)throw new AppError('Request is too large.',413);const text=await request.text();if(text.length>250_000)throw new AppError('Request is too large.',413);try{return JSON.parse(text);}catch{throw new AppError('A valid JSON request is required.');}}
export function responseError(error:unknown){if(error instanceof AppError)return Response.json({error:error.message},{status:error.status});if(error instanceof Error&&error.name==='ZodError')return Response.json({error:'Check the information entered and try again.'},{status:400});const code=(error as {code?:string})?.code;if(code==='42501')return Response.json({error:'You do not have access to this case.'},{status:403});return Response.json({error:'The request could not be completed. Your saved work is safe; please retry.'},{status:500});}
export async function rateLimit(request:Request,category:string,limit=10){const raw=request.headers.get('x-vercel-forwarded-for')||request.headers.get('x-forwarded-for')||'local';const key=createHmac('sha256',process.env.SUPABASE_SECRET_KEY||env('SUPABASE_SERVICE_ROLE_KEY')).update(category+':'+raw.split(',')[0]).digest('hex');await transaction(async db=>{const {rows}=await db.query("insert into request_limits(key,window_start,count) values($1,now(),1) on conflict(key) do update set window_start=case when request_limits.window_start<now()-interval '1 hour' then now() else request_limits.window_start end,count=case when request_limits.window_start<now()-interval '1 hour' then 1 else request_limits.count+1 end returning count",[key]);if(rows[0].count>limit)throw new AppError('Too many attempts. Please try again in an hour.',429);});}
export const BUCKET='vetcred-originals';
export const SHARE_BUCKET='vetcred-shared';
