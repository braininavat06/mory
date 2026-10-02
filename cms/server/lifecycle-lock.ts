import Database from 'better-sqlite3';
import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CmsError } from '../shared.ts';
// SQLite's OS file lock is released on process death (macOS/Linux). This is
// coordination only; the workspace remains cms.sqlite. Never expire live locks.
const context = new AsyncLocalStorage<{ path: string; active: boolean }>();
function acquire(runtime: string): Database.Database | null {
  mkdirSync(runtime, {recursive:true,mode:0o700});
  const db = new Database(join(runtime,'lifecycle-lock.sqlite'));
  try { db.pragma('busy_timeout = 0'); db.exec('BEGIN IMMEDIATE'); return db; }
  catch(error: any) { db.close(); if(error.code==='SQLITE_BUSY') return null; throw error; }
}
function nested(runtime: string) { const lease=context.getStore(); return lease?.active && lease.path===resolve(runtime); }
function run<T>(runtime: string, db: Database.Database, fn:()=>T):T {
  const lease={path:resolve(runtime),active:true};
  try { return context.run(lease,fn); }
  finally { lease.active=false; db.exec('ROLLBACK'); db.close(); }
}
export function lifecycleSync<T>(runtime:string, fn:()=>T):T {
  if(nested(runtime)) return fn();
  const db=acquire(runtime);
  if(!db) throw new CmsError(423,'이미지 정리 또는 백업을 진행 중입니다. 잠시 후 다시 시도하세요.');
  return run(runtime,db,fn);
}
export async function lifecycle<T>(runtime:string, fn:()=>Promise<T>|T):Promise<T> {
  if(nested(runtime)) return fn();
  let db:Database.Database|null;
  while(!(db=acquire(runtime))) await new Promise(r=>setTimeout(r,25));
  const lease={path:resolve(runtime),active:true};
  try { return await context.run(lease,fn); }
  finally { lease.active=false; db.exec('ROLLBACK'); db.close(); }
}
